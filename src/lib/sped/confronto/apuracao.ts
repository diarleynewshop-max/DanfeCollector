/**
 * Regras de confronto de APURAÇÃO (Bloco E) — R-APUR-01 a R-APUR-04
 *
 * Valida se a apuração do ICMS (E110) fecha com os valores escriturados nos C190
 * e com o total das notas no DanfeCollector.
 */

import type { SpedFiscalParsed } from '../types';
import { SpedCodigoSituacao, SpedIndicadorOperacao } from '../types';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaApuracao {
  codigoRegra: string;
  tipo: string;
  severidade: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'INFO';
  registroSped: string;
  linhaSped: number;
  campo: string;
  valorSped: string;
  valorDanfe: string;
  descricao: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

const TOLERANCIA = 0.10; // tolerância de 10 centavos para arredondamento

/**
 * Registros analíticos de outros documentos que também geram débito/crédito de ICMS
 * e que o parser não interpreta (cupom fiscal, energia, NFC-e consolidada, CT-e...).
 * Se o arquivo tiver algum deles, a soma dos C190 não representa o total da apuração.
 */
const OUTROS_ANALITICOS_ICMS = [
  'C320', 'C390', 'C490', 'C590', 'C690', 'C790', 'C850', 'C890',
  'D190', 'D300', 'D390', 'D410', 'D590', 'D690', 'D696',
];

function formatarValor(v: number): string {
  return v.toFixed(2);
}

const SITUACOES_SEM_VALOR: string[] = [
  SpedCodigoSituacao.CANCELADO,
  SpedCodigoSituacao.CANCELADO_EXTEMPORANEO,
  SpedCodigoSituacao.DENEGADO,
  SpedCodigoSituacao.NUMERACAO_INUTILIZADA,
];

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta a apuração do ICMS (E110) com os valores consolidados nos C190
 * e com o total das NF-e de saída no DanfeCollector.
 *
 * @param sped - SPED parseado
 * @param _totalIcmsXmlEntradas - Não usado: crédito escriturado e ICMS destacado pelo fornecedor não são comparáveis
 * @param totalIcmsXmlSaidas - Soma do ICMS das NF-e de SAÍDA da empresa no DanfeCollector (mesmo período)
 */
export function confrontarApuracao(
  sped: SpedFiscalParsed,
  _totalIcmsXmlEntradas?: number,
  totalIcmsXmlSaidas?: number,
): DivergenciaApuracao[] {
  const divergencias: DivergenciaApuracao[] = [];

  if (sped.apuracoesIcms.length === 0) return divergencias;

  const contagem = sped.estatisticas.contagemRegistros ?? {};
  const outrosDocumentos = OUTROS_ANALITICOS_ICMS.filter((r) => (contagem[r] ?? 0) > 0);
  const somaC190Completa = outrosDocumentos.length === 0;

  // Somar C190 por tipo de operação (entrada/saída), ignorando notas canceladas
  let somaIcmsC190Entradas = 0;
  let somaIcmsC190Saidas = 0;
  let temNotaSaida = false;

  for (const c100 of sped.notasFiscais) {
    if (SITUACOES_SEM_VALOR.includes(c100.codigoSituacao)) continue;
    const entrada = c100.indicadorOperacao === SpedIndicadorOperacao.ENTRADA;
    if (!entrada) temNotaSaida = true;
    for (const c190 of c100.consolidacoes) {
      if (entrada) somaIcmsC190Entradas += c190.valorIcms;
      else somaIcmsC190Saidas += c190.valorIcms;
    }
  }

  for (const e110 of sped.apuracoesIcms) {
    const base = { tipo: 'APURACAO', registroSped: 'E110', linhaSped: e110.linha };

    if (somaC190Completa) {
      // R-APUR-01: Total de débitos ≠ soma dos C190 de saída
      if (Math.abs(e110.valorTotalDebitos - somaIcmsC190Saidas) > TOLERANCIA) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-APUR-01',
          severidade: 'CRITICA',
          campo: 'VL_TOT_DEBITOS',
          valorSped: formatarValor(e110.valorTotalDebitos),
          valorDanfe: `Soma das notas de saída = ${formatarValor(somaIcmsC190Saidas)}`,
          descricao: `O total de débitos da apuração (R$ ${formatarValor(e110.valorTotalDebitos)}) não bate com a soma do ICMS das notas de saída escrituradas (R$ ${formatarValor(somaIcmsC190Saidas)}). Diferença de R$ ${formatarValor(e110.valorTotalDebitos - somaIcmsC190Saidas)}.`,
        });
      }

      // R-APUR-02: Total de créditos ≠ soma dos C190 de entrada
      if (Math.abs(e110.valorTotalCreditos - somaIcmsC190Entradas) > TOLERANCIA) {
        divergencias.push({
          ...base,
          codigoRegra: 'R-APUR-02',
          severidade: 'CRITICA',
          campo: 'VL_TOT_CREDITOS',
          valorSped: formatarValor(e110.valorTotalCreditos),
          valorDanfe: `Soma das notas de entrada = ${formatarValor(somaIcmsC190Entradas)}`,
          descricao: `O total de créditos da apuração (R$ ${formatarValor(e110.valorTotalCreditos)}) não bate com a soma do ICMS creditado nas notas de entrada (R$ ${formatarValor(somaIcmsC190Entradas)}). Diferença de R$ ${formatarValor(e110.valorTotalCreditos - somaIcmsC190Entradas)}.`,
        });
      }
    } else {
      divergencias.push({
        ...base,
        codigoRegra: 'R-APUR-00',
        severidade: 'INFO',
        campo: 'Registros analíticos',
        valorSped: outrosDocumentos.join(', '),
        valorDanfe: '',
        descricao: `O arquivo tem outros documentos com ICMS além das NF-e (${outrosDocumentos.join(', ')}). Por isso os totais de débitos e créditos da apuração não foram conferidos contra as notas.`,
      });
    }

    // R-APUR-03: Saldo apurado inconsistente
    // Guia EFD: (débitos + ajustes + estornos de crédito) − (créditos + ajustes + estornos de débito + saldo credor anterior).
    // Resultado positivo vai para VL_SLD_APURADO; negativo vira saldo credor a transportar.
    const resultado =
      e110.valorTotalDebitos +
      e110.valorAjustesDebitos +
      e110.valorTotalAjustesDebitos +
      e110.valorEstornosCredito -
      e110.valorTotalCreditos -
      e110.valorAjustesCreditos -
      e110.valorTotalAjustesCreditos -
      e110.valorEstornosDebito -
      e110.saldoCredorAnterior;
    const saldoDevedorEsperado = Math.max(0, resultado);
    const saldoCredorEsperado = Math.max(0, -resultado);

    if (Math.abs(saldoDevedorEsperado - e110.saldoDevedor) > TOLERANCIA) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-APUR-03',
        severidade: 'ALTA',
        campo: 'VL_SLD_APURADO',
        valorSped: formatarValor(e110.saldoDevedor),
        valorDanfe: `Calculado = ${formatarValor(saldoDevedorEsperado)}`,
        descricao: `O saldo devedor informado na apuração (R$ ${formatarValor(e110.saldoDevedor)}) não bate com a conta débitos − créditos (R$ ${formatarValor(saldoDevedorEsperado)}).`,
      });
    }

    if (e110.valorTotalDeducoes === 0 && Math.abs(saldoCredorEsperado - e110.saldoCredorTransportar) > TOLERANCIA) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-APUR-03',
        severidade: 'ALTA',
        campo: 'VL_SLD_CREDOR_TRANSPORTAR',
        valorSped: formatarValor(e110.saldoCredorTransportar),
        valorDanfe: `Calculado = ${formatarValor(saldoCredorEsperado)}`,
        descricao: `O saldo credor a transportar para o próximo mês (R$ ${formatarValor(e110.saldoCredorTransportar)}) não bate com a conta créditos − débitos (R$ ${formatarValor(saldoCredorEsperado)}).`,
      });
    }

    // ICMS a recolher = saldo devedor − deduções
    const icmsRecolherCalculado = Math.max(0, e110.saldoDevedor - e110.valorTotalDeducoes);
    if (Math.abs(icmsRecolherCalculado - e110.valorIcmsRecolher) > TOLERANCIA) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-APUR-03',
        severidade: 'ALTA',
        campo: 'VL_ICMS_RECOLHER',
        valorSped: formatarValor(e110.valorIcmsRecolher),
        valorDanfe: `Calculado = ${formatarValor(icmsRecolherCalculado)}`,
        descricao: `O ICMS a recolher informado (R$ ${formatarValor(e110.valorIcmsRecolher)}) não bate com saldo devedor (R$ ${formatarValor(e110.saldoDevedor)}) − deduções (R$ ${formatarValor(e110.valorTotalDeducoes)}) = R$ ${formatarValor(icmsRecolherCalculado)}.`,
      });
    }

    // R-APUR-04: ICMS das saídas no SPED ≠ soma dos XMLs de saída da empresa.
    // (Entradas não são comparadas: o crédito escriturado pode ser legitimamente menor que o destacado.)
    if (somaC190Completa && temNotaSaida && totalIcmsXmlSaidas !== undefined &&
        Math.abs(somaIcmsC190Saidas - totalIcmsXmlSaidas) > 1.00) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-APUR-04',
        severidade: 'ALTA',
        campo: 'ICMS SAÍDAS',
        valorSped: `SPED = ${formatarValor(somaIcmsC190Saidas)}`,
        valorDanfe: `XMLs = ${formatarValor(totalIcmsXmlSaidas)}`,
        descricao: `O ICMS das notas de saída escrituradas (R$ ${formatarValor(somaIcmsC190Saidas)}) é diferente do ICMS dos XMLs de saída da empresa no Proton-e (R$ ${formatarValor(totalIcmsXmlSaidas)}).`,
      });
    }
  }

  return divergencias;
}
