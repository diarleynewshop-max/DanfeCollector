import { prisma } from './prisma';
import * as fs from 'fs';
import * as path from 'path';

export const STATUS_RECEBIMENTO_CONHECIDOS = [
  'NF A CHEGAR',
  'CONCLUIDO RECEBIMENTO',
  'AGUARDANDO PRECO',
  'AGUARDANDO CADASTRO',
  'AGUARDANDO ENVIO',
  'NF ENVIADA',
] as const;

export type ResultadoStatusRecebimento =
  | {
      found: true;
      id: string | null;
      loja: string | null;
      numero: string | null;
      serie: string | null;
      fornecedor: string | null;
      destinatarioNome: string | null;
      chaveNfe: string;
      status: string;
      kanbanStatus: string | null;
      statusOperacional: string | null;
      statusOperacionalCodigo: string | null;
      kanbanUpdatedAt: string | null;
      kanbanUpdatedBy: string | null;
      dataEmissao: string | null;
      dataRecebimentoCd: string | null;
      dataInicioConferencia: string | null;
      dataConclusaoConferencia: string | null;
      dataFinalizacao: string | null;
      createdAt: string | null;
    }
  | { found: false };

export type ConsultaStatusRecebimento = {
  chave: string;
  success: boolean;
  found: boolean;
  status: string | null;
  etiqueta: string | null;
  message: string;
};

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

function configStatusRecebimento() {
  const baseUrl = (envLocal('NF_STATUS_API_URL') || 'https://api-recebimento.newgrup.cloud/functions/v1/nf-status-integration').trim();
  const token = envLocal('NF_STATUS_API_TOKEN');
  return { baseUrl, token };
}

function normalizarChaveNfe(chave: string): string {
  return String(chave ?? '').replace(/\D/g, '');
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo || null;
}

function parseData(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function etiquetasSemStatusRecebimento(etiquetaAtual: string | null | undefined, statusAnterior: string | null | undefined): string[] {
  const remover = new Set<string>(STATUS_RECEBIMENTO_CONHECIDOS);
  if (statusAnterior) remover.add(statusAnterior);

  return String(etiquetaAtual ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && !remover.has(tag));
}

function etiquetaComStatusRecebimento(etiquetaAtual: string | null | undefined, statusAnterior: string | null | undefined, statusNovo: string | null): string | null {
  const tags = etiquetasSemStatusRecebimento(etiquetaAtual, statusAnterior);
  if (statusNovo && !tags.includes(statusNovo)) tags.push(statusNovo);
  return tags.length > 0 ? tags.join(',') : null;
}

async function chamarApiStatusRecebimento(chave: string): Promise<ResultadoStatusRecebimento> {
  const { baseUrl, token } = configStatusRecebimento();
  if (!token) throw new Error('NF_STATUS_API_TOKEN nao configurado no servidor.');

  const url = new URL(baseUrl);
  url.searchParams.set('chave', chave);

  const resposta = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });

  let payload: unknown = null;
  const textoResposta = await resposta.text();
  if (textoResposta) {
    try {
      payload = JSON.parse(textoResposta);
    } catch {
      throw new Error(`API status NF retornou resposta invalida HTTP ${resposta.status}.`);
    }
  }

  if (resposta.status === 404) return { found: false };
  if (!resposta.ok) {
    const erro = typeof payload === 'object' && payload && 'error' in payload ? String((payload as { error?: unknown }).error ?? '') : '';
    throw new Error(`API status NF HTTP ${resposta.status}: ${erro || resposta.statusText}`);
  }

  const result = typeof payload === 'object' && payload && 'result' in payload
    ? (payload as { result?: unknown }).result
    : null;

  if (!result || typeof result !== 'object') {
    throw new Error('API status NF nao retornou result.');
  }

  const raw = result as Record<string, unknown>;
  if (raw.found === false) return { found: false };

  const status = texto(raw.status);
  const chaveNfe = normalizarChaveNfe(texto(raw.chaveNfe) ?? chave);
  if (!status) throw new Error('API status NF retornou nota sem status.');
  if (chaveNfe.length !== 44) throw new Error('API status NF retornou chave invalida.');

  return {
    found: true,
    id: texto(raw.id),
    loja: texto(raw.loja),
    numero: texto(raw.numero),
    serie: texto(raw.serie),
    fornecedor: texto(raw.fornecedor),
    destinatarioNome: texto(raw.destinatarioNome),
    chaveNfe,
    status,
    kanbanStatus: texto(raw.kanbanStatus),
    statusOperacional: texto(raw.statusOperacional),
    statusOperacionalCodigo: texto(raw.statusOperacionalCodigo),
    kanbanUpdatedAt: texto(raw.kanbanUpdatedAt),
    kanbanUpdatedBy: texto(raw.kanbanUpdatedBy),
    dataEmissao: texto(raw.dataEmissao),
    dataRecebimentoCd: texto(raw.dataRecebimentoCd),
    dataInicioConferencia: texto(raw.dataInicioConferencia),
    dataConclusaoConferencia: texto(raw.dataConclusaoConferencia),
    dataFinalizacao: texto(raw.dataFinalizacao),
    createdAt: texto(raw.createdAt),
  };
}

