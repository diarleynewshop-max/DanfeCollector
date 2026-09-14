/**
 * Regras de confronto de DOCUMENTOS FISCAIS (Bloco C) — R-DOC-01 a R-DOC-15
 *
 * Cruza os registros C100 do SPED com as NotaFiscal do DanfeCollector.
 *
 * Atenção à "visão" de cada lado: o XML é escrito por quem EMITIU a nota,
 * o SPED é escrito por quem ESCRITUROU. Numa compra (IND_EMIT = 1, terceiros)
 * o XML diz "Saída" e traz o ICMS destacado pelo fornecedor, enquanto o SPED
 * diz "Entrada" e traz o ICMS efetivamente creditado — que pode ser menor ou zero.
 */

import type { SpedFiscalParsed, SpedRegistro0150 } from '../types';
import { SpedCodigoSituacao, SpedIndicadorEmitente, SpedIndicadorOperacao } from '../types';
import { limparCnpjSped, dataSpedIso, dataIsoBrasil } from '../parser';

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
  tipoOperacao: string | null; // tpNF do XML, na visão do EMITENTE: "Entrada" | "Saída"
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
  /** true se a nota foi emitida dentro do período do SPED (false = veio só pela chave) */
  emitidaNoPeriodo?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Tolerância padrão para comparação de valores monetários (centavos) */
const TOLERANCIA_VALOR = 0.05;

/** Notas emitidas nos últimos N dias do período podem ter entrada só no mês seguinte */
const DIAS_FIM_PERIODO = 10;

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

/**
 * Tipo de operação da nota na visão da EMPRESA do SPED.
 * O tpNF do XML é na visão do emitente — se a empresa é a destinatária, inverte.
 */
