import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

function uso() {
  console.log(`Uso:
node scripts/importar-sitram-csv.mjs <arquivo.csv> --cnpj <CNPJ> [opcoes]

Opcoes:
  --cnpj <CNPJ>        CNPJ/empresa que recebera as notas espelho
  --out-dir <pasta>    Pasta dos CSVs de retorno (padrao: pasta do CSV)
  --limite <n>         Processa no maximo n chaves
  --sleep-ms <n>       Pausa entre chaves (padrao: 300)
  --dry-run            Consulta SITRAM e gera CSVs, mas nao grava no banco
`);
}

function parseArgs(argv) {
  const args = { sleepMs: 300, limite: 0, dryRun: false };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cnpj') args.cnpj = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--limite') args.limite = Number(argv[++i]);
    else if (arg === '--sleep-ms') args.sleepMs = Number(argv[++i]);
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

function cnpjValido(value) {
  const cleaned = digits(value);
  return cleaned.length === 14 ? cleaned : null;
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
  return [...new Set(text.match(/\b\d{44}\b/g) ?? [])].filter((chave) => chave.slice(20, 22) === '55');
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

function numero(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const normalizado = valor.includes(',')
    ? valor.replace(/\./g, '').replace(',', '.')
    : valor;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function primeiroTexto(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function dataValida(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function dataSitram(dataIso) {
  if (!dataIso) return null;
  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) return dataIso;
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function inferirSelada(nota) {
  if (typeof nota.selada === 'boolean') return nota.selada;
  const texto = `${nota.situacaoTransitoLivre ?? ''} ${nota.situacaoDescricao ?? ''}`.toLowerCase();
  if (/liberad|selad|desembarac|desembara|transito livre|transito livre/.test(texto)) return true;
  if (/pendente|bloquead|retid|nao liberad/.test(texto)) return false;
  return null;
}

function lancamentoPago(lancamento) {
  const text = `${lancamento.siuacaoDescricao ?? ''} ${lancamento.situacaoDescricao ?? ''} ${lancamento.situacao ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /pago|paga|quitad|baixad|recolhid|parcelad/.test(text);
}

function statusDae(nota, lancamentos) {
  if (lancamentos.length > 0) {
    return lancamentos.every(lancamentoPago) ? 'PAGO' : 'EM_ABERTO';
  }

  const situacao = String(nota.situacaoDoImposto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/a pagar|aberto|pendente|retid|autuad/.test(situacao)) return 'EM_ABERTO';
  if (/sem cobran/.test(situacao)) return 'SEM_DAE';
  if (/pago|paga|parcelad|quitad|baixad|recolhid/.test(situacao)) return 'PAGO';
  return situacao ? 'CONSULTADO' : 'SEM_DAE';
}

function resumoTransito(nota) {
  const dados = [];
  const gerado = dataSitram(nota.dataInclusao);
  const passagem = dataSitram(nota.dataFatoGerador);
  const posto = nota.descricaoOrgaoLocal || nota.orgaoLocalEventoDescricao || nota.orgaoLocalEventoSigla || null;

  if (gerado) dados.push(`Gerado/incluido SITRAM: ${gerado}`);
  if (passagem) dados.push(`Passou/fato gerador: ${passagem}`);
  if (posto) dados.push(`Posto fiscal: ${posto}`);
  if (nota.acaoFiscalSituacaoDescricao) dados.push(`Acao fiscal: ${nota.acaoFiscalSituacaoDescricao}`);
  return dados;
}

function resumoDae(nota, lancamentos) {
  const transito = resumoTransito(nota);
  if (lancamentos.length === 0) {
    return [nota.situacaoDoImposto || null, ...transito].filter(Boolean).join(' | ') || null;
  }

  const resumoLancamentos = lancamentos.map((l) => {
    const receita = [l.codigo, l.descricaoAbreviada, l.descricao].filter(Boolean).join(' - ');
    const situacao = l.siuacaoDescricao || l.situacaoDescricao || l.situacao || 'sem situacao';
    const valor = typeof l.valor === 'number' ? `R$ ${l.valor.toFixed(2)}` : '';
    const valorPago = typeof l.valorPago === 'number' ? `pago R$ ${l.valorPago.toFixed(2)}` : '';
    const vencimento = dataSitram(l.vencimento);
    return [receita || 'Lancamento', situacao, valor, valorPago, vencimento ? `venc. ${vencimento}` : '']
      .filter(Boolean)
      .join(': ');
  }).join(' | ');

  return [resumoLancamentos, ...transito].filter(Boolean).join(' | ');
}

function somaItens(itens, campo) {
  let total = 0;
  let encontrou = false;
  for (const item of itens) {
    const valor = numero(item[campo]);
    if (valor === null) continue;
    total += valor;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function timestampNota(nota) {
  const date = nota.dataInclusao || nota.dataFatoGerador || nota.dataEmissao;
  const time = date ? Date.parse(date) : NaN;
  if (!Number.isNaN(time)) return time;
  return Number(nota.id ?? 0);
}

async function portalGet(pathname, query = {}) {
  const base = process.env.SITRAM_PORTAL_API_URL || 'https://portal-sitram.sefaz.ce.gov.br';
  const url = new URL(`${base.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'DanfeCollector/1.0',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const error = new Error(resp.status === 404
      ? 'NF-e nao encontrada no SITRAM.'
      : `Portal SITRAM HTTP ${resp.status}: ${body.slice(0, 300) || resp.statusText}`);
    error.status = resp.status;
    throw error;
  }

  return resp.json();
}

async function consultarSitram(chave) {
  const pagina = await portalGet(`/api-nota/notafiscal/por-chave-de-acesso/${chave}`, { page: 0, size: 25 });
  const notas = Array.isArray(pagina.content) ? pagina.content : [];
  if (notas.length === 0) return null;

  const nota = [...notas].sort((a, b) => timestampNota(b) - timestampNota(a))[0];
  const id = nota.id;
  let lancamentos = [];
  let itens = [];

  if (id !== undefined && id !== null) {
    const [l, i] = await Promise.all([
      portalGet(`/api-nota/notafiscal/lancamentos-nota-fiscal/${id}`).catch(() => []),
      consultarTodosItens(id).catch(() => []),
    ]);
    lancamentos = Array.isArray(l) ? l : [];
    itens = Array.isArray(i) ? i : [];
  }

  return { nota, lancamentos, itens, registrosSitram: notas.length };
}

async function consultarTodosItens(idNotaFiscal, size = 100) {
  const itens = [];
  let page = 0;
  let totalPages = 1;

  do {
    const pagina = await portalGet(`/api-nota/notafiscal/itens-nota-fiscal/${idNotaFiscal}`, { page, size });
    itens.push(...(Array.isArray(pagina.content) ? pagina.content : []));
    totalPages = Math.max(1, Math.min(Number(pagina.totalPages ?? 1), 20));
    page += 1;
  } while (page < totalPages);

  return itens;
}

function montarDados(chave, empresa, sitram) {
  const { nota, lancamentos, itens, registrosSitram } = sitram;
  const valorProdutos = somaItens(itens, 'valorTotal');
  const valorIcms = somaItens(itens, 'icms') ?? somaItens(itens, 'valorIcmsDestacado');
  const emitidaEm = dataValida(nota.dataEmissao, nota.dataFatoGerador, nota.dataInclusao) ?? dataDaChave(chave);

  return {
    chave,
    nsu: null,
    numero: primeiroTexto(nota.numero) ?? numeroDaChave(chave),
    serie: serieDaChave(chave),
    emitidaEm,
    tipoOperacao: 'Entrada',
    naturezaOp: 'Espelho SITRAM',
    emitenteNome: primeiroTexto(nota.nomeEmitente),
    emitenteCnpj: cnpjValido(nota.codigoEmitente),
    emitenteIe: null,
    emitenteUf: primeiroTexto(nota.ufEmitente),
    destNome: primeiroTexto(nota.nomeDestinatario) ?? empresa.razaoSocial,
    destCnpj: cnpjValido(nota.codigoDestinatario) || empresa.cnpj,
    valorTotal: valorProdutos,
    valorProdutos,
    valorFrete: null,
    valorDesconto: null,
    valorIcms,
    modalidadeFrete: null,
    transportadoraNome: primeiroTexto(nota.nomeTransportadora),
    transportadoraCnpj: null,
    transportadoraIe: null,
    transportadoraUf: null,
    transportadoraMunicipio: null,
    qtdItens: itens.length || null,
    status: 'RESUMO',
    situacaoSefaz: 'AUTORIZADA',
    sitramConsultadaEm: new Date(),
    sitramChaveManifesto: null,
    sitramAcaoFiscal: nota.id != null ? String(nota.id) : null,
    sitramSelada: inferirSelada(nota),
    sitramSituacao: nota.situacaoDescricao || nota.situacaoTransitoLivre || null,
    sitramDaeStatus: statusDae(nota, lancamentos),
    sitramDaeResumo: resumoDae(nota, lancamentos),
    sitramDaeUrl: null,
    sitramDetalhe: JSON.stringify({
      origem: 'portal-nfe',
      notaFiscal: nota,
      lancamentos,
      itens,
      registrosSitram,
      espelhoOperacional: true,
    }),
    xmlPath: null,
    pdfPath: null,
    cnpjId: empresa.id,
  };
}

function mergeUpdate(existente, dados) {
  const update = {
    sitramConsultadaEm: dados.sitramConsultadaEm,
    sitramChaveManifesto: dados.sitramChaveManifesto,
    sitramAcaoFiscal: dados.sitramAcaoFiscal,
    sitramSelada: dados.sitramSelada,
    sitramSituacao: dados.sitramSituacao,
    sitramDaeStatus: dados.sitramDaeStatus,
    sitramDaeResumo: dados.sitramDaeResumo,
    sitramDaeUrl: dados.sitramDaeUrl,
    sitramDetalhe: dados.sitramDetalhe,
  };

  for (const campo of [
    'numero', 'serie', 'emitidaEm', 'tipoOperacao', 'naturezaOp',
    'emitenteNome', 'emitenteCnpj', 'emitenteIe', 'emitenteUf',
    'destNome', 'valorTotal', 'valorProdutos', 'valorIcms',
    'transportadoraNome', 'qtdItens',
  ]) {
    if (existente[campo] === null || existente[campo] === undefined || existente[campo] === '') {
      update[campo] = dados[campo];
    }
  }

  if (!cnpjValido(existente.destCnpj)) {
    update.destCnpj = dados.destCnpj;
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

  const cnpj = digits(args.cnpj);
  if (cnpj.length !== 14) throw new Error(`CNPJ invalido: ${args.cnpj}`);

  const outDir = path.resolve(args.outDir || path.dirname(csvPath));
  fs.mkdirSync(outDir, { recursive: true });

  const chavesTodas = lerChavesCsv(csvPath);
  const chaves = args.limite > 0 ? chavesTodas.slice(0, args.limite) : chavesTodas;
  const prisma = new PrismaClient();

  const importadas = [];
  const semSitram = [];
  const erros = [];

  try {
    const empresa = await prisma.cnpj.findUnique({ where: { cnpj } });
    if (!empresa) throw new Error(`CNPJ ${cnpj} nao esta cadastrado no sistema.`);

    console.log(`[inicio] chaves_csv=${chavesTodas.length} processar=${chaves.length} empresa=${empresa.cnpj} dryRun=${args.dryRun}`);

    for (let i = 0; i < chaves.length; i++) {
      const chave = chaves[i];
      const prefixo = `[${i + 1}/${chaves.length}] ${chave}`;

      try {
        const sitram = await consultarSitram(chave);
        if (!sitram) {
          semSitram.push({ chave, numero_nf: numeroDaChave(chave), motivo: 'nao_encontrada' });
          console.log(`${prefixo} sem-sitram`);
          await sleep(args.sleepMs);
          continue;
        }

        const dados = montarDados(chave, empresa, sitram);
        const existente = await prisma.notaFiscal.findUnique({ where: { chave } });
        let acao = 'dry-run';

        if (!args.dryRun) {
          if (existente) {
            await prisma.notaFiscal.update({ where: { chave }, data: mergeUpdate(existente, dados) });
            acao = 'atualizada';
          } else {
            await prisma.notaFiscal.create({ data: dados });
            acao = 'criada';
          }
        } else {
          acao = existente ? 'atualizaria' : 'criaria';
        }

        importadas.push({
          chave,
          numero_nf: dados.numero,
          acao,
          sitram_id: dados.sitramAcaoFiscal,
          itens: sitram.itens.length,
          lancamentos: sitram.lancamentos.length,
          dae_status: dados.sitramDaeStatus,
          selada: dados.sitramSelada,
          emitente: dados.emitenteNome,
          emitente_cnpj: dados.emitenteCnpj,
          emitente_uf: dados.emitenteUf,
          destinatario: dados.destNome,
          destinatario_cnpj: dados.destCnpj,
        });
        console.log(`${prefixo} ${acao} itens=${sitram.itens.length} dae=${dados.sitramDaeStatus}`);
      } catch (error) {
        const message = error.message || String(error);
        if (/NF-e nao encontrada no SITRAM/i.test(message)) {
          semSitram.push({ chave, numero_nf: numeroDaChave(chave), motivo: 'nao_encontrada' });
          console.log(`${prefixo} sem-sitram`);
        } else {
          erros.push({ chave, numero_nf: numeroDaChave(chave), erro: message });
          console.log(`${prefixo} erro: ${message}`);
        }
      }

      await sleep(args.sleepMs);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const importadasFile = path.join(outDir, `soye-sitram-importadas-${stamp}.csv`);
    const semSitramFile = path.join(outDir, `soye-sitram-sem-retorno-${stamp}.csv`);
    const errosFile = path.join(outDir, `soye-sitram-erros-${stamp}.csv`);

    writeCsv(importadasFile, [
      'chave', 'numero_nf', 'acao', 'sitram_id', 'itens', 'lancamentos', 'dae_status',
      'selada', 'emitente', 'emitente_cnpj', 'emitente_uf', 'destinatario', 'destinatario_cnpj',
    ], importadas);
    writeCsv(semSitramFile, ['chave', 'numero_nf', 'motivo'], semSitram);
    writeCsv(errosFile, ['chave', 'numero_nf', 'erro'], erros);

    console.log(`[fim] importadas=${importadas.length} sem_sitram=${semSitram.length} erros=${erros.length}`);
    console.log(`[arquivo] importadas=${importadasFile}`);
    console.log(`[arquivo] sem_sitram=${semSitramFile}`);
    console.log(`[arquivo] erros=${errosFile}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
