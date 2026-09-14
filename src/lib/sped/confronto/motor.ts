/**
 * Motor orquestrador do Confronto SPED Fiscal.
 *
 * Coordena a execução de todas as regras de confronto (cadastro, documentos,
 * itens, apuração e inteligentes) e produz um resultado unificado pronto
 * para persistir no banco (SpedDivergencia).
 */

import type { SpedFiscalParsed, SpedRegistro0150, SpedRegistro0200 } from '../types';
import { limparCnpjSped, periodoSped, dataSpedParaDate } from '../parser';
import { confrontarCadastros, type NotaDanfe, type ConsultaIeResult } from './cadastro';
import { confrontarDocumentos, type NotaDanfeCompleta } from './documentos';
import { confrontarItens } from './itens';
import { confrontarApuracao } from './apuracao';
import { confrontarInteligente } from './inteligente';
import { parseDanfe, type DanfeItem } from '../../sefaz/detalhe';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaUnificada {
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

export interface ResumoDivergencias {
  total: number;
  porSeveridade: {
    CRITICA: number;
    ALTA: number;
    MEDIA: number;
    BAIXA: number;
    INFO: number;
  };
  porTipo: Record<string, number>;
  porRegra: Record<string, number>;
  topFornecedores: Array<{
    cnpj: string;
    nome: string;
    total: number;
    tipos: string[];
  }>;
}

export interface ResultadoConfronto {
  periodo: string;
  cnpjEmpresa: string;
  nomeEmpresa: string;
  divergencias: DivergenciaUnificada[];
  resumo: ResumoDivergencias;
  estatisticasSped: SpedFiscalParsed['estatisticas'];
  totalNotasSped: number;
  totalNotasDanfe: number;
  executadoEm: Date;
}

// ─── Interface para dados do DanfeCollector ─────────────────────────────

export interface DadosDanfeCollector {
  /** Notas do DanfeCollector no período, indexadas por chave */
  notas: Map<string, NotaDanfeCompleta>;
  /** XMLs completos por chave (string XML), para parse de itens */
  xmlsPorChave: Map<string, string>;
  /** Cache de consultas IE (opcional — se já consultamos antes) */
  consultasIe?: Map<string, ConsultaIeResult>;
  /** UF da empresa */
  ufEmpresa?: string;
}

// ─── Orquestrador ───────────────────────────────────────────────────────

/**
 * Executa o confronto completo entre o SPED Fiscal e os dados do DanfeCollector.
 *
 * Sequência:
 * 1. Regras de cadastro (0150, 0200 vs NotaFiscal + IE)
 * 2. Regras de documentos (C100 vs NotaFiscal)
 * 3. Regras de itens (C170 vs det do XML, quando o XML está disponível)
 * 4. Regras de apuração (E110 vs C190 vs totais)
 * 5. Regras inteligentes (cruzamentos especiais)
 *
 * @param sped - SPED Fiscal parseado
 * @param dados - Dados do DanfeCollector (notas, XMLs, consultas IE)
 * @returns Resultado do confronto com divergências e resumo
 */
export function executarConfronto(
  sped: SpedFiscalParsed,
  dados: DadosDanfeCollector,
): ResultadoConfronto {
  const todas: DivergenciaUnificada[] = [];
  const periodo = periodoSped(sped.abertura);
  const cnpjEmpresa = limparCnpjSped(sped.abertura.cnpj);

  // Mapa de participantes
  const participantesPorCodigo = new Map<string, SpedRegistro0150>();
  for (const p of sped.participantes) {
    participantesPorCodigo.set(p.codigoParticipante, p);
  }

  // Mapa de produtos
  const produtosPorCodigo = new Map<string, SpedRegistro0200>();
  for (const p of sped.produtos) {
    produtosPorCodigo.set(p.codigoItem, p);
  }

  // 1. Cadastro
  const notasDanfeSimples = new Map<string, NotaDanfe>();
  for (const [chave, nota] of Array.from(dados.notas)) {
    notasDanfeSimples.set(chave, {
      chave: nota.chave,
      emitenteCnpj: nota.emitenteCnpj,
      emitenteNome: nota.emitenteNome,
      emitenteIe: nota.emitenteIe,
      emitenteUf: nota.emitenteUf,
      destCnpj: nota.destCnpj,
    });
  }
  const divCadastro = confrontarCadastros(sped, notasDanfeSimples, dados.consultasIe);
  todas.push(...divCadastro);

  // 2. Documentos
  const divDocumentos = confrontarDocumentos(sped, dados.notas, participantesPorCodigo, cnpjEmpresa);
  todas.push(...divDocumentos);

  // 3. Itens (para cada C100 que tem correspondência no DanfeCollector E temos o XML)
  for (const c100 of sped.notasFiscais) {
    if (c100.itens.length === 0) continue;
    const chave = (c100.chaveNfe ?? '').replace(/\D/g, '');
    if (!chave || chave.length !== 44) continue;

    const xml = dados.xmlsPorChave.get(chave);
    if (!xml) continue;

    // Parsear itens do XML
    const danfeData = parseDanfe(xml);
    if (!danfeData || !danfeData.itens.length) continue;

    const participante = participantesPorCodigo.get(c100.codigoParticipante);
    const divItens = confrontarItens(
      c100,
      danfeData.itens,
      produtosPorCodigo,
      participante?.nome,
      participante ? limparCnpjSped(participante.cnpj) : undefined,
    );
    todas.push(...divItens);
  }

  // 4. Apuração
  // Calcular totais de ICMS dos XMLs por tipo de operação
  let totalIcmsXmlEntradas = 0;
  let totalIcmsXmlSaidas = 0;
  for (const nota of Array.from(dados.notas.values())) {
    if (nota.valorIcms && nota.situacaoSefaz === 'AUTORIZADA') {
      if (nota.tipoOperacao === 'Entrada') {
        totalIcmsXmlEntradas += nota.valorIcms;
      } else {
        totalIcmsXmlSaidas += nota.valorIcms;
      }
    }
  }
  const divApuracao = confrontarApuracao(sped, totalIcmsXmlEntradas, totalIcmsXmlSaidas);
  todas.push(...divApuracao);

  // 5. Inteligentes
  const divInteligente = confrontarInteligente(sped, dados.consultasIe, dados.ufEmpresa);
  todas.push(...divInteligente);

  // Gerar resumo
  const resumo = gerarResumo(todas);

  return {
    periodo,
    cnpjEmpresa,
    nomeEmpresa: sped.abertura.nome,
    divergencias: todas,
    resumo,
    estatisticasSped: sped.estatisticas,
    totalNotasSped: sped.notasFiscais.length,
    totalNotasDanfe: dados.notas.size,
    executadoEm: new Date(),
  };
}

// ─── Gerador de resumo ─────────────────────────────────────────────────

function gerarResumo(divergencias: DivergenciaUnificada[]): ResumoDivergencias {
  const porSeveridade = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0, INFO: 0 };
  const porTipo: Record<string, number> = {};
  const porRegra: Record<string, number> = {};
  const fornecedorMap = new Map<string, { nome: string; total: number; tiposSet: Set<string> }>();

  for (const d of divergencias) {
    // Severidade
    if (d.severidade in porSeveridade) {
      porSeveridade[d.severidade as keyof typeof porSeveridade]++;
    }

    // Tipo
    porTipo[d.tipo] = (porTipo[d.tipo] ?? 0) + 1;

    // Regra
    porRegra[d.codigoRegra] = (porRegra[d.codigoRegra] ?? 0) + 1;

    // Fornecedor
    if (d.fornecedorCnpj) {
      const existing = fornecedorMap.get(d.fornecedorCnpj);
      if (existing) {
        existing.total++;
        existing.tiposSet.add(d.tipo);
      } else {
        fornecedorMap.set(d.fornecedorCnpj, {
          nome: d.fornecedorNome ?? d.fornecedorCnpj,
          total: 1,
          tiposSet: new Set([d.tipo]),
        });
      }
    }
  }

  const topFornecedores = Array.from(fornecedorMap.entries())
    .map(([cnpj, data]) => ({
      cnpj,
      nome: data.nome,
      total: data.total,
      tipos: Array.from(data.tiposSet),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return {
    total: divergencias.length,
    porSeveridade,
    porTipo,
    porRegra,
    topFornecedores,
  };
}