export function tipoOperacaoNaVisaoDaEmpresa(nota: NotaDanfeCompleta, cnpjEmpresa: string): 'Entrada' | 'Saída' | null {
  if (!nota.tipoOperacao) return null;
  const emitente = (nota.emitenteCnpj ?? '').replace(/\D/g, '');
  const dest = (nota.destCnpj ?? '').replace(/\D/g, '');
  const tp = nota.tipoOperacao === 'Entrada' ? 'Entrada' : 'Saída';
  if (emitente && emitente === cnpjEmpresa) return tp;
  if (dest && dest === cnpjEmpresa) return tp === 'Saída' ? 'Entrada' : 'Saída';
  return null;
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta os documentos fiscais (C100) do SPED com as NF-e do DanfeCollector.
 *
 * @param sped - SPED parseado
 * @param notasDanfe - Map de chave → NotaDanfeCompleta (notas do período + notas buscadas pela chave do SPED)
 * @param participantesPorCodigo - Map de COD_PART → SpedRegistro0150
 * @param cnpjEmpresa - CNPJ completo da empresa do SPED
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
    chavesNoSped.add(chave);

    // Pular NF-e com situação cancelada/inutilizada no SPED (não geram confronto)
    if (c100.codigoSituacao === SpedCodigoSituacao.CANCELADO ||
        c100.codigoSituacao === SpedCodigoSituacao.CANCELADO_EXTEMPORANEO ||
        c100.codigoSituacao === SpedCodigoSituacao.NUMERACAO_INUTILIZADA) {
      continue;
    }

    const participante = participantesPorCodigo.get(c100.codigoParticipante);
    const nomeFornecedor = participante?.nome ?? '';
    const cnpjFornecedor = participante ? limparCnpjSped(participante.cnpj) : '';
    const numeroNf = c100.numero ? String(Number(c100.numero)) : chave;
    const notaDeTerceiros = c100.indicadorEmitente === SpedIndicadorEmitente.TERCEIROS;
    const base = {
      registroSped: 'C100',
      linhaSped: c100.linha,
      chaveNfe: chave,
      participanteCod: c100.codigoParticipante,
      fornecedorNome: nomeFornecedor,
      fornecedorCnpj: cnpjFornecedor,
    };

    const notaDanfe = notasDanfe.get(chave);

    // R-DOC-01: NF no SPED sem XML no DanfeCollector
    if (!notaDanfe) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-01',
        tipo: 'CHAVE_INEXISTENTE',
        severidade: 'MEDIA',
        campo: 'CHV_NFE',
        valorSped: chave,
        valorDanfe: '(não está no Proton-e)',
        descricao: `NF ${numeroNf} de "${nomeFornecedor}" (emitida em ${dataSpedIso(c100.dataDocumento)}) está no SPED, mas o XML não está no Proton-e — por isso ela não pôde ser conferida. Importe a nota pela chave para confrontar.`,
      });
      continue;
    }

    // R-DOC-12: NF cancelada escriturada como ativa no SPED
    if (notaDanfe.situacaoSefaz === 'CANCELADA') {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-12',
        tipo: 'NF_CANCELADA',
        severidade: 'CRITICA',
        campo: 'COD_SIT',
        valorSped: `${c100.codigoSituacao} (${c100.codigoSituacao === '00' ? 'Regular' : c100.codigoSituacao})`,
        valorDanfe: 'CANCELADA na SEFAZ',
        descricao: `NF ${numeroNf} está CANCELADA na SEFAZ, mas foi escriturada como regular no SPED.`,
      });
    }

    // R-DOC-13: NF denegada escriturada
    if (notaDanfe.situacaoSefaz === 'DENEGADA') {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-13',
        tipo: 'NF_DENEGADA',
        severidade: 'CRITICA',
        campo: 'COD_SIT',
        valorSped: `${c100.codigoSituacao}`,
        valorDanfe: 'DENEGADA na SEFAZ',
        descricao: `NF ${numeroNf} foi DENEGADA pela SEFAZ, mas está escriturada no SPED.`,
      });
    }

    // R-DOC-14: Tipo operação invertido (comparando na visão da empresa)
    const tipoSped = c100.indicadorOperacao === SpedIndicadorOperacao.ENTRADA ? 'Entrada' : 'Saída';
    const tipoXml = tipoOperacaoNaVisaoDaEmpresa(notaDanfe, cnpjEmpresa);
    if (tipoXml && tipoSped !== tipoXml) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-14',
        tipo: 'TIPO_OPERACAO',
        severidade: 'CRITICA',
        campo: 'IND_OPER',
        valorSped: tipoSped,
        valorDanfe: tipoXml,
        descricao: `NF ${numeroNf} foi escriturada como ${tipoSped}, mas pelo XML ela é uma ${tipoXml} para a empresa.`,
      });
    }

    // Só confronta valores para notas COMPLETA (XML integral disponível)
    if (notaDanfe.status !== 'COMPLETA') continue;

    // R-DOC-03: Valor total divergente
    if (valorDivergente(c100.valorDocumento, notaDanfe.valorTotal)) {
      const diff = c100.valorDocumento - (notaDanfe.valorTotal ?? 0);
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-03',
        tipo: 'VALOR_NF',
        severidade: severidadeValor(diff),
        campo: 'VL_DOC',
        valorSped: formatarValor(c100.valorDocumento),
        valorDanfe: formatarValor(notaDanfe.valorTotal),
        descricao: `NF ${numeroNf}: valor total no SPED (R$ ${formatarValor(c100.valorDocumento)}) diferente do XML (R$ ${formatarValor(notaDanfe.valorTotal)}). Diferença de R$ ${formatarValor(diff)}.`,
      });
    }

    // R-DOC-04: Valor de produtos divergente
    if (valorDivergente(c100.valorMercadorias, notaDanfe.valorProdutos)) {
      const diff = c100.valorMercadorias - (notaDanfe.valorProdutos ?? 0);
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-04',
        tipo: 'VALOR_NF',
        severidade: severidadeValor(diff),
        campo: 'VL_MERC',
        valorSped: formatarValor(c100.valorMercadorias),
        valorDanfe: formatarValor(notaDanfe.valorProdutos),
        descricao: `NF ${numeroNf}: valor das mercadorias no SPED (R$ ${formatarValor(c100.valorMercadorias)}) diferente do XML (R$ ${formatarValor(notaDanfe.valorProdutos)}).`,
      });
    }

    // R-DOC-05: Valor de ICMS divergente
    // Nota própria: SPED e XML devem ser iguais.
    // Nota de terceiros: o crédito pode ser MENOR que o destacado (ST, uso e consumo,
    // Simples Nacional) — só é erro se o crédito for MAIOR que o destacado.
    const icmsXml = notaDanfe.valorIcms ?? 0;
    const icmsErro = notaDeTerceiros
      ? notaDanfe.valorIcms !== null && c100.valorIcms > icmsXml + TOLERANCIA_VALOR
      : valorDivergente(c100.valorIcms, notaDanfe.valorIcms);
    if (icmsErro) {
      const diff = c100.valorIcms - icmsXml;
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-05',
        tipo: notaDeTerceiros ? 'CREDITO_INDEVIDO' : 'VALOR_ICMS',
        severidade: 'CRITICA',
        campo: 'VL_ICMS',
        valorSped: formatarValor(c100.valorIcms),
        valorDanfe: formatarValor(notaDanfe.valorIcms),
        descricao: notaDeTerceiros
          ? `NF ${numeroNf}: crédito de ICMS no SPED (R$ ${formatarValor(c100.valorIcms)}) é MAIOR que o ICMS destacado pelo fornecedor (R$ ${formatarValor(icmsXml)}). Crédito a maior de R$ ${formatarValor(diff)}.`
          : `NF ${numeroNf}: ICMS no SPED (R$ ${formatarValor(c100.valorIcms)}) diferente do XML (R$ ${formatarValor(icmsXml)}). Diferença de R$ ${formatarValor(diff)}.`,
      });
    }

    // R-DOC-09: Valor frete divergente
    if (valorDivergente(c100.valorFrete, notaDanfe.valorFrete)) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-09',
        tipo: 'VALOR_FRETE',
        severidade: 'MEDIA',
        campo: 'VL_FRT',
        valorSped: formatarValor(c100.valorFrete),
        valorDanfe: formatarValor(notaDanfe.valorFrete),
        descricao: `NF ${numeroNf}: frete no SPED (R$ ${formatarValor(c100.valorFrete)}) diferente do XML (R$ ${formatarValor(notaDanfe.valorFrete)}).`,
      });
    }

    // R-DOC-10: Valor desconto divergente
    if (valorDivergente(c100.valorDesconto, notaDanfe.valorDesconto)) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-10',
        tipo: 'VALOR_DESCONTO',
        severidade: 'MEDIA',
        campo: 'VL_DESC',
        valorSped: formatarValor(c100.valorDesconto),
        valorDanfe: formatarValor(notaDanfe.valorDesconto),
        descricao: `NF ${numeroNf}: desconto no SPED (R$ ${formatarValor(c100.valorDesconto)}) diferente do XML (R$ ${formatarValor(notaDanfe.valorDesconto)}).`,
      });
    }

    // R-DOC-11: Data emissão divergente (compara só a data, no fuso do Brasil)
    const dataSped = dataSpedIso(c100.dataDocumento);
    const dataXml = notaDanfe.emitidaEm ? dataIsoBrasil(notaDanfe.emitidaEm) : '';
    if (dataSped.length === 10 && dataXml && dataSped !== dataXml) {
      divergencias.push({
        ...base,
        codigoRegra: 'R-DOC-11',
        tipo: 'DATA_EMISSAO',
        severidade: 'MEDIA',
        campo: 'DT_DOC',
        valorSped: dataSped,
        valorDanfe: dataXml,
        descricao: `NF ${numeroNf}: data de emissão no SPED (${dataSped}) diferente do XML (${dataXml}).`,
      });
    }
  }

  // R-DOC-02: NF emitida no período, no DanfeCollector, ausente no SPED
  const fimPeriodo = dataSpedIso(sped.abertura.dataFinal);
  for (const [chave, nota] of Array.from(notasDanfe)) {
    if (chavesNoSped.has(chave)) continue;
    if (nota.emitidaNoPeriodo === false) continue;
    if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') continue;

    const emissao = dataIsoBrasil(nota.emitidaEm);
    const diasAteFim = (Date.parse(fimPeriodo) - Date.parse(emissao)) / 86_400_000;
    // Só compras podem ter entrada no mês seguinte; nota própria de saída entra na data de emissão.
    const empresaEhDestinataria = (nota.destCnpj ?? '').replace(/\D/g, '') === cnpjEmpresa;
    const pertoDoFim = empresaEhDestinataria && Number.isFinite(diasAteFim) && diasAteFim <= DIAS_FIM_PERIODO;
    const numeroNf = nota.numero || chave;

    divergencias.push({
      codigoRegra: 'R-DOC-02',
      tipo: 'NF_AUSENTE_SPED',
      severidade: pertoDoFim ? 'BAIXA' : 'ALTA',
      registroSped: 'C100',
      linhaSped: 0,
      campo: 'CHV_NFE',
      valorSped: '(não escriturada)',
      valorDanfe: chave,
      descricao: pertoDoFim
        ? `NF ${numeroNf} de "${nota.emitenteNome || nota.emitenteCnpj}" foi emitida em ${emissao} e não está neste SPED. Como foi no fim do mês, provavelmente a entrada será no mês seguinte — confira.`
        : `NF ${numeroNf} de "${nota.emitenteNome || nota.emitenteCnpj}" foi emitida em ${emissao}, está autorizada na SEFAZ, mas não foi escriturada neste SPED.`,
      chaveNfe: chave,
      fornecedorNome: nota.emitenteNome ?? undefined,
      fornecedorCnpj: nota.emitenteCnpj ?? undefined,
    });
  }

  return divergencias;
}
