import fs from 'fs';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolverXmlPath } from '@/lib/xmlpath';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import { whereNotaPermitida } from '@/lib/usuarios/auth';
import {
  diasAteVencimento,
  extrairResumoDae,
  lancamentosVisiveisDae,
  statusDaeEfetivo,
} from '@/lib/sitram/dae';

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

interface ColunaRelatorio {
  chave: string;
  titulo: string;
  largura: number;
  formato?: string;
  alinhamento?: 'left' | 'center' | 'right';
}

interface DadosXmlTransporte {
  volumes?: number;
}

type LinhaRelatorio = {
  fornecedor: string;
  dataPedido: Date | null;
  produto: string;
  volumes: number | string | null;
  notaFiscal: string;
  frete: number | null;
  dataRecebimento: Date | null;
  icms: number | null;
  transportadora: string;
  precoLancado: string;
  lucro: string;
  valorNf: number | null;
  valorTotalPedido: string;
  obs: string;
  icmsPendente: number | null;
  pagamentoImposto: string;
};

const COLUNAS_BASE: ColunaRelatorio[] = [
  { chave: 'fornecedor', titulo: 'FORNECEDOR', largura: 30 },
  { chave: 'dataPedido', titulo: 'DATA DE PEDIDO', largura: 16, formato: 'dd/mm/yyyy', alinhamento: 'center' },
  { chave: 'produto', titulo: 'PRODUTO', largura: 34 },
  { chave: 'volumes', titulo: 'VOLUMES', largura: 12, alinhamento: 'center' },
  { chave: 'notaFiscal', titulo: 'NOTA FISCAL/ RECIBO ', largura: 20 },
  { chave: 'frete', titulo: 'FRETE', largura: 14, formato: '#,##0.00', alinhamento: 'right' },
  { chave: 'dataRecebimento', titulo: 'DATA Recebimento', largura: 18, formato: 'dd/mm/yyyy', alinhamento: 'center' },
  { chave: 'icms', titulo: 'ICMS', largura: 14, formato: '#,##0.00', alinhamento: 'right' },
  { chave: 'transportadora', titulo: 'TRANSPORTADORA', largura: 24 },
  { chave: 'precoLancado', titulo: 'PRECO LANCADO', largura: 16, alinhamento: 'center' },
  { chave: 'lucro', titulo: 'LUCRO', largura: 12, alinhamento: 'center' },
  { chave: 'valorNf', titulo: 'VALOR NF', largura: 14, formato: '#,##0.00', alinhamento: 'right' },
  { chave: 'valorTotalPedido', titulo: 'VALOR TOTAL PEDIDO', largura: 20, alinhamento: 'right' },
];

const COLUNAS_PENDENTE: ColunaRelatorio[] = [
  ...COLUNAS_BASE,
  { chave: 'obs', titulo: 'Obs', largura: 34 },
  { chave: 'icmsPendente', titulo: 'ICMS', largura: 14, formato: '#,##0.00', alinhamento: 'right' },
  { chave: 'pagamentoImposto', titulo: 'Pagamento de Imposto', largura: 24 },
];

const DAE_A_PAGAR = ['EM_ABERTO', 'LIBERADA_PARA_GERAR'];

const MESES = [
  'JANEIRO',
  'FEVEREIRO',
  'MARCO',
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

const selectNotaTransporte = {
  id: true,
  cnpjId: true,
  chave: true,
  numero: true,
  serie: true,
  emitidaEm: true,
  naturezaOp: true,
  emitenteNome: true,
  emitenteCnpj: true,
  valorTotal: true,
  valorFrete: true,
  valorIcms: true,
  modalidadeFrete: true,
  transportadoraNome: true,
  qtdItens: true,
  status: true,
  situacaoSefaz: true,
  sitramConsultadaEm: true,
  sitramDaeStatus: true,
  sitramDaeResumo: true,
  sitramDetalhe: true,
  pagamentoManualEm: true,
  pagamentoManualValor: true,
  xmlPath: true,
  cnpj: { select: { cnpj: true, razaoSocial: true } },
} satisfies Prisma.NotaFiscalSelect;

type NotaTransporte = Prisma.NotaFiscalGetPayload<{ select: typeof selectNotaTransporte }>;

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

function lista(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) return valor.map(registro);
  const item = registro(valor);
  return Object.keys(item).length > 0 ? [item] : [];
}

