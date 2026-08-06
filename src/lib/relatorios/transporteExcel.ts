import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import { whereNotaPermitida } from '@/lib/usuarios/auth';
import { extrairResumoDae, lancamentosVisiveisDae, statusDaeEfetivo } from '@/lib/sitram/dae';

export interface FiltrosRelatorioTransporte {
  usuario: UsuarioLogado;
  inicio?: string;
  fim?: string;
  cnpjId?: number;
  raizesCnpj?: string[];
  situacoes?: string[];
  daeFiltros?: string[];
  fornecedores?: string[];
}

type LinhaRelatorio = {
  chaveAcesso: string;
  numeroNota: string;
  dataEmissao: Date;
  cnpjFornecedor: string;
  nomeFornecedor: string;
  serie: string;
  uf: string;
  valorNfe: number | null;
  icmsDestacado: number | null;
  situacaoNfe: string;
  tipo: string;
  status: string;
};

const COLUNAS = [
  { key: 'chaveAcesso', header: 'Chave de Acesso', width: 61.88, hidden: false },
  { key: 'numeroNota', header: 'Número Nota', width: 14.13, hidden: false },
  { key: 'dataEmissao', header: 'Data da Emissão', width: 17.5, hidden: false, numFmt: 'dd/MM/yyyy' },
  { key: 'cnpjFornecedor', header: 'CPF/CNPJ Fornecedor', width: 23.63, hidden: false },
  { key: 'nomeFornecedor', header: 'Nome/Razão Social Fornecedor', width: 44.25, hidden: false },
  { key: 'serie', header: 'Série', width: 6.25, hidden: false },
  { key: 'uf', header: 'UF', width: 7, hidden: false },
  { key: 'valorNfe', header: 'Valor da NF-e', width: 14.38, hidden: false, numFmt: '#,##0.00' },
  { key: 'icmsDestacado', header: 'ICMS Destacado', width: 17.38, hidden: false, numFmt: '#,##0.00' },
  { key: 'situacaoNfe', header: 'Situação NF-e', width: 14.88, hidden: false },
  { key: 'tipo', header: 'TIPO', width: 14.63, hidden: false },
  { key: 'status', header: 'STATUS', width: 34.38, hidden: false },
] satisfies Array<{
  key: keyof LinhaRelatorio;
  header: string;
  width: number;
  hidden: boolean;
  numFmt?: string;
}>;

const DAE_A_PAGAR = ['EM_ABERTO', 'LIBERADA_PARA_GERAR'];

const MESES = [
  'JANEIRO',
  'FEVEREIRO',
  'MARÇO',
  'ABRIL',
  'MAIO',
  'JUNHO',
  'JULHO',
  'AGOSTO',
  'SETEMBRO',
  'OUTUBRO',
  'NOVEMBRO',
  'DEZEMBRO',
];

const selectNotaTransporte = {
  id: true,
  cnpjId: true,
  chave: true,
  numero: true,
  serie: true,
  emitidaEm: true,
  emitenteNome: true,
  emitenteCnpj: true,
  emitenteUf: true,
  valorTotal: true,
  valorIcms: true,
  situacaoSefaz: true,
  sitramConsultadaEm: true,
  sitramDaeStatus: true,
  sitramDaeResumo: true,
  sitramDetalhe: true,
  pagamentoManualEm: true,
  pagamentoManualValor: true,
  cnpj: { select: { cnpj: true, razaoSocial: true } },
} satisfies Prisma.NotaFiscalSelect;

type NotaTransporte = Prisma.NotaFiscalGetPayload<{ select: typeof selectNotaTransporte }>;

