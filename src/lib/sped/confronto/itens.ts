/**
 * Regras de confronto de ITENS (C170) — R-ITEM-01 a R-ITEM-10
 *
 * Cruza cada item do C170 do SPED com os itens do XML (det) parseados pelo DanfeCollector.
 * O XML é re-parseado usando o parser existente (detalhe.ts) para obter CFOP, CST, alíquota, etc.
 */

import type { SpedFiscalParsed, SpedRegistroC100, SpedRegistroC170, SpedRegistro0200 } from '../types';
import type { DanfeItem } from '../../sefaz/detalhe';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaItem {
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
  produtoCod?: string;
  fornecedorNome?: string;
  fornecedorCnpj?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const TOLERANCIA_VALOR = 0.05;
const TOLERANCIA_QTD = 0.001;

function formatarValor(v: number | null | undefined): string {
  if (v === null || v === undefined) return '(vazio)';
  return v.toFixed(2);
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta os itens (C170) de um C100 do SPED com os itens do XML (det) da NF-e.
 *
 * @param c100 - Registro C100 do SPED com itens (C170) vinculados
 * @param itensXml - Itens do XML parseados por detalhe.ts (DanfeItem[])
 * @param produtosPorCodigo - Mapa COD_ITEM → SpedRegistro0200 (para NCM default)
 * @param fornecedorNome - Nome do fornecedor (para mensagens)
 * @param fornecedorCnpj - CNPJ do fornecedor
 */
export function confrontarItens(
  c100: SpedRegistroC100,
  itensXml: DanfeItem[],
  produtosPorCodigo: Map<string, SpedRegistro0200>,
  fornecedorNome?: string,
  fornecedorCnpj?: string,
): DivergenciaItem[] {
  const divergencias: DivergenciaItem[] = [];
  const chave = c100.chaveNfe;

  // Mapa de número do item XML → DanfeItem (posição 1-indexed)
  const itensXmlPorNumero = new Map<number, DanfeItem>();
  for (const item of itensXml) {
    itensXmlPorNumero.set(item.nItem, item);
  }

  for (const c170 of c100.itens) {
    const numItem = parseInt(c170.numeroItem, 10);
    const itemXml = itensXmlPorNumero.get(numItem);

    if (!itemXml) {
      // Item no SPED sem correspondente no XML (por posição)
      // Pode ser diferença de numeração — tentamos não reportar se o C100 já foi flagado
      continue;
    }

    // R-ITEM-01: CFOP item divergente
    const cfopSped = (c170.cfop ?? '').trim();
    const cfopXml = (itemXml.cfop ?? '').trim();
    if (cfopSped && cfopXml && cfopSped !== cfopXml) {
      divergencias.push({
        codigoRegra: 'R-ITEM-01',
        tipo: 'CFOP',
        severidade: 'CRITICA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'CFOP',
        valorSped: cfopSped,
        valorDanfe: cfopXml,
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: CFOP no SPED (${cfopSped}) diverge do XML (${cfopXml}). CFOP define a natureza fiscal da operação.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-03: Alíquota ICMS divergente
    if (c170.aliquotaIcms > 0 || itemXml.pICMS > 0) {
      if (Math.abs(c170.aliquotaIcms - itemXml.pICMS) > 0.01) {
        divergencias.push({
          codigoRegra: 'R-ITEM-03',
          tipo: 'ALIQUOTA',
          severidade: 'ALTA',
          registroSped: 'C170',
          linhaSped: c170.linha,
          campo: 'ALIQ_ICMS',
          valorSped: `${c170.aliquotaIcms}%`,
          valorDanfe: `${itemXml.pICMS}%`,
          descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: alíquota ICMS no SPED (${c170.aliquotaIcms}%) diverge do XML (${itemXml.pICMS}%).`,
          chaveNfe: chave,
          participanteCod: c100.codigoParticipante,
          produtoCod: c170.codigoItem,
          fornecedorNome,
          fornecedorCnpj,
        });
      }
    }

    // R-ITEM-04: Base de cálculo ICMS item divergente
    if (Math.abs(c170.valorBaseIcms - itemXml.vBC) > TOLERANCIA_VALOR) {
      divergencias.push({
        codigoRegra: 'R-ITEM-04',
        tipo: 'BASE_CALCULO',
        severidade: 'ALTA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'VL_BC_ICMS',
        valorSped: formatarValor(c170.valorBaseIcms),
        valorDanfe: formatarValor(itemXml.vBC),
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: base de cálculo ICMS no SPED (R$ ${formatarValor(c170.valorBaseIcms)}) diverge do XML (R$ ${formatarValor(itemXml.vBC)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-05: Valor ICMS item divergente
    if (Math.abs(c170.valorIcms - itemXml.vICMS) > TOLERANCIA_VALOR) {
      divergencias.push({
        codigoRegra: 'R-ITEM-05',
        tipo: 'VALOR_ICMS',
        severidade: 'ALTA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'VL_ICMS',
        valorSped: formatarValor(c170.valorIcms),
        valorDanfe: formatarValor(itemXml.vICMS),
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: ICMS no SPED (R$ ${formatarValor(c170.valorIcms)}) diverge do XML (R$ ${formatarValor(itemXml.vICMS)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-06: NCM divergente
    const ncmSped = (c170.codigoNcm || '').replace(/\D/g, '');
    const ncmXml = (itemXml.ncm ?? '').replace(/\D/g, '');
    // Se o C170 não tiver NCM, buscar no 0200
    const ncmFinal = ncmSped || (produtosPorCodigo.get(c170.codigoItem)?.ncm ?? '').replace(/\D/g, '');
    if (ncmFinal && ncmXml && ncmFinal !== ncmXml) {
      divergencias.push({
        codigoRegra: 'R-ITEM-06',
        tipo: 'NCM_DIVERGENTE',
        severidade: 'MEDIA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'COD_NCM',
        valorSped: ncmFinal,
        valorDanfe: ncmXml,
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: NCM no SPED (${ncmFinal}) diverge do XML (${ncmXml}). NCM errado pode gerar tributação errada (IPI, ICMS-ST, PIS/COFINS).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-07: Quantidade divergente
    if (Math.abs(c170.quantidade - itemXml.quantidade) > TOLERANCIA_QTD) {
      divergencias.push({
        codigoRegra: 'R-ITEM-07',
        tipo: 'QUANTIDADE',
        severidade: 'MEDIA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'QTD',
        valorSped: c170.quantidade.toString(),
        valorDanfe: itemXml.quantidade.toString(),
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: quantidade no SPED (${c170.quantidade}) diverge do XML (${itemXml.quantidade}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-08: Valor item divergente
    if (Math.abs(c170.valorItem - itemXml.valorTotal) > TOLERANCIA_VALOR) {
      divergencias.push({
        codigoRegra: 'R-ITEM-08',
        tipo: 'VALOR_UNITARIO',
        severidade: 'MEDIA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'VL_ITEM',
        valorSped: formatarValor(c170.valorItem),
        valorDanfe: formatarValor(itemXml.valorTotal),
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: valor do item no SPED (R$ ${formatarValor(c170.valorItem)}) diverge do XML (R$ ${formatarValor(itemXml.valorTotal)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-09: CFOP de uso e consumo com crédito indevido
    // CFOPs de uso e consumo: x556 (compra de material), x407 (transferência uso consumo)
    // Se o CST indica crédito (00, 20) mas CFOP é de uso/consumo, é crédito indevido
    const cfopUsados = ['1556', '2556', '1407', '2407'];
    const cstCredito = ['00', '20', '10']; // CSTs que geram crédito
    if (cfopUsados.includes(cfopSped) && cstCredito.includes(c170.cstIcms)) {
      divergencias.push({
        codigoRegra: 'R-ITEM-09',
        tipo: 'CREDITO_INDEVIDO',
        severidade: 'ALTA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'CST_ICMS + CFOP',
        valorSped: `CST ${c170.cstIcms} + CFOP ${cfopSped}`,
        valorDanfe: 'Uso e consumo NÃO gera crédito',
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: CFOP ${cfopSped} (uso e consumo) com CST ${c170.cstIcms} que gera crédito de ICMS. Mercadoria para uso e consumo NÃO dá direito a crédito.`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }

    // R-ITEM-10: ICMS-ST divergente no item
    const vIcmsStSped = c170.valorIcmsSt;
    const vIcmsStXml = itemXml.vICMSST;
    if (Math.abs(vIcmsStSped - vIcmsStXml) > TOLERANCIA_VALOR) {
      divergencias.push({
        codigoRegra: 'R-ITEM-10',
        tipo: 'VALOR_ST',
        severidade: 'ALTA',
        registroSped: 'C170',
        linhaSped: c170.linha,
        campo: 'VL_ICMS_ST',
        valorSped: formatarValor(vIcmsStSped),
        valorDanfe: formatarValor(vIcmsStXml),
        descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero || chave}: ICMS-ST no SPED (R$ ${formatarValor(vIcmsStSped)}) diverge do XML (R$ ${formatarValor(vIcmsStXml)}).`,
        chaveNfe: chave,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome,
        fornecedorCnpj,
      });
    }
  }

  return divergencias;
}
