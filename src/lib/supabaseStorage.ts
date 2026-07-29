import 'server-only';

/**
 * Leitura e escrita server-side de objetos privados do Supabase Storage.
 *
 * O adaptador nao usa variaveis NEXT_PUBLIC: a chave nunca vai para o browser.
 * Sem configuracao, ele retorna null para que os chamadores mantenham o fallback
 * para o disco local enquanto a migracao ainda estiver em andamento.
 */

const BUCKET_XML_PADRAO = 'danfe-xml';
const BUCKET_ANEXOS_PADRAO = 'danfe-anexos';
const TIMEOUT_PADRAO_MS = 20_000;

interface ConfiguracaoStorage {
  url: string;
  chave: string;
}

function valorEnv(...nomes: string[]): string | null {
  for (const nome of nomes) {
    const valor = process.env[nome]?.trim();
    if (valor) return valor;
  }
  return null;
}

function normalizarBucket(bucket: string): string {
  const normalizado = bucket.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(normalizado)) {
    throw new Error('Bucket do Supabase Storage invalido.');
  }
  return normalizado;
}

/** Normaliza e valida a chave antes de montar uma URL remota. */
export function normalizarChaveStorage(chave: string): string {
  const partes = chave
    .replace(/\\/g, '/')
    .replace(/^\.\/+/g, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);

  if (partes.length === 0 || partes.some((parte) => parte === '.' || parte === '..' || parte.includes('\0'))) {
    throw new Error('Chave de Storage invalida.');
  }

  return partes.join('/');
}

function configuracaoStorage(): ConfiguracaoStorage | null {
  // Use apenas as credenciais dedicadas do Danfe. Nunca aceite uma
  // SERVICE_ROLE_KEY compartilhada, pois ela tambem enxerga SCAN e Catalogo.
  const url = valorEnv('DANFE_SUPABASE_URL');
  const chave = valorEnv('DANFE_SUPABASE_KEY');
  if (!url || !chave) return null;

  return { url: url.replace(/\/+$/, ''), chave };
}

/** Indica se o processo recebeu URL e chave para operar o Storage. */
export function storageSupabaseConfigurado(): boolean {
  return configuracaoStorage() !== null;
}

function timeoutStorageMs(): number {
  const bruto = Number(process.env.DANFE_STORAGE_READ_TIMEOUT_MS);
  if (!Number.isFinite(bruto)) return TIMEOUT_PADRAO_MS;
  return Math.min(120_000, Math.max(1_000, Math.trunc(bruto)));
}

function urlObjeto(urlBase: string, bucket: string, chave: string): string {
  const caminho = normalizarChaveStorage(chave)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `${urlBase}/storage/v1/object/${encodeURIComponent(normalizarBucket(bucket))}/${caminho}`;
}

export function bucketXmlDanfe(): string {
  return normalizarBucket(process.env.DANFE_STORAGE_XML_BUCKET || BUCKET_XML_PADRAO);
}

export function bucketAnexosDanfe(): string {
  return normalizarBucket(process.env.DANFE_STORAGE_ANEXOS_BUCKET || BUCKET_ANEXOS_PADRAO);
}

/**
 * Converte um xmlPath antigo para a chave usada pelo script de migracao.
 * Ex.: /app/downloads/123/2026/07/a.xml -> downloads/123/2026/07/a.xml.
 */
export function chaveXmlLegada(caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  const normalizado = caminho.replace(/\\/g, '/').replace(/^\.\//, '');
  const minusculo = normalizado.toLowerCase();
  const marcador = '/downloads/';
  const indice = minusculo.lastIndexOf(marcador);
  const relativo = indice >= 0
    ? normalizado.slice(indice + marcador.length)
    : minusculo.startsWith('downloads/')
      ? normalizado.slice('downloads/'.length)
      : null;

  return relativo ? normalizarChaveStorage(`downloads/${relativo}`) : null;
}

/** Converte o caminho relativo legado de Anexo para a chave de Storage. */
export function chaveAnexoLegada(caminho: string | null | undefined): string | null {
  if (!caminho) return null;
  const normalizado = caminho.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const relativo = normalizado.toLowerCase().startsWith('anexos/')
    ? normalizado.slice('anexos/'.length)
    : normalizado;
  return relativo ? normalizarChaveStorage(`anexos/${relativo}`) : null;
}

/**
 * Le um objeto privado. Retorna null quando Storage ainda nao foi configurado
 * ou quando o objeto ainda nao foi copiado; demais erros ficam visiveis.
 */
export async function lerObjetoSupabase(
  bucket: string,
  chave: string | null | undefined,
): Promise<Buffer | null> {
  if (!chave) return null;
  const config = configuracaoStorage();
  if (!config) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutStorageMs());

  try {
    const resposta = await fetch(urlObjeto(config.url, bucket, chave), {
      headers: {
        authorization: `Bearer ${config.chave}`,
        apikey: config.chave,
        'cache-control': 'no-store',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (resposta.status === 404) return null;
    if (!resposta.ok) {
      const detalhe = (await resposta.text()).slice(0, 300);
      throw new Error(`Supabase Storage HTTP ${resposta.status}: ${detalhe || resposta.statusText}`);
    }

    return Buffer.from(await resposta.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Faz upload com upsert para uma chave deterministica. Retorna false quando o
 * Storage ainda nao esta configurado; erros de um Storage configurado sobem ao
 * chamador. Quando configurado, o chamador nao deve registrar um objeto apenas
 * no disco, pois o filesystem da Vercel nao e persistente.
 */
export async function salvarObjetoSupabase(
  bucket: string,
  chave: string,
  bytes: Buffer,
  mime: string,
): Promise<boolean> {
  const config = configuracaoStorage();
  if (!config) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutStorageMs());

  try {
    const resposta = await fetch(urlObjeto(config.url, bucket, chave), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.chave}`,
        apikey: config.chave,
        'content-type': mime || 'application/octet-stream',
        'cache-control': 'private, max-age=0, no-store',
        'x-upsert': 'true',
      },
      body: Uint8Array.from(bytes),
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!resposta.ok) {
      const detalhe = (await resposta.text()).slice(0, 300);
      throw new Error(`Supabase Storage HTTP ${resposta.status}: ${detalhe || resposta.statusText}`);
    }

    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remove um objeto privado. A ausencia do objeto remoto e idempotente.
 * Retorna false somente quando o Storage ainda nao foi configurado.
 */
export async function apagarObjetoSupabase(
  bucket: string,
  chave: string | null | undefined,
): Promise<boolean> {
  if (!chave) return false;
  const config = configuracaoStorage();
  if (!config) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutStorageMs());

  try {
    const resposta = await fetch(urlObjeto(config.url, bucket, chave), {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${config.chave}`,
        apikey: config.chave,
        'cache-control': 'no-store',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (resposta.status === 404) return true;
    if (!resposta.ok) {
      const detalhe = (await resposta.text()).slice(0, 300);
      throw new Error(`Supabase Storage HTTP ${resposta.status}: ${detalhe || resposta.statusText}`);
    }

    return true;
  } finally {
    clearTimeout(timer);
  }
}
