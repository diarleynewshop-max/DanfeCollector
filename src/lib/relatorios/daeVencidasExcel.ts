import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import { whereNotaPermitida } from '@/lib/usuarios/auth';
import { diasAteVencimento, extrairResumoDae, statusDaeEfetivo } from '@/lib/sitram/dae';
import { extrairEspelhoSitram } from '@/lib/sitram/espelho';
import { numeroNotaDaChave } from '@/lib/notasIdentificacao';

type Registro = Record<string, unknown>;

export interface FiltrosRelatorioDaeVencidas {
  usuario: UsuarioLogado;
  inicio?: string;
  fim?: string;
  cnpjId?: number;
  raizesCnpj?: string[];
  tipo?: string;
  situacoes?: string[];
  daeFiltros?: string[];
  fornecedores?: string[];
  risco?: string;
  busca?: string;
}

type NotaDaeVencida = {
  id: number;
  chave: string;
  numero: string | null;
  emitidaEm: Date;
  tipoOperacao: string | null;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  destNome: string | null;
  destCnpj: string | null;
  situacaoSefaz: string;
  sitramConsultadaEm: Date | null;
  sitramDaeStatus: string | null;
  sitramDaeResumo: string | null;
  sitramDetalhe: string | null;
  pagamentoManualEm: Date | null;
  cnpj: { cnpj: string; razaoSocial: string | null };
};

type LinhaDaeVencida = {
  numeroNota: string;
  chaveAcesso: string;
  nomeFornecedor: string;
  nomeLojaRecebeu: string;
  dataVencimento: Date | null;
  st: number | null;
  jurosSt: number | null;
  antecipacao: number | null;
  jurosAntecipacao: number | null;
  fecop: number | null;
  jurosFecop: number | null;
  valorTotalPagar: number | null;
  valorTotalJuros: number | null;
  obs: string;
};

