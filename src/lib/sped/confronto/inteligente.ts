/**
 * Regras INTELIGENTES de confronto — R-INT-01 a R-INT-08
 *
 * Cruzamentos especiais que combinam dados do SPED com conhecimento fiscal
 * avançado para detectar inconsistências que regras simples não pegam.
 */

import type { SpedFiscalParsed, SpedRegistro0150 } from '../types';
import { SpedIndicadorOperacao } from '../types';
import { limparCnpjSped, normalizarCst } from '../parser';
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

// CFOPs interestaduais (2xxx/6xxx) e internas (1xxx/5xxx)
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

// CSTs (2 dígitos, sem a origem) que envolvem ST
const CST_ST = ['10', '30', '60', '70'];

function formatarValor(v: number): string {
  return v.toFixed(2);
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

  const participantesPorCodigo = new Map<string, SpedRegistro0150>();
  for (const p of sped.participantes) {
    participantesPorCodigo.set(p.codigoParticipante, p);
  }

  for (const c100 of sped.notasFiscais) {
    if (c100.codigoSituacao !== '00') continue; // Só notas regulares
    const participante = participantesPorCodigo.get(c100.codigoParticipante);
    const cnpjFornecedor = participante ? limparCnpjSped(participante.cnpj) : '';
    const nomeFornecedor = participante?.nome ?? '';
    const ufFornecedor = ufDoParticipante(participante);
    const operacaoInterestadual = ufFornecedor && ufEmp && ufFornecedor !== ufEmp;
    const operacaoInterna = ufFornecedor && ufEmp && ufFornecedor === ufEmp;
    const entrada = c100.indicadorOperacao === SpedIndicadorOperacao.ENTRADA;
    const numeroNf = c100.numero ? String(Number(c100.numero)) : c100.chaveNfe;

    for (const c170 of c100.itens) {
      const cfop = (c170.cfop ?? '').trim();
      const aliq = c170.aliquotaIcms;
      const cst = normalizarCst(c170.cstIcms);
      const base = {
        registroSped: 'C170',
        linhaSped: c170.linha,
        chaveNfe: c100.chaveNfe,
        participanteCod: c100.codigoParticipante,
        produtoCod: c170.codigoItem,
        fornecedorNome: nomeFornecedor,
        fornecedorCnpj: cnpjFornecedor,
      };
      const rotulo = `NF ${numeroNf}, item ${c170.numeroItem} (${c170.descricao})`;

      // R-INT-02: CFOP interestadual com alíquota que não é interestadual
      if (cfopInterestadual(cfop) && aliq > 0 && !ALIQUOTAS_INTERESTADUAIS.includes(aliq) && operacaoInterestadual) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-INT-02',
          tipo: 'ALIQUOTA_INTER',
          severidade: 'ALTA',
          campo: 'ALIQ_ICMS + CFOP',
          valorSped: `CFOP ${cfop} + alíquota ${aliq}%`,
          valorDanfe: 'Interestadual: 4%, 7% ou 12%',
          descricao: `${rotulo}: CFOP ${cfop} é interestadual (fornecedor em ${ufFornecedor}), mas a alíquota escriturada é ${aliq}%. Operação interestadual só admite 4%, 7% ou 12%.`,
        });
      }

      // R-INT-03: CFOP interno com alíquota de cara interestadual
      if (cfopInterna(cfop) && ALIQUOTAS_INTERESTADUAIS.includes(aliq) && operacaoInterna) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-INT-03',
          tipo: 'ALIQUOTA_INTER',
          severidade: 'MEDIA',
          campo: 'ALIQ_ICMS + CFOP',
          valorSped: `CFOP ${cfop} + alíquota ${aliq}%`,
          valorDanfe: `Operação interna (${ufEmp})`,
          descricao: `${rotulo}: operação dentro do ${ufEmp} (CFOP ${cfop}) com alíquota de ${aliq}%, que é típica de operação interestadual. Confirme se há redução de base ou benefício que justifique.`,
        });
      }

      // R-INT-04: Venda com CFOP de ST sem CST de ST nem ICMS-ST (só saídas —
      // na compra o ST já foi retido pelo fornecedor e o ICMS-ST do C170 fica zerado mesmo)
      if (!entrada && cfopSubstituicaoTributaria(cfop) && c170.valorIcmsSt === 0 && !CST_ST.includes(cst)) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-INT-04',
          tipo: 'ST_SEM_DESTAQUE',
          severidade: 'ALTA',
          campo: 'CFOP + CST',
          valorSped: `CFOP ${cfop} + CST ${c170.cstIcms}`,
          valorDanfe: 'CFOP de ST pede CST 10/30/60/70',
          descricao: `${rotulo}: saída com CFOP ${cfop} (substituição tributária), mas o CST ${c170.cstIcms} não é de ST e não há ICMS-ST.`,
        });
      }

      // R-INT-05: Compra de mercadoria com ST (x403) tomando crédito de ICMS
      if (entrada && ['00', '20'].includes(cst) && cfop.slice(-3) === '403' && c170.valorIcms > 0) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-INT-05',
          tipo: 'CREDITO_INDEVIDO',
          severidade: 'ALTA',
          campo: 'CST + CFOP + VL_ICMS',
          valorSped: `CST ${c170.cstIcms} + CFOP ${cfop} + crédito R$ ${formatarValor(c170.valorIcms)}`,
          valorDanfe: 'Mercadoria com ST normalmente não gera crédito',
          descricao: `${rotulo}: compra com CFOP ${cfop} (mercadoria sujeita a ST) escriturada com CST ${c170.cstIcms} e crédito de R$ ${formatarValor(c170.valorIcms)}. Em regra, quem compra com ST não se credita do ICMS — confirme com o contador se há regime especial.`,
        });
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
        campo: 'VL_MERC + itens',
        valorSped: `Modelo ${c100.codigoModelo}, sem itens`,
        valorDanfe: '',
        descricao: `NF ${numeroNf}: NF-e sem itens e sem valor de mercadorias. Normalmente é nota de ajuste ou complementar.`,
        chaveNfe: c100.chaveNfe,
        participanteCod: c100.codigoParticipante,
        fornecedorNome: nomeFornecedor,
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
          descricao: `Fornecedor "${part.nome}" (${cnpj}) tem ${notasCount} NF-e no período, mas todas as IEs estão inativas na SEFAZ. Os créditos dessas notas podem ser glosados.`,
          participanteCod: codPart,
          fornecedorNome: part.nome,
          fornecedorCnpj: cnpj,
        });
      }
    }
  }

  return divergencias;
}
