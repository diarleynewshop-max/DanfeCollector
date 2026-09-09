import * as fs from 'fs';
import * as path from 'path';

type EmpresaErp = 'NEWSHOP' | 'FACIL' | 'SOYE' | 'SEFULY';

type NotaFiscalCompraRaw = Record<string, unknown>;

export type NotaFiscalCompraErp = {
  codigo: number | null;
  chave: string;
  numero: string | null;
  serie: string | null;
  situacao: string | null;
  tipoOperacao: string | null;
  fornecedor: string | null;
  valor: number | null;
  dataEmissao: string | null;
};

export type ResultadoNotaFiscalCompraErp =
  | { found: true; nota: NotaFiscalCompraErp; totalRegistros: number }
  | { found: false; totalRegistros: number };

const HOSTS: Record<EmpresaErp, string> = {
  NEWSHOP: 'newshop.varejofacil.com',
  FACIL: 'facil.varejofacil.com',
  SOYE: 'facil.varejofacil.com',
  SEFULY: 'sefuly.varejofacil.com',
};

const webSessionCache = new Map<string, string>();

function envLocal(chave: string): string {
  const direto = process.env[chave];
  if (direto?.trim()) return direto.trim();

  const arquivo = path.join(process.cwd(), '.env');
  if (!fs.existsSync(arquivo)) return '';

  const regex = new RegExp(`^${chave}\\s*=\\s*(.*)$`, 'm');
  const match = fs.readFileSync(arquivo, 'utf8').match(regex);
  if (!match) return '';

  const valor = match[1].trim();
  if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
    return valor.slice(1, -1).trim();
  }
  return valor;
}

function baseEmpresa(empresa: EmpresaErp): EmpresaErp {
  if (empresa === 'SOYE') return 'FACIL';
  if (empresa === 'SEFULY') return 'NEWSHOP';
  return empresa;
}

function envErp(empresa: EmpresaErp, chave: 'URL' | 'USERNAME' | 'PASSWORD' | 'WEB_COOKIE' | 'SESSION_COOKIE'): string {
  const base = baseEmpresa(empresa);
  const allowGeneric = empresa !== 'SEFULY';
  return (
    envLocal(`ERP_${chave}_${empresa}`) ||
    envLocal(`VAREJOFACIL_${chave}_${empresa}`) ||
    envLocal(`ERP_${chave}_${base}`) ||
    envLocal(`VAREJOFACIL_${chave}_${base}`) ||
    (allowGeneric ? envLocal(`ERP_${chave}`) : '') ||
    (allowGeneric ? envLocal(`VAREJOFACIL_${chave}`) : '') ||
    ''
  ).trim();
}

function normalizarEmpresa(valor: string | null | undefined): EmpresaErp {
  const texto = String(valor ?? '').trim().toUpperCase();
  if (texto.includes('SEFULY')) return 'SEFULY';
  if (texto.includes('SOYE')) return 'SOYE';
  if (texto.includes('FACIL')) return 'FACIL';
  return 'NEWSHOP';
}

function webBaseUrl(empresa: EmpresaErp): string {
  const base = baseEmpresa(empresa);
  const configurada = (envErp(empresa, 'URL') || `https://${HOSTS[base]}`).replace(/\/$/, '');
  return configurada.endsWith('/api') ? configurada.slice(0, -4) : configurada;
}

function sessionCacheKey(empresa: EmpresaErp): string {
  return `${empresa}:${webBaseUrl(empresa)}:${envErp(empresa, 'USERNAME')}`;
}

function normalizarCookie(valor: string): string {
  const cookie = valor.trim();
  if (!cookie) return '';
  return cookie.includes('=') ? cookie : `JSESSIONID=${cookie}`;
}