export async function consultarStatusRecebimentoPorNotaId(notaId: number): Promise<ConsultaStatusRecebimento> {
  const nota = await prisma.notaFiscal.findUnique({
    where: { id: notaId },
    select: { id: true, chave: true, etiqueta: true, recebimentoStatus: true },
  });
  if (!nota) {
    return { chave: '', success: false, found: false, status: null, etiqueta: null, message: 'Nota nao encontrada.' };
  }

  const chave = normalizarChaveNfe(nota.chave);
  if (chave.length !== 44) {
    return { chave: nota.chave, success: false, found: false, status: null, etiqueta: null, message: 'Chave NF-e invalida.' };
  }

  try {
    const result = await chamarApiStatusRecebimento(chave);
    const consultadoEm = new Date();

    if (!result.found) {
      const etiqueta = etiquetaComStatusRecebimento(nota.etiqueta, nota.recebimentoStatus, null);
      await prisma.notaFiscal.update({
        where: { id: nota.id },
        data: {
          recebimentoStatus: null,
          recebimentoKanbanStatus: null,
          recebimentoStatusOperacional: null,
          recebimentoStatusOperacionalCodigo: null,
          recebimentoAtualizadoEm: null,
          recebimentoAtualizadoPor: null,
          recebimentoConsultadoEm: consultadoEm,
          recebimentoErro: 'NF nao encontrada no app de recebimento.',
          etiqueta,
        },
      });
      return { chave, success: true, found: false, status: null, etiqueta, message: 'NF nao encontrada no app de recebimento.' };
    }

    const etiqueta = etiquetaComStatusRecebimento(nota.etiqueta, nota.recebimentoStatus, result.status);
    await prisma.notaFiscal.update({
      where: { id: nota.id },
      data: {
        recebimentoStatus: result.status,
        recebimentoKanbanStatus: result.kanbanStatus,
        recebimentoStatusOperacional: result.statusOperacional,
        recebimentoStatusOperacionalCodigo: result.statusOperacionalCodigo,
        recebimentoAtualizadoEm: parseData(result.kanbanUpdatedAt),
        recebimentoAtualizadoPor: result.kanbanUpdatedBy,
        recebimentoConsultadoEm: consultadoEm,
        recebimentoErro: null,
        etiqueta,
      },
    });

    return { chave, success: true, found: true, status: result.status, etiqueta, message: `Status recebido: ${result.status}.` };
  } catch (error: unknown) {
    const message = (error as Error).message || 'Erro ao consultar status da NF.';
    await prisma.notaFiscal.update({
      where: { id: nota.id },
      data: {
        recebimentoConsultadoEm: new Date(),
        recebimentoErro: message,
      },
    });
    return { chave, success: false, found: false, status: null, etiqueta: nota.etiqueta, message };
  }
}
