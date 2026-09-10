import { raizCnpj } from './notasIdentificacao';

export type NotaRedFlagInput = {
  tipoOperacao?: string | null;
  naturezaOp?: string | null;
  emitenteCnpj?: string | null;
  cnpj?: { cnpj?: string | null } | null;
};

function textoSemAcento(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase();
}

/**
 * A devolucao de mercadoria deve ser emitida por quem esta devolvendo (a empresa
 * destinataria da compra original), nunca pelo fornecedor. Uma nota de ENTRADA
 * (tpNF=0) com natureza "Devolucao" emitida pelo proprio fornecedor (CNPJ de
 * terceiro, nao da empresa) e um padrao proibido/fraudulento que precisa ser
 * sinalizado e tratado manualmente. Ex.: chave 35260114491821000425550010000125941013863013.
 */
export function notaEhRedFlagDevolucaoFornecedor(nota: NotaRedFlagInput): boolean {
  if (nota.tipoOperacao !== 'Entrada') return false;
  if (!textoSemAcento(nota.naturezaOp).includes('devolu')) return false;

  const emitenteRaiz = raizCnpj(nota.emitenteCnpj);
  const empresaRaiz = raizCnpj(nota.cnpj?.cnpj);
  if (!emitenteRaiz || !empresaRaiz) return false;

  return emitenteRaiz !== empresaRaiz;
}

export const REDFLAG_DEVOLUCAO_FORNECEDOR_MENSAGEM =
  'RED FLAG: nota de ENTRADA por DEVOLUCAO emitida pelo proprio fornecedor. O fornecedor nao pode emitir a devolucao em nome da empresa - isso e proibido e precisa ser tratado com o fornecedor.';
