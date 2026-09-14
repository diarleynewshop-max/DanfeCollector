/**
 * Regras de confronto de APURAÇÃO (Bloco E) — R-APUR-01 a R-APUR-04
 *
 * Valida se a apuração do ICMS (E110) fecha com os valores escriturados nos C190
 * e com o total das notas no DanfeCollector.
 */

import type { SpedFiscalParsed, SpedRegistroC190, SpedRegistroE110 } from '../types';
import { SpedIndicadorOperacao } from '../types';

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

function formatarValor(v: number): string {
  return v.toFixed(2);
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta a apuração do ICMS (E110) com os valores consolidados nos C190
 * e opcionalmente com o total das NF-e no DanfeCollector.
 *
 * @param sped - SPED parseado
 * @param totalIcmsXmlEntradas - Soma do ICMS de todas as NF-e de ENTRADA no DanfeCollector (mesmo período)
 * @param totalIcmsXmlSaidas - Soma do ICMS de todas as NF-e de SAÍDA no DanfeCollector (mesmo período)
 */
export function confrontarApuracao(
  sped: SpedFiscalParsed,
  totalIcmsXmlEntradas?: number,
  totalIcmsXmlSaidas?: number,
): DivergenciaApuracao[] {
  const divergencias: DivergenciaApuracao[] = [];

  if (sped.apuracoesIcms.length === 0) return divergencias;

  // Somar C190 por tipo de operação (entrada/saída)
  let somaIcmsC190Entradas = 0;
  let somaIcmsC190Saidas = 0;

  for (const c100 of sped.notasFiscais) {
    for (const c190 of c100.consolidacoes) {
      if (c100.indicadorOperacao === SpedIndicadorOperacao.ENTRADA) {
        somaIcmsC190Entradas += c190.valorIcms;
      } else {
        somaIcmsC190Saidas += c190.valorIcms;
      }
    }
  }

  for (const e110 of sped.apuracoesIcms) {
    // R-APUR-01: Total de débitos ≠ soma dos C190 de saída
    if (Math.abs(e110.valorTotalDebitos - somaIcmsC190Saidas) > TOLERANCIA) {
      divergencias.push({
        codigoRegra: 'R-APUR-01',
        tipo: 'APURACAO',
        severidade: 'CRITICA',
        registroSped: 'E110',
        linhaSped: e110.linha,
        campo: 'VL_TOT_DEBITOS',
        valorSped: formatarValor(e110.valorTotalDebitos),
        valorDanfe: `Σ C190 saídas = ${formatarValor(somaIcmsC190Saidas)}`,
        descricao: `Total de débitos na apuração E110 (R$ ${formatarValor(e110.valorTotalDebitos)}) diverge da soma dos ICMS dos C190 de saída (R$ ${formatarValor(somaIcmsC190Saidas)}). Diferença: R$ ${formatarValor(e110.valorTotalDebitos - somaIcmsC190Saidas)}.`,
      });
    }

    // R-APUR-02: Total de créditos ≠ soma dos C190 de entrada
    if (Math.abs(e110.valorTotalCreditos - somaIcmsC190Entradas) > TOLERANCIA) {
      divergencias.push({
        codigoRegra: 'R-APUR-02',
        tipo: 'APURACAO',
        severidade: 'CRITICA',
        registroSped: 'E110',
        linhaSped: e110.linha,
        campo: 'VL_TOT_CREDITOS',
        valorSped: formatarValor(e110.valorTotalCreditos),
        valorDanfe: `Σ C190 entradas = ${formatarValor(somaIcmsC190Entradas)}`,
        descricao: `Total de créditos na apuração E110 (R$ ${formatarValor(e110.valorTotalCreditos)}) diverge da soma dos ICMS dos C190 de entrada (R$ ${formatarValor(somaIcmsC190Entradas)}). Diferença: R$ ${formatarValor(e110.valorTotalCreditos - somaIcmsC190Entradas)}.`,
      });
    }

    // R-APUR-03: Saldo devedor/credor inconsistente
    // Fórmula: débitos + ajustes_déb + estornos_créd - créditos - ajustes_créd - estornos_déb - saldo_credor_ant
    const saldoCalculado =
      e110.valorTotalDebitos +
      e110.valorAjustesDebitos +
      e110.valorTotalAjustesDebitos +
      e110.valorEstornosCredito -
      e110.valorTotalCreditos -
      e110.valorAjustesCreditos -
      e110.valorTotalAjustesCreditos -
      e110.valorEstornosDebito -
      e110.saldoCredorAnterior;

    if (Math.abs(saldoCalculado - e110.saldoDevedor) > TOLERANCIA) {
      divergencias.push({
        codigoRegra: 'R-APUR-03',
        tipo: 'APURACAO',
        severidade: 'ALTA',
        registroSped: 'E110',
        linhaSped: e110.linha,
        campo: 'VL_SLD_APURADO',
        valorSped: formatarValor(e110.saldoDevedor),
        valorDanfe: `Calculado = ${formatarValor(saldoCalculado)}`,
        descricao: `Saldo apurado informado no E110 (R$ ${formatarValor(e110.saldoDevedor)}) não bate com a fórmula: débitos + ajustes - créditos - saldo anterior = R$ ${formatarValor(saldoCalculado)}.`,
      });
    }

    // Verificar ICMS a recolher + saldo credor
    const icmsRecolherCalculado = e110.saldoDevedor > 0
      ? Math.max(0, e110.saldoDevedor - e110.valorTotalDeducoes)
      : 0;
    if (Math.abs(icmsRecolherCalculado - e110.valorIcmsRecolher) > TOLERANCIA && e110.saldoDevedor > 0) {
      divergencias.push({
        codigoRegra: 'R-APUR-03',
        tipo: 'APURACAO',
        severidade: 'ALTA',
        registroSped: 'E110',
        linhaSped: e110.linha,
        campo: 'VL_ICMS_RECOLHER',
        valorSped: formatarValor(e110.valorIcmsRecolher),
        valorDanfe: `Calculado = ${formatarValor(icmsRecolherCalculado)}`,
        descricao: `ICMS a recolher informado (R$ ${formatarValor(e110.valorIcmsRecolher)}) diverge do cálculo: saldo devedor (R$ ${formatarValor(e110.saldoDevedor)}) - deduções (R$ ${formatarValor(e110.valorTotalDeducoes)}) = R$ ${formatarValor(icmsRecolherCalculado)}.`,
      });
    }

    // R-APUR-04: ICMS total do SPED ≠ soma dos XMLs (quando disponível)
    if (totalIcmsXmlEntradas !== undefined) {
      if (Math.abs(somaIcmsC190Entradas - totalIcmsXmlEntradas) > 1.00) { // tolerância maior para soma global
        divergencias.push({
          codigoRegra: 'R-APUR-04',
          tipo: 'APURACAO',
          severidade: 'ALTA',
          registroSped: 'E110',
          linhaSped: e110.linha,
          campo: 'ICMS ENTRADAS',
          valorSped: `Σ C190 entradas = ${formatarValor(somaIcmsC190Entradas)}`,
          valorDanfe: `Σ XMLs entradas = ${formatarValor(totalIcmsXmlEntradas)}`,
          descricao: `Soma do ICMS de entradas nos C190 do SPED (R$ ${formatarValor(somaIcmsC190Entradas)}) diverge da soma dos XMLs no DanfeCollector (R$ ${formatarValor(totalIcmsXmlEntradas)}). Divergência sistêmica entre ERP e SEFAZ.`,
        });
      }
    }

    if (totalIcmsXmlSaidas !== undefined) {
      if (Math.abs(somaIcmsC190Saidas - totalIcmsXmlSaidas) > 1.00) {
        divergencias.push({
          codigoRegra: 'R-APUR-04',
          tipo: 'APURACAO',
          severidade: 'ALTA',
          registroSped: 'E110',
          linhaSped: e110.linha,
          campo: 'ICMS SAÍDAS',
          valorSped: `Σ C190 saídas = ${formatarValor(somaIcmsC190Saidas)}`,
          valorDanfe: `Σ XMLs saídas = ${formatarValor(totalIcmsXmlSaidas)}`,
          descricao: `Soma do ICMS de saídas nos C190 do SPED (R$ ${formatarValor(somaIcmsC190Saidas)}) diverge da soma dos XMLs no DanfeCollector (R$ ${formatarValor(totalIcmsXmlSaidas)}).`,
        });
      }
    }
  }

  return divergencias;
}
