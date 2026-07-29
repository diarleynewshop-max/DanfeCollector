import fs from 'fs';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { PrismaClient } from '@prisma/client';

const API_BASE = 'https://api.meudanfe.com.br/v2';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function uso() {
  console.log(`Uso:
node scripts/importar-meudanfe-resumo-csv.mjs <arquivo.csv> --cnpj <CNPJ> [opcoes]

Opcoes:
  --cnpj <CNPJ>        CNPJ/empresa que recebera os resumos
  --api-key <chave>    Api-Key MeuDanfe (prefira MEUDANFE_API_KEY no .env)
  --out-dir <pasta>    Pasta dos CSVs de retorno (padrao: pasta do CSV)
  --limite <n>         Processa no maximo n chaves
  --sleep-ms <n>       Pausa entre chaves (padrao: 1200)
  --poll-ms <n>        Pausa entre status da mesma chave (minimo: 1000; padrao: 2500)
  --tentativas <n>     Tentativas de status por chave (padrao: 8)
  --dry-run            Consulta MeuDanfe e gera CSVs, mas nao grava no banco

Requer: MEUDANFE_API_KEY no ambiente/.env ou --api-key.
`);
}

function parseArgs(argv) {
  const args = {
    sleepMs: 1200,
    pollMs: 2500,
    tentativas: 8,
    limite: 0,
    dryRun: false,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cnpj') args.cnpj = argv[++i];
    else if (arg === '--api-key') args.apiKey = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--limite') args.limite = Number(argv[++i]);
    else if (arg === '--sleep-ms') args.sleepMs = Number(argv[++i]);
    else if (arg === '--poll-ms') args.pollMs = Number(argv[++i]);
    else if (arg === '--tentativas') args.tentativas = Number(argv[++i]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
    else rest.push(arg);
  }

  args.csv = rest[0];
  return args;
}

function loadEnv(envPath = '.env') {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function validarChaveNfe(chave) {
  if (!/^\d{44}$/.test(chave)) return false;
  if (chave.slice(20, 22) !== '55') return false;

  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let pesoIdx = 0;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * pesos[pesoIdx];
    pesoIdx = (pesoIdx + 1) % pesos.length;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(file, headers, rows) {
  const body = [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ].join('\n');
  fs.writeFileSync(file, `${body}\n`, 'utf8');
}

function lerChavesCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const encontradas = [...new Set(text.match(/\b\d{44}\b/g) ?? [])];
  return encontradas.filter(validarChaveNfe);
}

function numeroDaChave(chave) {
  const numero = chave.slice(25, 34);
  return numero.replace(/^0+/, '') || numero;
}

function serieDaChave(chave) {
  const serie = chave.slice(22, 25);
  return serie.replace(/^0+/, '') || serie;
}

function dataDaChave(chave) {
  const ano = `20${chave.slice(2, 4)}`;
  const mes = chave.slice(4, 6);
  return new Date(`${ano}-${mes}-01T12:00:00-03:00`);
}

function n(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(String(value).replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

function s(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim() || null;
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function lista(value) {
  if (Array.isArray(value)) return value;
  const item = obj(value);
  return Object.keys(item).length > 0 ? [item] : [];
}

function tipoOperacao(tpNF) {
  if (tpNF === undefined || tpNF === null || tpNF === '') return null;
  return String(tpNF) === '0' ? 'Entrada' : 'Saida';
}

const MOD_FRETE = {
  '0': '0 - Por conta do emitente',
  '1': '1 - Por conta do destinatario',
  '2': '2 - Por conta de terceiros',
  '3': '3 - Transporte proprio (remetente)',
  '4': '4 - Transporte proprio (destinatario)',
  '9': '9 - Sem frete',
};

function modalidadeFrete(value) {
  const codigo = s(value);
  if (!codigo) return null;
  return MOD_FRETE[codigo] ?? codigo;
}

function jsonResumo(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value.slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

async function requestMeuDanfe(pathname, apiKey, init = {}) {
  const resp = await fetch(`${API_BASE}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Api-Key': apiKey,
      ...(init.headers || {}),
    },
  });

  const text = await resp.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!resp.ok) {
    const error = new Error(`MeuDanfe HTTP ${resp.status}: ${jsonResumo(data || text) || resp.statusText}`);
    error.status = resp.status;
    error.data = data;
    error.fatal = [401, 402, 403].includes(resp.status);
    throw error;
  }

  return data || {};
}

async function solicitarBusca(chave, apiKey) {
  return requestMeuDanfe(`/fd/add/${chave}`, apiKey, { method: 'PUT' });
}

async function aguardarBusca(chave, apiKey, tentativas, pollMs) {
  let ultimo = null;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    ultimo = await solicitarBusca(chave, apiKey);
    const status = String(ultimo.status || '').toUpperCase();
    if (['OK', 'NOT_FOUND', 'ERROR'].includes(status)) {
      return { ...ultimo, tentativa };
    }
    await sleep(pollMs);
  }
  return {
    ...(ultimo || {}),
    status: 'TIMEOUT',
    statusMessage: `Sem OK apos ${tentativas} tentativa(s)`,
  };
}

async function baixarXml(chave, apiKey) {
  const resp = await requestMeuDanfe(`/fd/get/xml/${chave}`, apiKey, { method: 'GET' });
  const xml = typeof resp.data === 'string' ? resp.data.trim() : '';
  if (!xml.includes('<NFe') && !xml.includes('<nfeProc')) {
    throw new Error(`MeuDanfe retornou XML vazio/invalido: ${jsonResumo(resp)}`);
  }
  return { xml, meta: resp };
}

function extrairResumoXml(xml, chave, empresa, statusBusca) {
  const json = parser.parse(xml);
  const inf =
    obj(obj(obj(json).nfeProc).NFe).infNFe ??
    obj(obj(json).NFe).infNFe;
  const infObj = obj(inf);
  if (Object.keys(infObj).length === 0) throw new Error('XML MeuDanfe nao contem infNFe.');

  const ide = obj(infObj.ide);
  const emit = obj(infObj.emit);
  const dest = obj(infObj.dest);
  const enderEmit = obj(emit.enderEmit);
  const total = obj(obj(infObj.total).ICMSTot);
  const transp = obj(infObj.transp);
  const transporta = obj(transp.transporta);
  const dets = lista(infObj.det);
  const prot = obj(obj(json).nfeProc).protNFe ? obj(obj(json).nfeProc).protNFe : {};
  const infProt = obj(obj(prot).infProt);
  const cStat = Number(infProt.cStat ?? 100);

  const chaveXml = s(infProt.chNFe) || s(infObj['@_Id'])?.replace(/^NFe/, '') || chave;
  const emitidaEm = new Date(s(ide.dhEmi) || s(ide.dEmi) || dataDaChave(chave));
  const dataOk = Number.isNaN(emitidaEm.getTime()) ? dataDaChave(chave) : emitidaEm;

  return {
    chave: chaveXml,
    nsu: null,
    numero: s(ide.nNF) || numeroDaChave(chave),
    serie: s(ide.serie) || serieDaChave(chave),
    emitidaEm: dataOk,
    tipoOperacao: tipoOperacao(ide.tpNF),
    naturezaOp: s(ide.natOp),
    emitenteNome: s(emit.xNome),
    emitenteCnpj: s(emit.CNPJ ?? emit.CPF) || chave.slice(6, 20),
    emitenteIe: s(emit.IE),
    emitenteUf: s(enderEmit.UF),
    destNome: s(dest.xNome) || empresa.razaoSocial,
    destCnpj: s(dest.CNPJ ?? dest.CPF) || empresa.cnpj,
    valorTotal: n(total.vNF),
    valorProdutos: n(total.vProd),
    valorFrete: n(total.vFrete),
    valorDesconto: n(total.vDesc),
    valorIcms: n(total.vICMS),
    modalidadeFrete: modalidadeFrete(transp.modFrete),
    transportadoraNome: s(transporta.xNome),
    transportadoraCnpj: s(transporta.CNPJ ?? transporta.CPF),
    transportadoraIe: s(transporta.IE),
    transportadoraUf: s(transporta.UF),
    transportadoraMunicipio: s(transporta.xMun),
    qtdItens: dets.length || null,
    etiqueta: 'MeuDanfe',
    status: 'RESUMO',
    situacaoSefaz: cStat === 110 ? 'DENEGADA' : 'AUTORIZADA',
    xmlPath: null,
    pdfPath: null,
    cnpjId: empresa.id,
    origemResumo: {
      origem: 'meudanfe-api-v2',
      importadoEm: new Date().toISOString(),
      statusBusca,
      xmlUsadoSomenteParaResumo: true,
    },
  };
}

function addEtiqueta(atual, nova) {
  const tags = String(atual || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!tags.includes(nova)) tags.push(nova);
  return tags.length ? tags.join(',') : null;
}

function dadosCreate(dados) {
  const { origemResumo, ...base } = dados;
  return {
    ...base,
    sitramDetalhe: JSON.stringify(origemResumo),
  };
}

function dadosUpdate(existente, dados) {
  const update = {
    numero: dados.numero,
    serie: dados.serie,
    emitidaEm: dados.emitidaEm,
    tipoOperacao: dados.tipoOperacao,
    naturezaOp: dados.naturezaOp,
    emitenteNome: dados.emitenteNome,
    emitenteCnpj: dados.emitenteCnpj,
    emitenteIe: dados.emitenteIe,
    emitenteUf: dados.emitenteUf,
    destNome: dados.destNome,
    destCnpj: dados.destCnpj,
    valorTotal: dados.valorTotal,
    valorProdutos: dados.valorProdutos,
    valorFrete: dados.valorFrete,
    valorDesconto: dados.valorDesconto,
    valorIcms: dados.valorIcms,
    modalidadeFrete: dados.modalidadeFrete,
    transportadoraNome: dados.transportadoraNome,
    transportadoraCnpj: dados.transportadoraCnpj,
    transportadoraIe: dados.transportadoraIe,
    transportadoraUf: dados.transportadoraUf,
    transportadoraMunicipio: dados.transportadoraMunicipio,
    qtdItens: dados.qtdItens,
    etiqueta: addEtiqueta(existente.etiqueta, 'MeuDanfe'),
    status: 'RESUMO',
    situacaoSefaz: dados.situacaoSefaz,
  };

  if (!existente.sitramDetalhe) {
    update.sitramDetalhe = JSON.stringify(dados.origemResumo);
  }

  for (const [campo, valor] of Object.entries(update)) {
    if (valor === null || valor === undefined || valor === '') delete update[campo];
  }

  return update;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.csv || !args.cnpj) {
    uso();
    process.exit(args.help ? 0 : 1);
  }

  loadEnv();

  const csvPath = path.resolve(args.csv);
  if (!fs.existsSync(csvPath)) throw new Error(`CSV nao encontrado: ${csvPath}`);

  const apiKey = String(args.apiKey || process.env.MEUDANFE_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('MEUDANFE_API_KEY nao configurada. Crie a Api-Key no MeuDanfe e coloque no .env da VPS.');
  }

  const cnpj = digits(args.cnpj);
  if (cnpj.length !== 14) throw new Error(`CNPJ invalido: ${args.cnpj}`);

  const outDir = path.resolve(args.outDir || path.dirname(csvPath));
  fs.mkdirSync(outDir, { recursive: true });

  args.pollMs = Math.max(1000, Number(args.pollMs) || 2500);
  args.sleepMs = Math.max(1000, Number(args.sleepMs) || 1200);
  args.tentativas = Math.max(1, Number(args.tentativas) || 8);

  const todas = lerChavesCsv(csvPath);
  const chaves = args.limite > 0 ? todas.slice(0, args.limite) : todas;
  const prisma = new PrismaClient();

  const importadas = [];
  const semRetorno = [];
  const erros = [];

  try {
    const empresa = await prisma.cnpj.findUnique({ where: { cnpj } });
    if (!empresa) throw new Error(`CNPJ ${cnpj} nao esta cadastrado no sistema.`);

    console.log(`[inicio] chaves_csv=${todas.length} processar=${chaves.length} empresa=${empresa.cnpj} dryRun=${args.dryRun}`);
    console.log(`[meudanfe] modo=api-v2 sleepMs=${args.sleepMs} pollMs=${args.pollMs} tentativas=${args.tentativas}`);

    for (let i = 0; i < chaves.length; i++) {
      const chave = chaves[i];
      const prefixo = `[${i + 1}/${chaves.length}] ${chave}`;

      try {
        const existente = await prisma.notaFiscal.findUnique({
          where: { chave },
          select: { id: true, cnpjId: true, status: true, etiqueta: true, sitramDetalhe: true },
        });

        if (existente?.status === 'COMPLETA') {
          importadas.push({
            chave,
            numero_nf: numeroDaChave(chave),
            acao: 'ja-completa',
            status_meudanfe: '',
            emitente: '',
            emitente_cnpj: '',
            destinatario: '',
            destinatario_cnpj: '',
            valor_total: '',
            itens: '',
          });
          console.log(`${prefixo} ja-tinha COMPLETA`);
          await sleep(args.sleepMs);
          continue;
        }

        if (existente && existente.cnpjId !== empresa.id) {
          erros.push({
            chave,
            numero_nf: numeroDaChave(chave),
            erro: `ja existe no banco vinculada ao cnpjId=${existente.cnpjId}; nao movi para cnpjId=${empresa.id}`,
          });
          console.log(`${prefixo} erro cnpjId-diferente existente=${existente.cnpjId} alvo=${empresa.id}`);
          await sleep(args.sleepMs);
          continue;
        }

        const statusBusca = await aguardarBusca(chave, apiKey, args.tentativas, args.pollMs);
        const status = String(statusBusca.status || '').toUpperCase();

        if (status !== 'OK') {
          semRetorno.push({
            chave,
            numero_nf: numeroDaChave(chave),
            status_meudanfe: status || 'SEM_STATUS',
            motivo: statusBusca.statusMessage || 'sem retorno util',
          });
          console.log(`${prefixo} sem-retorno meudanfe=${status || 'SEM_STATUS'}`);
          await sleep(args.sleepMs);
          continue;
        }

        const { xml } = await baixarXml(chave, apiKey);
        const dados = extrairResumoXml(xml, chave, empresa, statusBusca);
        let acao = 'dry-run';

        if (!args.dryRun) {
          if (existente) {
            await prisma.notaFiscal.update({ where: { chave }, data: dadosUpdate(existente, dados) });
            acao = 'atualizada';
          } else {
            await prisma.notaFiscal.create({ data: dadosCreate(dados) });
            acao = 'criada';
          }
        } else {
          acao = existente ? 'atualizaria' : 'criaria';
        }

        importadas.push({
          chave,
          numero_nf: dados.numero,
          acao,
          status_meudanfe: status,
          emitente: dados.emitenteNome,
          emitente_cnpj: dados.emitenteCnpj,
          destinatario: dados.destNome,
          destinatario_cnpj: dados.destCnpj,
          valor_total: dados.valorTotal,
          itens: dados.qtdItens,
        });
        console.log(`${prefixo} ${acao} RESUMO valor=${dados.valorTotal ?? ''} itens=${dados.qtdItens ?? ''}`);
      } catch (error) {
        const message = error.message || String(error);
        erros.push({ chave, numero_nf: numeroDaChave(chave), erro: message });
        console.log(`${prefixo} erro: ${message}`);
        if (error.fatal) {
          console.log('[fatal] erro de credencial/saldo MeuDanfe; interrompendo para nao repetir falha.');
          break;
        }
      }

      await sleep(args.sleepMs);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const importadasFile = path.join(outDir, `soye-meudanfe-importadas-${stamp}.csv`);
    const semRetornoFile = path.join(outDir, `soye-meudanfe-sem-retorno-${stamp}.csv`);
    const errosFile = path.join(outDir, `soye-meudanfe-erros-${stamp}.csv`);

    writeCsv(importadasFile, [
      'chave', 'numero_nf', 'acao', 'status_meudanfe', 'emitente', 'emitente_cnpj',
      'destinatario', 'destinatario_cnpj', 'valor_total', 'itens',
    ], importadas);
    writeCsv(semRetornoFile, ['chave', 'numero_nf', 'status_meudanfe', 'motivo'], semRetorno);
    writeCsv(errosFile, ['chave', 'numero_nf', 'erro'], erros);

    console.log(`[fim] importadas=${importadas.length} sem_retorno=${semRetorno.length} erros=${erros.length}`);
    console.log(`[arquivo] importadas=${importadasFile}`);
    console.log(`[arquivo] sem_retorno=${semRetornoFile}`);
    console.log(`[arquivo] erros=${errosFile}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