function numero(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

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

function numeroNota(nota: Pick<NotaTransporte, 'numero' | 'chave'>): string {
  return nota.numero || numeroNotaDaChave(nota.chave) || '';
}

function textoDae(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    PAGO: 'Pago',
    EM_ABERTO: 'Em aberto',
    SEM_DAE: 'Sem DAE',
    LIBERADA_PARA_GERAR: 'Gerar DAE',
    NAO_ENCONTRADA: 'Nao encontrada',
    CONSULTADO: 'Consultado',
  };
  return status ? labels[status] ?? status : '';
}

function extrairDadosXml(xmlPath: string | null): DadosXmlTransporte {
  const caminho = resolverXmlPath(xmlPath);
  if (!caminho) return {};

  try {
    const xml = fs.readFileSync(caminho, 'utf8');
    const json = parser.parse(xml) as Record<string, unknown>;
    const infProc = registro(registro(registro(json).nfeProc).NFe).infNFe;
    const infDireta = registro(registro(json).NFe).infNFe;
    const inf = registro(Object.keys(registro(infProc)).length > 0 ? infProc : infDireta);
    if (Object.keys(inf).length === 0) return {};

    const volumes = lista(registro(inf.transp).vol)
      .map((vol) => numero(vol.qVol))
      .filter((valor): valor is number => valor !== null);

    return {
      volumes: volumes.length ? volumes.reduce((total, valor) => total + valor, 0) : undefined,
    };
  } catch {
    return {};
  }
}

function dataAbaMes(data: Date, comAno: boolean): string {
  const mes = MESES[data.getMonth()] ?? 'PERIODO';
  return comAno ? `${mes} ${data.getFullYear()}` : mes;
}

function sanitizarNomeAba(nome: string): string {
  return nome.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'RELATORIO';
}

function formatarDataCurta(data: Date | string | null | undefined): string {
  if (!data) return '';
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return '';
  return valor.toLocaleDateString('pt-BR');
}

function nomeArquivo(inicio?: string, fim?: string): string {
  const partes = ['relatorio-transporte'];
  if (inicio || fim) partes.push(inicio || 'inicio', 'a', fim || 'hoje');
  else partes.push('geral');
  return `${partes.join('_')}.xlsx`;
}

function montarLinha(nota: NotaTransporte): LinhaRelatorio {
  const dadosXml = extrairDadosXml(nota.xmlPath);
  const resumoDae = extrairResumoDae(nota);
  const lancamentos = lancamentosVisiveisDae(resumoDae.lancamentos);
  const lancamentoAberto = lancamentos.find((item) => !item.pago) ?? lancamentos[0] ?? null;
  const daeStatus = statusDaeEfetivo(nota);
  const impostoPendente = daeStatus === 'EM_ABERTO' || daeStatus === 'LIBERADA_PARA_GERAR'
    ? lancamentoAberto?.valorAberto ?? lancamentoAberto?.valor ?? nota.valorIcms
    : null;
  const pagamentoImposto = nota.pagamentoManualEm
    ? `Pago em ${formatarDataCurta(nota.pagamentoManualEm)}`
    : textoDae(daeStatus) || (nota.sitramConsultadaEm ? 'Consultado' : 'Sem consulta SITRAM');
  const obs = [
    nota.situacaoSefaz && nota.situacaoSefaz !== 'AUTORIZADA' ? nota.situacaoSefaz : '',
    resumoDae.situacaoImposto,
    nota.naturezaOp,
  ].filter(Boolean).join(' | ');

  return {
    fornecedor: nota.emitenteNome || nota.emitenteCnpj || '',
    dataPedido: nota.emitidaEm,
    produto: '',
    volumes: dadosXml.volumes ?? null,
    notaFiscal: numeroNota(nota) ? `NF${numeroNota(nota)}` : nota.chave,
    frete: nota.valorFrete ?? null,
    dataRecebimento: null,
    icms: nota.valorIcms ?? null,
    transportadora: nota.transportadoraNome || nota.modalidadeFrete || '',
    precoLancado: '',
    lucro: '',
    valorNf: nota.valorTotal ?? null,
    valorTotalPedido: '',
    obs,
    icmsPendente: impostoPendente ?? null,
    pagamentoImposto,
  };
}

