import { prisma } from './prisma';
import { etiquetaComStatusRecebimento } from './nfStatusIntegration';

// Webhook de entrada: o Hexon empurra o status da NF e gravamos nos mesmos
// campos `recebimento*` que o painel já exibe. Não há alteração de schema.

export const HEXON_MAX_NOTAS_POR_LOTE = 100;
const MAX_TEXTO = 120;

export type ResultadoHexonStatus =
  | 'ATUALIZADO'
  | 'SEM_ALTERACAO'
  | 'IGNORADO_DESATUALIZADO'
  | 'NOTA_NAO_ENCONTRADA'
  | 'INVALIDO';

export type ItemResultadoHexon = {
  indice: number;
  chave: string | null;
  ok: boolean;
  resultado: ResultadoHexonStatus;
  status: string | null;
  message: string;
  erros?: string[];
};

type AtualizacaoValida = {
  chave: string;
  status: string;
  // undefined = campo não enviado (mantém valor atual); null = limpar
  kanbanStatus: string | null | undefined;
  statusOperacional: string | null | undefined;
  statusOperacionalCodigo: string | null | undefined;
  atualizadoEm: Date;
  atualizadoPor: string;
};

function textoOpcional(
  obj: Record<string, unknown>,
  campo: string,
  erros: string[]
): string | null | undefined {
  if (!(campo in obj) || obj[campo] === undefined) return undefined;
  const valor = obj[campo];
  if (valor === null) return null;
  if (typeof valor === 'number') return String(valor);
  if (typeof valor !== 'string') {
    erros.push(`${campo} deve ser texto ou null.`);
    return undefined;
  }
  const limpo = valor.trim();
  if (limpo.length > MAX_TEXTO) {
    erros.push(`${campo} excede ${MAX_TEXTO} caracteres.`);
    return undefined;
  }
  return limpo || null;
}

export function normalizarStatusHexon(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ').toUpperCase();
}

function validarItem(bruto: unknown): { ok: true; item: AtualizacaoValida } | { ok: false; chave: string | null; erros: string[] } {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return { ok: false, chave: null, erros: ['Cada nota deve ser um objeto JSON.'] };
  }
  const obj = bruto as Record<string, unknown>;
  const erros: string[] = [];

  const chaveRaw = typeof obj.chave === 'string' || typeof obj.chave === 'number' ? String(obj.chave) : '';
  const chave = chaveRaw.replace(/\D/g, '');
  if (chave.length !== 44) erros.push('chave obrigatoria com 44 digitos.');

  const statusRaw = typeof obj.status === 'string' ? normalizarStatusHexon(obj.status) : '';
  if (!statusRaw) erros.push('status obrigatorio (texto nao vazio).');
  else if (statusRaw.length > MAX_TEXTO) erros.push(`status excede ${MAX_TEXTO} caracteres.`);

  const kanbanStatus = textoOpcional(obj, 'kanbanStatus', erros);
  const statusOperacional = textoOpcional(obj, 'statusOperacional', erros);
  const statusOperacionalCodigo = textoOpcional(obj, 'statusOperacionalCodigo', erros);
  const atualizadoPorRaw = textoOpcional(obj, 'atualizadoPor', erros);

  let atualizadoEm = new Date();
  if (obj.atualizadoEm !== undefined && obj.atualizadoEm !== null) {
    const data = typeof obj.atualizadoEm === 'string' ? new Date(obj.atualizadoEm) : null;
    if (!data || Number.isNaN(data.getTime())) {
      erros.push('atualizadoEm deve ser data ISO 8601 (ex.: 2026-09-14T10:30:00-03:00).');
    } else if (data.getTime() > Date.now() + 5 * 60 * 1000) {
      erros.push('atualizadoEm nao pode estar no futuro.');
    } else {
      atualizadoEm = data;
    }
  }

  if (erros.length > 0) return { ok: false, chave: chave || null, erros };

  return {
    ok: true,
    item: {
      chave,
      status: statusRaw,
      kanbanStatus,
      statusOperacional,
      statusOperacionalCodigo,
      atualizadoEm,
      atualizadoPor: atualizadoPorRaw || 'Hexon',
    },
  };
}

