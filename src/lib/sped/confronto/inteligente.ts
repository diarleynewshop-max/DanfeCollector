/**
 * Regras INTELIGENTES de confronto — R-INT-01 a R-INT-08
 *
 * Cruzamentos especiais que combinam dados do SPED com conhecimento fiscal
 * avançado para detectar inconsistências que regras simples não pegam.
 */

import type { SpedFiscalParsed, SpedRegistroC100, SpedRegistroC170, SpedRegistro0150 } from '../types';
import { SpedIndicadorOperacao } from '../types';
import { limparCnpjSped } from '../parser';
import type { ConsultaIeResult } from './cadastro';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaInteligente {
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

const IBGE_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
};

function ufDoParticipante(part: SpedRegistro0150 | undefined): string | null {
  if (!part?.codigoMunicipio) return null;
  const cod = part.codigoMunicipio.slice(0, 2);
  return IBGE_UF[cod] ?? null;
}

// Alíquotas interestaduais válidas
const ALIQUOTAS_INTERESTADUAIS = [4, 7, 12];

// CFOPs interestaduais (2xxx) e internas (1xxx)
function cfopInterestadual(cfop: string): boolean {
  return cfop.startsWith('2') || cfop.startsWith('6');
}

function cfopInterna(cfop: string): boolean {
  return cfop.startsWith('1') || cfop.startsWith('5');
}

