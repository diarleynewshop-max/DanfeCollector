/**
 * Regras de confronto de DOCUMENTOS FISCAIS (Bloco C) — R-DOC-01 a R-DOC-15
 *
 * Cruza os registros C100 do SPED com as NotaFiscal do DanfeCollector.
 */

import type { SpedFiscalParsed, SpedRegistroC100, SpedRegistro0150 } from '../types';
import { SpedCodigoSituacao, SpedIndicadorOperacao } from '../types';
import { limparCnpjSped, dataSpedParaDate } from '../parser';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaDocumento {
  codigoRegra: string;
  tipo: string;
  severidade: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'INFO';
  registroSped: string;
  linhaSped: number;
  campo: string;
  valorSped: string;
  valorDanfe: string;
  descricao: string;
  chaveNfe?: string;
  participanteCod?: string;
  fornecedorNome?: string;
  fornecedorCnpj?: string;
}

export interface NotaDanfeCompleta {
  chave: string;
  numero: string | null;
  serie: string | null;
  emitidaEm: Date;
  tipoOperacao: string | null; // "Entrada" | "Saída"
  naturezaOp: string | null;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  emitenteIe: string | null;
  emitenteUf: string | null;
  destNome: string | null;
  destCnpj: string | null;
  valorTotal: number | null;
  valorProdutos: number | null;
  valorFrete: number | null;
  valorDesconto: number | null;
  valorIcms: number | null;
  status: string;           // RESUMO | COMPLETA
  situacaoSefaz: string;    // AUTORIZADA | CANCELADA | DENEGADA
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Tolerância padrão para comparação de valores monetários (centavos) */
const TOLERANCIA_VALOR = 0.05;

function valorDivergente(valorSped: number, valorDanfe: number | null, tolerancia = TOLERANCIA_VALOR): boolean {
  if (valorDanfe === null || valorDanfe === undefined) return false;
  return Math.abs(valorSped - valorDanfe) > tolerancia;
}

function severidadeValor(diferenca: number): 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'INFO' {
  const abs = Math.abs(diferenca);
  if (abs > 100) return 'CRITICA';
  if (abs > 10) return 'ALTA';
  if (abs > 1) return 'MEDIA';
  if (abs > TOLERANCIA_VALOR) return 'BAIXA';
  return 'INFO';
}

function formatarValor(v: number | null | undefined): string {
  if (v === null || v === undefined) return '(vazio)';
  return v.toFixed(2);
}

function dataSpedStr(d: string): string {
  // dd/mm/aaaa ou ddmmaaaa → YYYY-MM-DD
  const limpo = d.replace(/\//g, '');
  if (limpo.length !== 8) return d;
  return `${limpo.slice(4, 8)}-${limpo.slice(2, 4)}-${limpo.slice(0, 2)}`;
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta os documentos fiscais (C100) do SPED com as NF-e do DanfeCollector.
 *
 * @param sped - SPED parseado
 * @param notasDanfe - Map de chave → NotaDanfeCompleta (notas do período no DanfeCollector)
 * @param participantesPorCodigo - Map de COD_PART → SpedRegistro0150
 * @param cnpjEmpresa - CNPJ da empresa (raiz ou completo) para identificar notas próprias
 */
export function confrontarDocumentos(
  sped: SpedFiscalParsed,
  notasDanfe: Map<string, NotaDanfeCompleta>,
  participantesPorCodigo: Map<string, SpedRegistro0150>,
  cnpjEmpresa: string,
): DivergenciaDocumento[] {
  const divergencias: DivergenciaDocumento[] = [];
  const chavesNoSped = new Set<string>();

  for (const c100 of sped.notasFiscais) {
    const chave = (c100.chaveNfe ?? '').replace(/\D/g, '');
    if (!chave || chave.length !== 44) continue;

    // Pular NF-e com situação cancelada/inutilizada no SPED (não geram confronto)
    if (c100.codigoSituacao === SpedCodigoSituacao.CANCELADO ||
        c100.codigoSituacao === SpedCodigoSituacao.CANCELADO_EXTEMPORANEO ||
        c100.codigoSituacao === SpedCodigoSituacao.NUMERACAO_INUTILIZADA) {
      chavesNoSped.add(chave);
      continue;
    }

    chavesNoSped.add(chave);
    const participante = participantesPorCodigo.get(c100.codigoParticipante);
    const nomeForncedor = participante?.nome ?? '';
    const cnpjFornecedor = participante ? limparCnpjSped(participante.cnpj) : '';

    const notaDanfe = notasDanfe.get(chave);

    // R-DOC-01: NF no SPED sem XML no DanfeCollector
    if (!notaDanfe) {
      divergencias.push({
        codigoRegra: 'R-DOC-01',
        tipo: 'CHAVE_INEXISTENTE',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'CHV_NFE',
        valorSped: chave,
        valorDanfe: '(nota não encontrada)',
        descricao: `NF-e ${c100.numero || chave} de "${nomeForncedor}" declarada no SPED mas NÃO existe no DanfeCollector. Pode ser nota fantasma ou falha de sincronização.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
      continue;
    }

    // R-DOC-12: NF cancelada escriturada como ativa no SPED
    if (notaDanfe.situacaoSefaz === 'CANCELADA') {
      divergencias.push({
        codigoRegra: 'R-DOC-12',
        tipo: 'NF_CANCELADA',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'COD_SIT',
        valorSped: `${c100.codigoSituacao} (${c100.codigoSituacao === '00' ? 'Regular' : c100.codigoSituacao})`,
        valorDanfe: 'CANCELADA na SEFAZ',
        descricao: `NF-e ${c100.numero || chave} está CANCELADA na SEFAZ mas escriturada como regular no SPED. Remover do SPED ou retificar.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-13: NF denegada escriturada
    if (notaDanfe.situacaoSefaz === 'DENEGADA') {
      divergencias.push({
        codigoRegra: 'R-DOC-13',
        tipo: 'NF_DENEGADA',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'COD_SIT',
        valorSped: `${c100.codigoSituacao}`,
        valorDanfe: 'DENEGADA na SEFAZ',
        descricao: `NF-e ${c100.numero || chave} foi DENEGADA pela SEFAZ mas está escriturada no SPED.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-14: Tipo operação invertido
    const tipoSpedEntrada = c100.indicadorOperacao === SpedIndicadorOperacao.ENTRADA;
    const tipoXmlEntrada = notaDanfe.tipoOperacao === 'Entrada';
    if (notaDanfe.tipoOperacao && tipoSpedEntrada !== tipoXmlEntrada) {
      divergencias.push({
        codigoRegra: 'R-DOC-14',
        tipo: 'TIPO_OPERACAO',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'IND_OPER',
        valorSped: tipoSpedEntrada ? '0 (Entrada)' : '1 (Saída)',
        valorDanfe: notaDanfe.tipoOperacao,
        descricao: `NF-e ${c100.numero || chave}: tipo operação no SPED (${tipoSpedEntrada ? 'Entrada' : 'Saída'}) diverge do XML (${notaDanfe.tipoOperacao}). Operação escriturada invertida.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // Só confronta valores para notas COMPLETA (XML integral disponível)
    if (notaDanfe.status !== 'COMPLETA') continue;

    // R-DOC-03: Valor total divergente
    if (valorDivergente(c100.valorDocumento, notaDanfe.valorTotal)) {
      const diff = c100.valorDocumento - (notaDanfe.valorTotal ?? 0);
      divergencias.push({
        codigoRegra: 'R-DOC-03',
        tipo: 'VALOR_NF',
        severidade: severidadeValor(diff),
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_DOC',
        valorSped: formatarValor(c100.valorDocumento),
        valorDanfe: formatarValor(notaDanfe.valorTotal),
        descricao: `NF-e ${c100.numero || chave}: valor total no SPED (R$ ${formatarValor(c100.valorDocumento)}) diverge do XML (R$ ${formatarValor(notaDanfe.valorTotal)}). Diferença: R$ ${formatarValor(diff)}.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-04: Valor de produtos divergente
    if (valorDivergente(c100.valorMercadorias, notaDanfe.valorProdutos)) {
      const diff = c100.valorMercadorias - (notaDanfe.valorProdutos ?? 0);
      divergencias.push({
        codigoRegra: 'R-DOC-04',
        tipo: 'VALOR_NF',
        severidade: severidadeValor(diff),
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_MERC',
        valorSped: formatarValor(c100.valorMercadorias),
        valorDanfe: formatarValor(notaDanfe.valorProdutos),
        descricao: `NF-e ${c100.numero || chave}: valor de mercadorias no SPED (R$ ${formatarValor(c100.valorMercadorias)}) diverge do XML (R$ ${formatarValor(notaDanfe.valorProdutos)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-05: Valor de ICMS divergente
    if (valorDivergente(c100.valorIcms, notaDanfe.valorIcms)) {
      const diff = c100.valorIcms - (notaDanfe.valorIcms ?? 0);
      divergencias.push({
        codigoRegra: 'R-DOC-05',
        tipo: 'VALOR_ICMS',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_ICMS',
        valorSped: formatarValor(c100.valorIcms),
        valorDanfe: formatarValor(notaDanfe.valorIcms),
        descricao: `NF-e ${c100.numero || chave}: ICMS no SPED (R$ ${formatarValor(c100.valorIcms)}) diverge do XML (R$ ${formatarValor(notaDanfe.valorIcms)}). Diferença: R$ ${formatarValor(diff)}. Afeta diretamente a apuração.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-09: Valor frete divergente
    if (valorDivergente(c100.valorFrete, notaDanfe.valorFrete)) {
      const diff = c100.valorFrete - (notaDanfe.valorFrete ?? 0);
      divergencias.push({
        codigoRegra: 'R-DOC-09',
        tipo: 'VALOR_FRETE',
        severidade: 'MEDIA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_FRT',
        valorSped: formatarValor(c100.valorFrete),
        valorDanfe: formatarValor(notaDanfe.valorFrete),
        descricao: `NF-e ${c100.numero || chave}: valor de frete no SPED (R$ ${formatarValor(c100.valorFrete)}) diverge do XML (R$ ${formatarValor(notaDanfe.valorFrete)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-10: Valor desconto divergente
    if (valorDivergente(c100.valorDesconto, notaDanfe.valorDesconto)) {
      const diff = c100.valorDesconto - (notaDanfe.valorDesconto ?? 0);
      divergencias.push({
        codigoRegra: 'R-DOC-10',
        tipo: 'VALOR_DESCONTO',
        severidade: 'MEDIA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_DESC',
        valorSped: formatarValor(c100.valorDesconto),
        valorDanfe: formatarValor(notaDanfe.valorDesconto),
        descricao: `NF-e ${c100.numero || chave}: valor de desconto no SPED (R$ ${formatarValor(c100.valorDesconto)}) diverge do XML (R$ ${formatarValor(notaDanfe.valorDesconto)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }

    // R-DOC-11: Data emissão divergente
    const dataSpedDate = dataSpedParaDate(c100.dataDocumento);
    if (dataSpedDate && notaDanfe.emitidaEm) {
      const diffDias = Math.abs(dataSpedDate.getTime() - notaDanfe.emitidaEm.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDias > 1) { // mais de 1 dia de diferença
        divergencias.push({
          codigoRegra: 'R-DOC-11',
          tipo: 'DATA_EMISSAO',
          severidade: 'MEDIA',
          registroSped: 'C100',
          linhaSped: c100.linha,
          campo: 'DT_DOC',
          valorSped: dataSpedStr(c100.dataDocumento),
          valorDanfe: notaDanfe.emitidaEm.toISOString().slice(0, 10),
          descricao: `NF-e ${c100.numero || chave}: data no SPED (${dataSpedStr(c100.dataDocumento)}) diverge do XML (${notaDanfe.emitidaEm.toISOString().slice(0, 10)}). Pode causar apuração no mês errado.`,
          chaveNfe: chave,
          participanteCod: c100.codigoParticipante,
          fornecedorNome: nomeForncedor,
          fornecedorCnpj: cnpjFornecedor,
        });
      }
    }
  }

  // R-DOC-02: NF no DanfeCollector ausente no SPED
  for (const [chave, nota] of Array.from(notasDanfe)) {
    if (chavesNoSped.has(chave)) continue;
    if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') continue;

    divergencias.push({
      codigoRegra: 'R-DOC-02',
      tipo: 'NF_AUSENTE_SPED',
      severidade: 'ALTA',
      registroSped: 'C100',
      linhaSped: 0,
      campo: 'CHV_NFE',
      valorSped: '(não encontrada no SPED)',
      valorDanfe: chave,
      descricao: `NF-e ${nota.numero || chave} de "${nota.emitenteNome || nota.emitenteCnpj}" (${nota.situacaoSefaz}) existe no DanfeCollector mas NÃO foi escriturada no SPED. Nota "perdida" pelo ERP.`,
      chaveNfe: chave,
      fornecedorNome: nota.emitenteNome ?? undefined,
      fornecedorCnpj: nota.emitenteCnpj ?? undefined,
    });
  }

  return divergencias;
}
