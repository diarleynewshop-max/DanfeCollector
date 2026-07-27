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

export interface SitramPortalItemNotaFiscal {
  id?: number;
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