async function obterCookieWeb(empresa: EmpresaErp): Promise<string> {
  const configurado = normalizarCookie(envErp(empresa, 'WEB_COOKIE') || envErp(empresa, 'SESSION_COOKIE'));
  if (configurado) return configurado;

  const username = envErp(empresa, 'USERNAME');
  const password = envErp(empresa, 'PASSWORD');
  if (!username || !password) {
    throw new Error(`Credenciais ERP nao configuradas para ${empresa}. Configure ERP_WEB_COOKIE_${empresa} ou ERP_USERNAME_${empresa}/ERP_PASSWORD_${empresa}.`);
  }

  const cacheKey = sessionCacheKey(empresa);
  const cached = webSessionCache.get(cacheKey);
  if (cached) return cached;

  const baseUrl = webBaseUrl(empresa);
  const params = new URLSearchParams({ j_username: username, j_password: password });
  const resposta = await fetch(`${baseUrl}/j_spring_security_check?${params.toString()}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${baseUrl}/login`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  const setCookie = resposta.headers.get('set-cookie') || '';
  const match = setCookie.match(/JSESSIONID=([^;]+)/);
  if (!match?.[1]) {
    throw new Error(`ERP nao retornou sessao web para ${empresa}.`);
  }

  const cookie = `JSESSIONID=${match[1]}`;
  webSessionCache.set(cacheKey, cookie);
  return cookie;
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo || null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const parsed = Number(valor.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizarNota(raw: NotaFiscalCompraRaw, chaveConsultada: string): NotaFiscalCompraErp {
  return {
    codigo: numero(raw.codigo),
    chave: texto(raw.chaveDaNfe) ?? chaveConsultada,
    numero: texto(raw.numeroDoDocumento),
    serie: texto(raw.serie),
    situacao: texto(raw.situacao),
    tipoOperacao: texto(raw.tipoDeOperacao),
    fornecedor: texto(raw.descricaoDaPessoa),
    valor: numero(raw.valorDoDocumento),
    dataEmissao: texto(raw.dataDaEmissao),
  };
}

export async function consultarNotaFiscalCompraErp(
  chave: string,
  empresaInput?: string | null,
): Promise<ResultadoNotaFiscalCompraErp> {
  const chaveLimpa = String(chave ?? '').replace(/\D/g, '');
  if (chaveLimpa.length !== 44) throw new Error('Chave NF-e invalida para consulta no ERP.');

  const empresa = normalizarEmpresa(empresaInput);
  const baseUrl = webBaseUrl(empresa);
  const cookie = await obterCookieWeb(empresa);
  const url = new URL(`${baseUrl}/notaFiscalCompra/pesquisa`);
  url.searchParams.set('filtro.notaFiscal.loja.codigo', '');
  url.searchParams.set('filtro.notaFiscal.pessoa.codigo', '');
  url.searchParams.set('filtro.intervaloEmissao.inicio', '');
  url.searchParams.set('filtro.intervaloEmissao.termino', '');
  url.searchParams.set('filtro.notaFiscal.chaveDaNfe', chaveLimpa);
  url.searchParams.set('filtro.notaFiscal.serie', '');
  url.searchParams.set('filtro.notaFiscal.numeroDoDocumento', '');
  url.searchParams.set('filtro.intervaloEntrada.inicio', '');
  url.searchParams.set('filtro.intervaloEntrada.termino', '');
  url.searchParams.set('filtro.skipPagina', '0');
  url.searchParams.set('filtro.pageSize', '10');
  url.searchParams.set('filtro.totalPagina', '-1');
  url.searchParams.set('filtro.ordem', 'DATADAEMISSAO');
  url.searchParams.set('filtro.direcao', 'desc');
  url.searchParams.set('_', String(Date.now()));

  const resposta = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${baseUrl}/notaFiscalCompra/index`,
      Cookie: cookie,
      'User-Agent': 'DanfeCollector/1.0',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  if ([301, 302, 303, 307, 308].includes(resposta.status)) {
    webSessionCache.delete(sessionCacheKey(empresa));
    throw new Error('Sessao ERP expirada. Atualize o cookie ou credenciais.');
  }

  const body = await resposta.text();
  const contentType = resposta.headers.get('content-type') || '';
  if (!resposta.ok) throw new Error(`ERP retornou HTTP ${resposta.status}.`);
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('ERP retornou resposta nao JSON. Provavel sessao expirada.');
  }

  const payload = JSON.parse(body) as { totalRegistros?: unknown; notas?: unknown };
  const notas = Array.isArray(payload.notas) ? payload.notas : [];
  const totalRegistros = numero(payload.totalRegistros) ?? notas.length;
  if (notas.length === 0) return { found: false, totalRegistros };

  return {
    found: true,
    totalRegistros,
    nota: normalizarNota(notas[0] as NotaFiscalCompraRaw, chaveLimpa),
  };
}
