const PAGAMENTO_API_URL =
  process.env.SITRAM_PAGAMENTO_API_URL || 'https://portal-sitram.sefaz.ce.gov.br/api-pagamento';

export interface SitramDocumentoPagamento {
  tipo?: string;
  situacao?: string;
  codigoDocumento?: string;
  valor?: string;
  pago?: boolean;
  dataValidade?: string | null;
}

export interface SitramDaeDetalhe {
  documentoCreditoId?: number;
  codigoIdentificadorUnico?: number;
  numeracaoCodigoBarras?: string;
  descricaoIdentificacaoContribuinte?: string;
  codigoReceitaCodigo?: number;
  codigoReceitaDescricao?: string;
  dataReferencia?: number;
  dataVencimento?: string;
  dataPagamento?: string | null;
  valorPrincipal?: number;
  valorMulta?: number;
  valorJuros?: number;
  valorPago?: number;
  valorRestituido?: number | null;
  siglaBanco?: string | null;
  valorDesconto?: number;
  situacaoDebito?: number;
  descricaoSituacaoDebito?: string;
  total?: number;
  sisdae?: boolean;
}

export interface SitramSimulacaoDae {
  responsavel?: string;
  receita?: string;
  dataVencimento?: string;
  dataPagamento?: string;
  notasFiscais?: number[];
  multa?: number;
  juros?: number;
  desconto?: number;
  total?: number;
  icmsDevido?: number;
  idLancamento?: string;
  isDifal?: boolean;
  isRefis?: boolean;
  credenciamento?: number;
  lancamento?: Array<{
    idLancamento?: string;
    icmsDevido?: number;
    codigoReceita?: number;
    total?: number;
    multa?: number;
    juros?: number;
    desconto?: number;
    tipoCredenciamento?: number;
  }>;
}

function pagamentoUrl(pathname: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${PAGAMENTO_API_URL.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function pagamentoFetch<T>(
  pathname: string,
  init: RequestInit = {},
  query?: Record<string, string | number | undefined>
): Promise<T> {
  const resp = await fetch(pagamentoUrl(pathname, query), {
    ...init,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DanfeCollector/1.0',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`SITRAM pagamento HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
  }

  return (await resp.json()) as T;
}

export async function consultarDocumentosDaePorLancamento(
  idLancamentoFront: string | number
): Promise<SitramDocumentoPagamento[]> {
  return pagamentoFetch<SitramDocumentoPagamento[]>(
    '/dae/buscarNumeroDae',
    {},
    { idLancamento: String(idLancamentoFront) }
  );
}

export async function consultarDocumentosDaeBatch(
  idsLancamentoFront: Array<string | number>
): Promise<Record<string, SitramDocumentoPagamento[]>> {
  const ids = idsLancamentoFront
    .map((id) => String(id).replace(/\D/g, ''))
    .filter(Boolean);
  if (ids.length === 0) return {};

  return pagamentoFetch<Record<string, SitramDocumentoPagamento[]>>('/dae/informacoes-documentos/batch', {
    method: 'POST',
    body: JSON.stringify(ids),
  });
}

export async function simularDaeNotaFiscal(
  idsLancamentoFront: Array<string | number>
): Promise<SitramSimulacaoDae[]> {
  const ids = idsLancamentoFront
    .map((id) => String(id).replace(/\D/g, ''))
    .filter(Boolean);
  if (ids.length === 0) return [];

  const url = new URL(`${PAGAMENTO_API_URL.replace(/\/$/, '')}/dae/simularDaeNotaFiscal`);
  for (const id of ids) url.searchParams.append('idsLancamento', id);

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DanfeCollector/1.0',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`SITRAM pagamento HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
  }

  return (await resp.json()) as SitramSimulacaoDae[];
}

export async function consultarDaePorCodigo(
  codigoDocumento: string | number
): Promise<SitramDaeDetalhe> {
  const codigo = String(codigoDocumento).replace(/\D/g, '');
  if (!codigo) throw new Error('Codigo do DAE invalido.');

  return pagamentoFetch<SitramDaeDetalhe>('/pagamento/dae', {
    method: 'POST',
    body: JSON.stringify({ codigoIdentificadorUnico: Number(codigo) }),
  });
}

export async function emitirDaeNotaFiscal(simulacoes: SitramSimulacaoDae[]): Promise<string[]> {
  return pagamentoFetch<string[]>('/dae/emitir-dae', {
    method: 'POST',
    body: JSON.stringify(simulacoes),
  });
}
