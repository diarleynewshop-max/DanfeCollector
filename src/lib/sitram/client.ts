import { obterPemDoCertificado } from '../sefaz/assinatura';

const BASE_URL =
  process.env.SITRAM_API_URL || 'https://api.sefaz.ce.gov.br/service-transportadora-sitram';

export interface SitramSituacao {
  codigo?: number;
  descricao?: string;
}

export interface SitramConhecimentoTransporte {
  id?: number;
  numeroCTE?: string;
  chaveAcesso?: string;
  numeroAWB?: string;
}

export interface SitramLancamento {
  codReceita?: number;
  descricaoRec?: string;
  urlGerarDae?: string;
  icmsCalculado?: number;
  icmsDevido?: number;
  situacao?: string;
}

export interface SitramPendenciaMensagem {
  mensagem?: string;
  data?: string;
}

export interface SitramPendencia {
  numero?: number;
  situacao?: number;
  descricaoSituacao?: string;
  mensagens?: SitramPendenciaMensagem[];
  awb?: string;
}

export interface SitramNotaFiscal {
  id?: number;
  numeroContainer?: string;
  chaveAcesso?: string;
  notaLiberada?: number;
  situacao?: number;
  descricaoSituacao?: string;
  descricaoStatusNF?: string;
  chaveAcessoDocumentoVinculado?: string;
  tipoDocumentoVinculado?: string;
  awb?: number;
  pendenciasNotaFiscal?: SitramPendencia[];
  lancamentos?: SitramLancamento[];
  credenciamento?: string;
  liberadaParaPagamento?: boolean;
}

export interface SitramManifestoCarga {
  id?: number;
  data?: string;
  chaveAcesso?: string;
  acaoFiscal?: number;
  situacaoAcaoFiscal?: number;
  descricaoSituacao?: string;
  pendenciasAcaoFiscal?: SitramPendencia[];
  ctes?: SitramConhecimentoTransporte[];
  notasFiscais?: SitramNotaFiscal[];
}

export interface ConsultarManifestoOptions {
  numeroAWB?: string;
  chaveCTE?: string;
  numeroContainer?: string;
}

let bearerCache: string | null = null;

function certificadoBearer(): string {
  if (bearerCache) return bearerCache;

  const { certificatePem } = obterPemDoCertificado();
  const base64Cert = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');

  if (!base64Cert) {
    throw new Error('Nao foi possivel extrair o certificado publico do PFX.');
  }

  bearerCache = `Bearer ${base64Cert}`;
  return bearerCache;
}

function pathUrl(pathname: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${BASE_URL.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function sitramGet<T>(pathname: string, query?: Record<string, string | undefined>): Promise<T> {
  const resp = await fetch(pathUrl(pathname, query), {
    method: 'GET',
    headers: {
      Authorization: certificadoBearer(),
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `SITRAM ${resp.status}: certificado nao autorizado para este servico ou CNPJ.`
      );
    }
    throw new Error(`SITRAM HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
  }

  return (await resp.json()) as T;
}

export function listarSituacoesNotaFiscal(): Promise<SitramSituacao[]> {
  return sitramGet<SitramSituacao[]>('/situacao/nota-fiscal');
}

export function listarSituacoesConhecimentoTransporte(): Promise<SitramSituacao[]> {
  return sitramGet<SitramSituacao[]>('/situacao/conhecimento-transporte');
}

export function listarSituacoesAcaoFiscal(): Promise<SitramSituacao[]> {
  return sitramGet<SitramSituacao[]>('/situacao/acao-fiscal');
}

export function consultarManifestoCarga(
  chaveMdfe: string,
  options: ConsultarManifestoOptions = {}
): Promise<SitramManifestoCarga> {
  const chave = chaveMdfe.replace(/\D/g, '');
  if (chave.length !== 44) throw new Error('Chave de MDF-e invalida.');

  return sitramGet<SitramManifestoCarga>(`/manifesto-carga/${chave}`, {
    numeroAWB: options.numeroAWB?.replace(/\D/g, ''),
    chaveCTE: options.chaveCTE?.replace(/\D/g, ''),
    numeroContainer: options.numeroContainer?.trim(),
  });
}

export async function gerarDaeSitram(key: string): Promise<Buffer> {
  const resp = await fetch(pathUrl(`/gerar-dae/${encodeURIComponent(key)}`), {
    method: 'GET',
    headers: {
      Authorization: certificadoBearer(),
      Accept: 'application/pdf,application/octet-stream,*/*',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`SITRAM DAE HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
  }

  return Buffer.from(await resp.arrayBuffer());
}
