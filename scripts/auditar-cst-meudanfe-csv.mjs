import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';

const API_BASE = 'https://api.meudanfe.com.br/v2';
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function loadEnv() {
  if (!fs.existsSync('.env')) return;
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

function args() {
  const out = { files: [], outDir: 'outputs/selagem_urgente_2026-09-04/meudanfe_cst' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--api-key') out.apiKey = argv[++i];
    else if (argv[i] === '--out-dir') out.outDir = argv[++i];
    else out.files.push(argv[i]);
  }
  return out;
}

function chavesCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  return [...new Set(text.match(/\b\d{44}\b/g) ?? [])];
}

async function requestXml(chave, apiKey) {
  const resp = await fetch(`${API_BASE}/fd/get/xml/${chave}`, {
    method: 'GET',
    headers: { Accept: 'application/json', 'Api-Key': apiKey },
  });
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) throw new Error(`MeuDanfe HTTP ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  const xml = typeof data.data === 'string' ? data.data.trim() : '';
  if (!xml.includes('<NFe') && !xml.includes('<nfeProc')) throw new Error(`XML vazio/invalido: ${JSON.stringify(data).slice(0, 300)}`);
  return xml;
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function lista(value) {
  if (Array.isArray(value)) return value;
  const item = obj(value);
  return Object.keys(item).length ? [item] : [];
}

function primeiro(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function cstItem(det) {
  const imposto = obj(det.imposto);
  const icms = obj(imposto.ICMS);
  const grupos = Object.values(icms).filter((v) => v && typeof v === 'object');
  const grupo = obj(grupos[0]);
  const orig = primeiro(grupo.orig);
  const cst = primeiro(grupo.CST, grupo.CSOSN);
  return [orig, cst].filter(Boolean).join('') || primeiro(det.CST, det.cst);
}

function analisarXml(chave, xml) {
  const json = parser.parse(xml);
  const inf = obj(obj(obj(json).nfeProc).NFe).infNFe ?? obj(obj(json).NFe).infNFe;
  const ide = obj(obj(inf).ide);
  const dets = lista(obj(inf).det);
  const itens = dets.map((det, index) => {
    const prod = obj(det.prod);
    return {
      item: primeiro(det['@_nItem'], index + 1),
      codigo: primeiro(prod.cProd),
      descricao: primeiro(prod.xProd),
      cfop: primeiro(prod.CFOP),
      cst: cstItem(det),
    };
  });
  const texto = [
    primeiro(ide.natOp),
    ...itens.flatMap((item) => [item.descricao, item.cfop, item.cst]),
  ].join(' ').toLowerCase();
  const itensDevolucao = itens.filter((item) =>
    [item.descricao, item.cfop, item.cst].join(' ').toLowerCase().includes('devol'),
  );
  const csts = [...new Set(itens.map((item) => item.cst).filter(Boolean))].sort();
  const cfops = [...new Set(itens.map((item) => item.cfop).filter(Boolean))].sort();
  return {
    chave,
    numero: primeiro(ide.nNF),
    natureza: primeiro(ide.natOp),
    qtdItens: itens.length,
    csts: csts.join('; '),
    cfops: cfops.join('; '),
    possivelDevolucao: texto.includes('devol') ? 'SIM' : 'NAO',
    itensDevolucao: itensDevolucao.map((item) => `${item.item}: ${item.cfop} CST ${item.cst} ${item.descricao}`).join(' | '),
    erro: '',
  };
}

function writeCsv(file, rows) {
  const headers = ['chave', 'numero', 'natureza', 'qtdItens', 'csts', 'cfops', 'possivelDevolucao', 'itensDevolucao', 'erro'];
  const esc = (v) => {
    const text = v === null || v === undefined ? '' : String(v);
    return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  fs.writeFileSync(file, `${headers.join(',')}\n${rows.map((r) => headers.map((h) => esc(r[h])).join(',')).join('\n')}\n`, 'utf8');
}

async function writeXlsx(file, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CST MeuDanfe');
  ws.columns = [
    { header: 'Chave', key: 'chave', width: 48 },
    { header: 'Numero', key: 'numero', width: 12 },
    { header: 'Natureza', key: 'natureza', width: 38 },
    { header: 'Qtd itens', key: 'qtdItens', width: 10 },
    { header: 'CSTs', key: 'csts', width: 24 },
    { header: 'CFOPs', key: 'cfops', width: 24 },
    { header: 'Possivel devolucao', key: 'possivelDevolucao', width: 18 },
    { header: 'Itens devolucao', key: 'itensDevolucao', width: 60 },
    { header: 'Erro', key: 'erro', width: 40 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `I${rows.length + 1}` };
  await wb.xlsx.writeFile(file);
}

async function main() {
  loadEnv();
  const cfg = args();
  const apiKey = String(cfg.apiKey || process.env.MEUDANFE_API_KEY || '').trim();
  if (!apiKey) throw new Error('MEUDANFE_API_KEY nao informada.');
  if (!cfg.files.length) throw new Error('Informe ao menos um CSV.');
  fs.mkdirSync(cfg.outDir, { recursive: true });
  const chaves = [...new Set(cfg.files.flatMap(chavesCsv))];
  const rows = [];
  for (let i = 0; i < chaves.length; i += 1) {
    const chave = chaves[i];
    try {
      const xml = await requestXml(chave, apiKey);
      const row = analisarXml(chave, xml);
      rows.push(row);
      console.log(`[${i + 1}/${chaves.length}] ${chave} devolucao=${row.possivelDevolucao} csts=${row.csts}`);
    } catch (error) {
      rows.push({ chave, numero: '', natureza: '', qtdItens: 0, csts: '', cfops: '', possivelDevolucao: 'ERRO', itensDevolucao: '', erro: error.message || String(error) });
      console.log(`[${i + 1}/${chaves.length}] ${chave} erro=${error.message || error}`);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const csv = path.resolve(cfg.outDir, `cst-meudanfe-${stamp}.csv`);
  const xlsx = path.resolve(cfg.outDir, `cst-meudanfe-${stamp}.xlsx`);
  writeCsv(csv, rows);
  await writeXlsx(xlsx, rows);
  console.log(JSON.stringify({
    total: rows.length,
    devolucao: rows.filter((r) => r.possivelDevolucao === 'SIM').length,
    erros: rows.filter((r) => r.erro).length,
    csv,
    xlsx,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
