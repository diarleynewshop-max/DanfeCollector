const PORTAL_API_URL = process.env.SITRAM_PORTAL_API_URL || 'https://portal-sitram.sefaz.ce.gov.br';

export interface SitramPortalPage<T> {
  content?: T[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
}

export interface SitramPortalNotaFiscal {
  id?: number;
  numero?: string | number;
  dataEmissao?: string;
  dataInclusao?: string;
  dataFatoGerador?: string;
  codigoEmitente?: string;
  nomeEmitente?: string;
  ufEmitente?: string;
  codigoDestinatario?: string;
  nomeDestinatario?: string;
  ufDestinatario?: string;
  situacaoDescricao?: string;
  situacaoDoImposto?: string;
  retorno?: boolean;
  selada?: boolean;
  situacaoTransitoLivre?: string;
  situacaoTransitoLivreDescricao?: string;
  situacaoAlteracao?: string;
  acaoFiscalSituacaoDescricao?: string;
  idAcaoFiscal?: string | number;
  descricaoOrgaoLocal?: string;
  orgaoLocalEventoSigla?: string;
  orgaoLocalEventoDescricao?: string;
  nomeTransportadora?: string | null;
}

export interface SitramPortalLancamento {
  id?: number;
  codigo?: number;
  descricao?: string;
  descricaoAbreviada?: string;
  valor?: number;
  valorPago?: number;
  vencimento?: string;
  siuacaoDescricao?: string;
  situacaoDescricao?: string;
  situacao?: string;
  identificadorUnico?: string | number;
}

export interface SitramPortalCalculadoraItem {
  trilha?: string;
}

export interface SitramPortalItemNotaFiscal {
  // O portal retorna este identificador como texto. Nao converta para number:
  // ele ultrapassa o limite seguro de inteiros do JavaScript.
  id?: string | number;
  numero?: string | number;
  codigoProduto?: string | number;
  ncm?: string;
  ncmDescricao?: string;
  descricaoProduto?: string;
  cfop?: string | number;
  cfopDescricao?: string;
  codigoCSTA?: string | number;
  codigoCSTB?: string | number;
  quantidade?: number;
  valorUnitario?: number;
  valorTotal?: number;
  valorAliquota?: number;
  valorBc?: number;
  valorBcICMSSt?: number;
  valorICMSSt?: number;
  valorIcmsDestacado?: number;
  icms?: number;
  valorFecop?: number;
  valorIPI?: number;
  tipoRegime?: string | number;
  tipoCobranca?: string | number;
  nomeConfiguracao?: string;
  tipoAlteracaoNotaItem?: string;
  calculadoraSitram?: SitramPortalCalculadoraItem;
}

function portalUrl(pathname: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${PORTAL_API_URL.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function portalGet<T>(pathname: string, query?: Record<string, string | number | undefined>): Promise<T> {
  const resp = await fetch(portalUrl(pathname, query), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DanfeCollector/1.0',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 404) {
      throw new Error('NF-e nao encontrada no SITRAM.');
    }
    throw new Error(`Portal SITRAM HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
  }

  return (await resp.json()) as T;
}

export async function consultarNotaFiscalSitramPorChave(
  chaveNfe: string,
  page = 0,
  size = 25
): Promise<SitramPortalPage<SitramPortalNotaFiscal>> {
  const chave = chaveNfe.replace(/\D/g, '');
  if (chave.length !== 44 || chave.slice(20, 22) !== '55') {
    throw new Error('Chave de NF-e invalida.');
  }

  return portalGet<SitramPortalPage<SitramPortalNotaFiscal>>(
    `/api-nota/notafiscal/por-chave-de-acesso/${chave}`,
    { page, size }
  );
}

export async function consultarLancamentosNotaFiscalSitram(
  idNotaFiscal: number
): Promise<SitramPortalLancamento[]> {
  return portalGet<SitramPortalLancamento[]>(`/api-nota/notafiscal/lancamentos-nota-fiscal/${idNotaFiscal}`);
}

export async function consultarItensNotaFiscalSitram(
  idNotaFiscal: number,
  page = 0,
  size = 100
): Promise<SitramPortalPage<SitramPortalItemNotaFiscal>> {
  return portalGet<SitramPortalPage<SitramPortalItemNotaFiscal>>(
    `/api-nota/notafiscal/itens-nota-fiscal/${idNotaFiscal}`,
    { page, size }
  );
}

export async function consultarTodosItensNotaFiscalSitram(
  idNotaFiscal: number,
  size = 100
): Promise<SitramPortalItemNotaFiscal[]> {
  const itens: SitramPortalItemNotaFiscal[] = [];
  let paginaAtual = 0;
  let totalPaginas = 1;

  do {
    const pagina = await consultarItensNotaFiscalSitram(idNotaFiscal, paginaAtual, size);
    itens.push(...(pagina.content ?? []));
    totalPaginas = Math.max(1, Math.min(Number(pagina.totalPages ?? 1), 20));
    paginaAtual += 1;
  } while (paginaAtual < totalPaginas);

  return itens;
}

export interface SitramPortalItensComCalculadora {
  itens: SitramPortalItemNotaFiscal[];
  consultados: number;
  falhas: number;
}

function temTrilhaDaCalculadora(item: SitramPortalItemNotaFiscal): boolean {
  return typeof item.calculadoraSitram?.trilha === 'string' && item.calculadoraSitram.trilha.trim().length > 0;
}

export async function consultarCalculadoraItemSitram(
  idItem: string | number
): Promise<SitramPortalCalculadoraItem> {
  const id = String(idItem).trim();
  if (!id) throw new Error('Item SITRAM sem identificador para calcular o ICMS.');

  return portalGet<SitramPortalCalculadoraItem>(`/api-calculadora/${encodeURIComponent(id)}`);
}

export async function consultarCalculadorasItensSitram(
  itens: SitramPortalItemNotaFiscal[],
  concorrencia = 4
): Promise<SitramPortalItensComCalculadora> {
  const resultado = itens.map((item) => ({ ...item }));
  const pendentes = resultado
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => {
      const id = item.id === undefined || item.id === null ? '' : String(item.id).trim();
      return Boolean(id) && !temTrilhaDaCalculadora(item);
    });

  let proximo = 0;
  let consultados = 0;
  let falhas = 0;
  const totalWorkers = Math.min(Math.max(1, Math.trunc(concorrencia) || 4), pendentes.length);

  async function worker(): Promise<void> {
    while (proximo < pendentes.length) {
      const atual = pendentes[proximo++];
      const id = String(atual.item.id).trim();
      consultados += 1;

      try {
        const calculadoraSitram = await consultarCalculadoraItemSitram(id);
        if (typeof calculadoraSitram.trilha !== 'string' || !calculadoraSitram.trilha.trim()) {
          falhas += 1;
          continue;
        }
        resultado[atual.indice] = { ...atual.item, calculadoraSitram };
      } catch {
        // A listagem do item continua valida; a classificacao por lancamentos
        // cobre apenas o caso em que a calculadora individual nao respondeu.
        falhas += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: totalWorkers }, () => worker()));

  return { itens: resultado, consultados, falhas };
}