// CFOPs de substituição tributária
function cfopSubstituicaoTributaria(cfop: string): boolean {
  const ultimos3 = cfop.slice(-3);
  return ['401', '403', '405', '406', '408', '411', '413'].includes(ultimos3);
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Executa regras inteligentes de confronto que combinam múltiplas fontes de dados.
 *
 * @param sped - SPED parseado
 * @param consultasIe - Cache de consultas IE (cnpj → resultado)
 * @param ufEmpresa - UF da empresa (ex: "CE")
 */
export function confrontarInteligente(
  sped: SpedFiscalParsed,
  consultasIe?: Map<string, ConsultaIeResult>,
  ufEmpresa?: string,
): DivergenciaInteligente[] {
  const divergencias: DivergenciaInteligente[] = [];
  const ufEmp = (ufEmpresa ?? sped.abertura.uf ?? '').toUpperCase();

  // Mapa de participantes
  const participantesPorCodigo = new Map<string, SpedRegistro0150>();
  for (const p of sped.participantes) {
    participantesPorCodigo.set(p.codigoParticipante, p);
  }

  for (const c100 of sped.notasFiscais) {
    if (c100.codigoSituacao !== '00') continue; // Só notas regulares
    const participante = participantesPorCodigo.get(c100.codigoParticipante);
    const cnpjFornecedor = participante ? limparCnpjSped(participante.cnpj) : '';
    const nomeForncedor = participante?.nome ?? '';
    const ufFornecedor = ufDoParticipante(participante);
    const operacaoInterestadual = ufFornecedor && ufEmp && ufFornecedor !== ufEmp;
    const operacaoInterna = ufFornecedor && ufEmp && ufFornecedor === ufEmp;

    for (const c170 of c100.itens) {
      const cfop = (c170.cfop ?? '').trim();
      const aliq = c170.aliquotaIcms;
      const cst = (c170.cstIcms ?? '').trim();

      // R-INT-02: CFOP interestadual com alíquota interna
      if (cfopInterestadual(cfop) && aliq > 0 && !ALIQUOTAS_INTERESTADUAIS.includes(aliq)) {
        // Verificar se realmente é interestadual pela UF do participante
        if (operacaoInterestadual) {
          divergencias.push({
            codigoRegra: 'R-INT-02',
            tipo: 'ALIQUOTA_INTER',
            severidade: 'CRITICA',
            registroSped: 'C170',
            linhaSped: c170.linha,
            campo: 'ALIQ_ICMS + CFOP',
            valorSped: `CFOP ${cfop} (interestadual) + alíquota ${aliq}%`,
            valorDanfe: `Alíquotas interestaduais válidas: 4%, 7% ou 12%`,
            descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero}: CFOP ${cfop} (interestadual, fornecedor UF ${ufFornecedor}) com alíquota ${aliq}%. Operações interestaduais só admitem 4%, 7% ou 12%.`,
            chaveNfe: c100.chaveNfe,
            participanteCod: c100.codigoParticipante,
            produtoCod: c170.codigoItem,
            fornecedorNome: nomeForncedor,
            fornecedorCnpj: cnpjFornecedor,
          });
        }
      }

      // R-INT-03: CFOP intraestadual com alíquota interestadual
      if (cfopInterna(cfop) && ALIQUOTAS_INTERESTADUAIS.includes(aliq) && aliq < 18) {
        if (operacaoInterna) {
          divergencias.push({
            codigoRegra: 'R-INT-03',
            tipo: 'ALIQUOTA_INTER',
            severidade: 'ALTA',
            registroSped: 'C170',
            linhaSped: c170.linha,
            campo: 'ALIQ_ICMS + CFOP',
            valorSped: `CFOP ${cfop} (interna) + alíquota ${aliq}%`,
            valorDanfe: `Operação interna (mesma UF: ${ufEmp}) deveria ter alíquota interna`,
            descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero}: CFOP ${cfop} (interna) com alíquota ${aliq}% que parece interestadual. Fornecedor e empresa estão na mesma UF (${ufEmp}).`,
            chaveNfe: c100.chaveNfe,
            participanteCod: c100.codigoParticipante,
            produtoCod: c170.codigoItem,
            fornecedorNome: nomeForncedor,
            fornecedorCnpj: cnpjFornecedor,
          });
        }
      }

      // R-INT-04: CFOP de ST sem destaque de ICMS-ST
      if (cfopSubstituicaoTributaria(cfop) && c170.valorIcmsSt === 0 && c170.valorBaseIcmsSt === 0) {
        // CST 10, 30, 60, 70 são os que envolvem ST
        const cstSt = ['10', '30', '60', '70', '110', '130', '160', '170'];
        if (!cstSt.includes(cst)) {
          divergencias.push({
            codigoRegra: 'R-INT-04',
            tipo: 'ST_SEM_DESTAQUE',
            severidade: 'ALTA',
            registroSped: 'C170',
            linhaSped: c170.linha,
            campo: 'CFOP + VL_ICMS_ST',
            valorSped: `CFOP ${cfop} (ST) + CST ${cst} + ICMS-ST = R$ 0,00`,
            valorDanfe: 'CFOP de ST deveria ter CST de ST e/ou ICMS-ST destacado',
            descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero}: CFOP ${cfop} indica substituição tributária mas CST é ${cst} e ICMS-ST é zero. Inconsistência fiscal.`,
            chaveNfe: c100.chaveNfe,
            participanteCod: c100.codigoParticipante,
            produtoCod: c170.codigoItem,
            fornecedorNome: nomeForncedor,
            fornecedorCnpj: cnpjFornecedor,
          });
        }
      }

      // R-INT-05: Crédito sobre mercadoria com ST (CST 60 = ICMS pago por ST)
      // Se o ERP escriturou como CST 00/20 (tributação normal com crédito) mas deveria ser 60
      if (cst === '00' || cst === '20') {
        // Verificar se o CFOP é de mercadoria para revenda com ST (x403, x405)
        const ultimos3 = cfop.slice(-3);
        if (['403', '405'].includes(ultimos3)) {
          divergencias.push({
            codigoRegra: 'R-INT-05',
            tipo: 'CREDITO_INDEVIDO',
            severidade: 'CRITICA',
            registroSped: 'C170',
            linhaSped: c170.linha,
            campo: 'CST_ICMS + CFOP',
            valorSped: `CST ${cst} (crédito) + CFOP ${cfop} (ST)`,
            valorDanfe: 'CST deveria ser 60 (ICMS pago anteriormente por ST)',
            descricao: `Item ${c170.numeroItem} da NF-e ${c100.numero}: CFOP ${cfop} (mercadoria com ST) com CST ${cst} gerando crédito. Deveria ser CST 60 (ICMS cobrado anteriormente por substituição tributária) — crédito INDEVIDO.`,
            chaveNfe: c100.chaveNfe,
            participanteCod: c100.codigoParticipante,
            produtoCod: c170.codigoItem,
            fornecedorNome: nomeForncedor,
            fornecedorCnpj: cnpjFornecedor,
          });
        }
      }
    }

    // R-INT-07: Nota de ajuste (modelo 55, sem itens)
    if (c100.codigoModelo === '55' && c100.itens.length === 0 && c100.valorMercadorias === 0) {
      divergencias.push({
        codigoRegra: 'R-INT-07',
        tipo: 'VALOR_NF',
        severidade: 'INFO',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'VL_MERC + det',
        valorSped: `Modelo ${c100.codigoModelo}, VL_MERC = 0, sem itens (C170)`,
        valorDanfe: '',
        descricao: `NF-e ${c100.numero || c100.chaveNfe}: NF-e modelo 55 sem itens e sem valor de mercadorias. Pode ser nota de ajuste/complementar.`,
        chaveNfe: c100.chaveNfe,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeForncedor,
        fornecedorCnpj: cnpjFornecedor,
      });
    }
  }

  // R-INT-01: Fornecedor com IE baixada operando (verificar participantes usados no período)
  if (consultasIe) {
    const participantesUsados = new Set<string>();
    for (const c100 of sped.notasFiscais) {
      if (c100.codigoSituacao === '00') {
        participantesUsados.add(c100.codigoParticipante);
      }
    }

    for (const codPart of Array.from(participantesUsados)) {
      const part = participantesPorCodigo.get(codPart);
      if (!part) continue;
      const cnpj = limparCnpjSped(part.cnpj);
      if (!cnpj) continue;

      const consulta = consultasIe.get(cnpj);
      if (!consulta) continue;

      const todasInativas = consulta.inscricoesEstaduais.length > 0 &&
        consulta.inscricoesEstaduais.every(ie => !ie.ativo);

      if (todasInativas) {
        // Contar notas deste participante no período
        const notasCount = sped.notasFiscais.filter(
          c => c.codigoParticipante === codPart && c.codigoSituacao === '00'
        ).length;

        divergencias.push({
          codigoRegra: 'R-INT-01',
          tipo: 'CADASTRO_IE',
          severidade: 'ALTA',
          registroSped: '0150',
          linhaSped: part.linha,
          campo: 'IE (todas inativas)',
          valorSped: `${consulta.inscricoesEstaduais.map(ie => ie.inscricao).join(', ')} — TODAS INATIVAS`,
          valorDanfe: `${notasCount} NF-e no período`,
          descricao: `Fornecedor "${part.nome}" (${cnpj}) tem ${notasCount} NF-e no período mas TODAS as IEs estão inativas na SEFAZ. Operação irregular — créditos serão glosados.`,
          participanteCod: codPart,
          fornecedorNome: part.nome,
          fornecedorCnpj: cnpj,
        });
      }
    }
  }

  return divergencias;
}
