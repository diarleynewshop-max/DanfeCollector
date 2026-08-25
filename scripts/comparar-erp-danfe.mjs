import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const ROOT = process.cwd();
const CSV_FILES = [
  { empresa: 'FACIL', arquivo: 'C:/Users/diarl/Downloads/facil - nota.csv', raizes: ['50767035'] },
  { empresa: 'NEWSHOP', arquivo: 'C:/Users/diarl/Downloads/newshop - nota.csv', raizes: ['45998339'] },
  { empresa: 'SOYE', arquivo: 'C:/Users/diarl/Downloads/soye - nota.csv', raizes: ['62803717'] },
];

function carregarEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) continue;
    const idx = texto.indexOf('=');
    if (idx < 1) continue;
    const chave = texto.slice(0, idx).trim();
    let valor = texto.slice(idx + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) process.env[chave] = valor;
  }
}

function parseCsvLinha(linha) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        aspas = !aspas;
      }
      continue;
    }
    if (ch === ';' && !aspas) {
      campos.push(atual);
      atual = '';
      continue;
    }
    atual += ch;
  }
  campos.push(atual);
  return campos;
}

function normalizarTexto(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function normalizarNumero(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return String(Number(digitos || '0'));
}

function numeroDaChave(chave) {
  const digitos = String(chave ?? '').replace(/\D/g, '');
  if (digitos.length !== 44) return null;
  return normalizarNumero(digitos.slice(25, 34));
}

function parseValor(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  const normalizado = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function centavos(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.round(valor * 100) : null;
}

function parseDataBr(valor) {
  const match = String(valor ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00-03:00`);
}

function dataIso(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return '';
  return data.toISOString().slice(0, 10);
}

function moeda(valor) {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function adicionarAoMapa(mapa, chave, valor) {
  if (!chave) return;
  const lista = mapa.get(chave) ?? [];
  lista.push(valor);
  mapa.set(chave, lista);
}

function melhorNome(nota) {
  return nota.emitenteNome || nota.emitenteCnpj || '';
}

function empresaPorCnpj(cnpj) {
  const raiz = String(cnpj ?? '').replace(/\D/g, '').slice(0, 8);
  for (const cfg of CSV_FILES) {
    if (cfg.raizes.includes(raiz)) return cfg.empresa;
  }
  return null;
}

async function lerErp() {
  const registros = [];
  for (const cfg of CSV_FILES) {
    const conteudo = await fsp.readFile(cfg.arquivo, 'utf8');
    const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim());
    const header = parseCsvLinha(linhas[0]);
    const idx = Object.fromEntries(header.map((nome, i) => [nome, i]));
    for (const linha of linhas.slice(1)) {
      const cols = parseCsvLinha(linha);
      const data = parseDataBr(cols[idx['Data De Emissão']]);
      const valor = parseValor(cols[idx['Valor Total']]);
      const numero = normalizarNumero(cols[idx['Número do Documento']]);
      registros.push({
        empresa: cfg.empresa,
        fornecedor: cols[idx['Nome do Fornecedor']]?.trim() ?? '',
        fornecedorNorm: normalizarTexto(cols[idx['Nome do Fornecedor']]),
        numero,
        data,
        valor,
        valorCentavos: centavos(valor),
        situacao: cols[idx['Situação']]?.trim() ?? '',
        operacao: cols[idx['Operação']]?.trim() ?? '',
        loja: cols[idx['Código da Loja']]?.trim() ?? '',
      });
    }
  }
  return registros;
}

function criarIndices(registros, getEmpresa) {
  const porNumeroValor = new Map();
  const porNumeroFornecedor = new Map();
  const porNumero = new Map();
  for (const r of registros) {
    const empresa = getEmpresa(r);
    if (!empresa || !r.numero) continue;
    adicionarAoMapa(porNumeroValor, `${empresa}|${r.numero}|${r.valorCentavos ?? ''}`, r);
    adicionarAoMapa(porNumeroFornecedor, `${empresa}|${r.numero}|${r.fornecedorNorm}`, r);
    adicionarAoMapa(porNumero, `${empresa}|${r.numero}`, r);
  }
  return { porNumeroValor, porNumeroFornecedor, porNumero };
}

function classificarDanfe(nota, erpIdx) {
  const empresa = empresaPorCnpj(nota.cnpj.cnpj);
  const numero = normalizarNumero(nota.numero || numeroDaChave(nota.chave));
  const valorCentavos = centavos(nota.valorTotal);
  const fornecedorNorm = normalizarTexto(melhorNome(nota));
  const porValor = erpIdx.porNumeroValor.get(`${empresa}|${numero}|${valorCentavos ?? ''}`) ?? [];
  if (porValor.length > 0) return { status: 'OK', erp: porValor[0], motivo: 'Número e valor encontrados no ERP' };
  const porFornecedor = erpIdx.porNumeroFornecedor.get(`${empresa}|${numero}|${fornecedorNorm}`) ?? [];
  if (porFornecedor.length > 0) return { status: 'VALOR_DIFERENTE', erp: porFornecedor[0], motivo: 'Número e fornecedor encontrados, valor diferente' };
  const porNumero = erpIdx.porNumero.get(`${empresa}|${numero}`) ?? [];
  if (porNumero.length > 0) return { status: 'CONFERIR_NUMERO', erp: porNumero[0], motivo: 'Número existe no ERP, mas fornecedor/valor não bateram' };
  return { status: 'DANFE_SEM_ERP', erp: null, motivo: 'Nota existe no Danfe e não foi encontrada no ERP' };
}

function classificarErp(registro, danfeIdx) {
  const porValor = danfeIdx.porNumeroValor.get(`${registro.empresa}|${registro.numero}|${registro.valorCentavos ?? ''}`) ?? [];
  if (porValor.length > 0) return { status: 'OK', nota: porValor[0] };
  const porFornecedor = danfeIdx.porNumeroFornecedor.get(`${registro.empresa}|${registro.numero}|${registro.fornecedorNorm}`) ?? [];
  if (porFornecedor.length > 0) return { status: 'VALOR_DIFERENTE', nota: porFornecedor[0] };
  const porNumero = danfeIdx.porNumero.get(`${registro.empresa}|${registro.numero}`) ?? [];
  if (porNumero.length > 0) return { status: 'CONFERIR_NUMERO', nota: porNumero[0] };
  return { status: 'ERP_SEM_DANFE', nota: null };
}

function configurarPlanilha(sheet, columns) {
  sheet.columns = columns;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
}

function aplicarFormato(sheet) {
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', wrapText: rowNumber === 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });
}

async function main() {
  carregarEnv();
  const erp = await lerErp();
  const datas = erp.map((r) => r.data).filter(Boolean);
  const minData = new Date(Math.min(...datas.map((d) => d.getTime())));
  const maxData = new Date(Math.max(...datas.map((d) => d.getTime())));
  const inicio = new Date(`${dataIso(minData)}T00:00:00-03:00`);
  const fim = new Date(`${dataIso(maxData)}T23:59:59.999-03:00`);
  const raizes = CSV_FILES.flatMap((cfg) => cfg.raizes);

  const prisma = new PrismaClient();
  const cnpjs = await prisma.cnpj.findMany({
    where: { OR: raizes.map((raiz) => ({ cnpj: { startsWith: raiz } })) },
    select: { id: true, cnpj: true, razaoSocial: true, ativo: true, _count: { select: { notas: true } } },
    orderBy: { cnpj: 'asc' },
  });
  const notas = await prisma.notaFiscal.findMany({
    where: {
      emitidaEm: { gte: inicio, lte: fim },
      situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
      OR: raizes.map((raiz) => ({ cnpj: { cnpj: { startsWith: raiz } } })),
    },
    select: {
      chave: true,
      numero: true,
      emitidaEm: true,
      emitenteNome: true,
      emitenteCnpj: true,
      destCnpj: true,
      valorTotal: true,
      situacaoSefaz: true,
      status: true,
      cnpj: { select: { cnpj: true, razaoSocial: true } },
    },
    orderBy: [{ emitidaEm: 'asc' }, { numero: 'asc' }],
  });
  await prisma.$disconnect();

  const erpIdx = criarIndices(erp, (r) => r.empresa);
  const danfeBase = notas
    .map((nota) => ({
      ...nota,
      empresa: empresaPorCnpj(nota.cnpj.cnpj),
      fornecedorNorm: normalizarTexto(melhorNome(nota)),
      numeroNorm: normalizarNumero(nota.numero || numeroDaChave(nota.chave)),
      valorCentavos: centavos(nota.valorTotal),
    }))
    .filter((nota) => nota.empresa);
  const danfeIdx = criarIndices(danfeBase, (r) => r.empresa);

  const danfeClassificado = danfeBase.map((nota) => ({ nota, ...classificarDanfe(nota, erpIdx) }));
  const erpClassificado = erp.map((registro) => ({ registro, ...classificarErp(registro, danfeIdx) }));

  const danfeSemErp = danfeClassificado.filter((r) => r.status === 'DANFE_SEM_ERP');
  const valorDiferente = danfeClassificado.filter((r) => r.status === 'VALOR_DIFERENTE' || r.status === 'CONFERIR_NUMERO');
  const erpSemDanfe = erpClassificado.filter((r) => r.status === 'ERP_SEM_DANFE');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DanfeCollector';
  workbook.created = new Date();

  const resumo = workbook.addWorksheet('Resumo');
  resumo.columns = [
    { header: 'Indicador', key: 'indicador', width: 38 },
    { header: 'Valor', key: 'valor', width: 18 },
    { header: 'Observacao', key: 'obs', width: 70 },
  ];
  resumo.addRows([
    { indicador: 'Período analisado', valor: `${dataIso(minData)} a ${dataIso(maxData)}`, obs: 'Derivado dos CSVs do ERP' },
    { indicador: 'Notas ERP', valor: erp.length, obs: 'FACIL + NEWSHOP + SOYE' },
    { indicador: 'Notas Danfe', valor: danfeBase.length, obs: 'Mesmo período, CNPJs mapeados, sem CANCELADA/DENEGADA' },
    { indicador: 'Danfe sem ERP', valor: danfeSemErp.length, obs: 'Principal lista para recuperar no ERP' },
    { indicador: 'Conferir valor/fornecedor', valor: valorDiferente.length, obs: 'Número existe no ERP, mas valor ou fornecedor não bateu' },
    { indicador: 'ERP sem Danfe', valor: erpSemDanfe.length, obs: 'Pode indicar NF não importada no Danfe ou match insuficiente' },
    { indicador: 'CNPJs Danfe mapeados', valor: cnpjs.length, obs: cnpjs.map((c) => `${c.cnpj} ${c.razaoSocial ?? ''}`.trim()).join(' | ') },
  ]);
  configurarPlanilha(resumo, resumo.columns);
  aplicarFormato(resumo);

  const sheetDanfe = workbook.addWorksheet('Danfe_sem_ERP');
  configurarPlanilha(sheetDanfe, [
    { header: 'Empresa', key: 'empresa', width: 14 },
    { header: 'Fornecedor', key: 'fornecedor', width: 48 },
    { header: 'Chave de acesso', key: 'chave', width: 48 },
    { header: 'Número', key: 'numero', width: 14 },
    { header: 'Valor', key: 'valor', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Emissão', key: 'emissao', width: 14 },
    { header: 'CNPJ loja', key: 'cnpjLoja', width: 18 },
    { header: 'CNPJ fornecedor', key: 'cnpjFornecedor', width: 18 },
    { header: 'Situação SEFAZ', key: 'situacaoSefaz', width: 16 },
    { header: 'Status Danfe', key: 'statusDanfe', width: 14 },
    { header: 'Motivo', key: 'motivo', width: 48 },
  ]);
  sheetDanfe.addRows(danfeSemErp.map(({ nota, motivo }) => ({
    empresa: nota.empresa,
    fornecedor: melhorNome(nota),
    chave: nota.chave,
    numero: nota.numero || numeroDaChave(nota.chave),
    valor: moeda(nota.valorTotal),
    emissao: dataIso(nota.emitidaEm),
    cnpjLoja: nota.cnpj.cnpj,
    cnpjFornecedor: nota.emitenteCnpj,
    situacaoSefaz: nota.situacaoSefaz,
    statusDanfe: nota.status,
    motivo,
  })));
  aplicarFormato(sheetDanfe);

  const sheetValor = workbook.addWorksheet('Conferir_valor_numero');
  configurarPlanilha(sheetValor, [
    { header: 'Empresa', key: 'empresa', width: 14 },
    { header: 'Fornecedor Danfe', key: 'fornecedorDanfe', width: 42 },
    { header: 'Chave de acesso', key: 'chave', width: 48 },
    { header: 'Número', key: 'numero', width: 14 },
    { header: 'Valor Danfe', key: 'valorDanfe', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Fornecedor ERP', key: 'fornecedorErp', width: 42 },
    { header: 'Valor ERP', key: 'valorErp', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Emissão Danfe', key: 'emissaoDanfe', width: 14 },
    { header: 'Emissão ERP', key: 'emissaoErp', width: 14 },
    { header: 'Motivo', key: 'motivo', width: 54 },
  ]);
  sheetValor.addRows(valorDiferente.map(({ nota, erp: erpRegistro, motivo }) => ({
    empresa: nota.empresa,
    fornecedorDanfe: melhorNome(nota),
    chave: nota.chave,
    numero: nota.numero || numeroDaChave(nota.chave),
    valorDanfe: moeda(nota.valorTotal),
    fornecedorErp: erpRegistro?.fornecedor ?? '',
    valorErp: moeda(erpRegistro?.valor),
    emissaoDanfe: dataIso(nota.emitidaEm),
    emissaoErp: dataIso(erpRegistro?.data),
    motivo,
  })));
  aplicarFormato(sheetValor);

  const sheetErp = workbook.addWorksheet('ERP_sem_Danfe');
  configurarPlanilha(sheetErp, [
    { header: 'Empresa', key: 'empresa', width: 14 },
    { header: 'Fornecedor ERP', key: 'fornecedor', width: 48 },
    { header: 'Número', key: 'numero', width: 14 },
    { header: 'Valor ERP', key: 'valor', width: 16, style: { numFmt: '#,##0.00' } },
    { header: 'Emissão ERP', key: 'emissao', width: 14 },
    { header: 'Situação ERP', key: 'situacao', width: 16 },
    { header: 'Operação', key: 'operacao', width: 45 },
  ]);
  sheetErp.addRows(erpSemDanfe.map(({ registro }) => ({
    empresa: registro.empresa,
    fornecedor: registro.fornecedor,
    numero: registro.numero,
    valor: moeda(registro.valor),
    emissao: dataIso(registro.data),
    situacao: registro.situacao,
    operacao: registro.operacao,
  })));
  aplicarFormato(sheetErp);

  const outDir = path.join(ROOT, 'outputs');
  await fsp.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `diferencas_erp_danfe_${dataIso(minData)}_${dataIso(maxData)}.xlsx`);
  await workbook.xlsx.writeFile(outFile);

  console.log(JSON.stringify({
    periodo: { inicio: dataIso(minData), fim: dataIso(maxData) },
    cnpjs,
    erp: erp.length,
    danfe: danfeBase.length,
    danfeSemErp: danfeSemErp.length,
    conferirValorNumero: valorDiferente.length,
    erpSemDanfe: erpSemDanfe.length,
    arquivo: outFile,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
