/**
 * Parser do arquivo SPED Fiscal (EFD ICMS/IPI).
 *
 * O SPED é um arquivo texto com campos delimitados por pipe (|).
 * Cada linha começa e termina com |, e o primeiro campo é o código do registro.
 *
 * Exemplo: |C100|0|1|FORN001|55|00|001|27020|23456789000100550010000270201234567890|01012026|01012026|5000.00|...
 *
 * Este parser lê o arquivo linha a linha e extrai os registros relevantes para
 * o confronto fiscal (blocos 0, C, E), vinculando registros filhos (C170, C190)
 * ao C100 pai.
 */

import type {
  SpedFiscalParsed,
  SpedRegistro0000,
  SpedRegistro0150,
  SpedRegistro0190,
  SpedRegistro0200,
  SpedRegistro0220,
  SpedRegistroC100,
  SpedRegistroC170,
  SpedRegistroC190,
  SpedRegistroE110,
  SpedEstatisticasParsing,
  SpedErroParsing,
} from './types';
import {
  SpedIndicadorOperacao,
  SpedFinalidade,
  SpedIndicadorEmitente,
  SpedCodigoSituacao,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────────────

/** Extrai string de um campo SPED (retorna '' se vazio) */
function str(campos: string[], indice: number): string {
  return (campos[indice] ?? '').trim();
}

/** Extrai número de um campo SPED (retorna 0 se vazio/inválido). Aceita vírgula como decimal. */
function num(campos: string[], indice: number): number {
  const raw = (campos[indice] ?? '').trim().replace(',', '.');
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Divide uma linha SPED em campos.
 * A linha começa e termina com pipe: |REG|campo1|campo2|...|campoN|
 * O split gera ['', 'REG', 'campo1', ..., 'campoN', ''] — removemos primeiro e último vazios.
 */
function splitCampos(linha: string): string[] {
  const partes = linha.split('|');
  // Remove o primeiro e último elementos vazios causados pelo pipe externo
  if (partes.length > 0 && partes[0] === '') partes.shift();
  if (partes.length > 0 && partes[partes.length - 1] === '') partes.pop();
  return partes;
}

// ─── Parsers individuais ────────────────────────────────────────────────

function parsear0000(campos: string[], linha: number): SpedRegistro0000 {
  return {
    registro: '0000',
    codigoVersao: str(campos, 1),
    codigoFinalidade: (str(campos, 2) || '0') as SpedFinalidade,
    dataInicial: str(campos, 3),
    dataFinal: str(campos, 4),
    nome: str(campos, 5),
    cnpj: str(campos, 6),
    cpf: str(campos, 7),
    uf: str(campos, 8),
    ie: str(campos, 9),
    codigoMunicipio: str(campos, 10),
    im: str(campos, 11),
    suframa: str(campos, 12),
    indicadorPerfil: str(campos, 13),
    indicadorAtividade: str(campos, 14),
    linha,
  };
}

function parsear0150(campos: string[], linha: number): SpedRegistro0150 {
  return {
    registro: '0150',
    codigoParticipante: str(campos, 1),
    nome: str(campos, 2),
    codigoPais: str(campos, 3),
    cnpj: str(campos, 4),
    cpf: str(campos, 5),
    ie: str(campos, 6),
    codigoMunicipio: str(campos, 7),
    suframa: str(campos, 8),
    endereco: str(campos, 9),
    numero: str(campos, 10),
    complemento: str(campos, 11),
    bairro: str(campos, 12),
    linha,
  };
}

function parsear0190(campos: string[], linha: number): SpedRegistro0190 {
  return {
    registro: '0190',
    unidade: str(campos, 1),
    descricao: str(campos, 2),
    linha,
  };
}

function parsear0200(campos: string[], linha: number): SpedRegistro0200 {
  return {
    registro: '0200',
    codigoItem: str(campos, 1),
    descricao: str(campos, 2),
    codigoBarras: str(campos, 3),
    codigoAnterior: str(campos, 4),
    unidade: str(campos, 5),
    tipoItem: str(campos, 6),
    ncm: str(campos, 7),
    exIpi: str(campos, 8),
    codigoGenero: str(campos, 9),
    codigoServico: str(campos, 10),
    aliquotaIcms: str(campos, 11),
    cest: str(campos, 12),
    linha,
  };
}

function parsear0220(campos: string[], linha: number): SpedRegistro0220 {
  return {
    registro: '0220',
    codigoItem: '', // será atribuído pelo contexto pai (0200)
    unidadeConversao: str(campos, 1),
    fatorConversao: num(campos, 2),
    codigoBarras: str(campos, 3),
    linha,
  };
}

function parsearC100(campos: string[], linha: number): SpedRegistroC100 {
  return {
    registro: 'C100',
    indicadorOperacao: (str(campos, 1) || '0') as SpedIndicadorOperacao,
    indicadorEmitente: (str(campos, 2) || '0') as SpedIndicadorEmitente,
    codigoParticipante: str(campos, 3),
    codigoModelo: str(campos, 4),
    codigoSituacao: (str(campos, 5) || '00') as SpedCodigoSituacao,
    serie: str(campos, 6),
    numero: str(campos, 7),
    chaveNfe: str(campos, 8),
    dataDocumento: str(campos, 9),
    dataEntradaSaida: str(campos, 10),
    valorDocumento: num(campos, 11),
    indicadorPagamento: str(campos, 12),
    valorDesconto: num(campos, 13),
    valorAbatimento: num(campos, 14),
    valorMercadorias: num(campos, 15),
    indicadorFrete: str(campos, 16),
    valorFrete: num(campos, 17),
    valorSeguro: num(campos, 18),
    valorOutrasDespesas: num(campos, 19),
    valorBaseIcms: num(campos, 20),
    valorIcms: num(campos, 21),
    valorBaseIcmsSt: num(campos, 22),
    valorIcmsSt: num(campos, 23),
    valorIpi: num(campos, 24),
    valorPis: num(campos, 25),
    valorCofins: num(campos, 26),
    valorPisSt: num(campos, 27),
    valorCofinsSt: num(campos, 28),
    linha,
    itens: [],
    consolidacoes: [],
  };
}

function parsearC170(campos: string[], linha: number): SpedRegistroC170 {
  return {
    registro: 'C170',
    numeroItem: str(campos, 1),
    codigoItem: str(campos, 2),
    descricao: str(campos, 3),
    quantidade: num(campos, 4),
    unidade: str(campos, 5),
    valorItem: num(campos, 6),
    valorDesconto: num(campos, 7),
    indicadorMovimento: str(campos, 8),
    cstIcms: str(campos, 9),
    cfop: str(campos, 10),
    codigoNatureza: str(campos, 11),
    valorBaseIcms: num(campos, 12),
    aliquotaIcms: num(campos, 13),
    valorIcms: num(campos, 14),
    valorBaseIcmsSt: num(campos, 15),
    aliquotaIcmsSt: num(campos, 16),
    valorIcmsSt: num(campos, 17),
    indicadorApur: str(campos, 18),
    cstIpi: str(campos, 19),
    codigoEnquadramentoIpi: str(campos, 20),
    valorBaseIpi: num(campos, 21),
    aliquotaIpi: num(campos, 22),
    valorIpi: num(campos, 23),
    // Layout C170: ... CST_PIS(24) VL_BC_PIS ALIQ_PIS QUANT_BC_PIS ALIQ_PIS_QUANT VL_PIS(29)
    // CST_COFINS(30) VL_BC_COFINS ALIQ_COFINS QUANT_BC_COFINS ALIQ_COFINS_QUANT VL_COFINS(35)
    cstPis: str(campos, 24),
    valorBasePis: num(campos, 25),
    aliquotaPis: num(campos, 26),
    valorPis: num(campos, 29),
    cstCofins: str(campos, 30),
    valorBaseCofins: num(campos, 31),
    aliquotaCofins: num(campos, 32),
    valorCofins: num(campos, 35),
    // O C170 não tem campo de NCM — o NCM do item vem do 0200.
    codigoNcm: '',
    linha,
  };
}

function parsearC190(campos: string[], linha: number): SpedRegistroC190 {
  return {
    registro: 'C190',
    cstIcms: str(campos, 1),
    cfop: str(campos, 2),
    aliquotaIcms: num(campos, 3),
    valorOperacao: num(campos, 4),
    valorBaseIcms: num(campos, 5),
    valorIcms: num(campos, 6),
    valorBaseIcmsSt: num(campos, 7),
    valorIcmsSt: num(campos, 8),
    valorIcmsDesonerado: num(campos, 9), // VL_RED_BC
    valorIpi: num(campos, 10),
    linha,
  };
}

function parsearE110(campos: string[], linha: number): SpedRegistroE110 {
  return {
    registro: 'E110',
    valorTotalDebitos: num(campos, 1),
    valorAjustesDebitos: num(campos, 2),
    valorTotalAjustesDebitos: num(campos, 3),
    valorEstornosCredito: num(campos, 4),
    valorTotalCreditos: num(campos, 5),
    valorAjustesCreditos: num(campos, 6),
    valorTotalAjustesCreditos: num(campos, 7),
    valorEstornosDebito: num(campos, 8),
    saldoCredorAnterior: num(campos, 9),
    saldoDevedor: num(campos, 10),
    valorTotalDeducoes: num(campos, 11),
    valorIcmsRecolher: num(campos, 12),
    saldoCredorTransportar: num(campos, 13),
    valorDebitoEspecial: num(campos, 14),
    linha,
  };
}

// ─── Registros que sabemos ler (para não gerar ruído de "desconhecido") ─

const REGISTROS_CONHECIDOS = new Set([
  '0000', '0001', '0005', '0015', '0100', '0150', '0175', '0190', '0200', '0205', '0206',
  '0210', '0220', '0300', '0305', '0400', '0450', '0460', '0500', '0600', '0990',
  'C001', 'C100', 'C101', 'C105', '0170',
  'C110', 'C111', 'C112', 'C113', 'C114', 'C115', 'C116',
  'C120', 'C130', 'C140', 'C141',
  'C170', 'C171', 'C172', 'C173', 'C174', 'C175', 'C176', 'C177', 'C178', 'C179',
  'C185', 'C186',
  'C190', 'C191',
  'C195', 'C197',
  'C300', 'C310', 'C320', 'C321', 'C330',
  'C350', 'C370', 'C380', 'C390',
  'C400', 'C405', 'C410', 'C420', 'C425', 'C430', 'C460', 'C465', 'C470',
  'C490', 'C495',
  'C500', 'C510', 'C590', 'C595', 'C597',
  'C600', 'C601', 'C610', 'C690',
  'C700', 'C790', 'C791',
  'C800', 'C810', 'C815', 'C850', 'C855', 'C857', 'C860', 'C870', 'C880', 'C890',
  'C895', 'C897',
  'C990',
  'D001', 'D100', 'D101', 'D110', 'D120', 'D130', 'D140', 'D150', 'D160', 'D161',
  'D162', 'D170', 'D180', 'D190', 'D195', 'D197',
  'D300', 'D301', 'D310', 'D350', 'D355', 'D360', 'D365', 'D370', 'D390',
  'D400', 'D410', 'D411', 'D420',
  'D500', 'D510', 'D530', 'D590', 'D600', 'D610', 'D690',
  'D695', 'D696', 'D697',
  'D990',
  'E001', 'E100', 'E110', 'E111', 'E112', 'E113', 'E115', 'E116',
  'E200', 'E210', 'E220', 'E230', 'E240', 'E250',
  'E300', 'E310', 'E311', 'E312', 'E313', 'E316',
  'E500', 'E510', 'E520', 'E530',
  'E990',
  'G001', 'G110', 'G125', 'G126', 'G130', 'G140', 'G990',
  'H001', 'H005', 'H010', 'H020', 'H030', 'H990',
  'K001', 'K100', 'K200', 'K210', 'K215', 'K220', 'K230', 'K235',
  'K250', 'K255', 'K260', 'K265', 'K270', 'K275', 'K280', 'K290', 'K291', 'K292',
  'K300', 'K301', 'K302', 'K990',
  '1001', '1010', '1100', '1105', '1110', '1200', '1210', '1250', '1255',
  '1300', '1310', '1320', '1350', '1360', '1370', '1390', '1391',
  '1400', '1500', '1510', '1600', '1601', '1700', '1710',
  '1800', '1900', '1910', '1920', '1921', '1922', '1923', '1925', '1926',
  '1960', '1970', '1975', '1980',
  '1990',
  '9001', '9900', '9990', '9999',
]);

// ─── Parser principal ───────────────────────────────────────────────────

/**
 * Parseia o conteúdo completo de um arquivo SPED Fiscal (EFD ICMS/IPI).
 *
 * Registros filhos (C170, C190) são automaticamente vinculados ao C100 pai
 * mais recente, pois o SPED é sequencial: C100 → C170 (N itens) → C190 (N consolidações) → próximo C100.
 *
 * @param conteudo - Conteúdo textual completo do arquivo .txt do SPED
 * @returns Estrutura parseada com todos os registros e estatísticas
 * @throws Error se o registro 0000 não for encontrado
 */
export function parsearSpedFiscal(conteudo: string): SpedFiscalParsed {
  const linhas = conteudo.split(/\r?\n/);

  let abertura: SpedRegistro0000 | null = null;
  const participantes: SpedRegistro0150[] = [];
  const unidades: SpedRegistro0190[] = [];
  const produtos: SpedRegistro0200[] = [];
  const conversoes: SpedRegistro0220[] = [];
  const notasFiscais: SpedRegistroC100[] = [];
  const apuracoesIcms: SpedRegistroE110[] = [];
  const erros: SpedErroParsing[] = [];
  const registrosDesconhecidosSet = new Set<string>();
  const contagemRegistros: Record<string, number> = {};

  // Contexto de vinculação hierárquica
  let ultimoC100: SpedRegistroC100 | null = null;
  let ultimoProduto0200: SpedRegistro0200 | null = null;

  let totalRegistrosLidos = 0;
  let totalRegistrosIgnorados = 0;

  for (let i = 0; i < linhas.length; i++) {
    const linhaRaw = linhas[i].trim();
    if (!linhaRaw || !linhaRaw.startsWith('|')) continue;

    const campos = splitCampos(linhaRaw);
    if (campos.length === 0) continue;

    const registro = campos[0];
    const numeroLinha = i + 1; // 1-indexed
    contagemRegistros[registro] = (contagemRegistros[registro] ?? 0) + 1;

    try {
      switch (registro) {
        case '0000':
          abertura = parsear0000(campos, numeroLinha);
          totalRegistrosLidos++;
          break;

        case '0150':
          participantes.push(parsear0150(campos, numeroLinha));
          totalRegistrosLidos++;
          break;

        case '0190':
          unidades.push(parsear0190(campos, numeroLinha));
          totalRegistrosLidos++;
          break;

        case '0200':
          ultimoProduto0200 = parsear0200(campos, numeroLinha);
          produtos.push(ultimoProduto0200);
          totalRegistrosLidos++;
          break;

        case '0220': {
          const conv = parsear0220(campos, numeroLinha);
          if (ultimoProduto0200) {
            conv.codigoItem = ultimoProduto0200.codigoItem;
          }
          conversoes.push(conv);
          totalRegistrosLidos++;
          break;
        }

        case 'C100': {
          const c100 = parsearC100(campos, numeroLinha);
          notasFiscais.push(c100);
          ultimoC100 = c100;
          totalRegistrosLidos++;
          break;
        }

        case 'C170': {
          const c170 = parsearC170(campos, numeroLinha);
          if (ultimoC100) {
            c170.chaveNfePai = ultimoC100.chaveNfe;
            ultimoC100.itens.push(c170);
          }
          totalRegistrosLidos++;
          break;
        }

        case 'C190': {
          const c190 = parsearC190(campos, numeroLinha);
          if (ultimoC100) {
            c190.chaveNfePai = ultimoC100.chaveNfe;
            ultimoC100.consolidacoes.push(c190);
          }
          totalRegistrosLidos++;
          break;
        }

        case 'E110':
          apuracoesIcms.push(parsearE110(campos, numeroLinha));
          totalRegistrosLidos++;
          break;

        default:
          if (REGISTROS_CONHECIDOS.has(registro)) {
            totalRegistrosIgnorados++;
          } else {
            registrosDesconhecidosSet.add(registro);
            totalRegistrosIgnorados++;
          }
          break;
      }
    } catch (err) {
      erros.push({
        linha: numeroLinha,
        registro,
        mensagem: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!abertura) {
    throw new Error(
      'Arquivo SPED inválido: registro 0000 (abertura) não encontrado. ' +
      'Verifique se o arquivo é um SPED Fiscal (EFD ICMS/IPI) válido.'
    );
  }

  const estatisticas: SpedEstatisticasParsing = {
    totalLinhas: linhas.length,
    totalRegistrosLidos,
    totalRegistrosIgnorados,
    total0150: participantes.length,
    total0200: produtos.length,
    totalC100: notasFiscais.length,
    totalC170: notasFiscais.reduce((acc, nf) => acc + nf.itens.length, 0),
    totalC190: notasFiscais.reduce((acc, nf) => acc + nf.consolidacoes.length, 0),
    totalE110: apuracoesIcms.length,
    contagemRegistros,
    registrosDesconhecidos: Array.from(registrosDesconhecidosSet).sort(),
    erros,
  };

  return {
    abertura,
    participantes,
    unidades,
    produtos,
    conversoes,
    notasFiscais,
    apuracoesIcms,
    estatisticas,
  };
}

export const parseSpedFiscal = parsearSpedFiscal;

// ─── Utilitários de data ────────────────────────────────────────────────

/**
 * Converte data SPED (ddmmaaaa ou dd/mm/aaaa) para Date.
 */
export function dataSpedParaDate(dataSped: string): Date | null {
  if (!dataSped) return null;
  const limpo = dataSped.replace(/\//g, '');
  if (limpo.length !== 8) return null;
  const dia = parseInt(limpo.slice(0, 2), 10);
  const mes = parseInt(limpo.slice(2, 4), 10) - 1;
  const ano = parseInt(limpo.slice(4, 8), 10);
  const d = new Date(ano, mes, dia);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Retorna o período do SPED como string "YYYY-MM" (ex: "2026-01").
 */
export function periodoSped(abertura: SpedRegistro0000): string {
  const dt = dataSpedParaDate(abertura.dataInicial);
  if (!dt) return 'desconhecido';
  const ano = dt.getFullYear();
  const mes = String(dt.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

/**
 * Data SPED (ddmmaaaa) → "AAAA-MM-DD", sem passar por Date (evita fuso).
 */
export function dataSpedIso(dataSped: string): string {
  const limpo = (dataSped ?? '').replace(/\//g, '');
  if (limpo.length !== 8) return dataSped ?? '';
  return `${limpo.slice(4, 8)}-${limpo.slice(2, 4)}-${limpo.slice(0, 2)}`;
}

/**
 * Data do XML (instante UTC) → "AAAA-MM-DD" no horário do Ceará (UTC-3, sem horário de verão).
 */
export function dataIsoBrasil(data: Date): string {
  return new Date(data.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * CST do SPED pode vir com 3 dígitos (origem + CST, ex: "260"). Retorna só o CST ("60").
 */
export function normalizarCst(cst: string | null | undefined): string {
  const c = (cst ?? '').trim();
  return c.length === 3 ? c.slice(1) : c;
}

/**
 * CFOP de saída do fornecedor → CFOP equivalente de entrada (5→1, 6→2, 7→3).
 */
export function grupoCfopEntrada(cfopSaida: string): string {
  const primeiro = (cfopSaida ?? '').trim().charAt(0);
  return ({ '5': '1', '6': '2', '7': '3' } as Record<string, string>)[primeiro] ?? primeiro;
}

/**
 * Limpa CNPJ removendo caracteres não-numéricos.
 */
export function limparCnpjSped(cnpj: string): string {
  return (cnpj ?? '').replace(/\D/g, '');
}