function dataParametro(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new Error('Periodo invalido.');
  }
  return new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}-03:00`);
}

function numeroNotaDaChave(chave: string | null | undefined): string {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return '';
  const numero = normalizada.slice(25, 34);
  return numero.replace(/^0+/, '') || numero;
}

function serieNotaDaChave(chave: string | null | undefined): string {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return '';
  const serie = normalizada.slice(22, 25);
  return serie.replace(/^0+/, '') || serie;
}

function formatarCpfCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length === 14) {
    return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digitos.length === 11) {
    return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return valor ?? '';
}

function textoSituacao(valor: string | null | undefined): string {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  if (texto === texto.toUpperCase()) {
    return texto
      .toLowerCase()
      .replace(/(^|\s|-)([a-záéíóúãõç])/g, (match) => match.toUpperCase());
  }
  return texto;
}

function nomeArquivo(inicio?: string, fim?: string): string {
  const partes = ['nota-fiscal-newshop'];
  if (inicio || fim) partes.push(inicio || 'inicio', 'a', fim || 'hoje');
  else partes.push('geral');
  return `${partes.join('_')}.xlsx`;
}

function montarLinha(nota: NotaTransporte): LinhaRelatorio {
  return {
    chaveAcesso: nota.chave,
    numeroNota: nota.numero || numeroNotaDaChave(nota.chave),
    dataEmissao: nota.emitidaEm,
    cnpjFornecedor: formatarCpfCnpj(nota.emitenteCnpj),
    nomeFornecedor: nota.emitenteNome || '',
    serie: nota.serie || serieNotaDaChave(nota.chave),
    uf: nota.emitenteUf || '',
    valorNfe: nota.valorTotal ?? null,
    icmsDestacado: nota.valorIcms ?? null,
    situacaoNfe: textoSituacao(nota.situacaoSefaz),
    tipo: '',
    status: '',
  };
}

function filtroBloqueado(valores: string[] | undefined): boolean {
  return Array.isArray(valores) && valores.includes('__none__');
}

function notaPassaFiltroDae(nota: NotaTransporte, filtros: string[] | undefined): boolean {
  if (!filtros || filtros.length === 0) return true;
  if (filtros.includes('__none__')) return false;

  const resumo = extrairResumoDae(nota);
  const lancamentos = lancamentosVisiveisDae(resumo.lancamentos);
  const lancamento = lancamentos.find((item) => !item.pago) ?? lancamentos[0] ?? null;
  const status = statusDaeEfetivo(nota);
  const daePendente = DAE_A_PAGAR.includes(status);
  const diasDae = (() => {
    if (!lancamento?.vencimento) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const vencimento = new Date(lancamento.vencimento);
    if (Number.isNaN(vencimento.getTime())) return null;
    vencimento.setHours(0, 0, 0, 0);
    return Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
  })();

  return filtros.some((filtro) => {
    if (filtro === 'pago') return status === 'PAGO';
    if (filtro === 'pendente') return daePendente;
    if (filtro === 'vencido') return daePendente && diasDae !== null && diasDae < 0;
    if (filtro === 'vence7') return daePendente && diasDae !== null && diasDae >= 0 && diasDae <= 7;
    if (filtro === 'sem-consulta') return !nota.sitramConsultadaEm;
    if (filtro === 'sem-dae') return status === 'SEM_DAE';
    if (filtro === 'consultado') return status === 'CONSULTADO';
    return false;
  });
}

function aplicarLayout(sheet: ExcelJS.Worksheet) {
  sheet.autoFilter = '$A$1:$L$1';

  const header = sheet.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 15, name: 'Oswald' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  COLUNAS.forEach((coluna, indice) => {
    const colunaExcel = sheet.getColumn(indice + 1);
    colunaExcel.width = coluna.width;
    colunaExcel.hidden = coluna.hidden;
    if (coluna.numFmt) colunaExcel.numFmt = coluna.numFmt;
    colunaExcel.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { size: 17, color: { argb: 'FF000000' }, name: 'Oswald' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  }
}

function adicionarPlanilhaMes(workbook: ExcelJS.Workbook, nome: string, linhas: LinhaRelatorio[]) {
  const sheet = workbook.addWorksheet(nome);
  sheet.columns = COLUNAS.map((coluna) => ({
    key: coluna.key,
    header: coluna.header,
  }));

  for (const linha of linhas) {
    sheet.addRow(linha);
  }

  aplicarLayout(sheet);
}

function chaveMes(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth()).padStart(2, '0')}`;
}

function nomeAbaMes(data: Date, incluirAno: boolean): string {
  const nome = MESES[data.getMonth()] ?? 'PERIODO';
  return incluirAno ? `${nome} ${data.getFullYear()}` : nome;
}

function mesesDoPeriodo(inicio: Date | undefined, fim: Date | undefined, notas: NotaTransporte[]): Date[] {
  if (inicio || fim) {
    const primeiro = inicio ?? notas[0]?.emitidaEm ?? new Date();
    const ultimo = fim ?? notas[notas.length - 1]?.emitidaEm ?? primeiro;
    const atual = new Date(primeiro.getFullYear(), primeiro.getMonth(), 1);
    const limite = new Date(ultimo.getFullYear(), ultimo.getMonth(), 1);
    const meses: Date[] = [];

    while (atual.getTime() <= limite.getTime()) {
      meses.push(new Date(atual));
      atual.setMonth(atual.getMonth() + 1);
    }

    return meses;
  }

  const vistos = new Set<string>();
  return notas
    .map((nota) => new Date(nota.emitidaEm.getFullYear(), nota.emitidaEm.getMonth(), 1))
    .filter((data) => {
      const chave = chaveMes(data);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });
}

export async function gerarRelatorioTransporteExcel(filtros: FiltrosRelatorioTransporte): Promise<{
  buffer: Buffer;
  filename: string;
  total: number;
}> {
  const inicio = dataParametro(filtros.inicio, false);
  const fim = dataParametro(filtros.fim, true);
  const filtrosAnd: Prisma.NotaFiscalWhereInput[] = [whereNotaPermitida(filtros.usuario)];

  if (inicio || fim) {
    filtrosAnd.push({
      emitidaEm: {
        ...(inicio ? { gte: inicio } : {}),
        ...(fim ? { lte: fim } : {}),
      },
    });
  }

  if (filtros.cnpjId) {
    filtrosAnd.push({ cnpjId: filtros.cnpjId });
  }

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

  const situacoes = (filtros.situacoes ?? []).filter((situacao) => situacao !== '__none__');
  if (situacoes.length > 0) {
    filtrosAnd.push({ situacaoSefaz: { in: situacoes } });
  }

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
    select: selectNotaTransporte,
  });

  const notasFiltradas = filtros.daeFiltros?.length
    ? notas.filter((nota) => notaPassaFiltroDae(nota, filtros.daeFiltros))
    : notas;

  const linhasPorMes = new Map<string, LinhaRelatorio[]>();
  for (const nota of notasFiltradas) {
    const mes = chaveMes(nota.emitidaEm);
    const linhasMes = linhasPorMes.get(mes) ?? [];
    linhasMes.push(montarLinha(nota));
    linhasPorMes.set(mes, linhasMes);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DanfeCollector';
  workbook.created = new Date();

  const meses = mesesDoPeriodo(inicio, fim, notasFiltradas);
  const incluirAno = new Set(meses.map((data) => data.getFullYear())).size > 1;

  if (meses.length === 0) {
    adicionarPlanilhaMes(workbook, 'PERIODO', []);
  } else {
    for (const mes of meses) {
      adicionarPlanilhaMes(workbook, nomeAbaMes(mes, incluirAno), linhasPorMes.get(chaveMes(mes)) ?? []);
    }
  }

  const dados = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(dados),
    filename: nomeArquivo(filtros.inicio, filtros.fim),
    total: notasFiltradas.length,
  };
}
