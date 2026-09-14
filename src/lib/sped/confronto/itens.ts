/**
 * Regras de confronto de ITENS (C170) — R-ITEM-00 a R-ITEM-10
 *
 * Cruza cada item do C170 do SPED com os itens do XML (det) parseados pelo DanfeCollector.
 *
 * Em notas de TERCEIROS (compras), o XML traz a visão do fornecedor (CFOP 5/6xxx,
 * ICMS destacado, ST retido) e o SPED traz a visão de quem comprou (CFOP 1/2xxx,
 * ICMS creditado). Nesses casos não se compara CFOP exato, alíquota, base nem ST —
 * só o que precisa bater dos dois lados.
 */

import type { SpedRegistroC100, SpedRegistro0200 } from '../types';
import { SpedIndicadorEmitente } from '../types';
import type { DanfeItem } from '../../sefaz/detalhe';
import { grupoCfopEntrada } from '../parser';

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

/** CFOPs de aquisição para uso e consumo / ativo que não dão crédito de ICMS */
const CFOPS_USO_CONSUMO = ['1556', '2556', '1407', '2407'];

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
 * @param produtosPorCodigo - Mapa COD_ITEM → SpedRegistro0200 (fonte do NCM)
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
  const numeroNf = c100.numero ? String(Number(c100.numero)) : chave;
  const terceiros = c100.indicadorEmitente === SpedIndicadorEmitente.TERCEIROS;

  // R-ITEM-00: se a quantidade de itens não bate, a numeração não casa e a comparação
  // item a item geraria alertas falsos. Avisa uma vez e não confere os itens.
  if (c100.itens.length !== itensXml.length) {
    return [{
      codigoRegra: 'R-ITEM-00',
      tipo: 'QUANTIDADE',
      severidade: 'INFO',
      registroSped: 'C100',
      linhaSped: c100.linha,
      campo: 'Qtde de itens',
      valorSped: `${c100.itens.length} itens`,
      valorDanfe: `${itensXml.length} itens`,
      descricao: `NF ${numeroNf}: o SPED tem ${c100.itens.length} itens e o XML tem ${itensXml.length}. O ERP pode ter agrupado ou desmembrado itens — a conferência item a item desta nota foi pulada.`,
      chaveNfe: chave,
      participanteCod: c100.codigoParticipante,
      fornecedorNome,
      fornecedorCnpj,
    }];
  }

  const itensXmlPorNumero = new Map<number, DanfeItem>();
  for (const item of itensXml) {
    itensXmlPorNumero.set(item.nItem, item);
  }

  for (const c170 of c100.itens) {
    const numItem = parseInt(c170.numeroItem, 10);
    const itemXml = itensXmlPorNumero.get(numItem);
    if (!itemXml) continue;

    const base = {
      registroSped: 'C170',
      linhaSped: c170.linha,
      chaveNfe: chave,
      participanteCod: c100.codigoParticipante,
      produtoCod: c170.codigoItem,
      fornecedorNome,
      fornecedorCnpj,
    };
    const rotulo = `NF ${numeroNf}, item ${c170.numeroItem} (${c170.descricao || itemXml.descricao})`;

    // R-ITEM-01: CFOP
    const cfopSped = (c170.cfop ?? '').trim();
    const cfopXml = (itemXml.cfop ?? '').trim();
    if (cfopSped && cfopXml) {
      if (terceiros) {
        // Compra: só o 1º dígito precisa corresponder (5→1 interna, 6→2 interestadual, 7→3 exterior)
        const esperado = grupoCfopEntrada(cfopXml);
        if (cfopSped.charAt(0) !== esperado) {
          divergencias.push({
            ...base,
            codigoRegra: 'R-ITEM-01',
            tipo: 'CFOP',
            severidade: 'ALTA',
            campo: 'CFOP',
            valorSped: cfopSped,
            valorDanfe: `${cfopXml} (esperado ${esperado}xxx na entrada)`,
            descricao: `${rotulo}: o fornecedor emitiu com CFOP ${cfopXml}, então a entrada deveria ser ${esperado}xxx, mas foi escriturada com ${cfopSped}. Operação interna/interestadual trocada.`,
          });
        }
      } else if (cfopSped !== cfopXml) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-ITEM-01',
          tipo: 'CFOP',
          severidade: 'ALTA',
          campo: 'CFOP',
          valorSped: cfopSped,
          valorDanfe: cfopXml,
          descricao: `${rotulo}: CFOP no SPED (${cfopSped}) diferente do XML emitido pela empresa (${cfopXml}).`,
        });
      }
    }

    if (!terceiros) {
      // R-ITEM-03: Alíquota ICMS (só nota própria)
      if ((c170.aliquotaIcms > 0 || itemXml.pICMS > 0) && Math.abs(c170.aliquotaIcms - itemXml.pICMS) > 0.01) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-ITEM-03',
          tipo: 'ALIQUOTA',
          severidade: 'ALTA',
          campo: 'ALIQ_ICMS',
          valorSped: `${c170.aliquotaIcms}%`,
          valorDanfe: `${itemXml.pICMS}%`,
          descricao: `${rotulo}: alíquota de ICMS no SPED (${c170.aliquotaIcms}%) diferente do XML (${itemXml.pICMS}%).`,
        });
      }

      // R-ITEM-04: Base de cálculo ICMS (só nota própria)
      if (Math.abs(c170.valorBaseIcms - itemXml.vBC) > TOLERANCIA_VALOR) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-ITEM-04',
          tipo: 'BASE_CALCULO',
          severidade: 'ALTA',
          campo: 'VL_BC_ICMS',
          valorSped: formatarValor(c170.valorBaseIcms),
          valorDanfe: formatarValor(itemXml.vBC),
          descricao: `${rotulo}: base de cálculo do ICMS no SPED (R$ ${formatarValor(c170.valorBaseIcms)}) diferente do XML (R$ ${formatarValor(itemXml.vBC)}).`,
        });
      }

      // R-ITEM-10: ICMS-ST (só nota própria)
      if (Math.abs(c170.valorIcmsSt - itemXml.vICMSST) > TOLERANCIA_VALOR) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-ITEM-10',
          tipo: 'VALOR_ST',
          severidade: 'ALTA',
          campo: 'VL_ICMS_ST',
          valorSped: formatarValor(c170.valorIcmsSt),
          valorDanfe: formatarValor(itemXml.vICMSST),
          descricao: `${rotulo}: ICMS-ST no SPED (R$ ${formatarValor(c170.valorIcmsSt)}) diferente do XML (R$ ${formatarValor(itemXml.vICMSST)}).`,
        });
      }
    }

    // R-ITEM-05: Valor ICMS
    // Nota própria: deve ser igual. Compra: crédito não pode ser maior que o destacado.
    const icmsErro = terceiros
      ? c170.valorIcms > itemXml.vICMS + TOLERANCIA_VALOR
      : Math.abs(c170.valorIcms - itemXml.vICMS) > TOLERANCIA_VALOR;
    if (icmsErro) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-ITEM-05',
        tipo: terceiros ? 'CREDITO_INDEVIDO' : 'VALOR_ICMS',
        severidade: 'ALTA',
        campo: 'VL_ICMS',
        valorSped: formatarValor(c170.valorIcms),
        valorDanfe: formatarValor(itemXml.vICMS),
        descricao: terceiros
          ? `${rotulo}: crédito de ICMS no SPED (R$ ${formatarValor(c170.valorIcms)}) é maior que o ICMS destacado pelo fornecedor (R$ ${formatarValor(itemXml.vICMS)}).`
          : `${rotulo}: ICMS no SPED (R$ ${formatarValor(c170.valorIcms)}) diferente do XML (R$ ${formatarValor(itemXml.vICMS)}).`,
      });
    }

    // R-ITEM-06: NCM do cadastro (0200) diferente do XML
    const ncmSped = (produtosPorCodigo.get(c170.codigoItem)?.ncm ?? '').replace(/\D/g, '');
    const ncmXml = (itemXml.ncm ?? '').replace(/\D/g, '');
    if (ncmSped && ncmXml && ncmSped !== ncmXml) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-ITEM-06',
        tipo: 'NCM_DIVERGENTE',
        severidade: 'MEDIA',
        campo: 'COD_NCM (0200)',
        valorSped: ncmSped,
        valorDanfe: ncmXml,
        descricao: `${rotulo}: NCM cadastrado no ERP (${ncmSped}) diferente do NCM da nota (${ncmXml}). NCM errado pode levar a tributação errada (ST, PIS/COFINS).`,
      });
    }

    // R-ITEM-07: Quantidade (só quando a unidade é a mesma — caixa x unidade não é erro)
    const mesmaUnidade = (c170.unidade ?? '').trim().toUpperCase() === (itemXml.unidade ?? '').trim().toUpperCase();
    if (mesmaUnidade && Math.abs(c170.quantidade - itemXml.quantidade) > TOLERANCIA_QTD) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-ITEM-07',
        tipo: 'QUANTIDADE',
        severidade: 'MEDIA',
        campo: 'QTD',
        valorSped: `${c170.quantidade} ${c170.unidade}`,
        valorDanfe: `${itemXml.quantidade} ${itemXml.unidade}`,
        descricao: `${rotulo}: quantidade no SPED (${c170.quantidade}) diferente do XML (${itemXml.quantidade}), na mesma unidade.`,
      });
    }

    // R-ITEM-08: Valor do item
    if (Math.abs(c170.valorItem - itemXml.valorTotal) > TOLERANCIA_VALOR) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-ITEM-08',
        tipo: 'VALOR_UNITARIO',
        severidade: 'MEDIA',
        campo: 'VL_ITEM',
        valorSped: formatarValor(c170.valorItem),
        valorDanfe: formatarValor(itemXml.valorTotal),
        descricao: `${rotulo}: valor do item no SPED (R$ ${formatarValor(c170.valorItem)}) diferente do XML (R$ ${formatarValor(itemXml.valorTotal)}).`,
      });
    }

    // R-ITEM-09: Uso e consumo com crédito de ICMS
    if (CFOPS_USO_CONSUMO.includes(cfopSped) && c170.valorIcms > 0) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-ITEM-09',
        tipo: 'CREDITO_INDEVIDO',
        severidade: 'ALTA',
        campo: 'CFOP + VL_ICMS',
        valorSped: `CFOP ${cfopSped} com crédito de R$ ${formatarValor(c170.valorIcms)}`,
        valorDanfe: 'Uso e consumo não gera crédito',
        descricao: `${rotulo}: CFOP ${cfopSped} (uso e consumo) com crédito de ICMS de R$ ${formatarValor(c170.valorIcms)}. Material de uso e consumo não dá direito a crédito.`,
      });
    }
  }

  return divergencias;
}