async function aplicarItem(item: AtualizacaoValida, indice: number): Promise<ItemResultadoHexon> {
  const nota = await prisma.notaFiscal.findUnique({
    where: { chave: item.chave },
    select: {
      id: true,
      etiqueta: true,
      recebimentoStatus: true,
      recebimentoKanbanStatus: true,
      recebimentoStatusOperacional: true,
      recebimentoStatusOperacionalCodigo: true,
      recebimentoAtualizadoEm: true,
    },
  });

  if (!nota) {
    return {
      indice,
      chave: item.chave,
      ok: false,
      resultado: 'NOTA_NAO_ENCONTRADA',
      status: null,
      message: 'Nota fiscal nao encontrada no Proton-e. Reenvie depois que a nota for importada.',
    };
  }

  // Entregas fora de ordem: nunca deixa um status antigo sobrescrever um mais novo.
  if (nota.recebimentoAtualizadoEm && item.atualizadoEm.getTime() < nota.recebimentoAtualizadoEm.getTime()) {
    return {
      indice,
      chave: item.chave,
      ok: true,
      resultado: 'IGNORADO_DESATUALIZADO',
      status: nota.recebimentoStatus,
      message: `Ignorado: ja existe status mais recente (${nota.recebimentoAtualizadoEm.toISOString()}).`,
    };
  }

  const kanbanStatus = item.kanbanStatus === undefined ? nota.recebimentoKanbanStatus : item.kanbanStatus;
  const statusOperacional = item.statusOperacional === undefined ? nota.recebimentoStatusOperacional : item.statusOperacional;
  const statusOperacionalCodigo = item.statusOperacionalCodigo === undefined
    ? nota.recebimentoStatusOperacionalCodigo
    : item.statusOperacionalCodigo;

  const semAlteracao =
    nota.recebimentoStatus === item.status &&
    nota.recebimentoKanbanStatus === kanbanStatus &&
    nota.recebimentoStatusOperacional === statusOperacional &&
    nota.recebimentoStatusOperacionalCodigo === statusOperacionalCodigo;

  const etiqueta = etiquetaComStatusRecebimento(nota.etiqueta, nota.recebimentoStatus, item.status);

  await prisma.notaFiscal.update({
    where: { id: nota.id },
    data: {
      recebimentoStatus: item.status,
      recebimentoKanbanStatus: kanbanStatus,
      recebimentoStatusOperacional: statusOperacional,
      recebimentoStatusOperacionalCodigo: statusOperacionalCodigo,
      recebimentoAtualizadoEm: item.atualizadoEm,
      recebimentoAtualizadoPor: item.atualizadoPor,
      recebimentoConsultadoEm: new Date(),
      recebimentoErro: null,
      etiqueta,
    },
  });

  return {
    indice,
    chave: item.chave,
    ok: true,
    resultado: semAlteracao ? 'SEM_ALTERACAO' : 'ATUALIZADO',
    status: item.status,
    message: semAlteracao ? 'Status ja estava registrado.' : `Status atualizado para ${item.status}.`,
  };
}

export async function processarStatusHexon(itens: unknown[]): Promise<ItemResultadoHexon[]> {
  const resultados: ItemResultadoHexon[] = [];
  for (let indice = 0; indice < itens.length; indice++) {
    const validacao = validarItem(itens[indice]);
    if (!validacao.ok) {
      resultados.push({
        indice,
        chave: validacao.chave,
        ok: false,
        resultado: 'INVALIDO',
        status: null,
        message: 'Payload invalido.',
        erros: validacao.erros,
      });
      continue;
    }
    try {
      resultados.push(await aplicarItem(validacao.item, indice));
    } catch (error: unknown) {
      console.error('[hexon-status-nf] erro ao aplicar status', validacao.item.chave, error);
      throw error;
    }
  }
  return resultados;
}