function linhaPendente(linha: LinhaRelatorio): boolean {
  if (/^Pago/i.test(linha.pagamentoImposto) || linha.pagamentoImposto === 'Sem DAE') return false;
  return Boolean(linha.icmsPendente || linha.pagamentoImposto === 'Em aberto' || linha.pagamentoImposto === 'Gerar DAE' || linha.pagamentoImposto === 'Sem consulta SITRAM');
}

function filtroBloqueado(valores: string[] | undefined): boolean {
  return Array.isArray(valores) && valores.includes('__none__');
}

function notaPassaFiltroDae(nota: NotaTransporte, filtros: string[] | undefined): boolean {
  if (!filtros || filtros.length === 0) return true;
  if (filtros.includes('__none__')) return false;

  const resumo = extrairResumoDae(nota);
  const lancamento = lancamentosVisiveisDae(resumo.lancamentos).find((item) => !item.pago)
    ?? lancamentosVisiveisDae(resumo.lancamentos)[0]
    ?? null;
  const status = statusDaeEfetivo(nota);
  const daePendente = DAE_A_PAGAR.includes(status);
  const diasDae = diasAteVencimento(lancamento?.vencimento);

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

function aplicarLayout(sheet: ExcelJS.Worksheet, colunas: ColunaRelatorio[]) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: colunas.length },
  };

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF166534' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FF94A3B8' } },
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
      right: { style: 'thin', color: { argb: 'FF94A3B8' } },
    };
  });

  for (const coluna of colunas) {
    const colunaExcel = sheet.getColumn(coluna.chave);
    if (coluna.formato) colunaExcel.numFmt = coluna.formato;
    colunaExcel.alignment = {
      vertical: 'middle',
      horizontal: coluna.alinhamento ?? 'left',
      wrapText: coluna.chave === 'produto' || coluna.chave === 'obs',
    };
  }

  for (let i = 2; i <= sheet.rowCount; i += 1) {
    const row = sheet.getRow(i);
    row.height = 22;
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

function adicionarPlanilha(workbook: ExcelJS.Workbook, nome: string, colunas: ColunaRelatorio[], linhas: LinhaRelatorio[]) {
  const sheet = workbook.addWorksheet(sanitizarNomeAba(nome));
  sheet.columns = colunas.map((coluna) => ({
    header: coluna.titulo,
    key: coluna.chave,
    width: coluna.largura,
  }));

  for (const linha of linhas) {
    sheet.addRow(linha);
  }

  aplicarLayout(sheet, colunas);
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
        cnpj: {
          cnpj: {
            startsWith: raiz,
          },
        },
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
  const linhas = notasFiltradas.map(montarLinha);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DanfeCollector';
  workbook.created = new Date();

  const anos = new Set(notasFiltradas.map((nota) => nota.emitidaEm.getFullYear()));
  const usarAnoNaAba = anos.size > 1;
  const porMes = new Map<string, LinhaRelatorio[]>();

  for (let i = 0; i < notasFiltradas.length; i += 1) {
    const nome = dataAbaMes(notasFiltradas[i].emitidaEm, usarAnoNaAba);
    const atual = porMes.get(nome) ?? [];
    atual.push(linhas[i]);
    porMes.set(nome, atual);
  }

  if (porMes.size === 0) {
    adicionarPlanilha(workbook, 'PERIODO', COLUNAS_PENDENTE, []);
  } else {
    for (const [nome, linhasMes] of porMes.entries()) {
      adicionarPlanilha(workbook, nome, COLUNAS_BASE, linhasMes);
    }
  }

  adicionarPlanilha(workbook, 'Pendente', COLUNAS_PENDENTE, linhas.filter(linhaPendente));

  const dados = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(dados),
    filename: nomeArquivo(filtros.inicio, filtros.fim),
    total: notasFiltradas.length,
  };
}
