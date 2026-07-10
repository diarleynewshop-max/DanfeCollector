const PORTAL_API_URL = process.env.SITRAM_PORTAL_API_URL || 'https://portal-sitram.sefaz.ce.gov.br';

export interface SitramPortalPage<T> {
  content?: T[];
  totalElements?: number;
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