function registro(valor: unknown): Registro {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : {};
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const limpo = valor.replace(/\s/g, '').replace(/^R\$/i, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function primeiroTexto(...valores: unknown[]): string | null {
  for (const valor of valores) {
    const resultado = texto(valor);
    if (resultado) return resultado;
  }
  return null;
}

function semAcentos(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tipoLancamento(raw: Registro): 'ST' | 'ANTECIPACAO' | 'FECOP' | 'OUTRO' {
  const codigo = primeiroTexto(raw.codigo, raw.codReceita, raw.codigoReceitaCodigo);
  const descricao = semAcentos([
    primeiroTexto(raw.descricaoAbreviada, raw.descricaoRec, raw.descricao),
    codigo,
  ].filter(Boolean).join(' '));

  if (/\bfecop\b|\b2020\b/.test(descricao)) return 'FECOP';
  if (/\b1031\b|\bsubt\b|substituicao/.test(descricao)) return 'ST';
  if (/\b1023\b|\bantc\b|antecip/.test(descricao)) return 'ANTECIPACAO';
  return 'OUTRO';
}

function extrairLancamentos(detalhe: Registro): Registro[] {
  if (Array.isArray(detalhe.lancamentos)) return detalhe.lancamentos.map(registro);
  const notaFiscal = registro(detalhe.notaFiscal);
  if (Array.isArray(notaFiscal.lancamentos)) return notaFiscal.lancamentos.map(registro);
  return [];
}

function parseData(valor: unknown): Date | null {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor;
  const textoData = texto(valor);
  if (!textoData) return null;
  const data = new Date(textoData);
  return Number.isNaN(data.getTime()) ? null : data;
}

function juntarMoedas(...valores: Array<number | null | undefined>): number | null {
  let total = 0;
  let encontrou = false;
  for (const valor of valores) {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) continue;
    total += valor;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function escolherDataVencimento(lancamentos: Array<{ vencimento: string | null }>): Date | null {
  const datas = lancamentos
    .map((lancamento) => parseData(lancamento.vencimento))
    .filter((data): data is Date => !!data);
  if (datas.length === 0) return null;
  datas.sort((a, b) => a.getTime() - b.getTime());
  return datas[0];
}

function dataParametro(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new Error('Periodo invalido.');
  }
  return new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}-03:00`);
}

function filtroBloqueado(valores: string[] | undefined): boolean {
  return Array.isArray(valores) && valores.includes('__none__');
}

function normalizarBusca(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapearDocumentosPagamento(detalhe: Registro): Registro[] {
  const pagamentoIcms = registro(detalhe.pagamentoIcms);
  if (Array.isArray(pagamentoIcms.documentos)) return pagamentoIcms.documentos.map(registro);
  return [];
}

function jurosDocumento(documento: Registro): number | null {
  const detalheDae = registro(documento.detalheDae);
  return numero(detalheDae.valorJuros) ?? numero(documento.valorJuros);
}

function normalizarLancamentosParaLinha(nota: NotaDaeVencida): LinhaDaeVencida | null {
  if (!nota.sitramDetalhe) return null;

  let detalhe: Registro;
  try {
    detalhe = registro(JSON.parse(nota.sitramDetalhe));
  } catch {
    return null;
  }

  if (nota.pagamentoManualEm) return null;
  if (statusDaeEfetivo(nota) === 'PAGO') return null;

  const resumo = extrairResumoDae(nota);
  const lancamentosBrutos = extrairLancamentos(detalhe).map((raw, indice) => {
    const normalizado = resumo.lancamentos[indice];
    return {
    raw,
    tipo: tipoLancamento(raw),
    id: primeiroTexto(raw.idLancamentoFront, raw.id)?.replace(/\D/g, '') ?? null,
    codigo: primeiroTexto(raw.codigo, raw.codReceita, raw.codigoReceitaCodigo),
    vencimento: normalizado?.vencimento ?? primeiroTexto(raw.vencimento, raw.dataVencimento),
    pago: normalizado?.pago ?? /pago|quitad|baixad|recolhid/i.test(semAcentos(primeiroTexto(raw.situacao, raw.siuacaoDescricao, raw.descricaoSituacao))),
    valorAberto: normalizado?.valorAberto ?? numero(raw.valorAberto),
    valor: normalizado?.valor ?? numero(raw.valor) ?? numero(raw.icmsDevido) ?? numero(raw.icmsCalculado),
    juros: numero(raw.valorJuros),
    };
  });

  const lancamentosVencidos = lancamentosBrutos.filter((item) => {
    const dias = diasAteVencimento(item.vencimento);
    return !item.pago && dias !== null && dias < 0;
  });
  if (lancamentosVencidos.length === 0) return null;

  const documentos = mapearDocumentosPagamento(detalhe);
  const docsPorLancamento = new Map<string, Registro[]>();

  for (const documento of documentos) {
    const id = primeiroTexto(documento.idLancamentoFront, documento.id)?.replace(/\D/g, '') ?? null;
    if (!id) continue;
    const lista = docsPorLancamento.get(id) ?? [];
    lista.push(documento);
    docsPorLancamento.set(id, lista);
  }

  const itensFecop = extrairEspelhoSitram({
    chave: nota.chave,
    numero: nota.numero,
    sitramDetalhe: nota.sitramDetalhe,
  });
  const fecopTotal = itensFecop?.totais.fecop ?? null;

  const stLancamentos = lancamentosVencidos.filter((item) => item.tipo === 'ST');
  const antecLancamentos = lancamentosVencidos.filter((item) => item.tipo === 'ANTECIPACAO');
  const fecopLancamentos = lancamentosVencidos.filter((item) => item.tipo === 'FECOP');
  const outrosLancamentos = lancamentosVencidos.filter((item) => item.tipo === 'OUTRO');

  const st = juntarMoedas(...stLancamentos.map((item) => item.valorAberto ?? item.valor)) ?? null;
  const antecipacao = juntarMoedas(...antecLancamentos.map((item) => item.valorAberto ?? item.valor)) ?? null;
  const fecopLancamento = juntarMoedas(...fecopLancamentos.map((item) => item.valorAberto ?? item.valor));
  const fecop = fecopLancamento ?? fecopTotal;

  const jurosStDocs = stLancamentos.flatMap((item) => {
    const id = item.id;
    const encontrados = id ? (docsPorLancamento.get(id) ?? []) : [];
    return encontrados.length > 0
      ? encontrados.map((doc) => jurosDocumento(doc))
      : [item.juros];
  });
  const jurosFecopDocs = fecopLancamentos.flatMap((item) => {
    const id = item.id;
    const encontrados = id ? (docsPorLancamento.get(id) ?? []) : [];
    return encontrados.length > 0
      ? encontrados.map((doc) => jurosDocumento(doc))
      : [item.juros];
  });

  const jurosSt = juntarMoedas(...jurosStDocs);
  const jurosFecop = juntarMoedas(...jurosFecopDocs);
  const jurosTotal = juntarMoedas(jurosSt, jurosFecop);
  const valorTotalPagar = juntarMoedas(st, antecipacao, fecop, jurosTotal);
  const dataVencimento = escolherDataVencimento(lancamentosVencidos.map((item) => ({ vencimento: item.vencimento })));

  const obsPartes = [
    outrosLancamentos.length > 0 ? `${outrosLancamentos.length} lançamento(s) adicional(is)` : '',
    documentos.length > 0 ? 'Juros extraídos do detalhamento SITRAM quando disponível.' : '',
    nota.pagamentoManualEm ? 'Pagamento manual já registrado na base.' : '',
  ].filter(Boolean);

  return {
    numeroNota: nota.numero || numeroNotaDaChave(nota.chave) || '',
    chaveAcesso: nota.chave,
    nomeFornecedor: nota.emitenteNome || '',
    nomeLojaRecebeu: nota.cnpj.razaoSocial || '',
    dataVencimento,
    st,
    jurosSt,
    antecipacao,
    jurosAntecipacao: null,
    fecop,
    jurosFecop,
    valorTotalPagar,
    valorTotalJuros: jurosTotal,
    obs: obsPartes.join(' '),
  };
}

function notaPassaFiltrosDerivados(nota: NotaDaeVencida, filtros: FiltrosRelatorioDaeVencidas): boolean {
  if (filtros.daeFiltros?.includes('__none__')) return false;
  if (filtros.daeFiltros && filtros.daeFiltros.length > 0 && !filtros.daeFiltros.includes('vencido') && !filtros.daeFiltros.includes('pendente')) {
    return false;
  }

  if (filtros.risco && filtros.risco !== 'todos' && filtros.risco !== 'critico') return false;

  const busca = normalizarBusca(filtros.busca ?? '');
  if (!busca) return true;

  const textoBusca = normalizarBusca([
    nota.numero,
    numeroNotaDaChave(nota.chave) || '',
    nota.chave,
    nota.emitenteNome,
    nota.emitenteCnpj,
    nota.destNome,
    nota.destCnpj,
    nota.cnpj.razaoSocial,
    nota.cnpj.cnpj,
  ].filter(Boolean).join(' '));

  return textoBusca.includes(busca);
}

function aplicarLayout(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 14 },
  };

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C2D12' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    };
  });

  const colunas = [
    { width: 16, format: undefined, align: 'left' as const },
    { width: 48, format: undefined, align: 'left' as const },
    { width: 34, format: undefined, align: 'left' as const },
    { width: 28, format: undefined, align: 'left' as const },
    { width: 16, format: 'dd/mm/yyyy', align: 'center' as const },
    { width: 14, format: '#,##0.00', align: 'right' as const },
    { width: 14, format: '#,##0.00', align: 'right' as const },
    { width: 16, format: '#,##0.00', align: 'right' as const },
    { width: 18, format: '#,##0.00', align: 'right' as const },
    { width: 14, format: '#,##0.00', align: 'right' as const },
    { width: 16, format: '#,##0.00', align: 'right' as const },
    { width: 18, format: '#,##0.00', align: 'right' as const },
    { width: 18, format: '#,##0.00', align: 'right' as const },
    { width: 34, format: undefined, align: 'left' as const },
  ];

  colunas.forEach((coluna, indice) => {
    const sheetColumn = sheet.getColumn(indice + 1);
    sheetColumn.width = coluna.width;
    sheetColumn.numFmt = coluna.format;
    sheetColumn.alignment = {
      vertical: 'middle',
      horizontal: coluna.align,
      wrapText: indice === 1 || indice === 2 || indice === 3 || indice === 13,
    };
  });

  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    row.height = 21;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  }
}

export async function gerarRelatorioDaeVencidasExcel(filtros: FiltrosRelatorioDaeVencidas): Promise<{
  buffer: Buffer;
  filename: string;
  total: number;
}> {
  const inicio = dataParametro(filtros.inicio, false);
  const fim = dataParametro(filtros.fim, true);
  const filtrosAnd: Prisma.NotaFiscalWhereInput[] = [
    whereNotaPermitida(filtros.usuario),
    {
      situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
      sitramDetalhe: { not: null },
    },
  ];

  if (inicio || fim) {
    filtrosAnd.push({
      emitidaEm: {
        ...(inicio ? { gte: inicio } : {}),
        ...(fim ? { lte: fim } : {}),
      },
    });
  }

  if (filtros.cnpjId) filtrosAnd.push({ cnpjId: filtros.cnpjId });

  if (filtroBloqueado(filtros.raizesCnpj) || filtroBloqueado(filtros.situacoes) || filtroBloqueado(filtros.fornecedores)) {
    filtrosAnd.push({ id: -1 });
  }

  const raizesCnpj = (filtros.raizesCnpj ?? []).filter((raiz) => raiz !== '__none__');
  if (raizesCnpj.length > 0) {
    filtrosAnd.push({
      OR: raizesCnpj.map((raiz) => ({
        cnpj: { cnpj: { startsWith: raiz } },
      })),
    });
  }

  if (filtros.tipo && filtros.tipo !== 'todos') filtrosAnd.push({ tipoOperacao: filtros.tipo });

  const situacoes = (filtros.situacoes ?? []).filter((situacao) => situacao !== '__none__');
  if (situacoes.length > 0) filtrosAnd.push({ situacaoSefaz: { in: situacoes } });

  const fornecedores = (filtros.fornecedores ?? []).filter((fornecedor) => fornecedor !== '__none__');
  if (fornecedores.length > 0) {
    filtrosAnd.push({
      OR: [
        { emitenteCnpj: { in: fornecedores } },
        { emitenteNome: { in: fornecedores } },
      ],
    });
  }

  const notas = await prisma.notaFiscal.findMany({
    where: { AND: filtrosAnd },
    orderBy: [{ emitidaEm: 'asc' }, { numero: 'asc' }],
    select: {
      id: true,
      chave: true,
      numero: true,
      emitidaEm: true,
      tipoOperacao: true,
      emitenteNome: true,
      emitenteCnpj: true,
      destNome: true,
      destCnpj: true,
      situacaoSefaz: true,
      sitramConsultadaEm: true,
      sitramDaeStatus: true,
      sitramDaeResumo: true,
      sitramDetalhe: true,
      pagamentoManualEm: true,
      cnpj: { select: { cnpj: true, razaoSocial: true } },
    },
  }) as NotaDaeVencida[];

  const linhas = notas
    .filter((nota) => notaPassaFiltrosDerivados(nota, filtros))
    .map(normalizarLancamentosParaLinha)
    .filter((linha): linha is LinhaDaeVencida => !!linha)
    .sort((a, b) => {
      const dataA = a.dataVencimento?.getTime() ?? Number.POSITIVE_INFINITY;
      const dataB = b.dataVencimento?.getTime() ?? Number.POSITIVE_INFINITY;
      if (dataA !== dataB) return dataA - dataB;
      return a.nomeLojaRecebeu.localeCompare(b.nomeLojaRecebeu);
    });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DanfeCollector';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('DAE VENCIDAS');
  sheet.addRow([
    'Número da nota',
    'Chave de acesso',
    'Nome do Fornecedor',
    'Nome da Loja que recebeu',
    'Data de vencimento',
    'ST',
    'Juros ST',
    'Antecipação',
    'Juros antecipação',
    'Fecop',
    'Juros Fecop',
    'Valor total a ser pago',
    'Valor total de juros',
    'OBS',
  ]);

  for (const linha of linhas) {
    sheet.addRow([
      linha.numeroNota,
      linha.chaveAcesso,
      linha.nomeFornecedor,
      linha.nomeLojaRecebeu,
      linha.dataVencimento,
      linha.st,
      linha.jurosSt,
      linha.antecipacao,
      linha.jurosAntecipacao,
      linha.fecop,
      linha.jurosFecop,
      linha.valorTotalPagar,
      linha.valorTotalJuros,
      linha.obs,
    ]);
  }

  aplicarLayout(sheet);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const filename = `dae-vencidas-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return {
    buffer,
    filename,
    total: linhas.length,
  };
}
