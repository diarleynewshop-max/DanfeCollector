import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import { whereNotaPermitida } from '@/lib/usuarios/auth';

export interface FiltrosRelatorioCteMensal {
  usuario: UsuarioLogado;
  inicio?: string;
  fim?: string;
  cnpjId?: number;
}

type LinhaCteMensal = {
  cnpj: string;
  razaoSocial: string;
  mesChave: string;
  mesLabel: string;
  qtdCte: number;
  valorPrestacao: number;
  valorCarga: number;
  qtdNfeVinculadas: number;
  valorNfeVinculadas: number;
};

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const COLUNAS = [
  { key: 'cnpj', header: 'CNPJ', width: 22 },
  { key: 'razaoSocial', header: 'Razão Social', width: 40 },
  { key: 'mesLabel', header: 'Mês/Ano', width: 16 },
  { key: 'qtdCte', header: 'Qtd CT-e', width: 12 },
  { key: 'valorPrestacao', header: 'Valor Prestação CT-e', width: 20, numFmt: '#,##0.00' },
  { key: 'valorCarga', header: 'Valor Carga CT-e', width: 20, numFmt: '#,##0.00' },
  { key: 'qtdNfeVinculadas', header: 'Qtd NF-e vinculadas', width: 18 },
  { key: 'valorNfeVinculadas', header: 'Valor NF-e vinculadas', width: 20, numFmt: '#,##0.00' },
] satisfies Array<{ key: keyof LinhaCteMensal | 'rotulo'; header: string; width: number; numFmt?: string }>;

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor ?? '';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function dataParametro(valor: string | undefined, fimDoDia: boolean): Date | undefined {
  if (!valor) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new Error('Periodo invalido.');
  }
  return new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}-03:00`);
}

function mesChaveDe(data: Date): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
}

function mesLabelDe(mesChave: string): string {
  const [ano, mes] = mesChave.split('-');
  return `${MESES[Number(mes) - 1] ?? mes}/${ano}`;
}

function nomeArquivo(inicio?: string, fim?: string): string {
  const partes = ['cte-mensal-cnpj'];
  if (inicio || fim) partes.push(inicio || 'inicio', 'a', fim || 'hoje');
  else partes.push('geral');
  return `${partes.join('_')}.xlsx`;
}

function colunaExcel(indice: number): string {
  let n = indice;
  let nome = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    nome = String.fromCharCode(65 + resto) + nome;
    n = Math.floor((n - 1) / 26);
  }
  return nome;
}

function linhaValores(linha: LinhaCteMensal): (string | number)[] {
  return [
    linha.cnpj,
    linha.razaoSocial,
    linha.mesLabel,
    linha.qtdCte,
    linha.valorPrestacao,
    linha.valorCarga,
    linha.qtdNfeVinculadas,
    linha.valorNfeVinculadas,
  ];
}

export async function gerarRelatorioCteMensalExcel(filtros: FiltrosRelatorioCteMensal): Promise<{
  buffer: Buffer;
  filename: string;
  total: number;
}> {
  const inicio = dataParametro(filtros.inicio, false);
  const fim = dataParametro(filtros.fim, true);

  const filtrosAnd: Prisma.ConhecimentoTransporteWhereInput[] = [whereNotaPermitida(filtros.usuario)];

  if (filtros.cnpjId) {
    filtrosAnd.push({ cnpjId: filtros.cnpjId });
  }

  if (inicio || fim) {
    filtrosAnd.push({
      emitidaEm: {
        ...(inicio ? { gte: inicio } : {}),
        ...(fim ? { lte: fim } : {}),
      },
    });
  }

  const ctes = await prisma.conhecimentoTransporte.findMany({
    where: { AND: filtrosAnd },
    orderBy: { emitidaEm: 'asc' },
    select: {
      cnpjId: true,
      emitidaEm: true,
      valorTotal: true,
      valorPrestacao: true,
      valorCarga: true,
      cnpj: { select: { cnpj: true, razaoSocial: true } },
      notasVinculadas: { select: { chaveNfe: true } },
    },
  });

  const chavesNfe = [...new Set(ctes.flatMap((cte) => cte.notasVinculadas.map((v) => v.chaveNfe)))];
  const notas = chavesNfe.length > 0
    ? await prisma.notaFiscal.findMany({
        where: { chave: { in: chavesNfe } },
        select: { chave: true, valorTotal: true },
      })
    : [];
  const valorPorChaveNfe = new Map(notas.map((nota) => [nota.chave, nota.valorTotal ?? 0]));

  type Grupo = {
    cnpj: string;
    razaoSocial: string;
    mesChave: string;
    qtdCte: number;
    valorPrestacao: number;
    valorCarga: number;
    chavesNfe: Set<string>;
  };
  const grupos = new Map<string, Grupo>();

  for (const cte of ctes) {
    const mesChave = mesChaveDe(cte.emitidaEm);
    const chaveGrupo = `${cte.cnpjId}|${mesChave}`;
    const grupo = grupos.get(chaveGrupo) ?? {
      cnpj: cte.cnpj.cnpj,
      razaoSocial: cte.cnpj.razaoSocial || cte.cnpj.cnpj,
      mesChave,
      qtdCte: 0,
      valorPrestacao: 0,
      valorCarga: 0,
      chavesNfe: new Set<string>(),
    };
    grupo.qtdCte += 1;
    grupo.valorPrestacao += cte.valorPrestacao ?? cte.valorTotal ?? 0;
    grupo.valorCarga += cte.valorCarga ?? 0;
    for (const vinculo of cte.notasVinculadas) grupo.chavesNfe.add(vinculo.chaveNfe);
    grupos.set(chaveGrupo, grupo);
  }

  const linhas: LinhaCteMensal[] = [...grupos.values()]
    .map((grupo) => ({
      cnpj: formatarCnpj(grupo.cnpj),
      razaoSocial: grupo.razaoSocial,
      mesChave: grupo.mesChave,
      mesLabel: mesLabelDe(grupo.mesChave),
      qtdCte: grupo.qtdCte,
      valorPrestacao: grupo.valorPrestacao,
      valorCarga: grupo.valorCarga,
      qtdNfeVinculadas: grupo.chavesNfe.size,
      valorNfeVinculadas: [...grupo.chavesNfe].reduce((soma, chave) => soma + (valorPorChaveNfe.get(chave) ?? 0), 0),
    }))
    .sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial) || a.mesChave.localeCompare(b.mesChave));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DanfeCollector';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('CT-e por CNPJ e mes');
  sheet.columns = COLUNAS.map((coluna) => ({ key: coluna.key, header: coluna.header, width: coluna.width }));

  let cnpjAtual: string | null = null;
  let subtotal = { qtdCte: 0, valorPrestacao: 0, valorCarga: 0, qtdNfeVinculadas: 0, valorNfeVinculadas: 0 };
  const totalGeral = { qtdCte: 0, valorPrestacao: 0, valorCarga: 0, qtdNfeVinculadas: 0, valorNfeVinculadas: 0 };

  function adicionarSubtotal(razaoSocial: string) {
    sheet.addRow([
      '', `Total ${razaoSocial}`, '',
      subtotal.qtdCte, subtotal.valorPrestacao, subtotal.valorCarga,
      subtotal.qtdNfeVinculadas, subtotal.valorNfeVinculadas,
    ]).font = { bold: true };
  }

  for (const linha of linhas) {
    if (cnpjAtual !== null && cnpjAtual !== linha.razaoSocial) {
      adicionarSubtotal(cnpjAtual);
      subtotal = { qtdCte: 0, valorPrestacao: 0, valorCarga: 0, qtdNfeVinculadas: 0, valorNfeVinculadas: 0 };
    }
    cnpjAtual = linha.razaoSocial;
    sheet.addRow(linhaValores(linha));
    subtotal.qtdCte += linha.qtdCte;
    subtotal.valorPrestacao += linha.valorPrestacao;
    subtotal.valorCarga += linha.valorCarga;
    subtotal.qtdNfeVinculadas += linha.qtdNfeVinculadas;
    subtotal.valorNfeVinculadas += linha.valorNfeVinculadas;
    totalGeral.qtdCte += linha.qtdCte;
    totalGeral.valorPrestacao += linha.valorPrestacao;
    totalGeral.valorCarga += linha.valorCarga;
    totalGeral.qtdNfeVinculadas += linha.qtdNfeVinculadas;
    totalGeral.valorNfeVinculadas += linha.valorNfeVinculadas;
  }
  if (cnpjAtual !== null) adicionarSubtotal(cnpjAtual);

  if (linhas.length > 0) {
    sheet.addRow([]);
    sheet.addRow([
      '', 'TOTAL GERAL', '',
      totalGeral.qtdCte, totalGeral.valorPrestacao, totalGeral.valorCarga,
      totalGeral.qtdNfeVinculadas, totalGeral.valorNfeVinculadas,
    ]).font = { bold: true, size: 12 };
  }

  sheet.autoFilter = `$A$1:$${colunaExcel(COLUNAS.length)}$1`;
  const header = sheet.getRow(1);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  COLUNAS.forEach((coluna, indice) => {
    if (coluna.numFmt) sheet.getColumn(indice + 1).numFmt = coluna.numFmt;
  });

  const dados = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(dados),
    filename: nomeArquivo(filtros.inicio, filtros.fim),
    total: linhas.length,
  };
}
