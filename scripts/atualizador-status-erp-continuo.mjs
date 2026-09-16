// Worker contínuo (roda sob PM2) que mantém a etiqueta de status ERP das notas
// sempre atualizada, sem precisar rodar manualmente.
//
// Regra de escopo (evita bater no ERP à toa):
//   - Ignora notas já etiquetadas como "Efetivada" (status final, não muda mais).
//   - Também ignora notas "Recusada" (status final).
//   - Foca em notas "Pendente a Entrega", "Inconsistente" ou SEM etiqueta de
//     status ERP nenhuma (para classificar pelo menos uma vez as notas novas).
//
// Processa em lotes de 50 (configurável via BATCH_SIZE), com pausa entre
// notas e entre lotes para não sobrecarregar o ERP. Ao terminar uma volta
// completa, dorme um intervalo e recomeça — mantendo os dados sempre frescos.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = valor;
  }
}

const HOSTS = {
  NEWSHOP: 'newshop.varejofacil.com',
  FACIL: 'facil.varejofacil.com',
  SOYE: 'facil.varejofacil.com',
  SEFULY: 'sefuly.varejofacil.com',
};

const STATUS_TAGS_ERP = ['Efetivada', 'Pendente a Entrega', 'Inconsistente', 'Recusada'];

const BATCH_SIZE = Math.max(1, Math.min(200, Number(process.env.STATUS_ERP_BATCH_SIZE) || 50));
const SLEEP_MS = Math.max(0, Number(process.env.STATUS_ERP_SLEEP_MS) || 350);
const BATCH_SLEEP_MS = Math.max(0, Number(process.env.STATUS_ERP_BATCH_SLEEP_MS) || 2000);
const CICLO_INTERVALO_MIN = Math.max(1, Number(process.env.STATUS_ERP_CICLO_INTERVALO_MINUTOS) || 10);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function baseEmpresa(empresa) {
  if (empresa === 'SOYE') return 'FACIL';
  if (empresa === 'SEFULY') return 'NEWSHOP';
  return empresa;
}

function empresaPorCnpj(cnpj, razaoSocial = '') {
  const raiz = digits(cnpj).slice(0, 8);
  const nome = String(razaoSocial ?? '').toUpperCase();
  if (raiz === '50767035') return 'FACIL';
  if (raiz === '62803717') return 'SOYE';
  if (nome.includes('SEFULY')) return 'SEFULY';
  return 'NEWSHOP';
}

function envErp(empresa, chave) {
  const base = baseEmpresa(empresa);
  const allowGeneric = empresa !== 'SEFULY';
  return (
    process.env[`ERP_${chave}_${empresa}`] ||
    process.env[`VAREJOFACIL_${chave}_${empresa}`] ||
    process.env[`ERP_${chave}_${base}`] ||
    process.env[`VAREJOFACIL_${chave}_${base}`] ||
    (allowGeneric ? process.env[`ERP_${chave}`] : '') ||
    (allowGeneric ? process.env[`VAREJOFACIL_${chave}`] : '') ||
    ''
  ).trim();
}

function webBaseUrl(empresa) {
  const base = baseEmpresa(empresa);
  const configured = (envErp(empresa, 'URL') || `https://${HOSTS[base]}`).replace(/\/$/, '');
  return configured.endsWith('/api') ? configured.slice(0, -4) : configured;
}

function normalizarCookie(valor) {
  const cookie = String(valor ?? '').trim();
  if (!cookie) return '';
  return cookie.includes('=') ? cookie : `JSESSIONID=${cookie}`;
}

async function obterCookieWeb(empresa) {
  const username = envErp(empresa, 'USERNAME');
  const password = envErp(empresa, 'PASSWORD');
  if (!username || !password) {
    const configured = normalizarCookie(envErp(empresa, 'WEB_COOKIE') || envErp(empresa, 'SESSION_COOKIE'));
    if (configured) return configured;
    throw new Error(`Credenciais ERP nao configuradas para ${empresa}.`);
  }

  const baseUrl = webBaseUrl(empresa);
  const params = new URLSearchParams({ j_username: username, j_password: password });
  const response = await fetch(`${baseUrl}/j_spring_security_check?${params.toString()}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${baseUrl}/login`,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(30000),
  });

  const getSetCookieFn = response.headers.getSetCookie;
  const setCookieHeaders = typeof getSetCookieFn === 'function'
    ? getSetCookieFn.call(response.headers)
    : [response.headers.get('set-cookie') || ''];
  const match = setCookieHeaders.join('; ').match(/JSESSIONID=([^;]+)/);
  if (!match?.[1]) throw new Error(`ERP nao retornou sessao web para ${empresa}.`);
  return `JSESSIONID=${match[1]}`;
}

function texto(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function statusParaEtiqueta(situacao) {
  const status = texto(situacao)?.toUpperCase();
  if (status === 'EFETIVADA') return 'Efetivada';
  if (status === 'PENDENTE' || status === 'PENDENTE_ENTREGA') return 'Pendente a Entrega';
  if (status === 'INCONSISTENTE') return 'Inconsistente';
  if (status === 'RECUSADA') return 'Recusada';
  return null;
}

function atualizarEtiqueta(etiquetaAtual, etiquetaErp) {
  const tags = String(etiquetaAtual ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && !STATUS_TAGS_ERP.includes(tag));
  if (etiquetaErp && !tags.includes(etiquetaErp)) tags.push(etiquetaErp);
  return tags.length > 0 ? tags.join(',') : null;
}

async function consultarNotaCompraErp({ empresa, cookie, chave }) {
  const chaveLimpa = digits(chave);
  const baseUrl = webBaseUrl(empresa);
  const url = new URL(`${baseUrl}/notaFiscalCompra/pesquisa`);
  url.searchParams.set('filtro.notaFiscal.loja.codigo', '');
  url.searchParams.set('filtro.notaFiscal.pessoa.codigo', '');
  url.searchParams.set('filtro.intervaloEmissao.inicio', '');
  url.searchParams.set('filtro.intervaloEmissao.termino', '');
  url.searchParams.set('filtro.notaFiscal.chaveDaNfe', chaveLimpa);
  url.searchParams.set('filtro.notaFiscal.serie', '');
  url.searchParams.set('filtro.notaFiscal.numeroDoDocumento', '');
  url.searchParams.set('filtro.intervaloEntrada.inicio', '');
  url.searchParams.set('filtro.intervaloEntrada.termino', '');
  url.searchParams.set('filtro.skipPagina', '0');
  url.searchParams.set('filtro.pageSize', '10');
  url.searchParams.set('filtro.totalPagina', '-1');
  url.searchParams.set('filtro.ordem', 'DATADAEMISSAO');
  url.searchParams.set('filtro.direcao', 'desc');
  url.searchParams.set('_', String(Date.now()));

  const response = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${baseUrl}/notaFiscalCompra/index`,
      Cookie: cookie,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(30000),
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error('Sessao ERP expirada.');
  }
  const contentType = response.headers.get('content-type') || '';
  const rawText = await response.text();
  if (!response.ok) throw new Error(`ERP HTTP ${response.status}`);
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error('ERP retornou HTML/resposta nao JSON.');
  }

  const payload = JSON.parse(rawText);
  const notas = Array.isArray(payload?.notas) ? payload.notas : [];
  if (notas.length === 0) return { found: false };
  const nota = notas[0];
  return {
    found: true,
    situacao: texto(nota.situacao),
    numero: texto(nota.numeroDoDocumento),
    serie: texto(nota.serie),
    fornecedor: texto(nota.descricaoDaPessoa),
  };
}

const prisma = new PrismaClient();
const cookiesPorEmpresa = new Map();
async function cookieDaEmpresa(empresa, forcarNovo = false) {
  if (forcarNovo || !cookiesPorEmpresa.has(empresa)) {
    cookiesPorEmpresa.set(empresa, await obterCookieWeb(empresa));
  }
  return cookiesPorEmpresa.get(empresa);
}

// Notas que interessam a este worker: sem etiqueta de status ERP ainda, ou
// marcadas Pendente a Entrega / Inconsistente. Efetivada e Recusada ficam de
// fora por serem status finais (não mudam mais no ERP).
const whereAlvo = {
  OR: [
    { etiqueta: null },
    { etiqueta: { contains: 'Pendente a Entrega' } },
    { etiqueta: { contains: 'Inconsistente' } },
  ],
};

let parando = false;
process.on('SIGTERM', () => {
  log('Recebido SIGTERM, encerrando apos o lote atual...');
  parando = true;
});
process.on('SIGINT', () => {
  log('Recebido SIGINT, encerrando apos o lote atual...');
  parando = true;
});

async function processarNota(nota) {
  const empresaNota = empresaPorCnpj(nota.cnpj?.cnpj, nota.cnpj?.razaoSocial);
  let resultado;
  try {
    resultado = await consultarNotaCompraErp({ empresa: empresaNota, cookie: await cookieDaEmpresa(empresaNota), chave: nota.chave });
  } catch (errConsulta) {
    if (String(errConsulta?.message).includes('Sessao ERP expirada')) {
      const novoCookie = await cookieDaEmpresa(empresaNota, true);
      resultado = await consultarNotaCompraErp({ empresa: empresaNota, cookie: novoCookie, chave: nota.chave });
    } else {
      throw errConsulta;
    }
  }

  if (!resultado.found) {
    log(`  ${nota.chave} empresa=${empresaNota} nao-encontrada no ERP`);
    return { encontrada: false };
  }

  const situacao = resultado.situacao || 'SEM_SITUACAO';
  const etiquetaErp = statusParaEtiqueta(situacao);
  if (!etiquetaErp) {
    log(`  ${nota.chave} empresa=${empresaNota} situacao=${situacao} (sem mapeamento de etiqueta)`);
    return { encontrada: true, alterada: false };
  }

  const proximaEtiqueta = atualizarEtiqueta(nota.etiqueta, etiquetaErp);
  if (proximaEtiqueta === (nota.etiqueta ?? null)) {
    return { encontrada: true, alterada: false };
  }

  await prisma.notaFiscal.update({ where: { id: nota.id }, data: { etiqueta: proximaEtiqueta } });
  log(`  ${nota.chave} empresa=${empresaNota} nf=${resultado.numero || nota.numero || '-'} situacao=${situacao} -> etiqueta="${proximaEtiqueta}"`);
  return { encontrada: true, alterada: true };
}

async function rodarCiclo() {
  const totalAlvo = await prisma.notaFiscal.count({ where: whereAlvo });
  log(`Iniciando volta: ${totalAlvo} nota(s) pendente/inconsistente/sem-etiqueta a verificar (lotes de ${BATCH_SIZE}).`);

  const cont = { verificadas: 0, atualizadas: 0, naoEncontradas: 0, erros: 0 };
  let cursorId = 0;

  while (!parando) {
    const notas = await prisma.notaFiscal.findMany({
      where: { ...whereAlvo, id: { gt: cursorId } },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, chave: true, etiqueta: true, numero: true, serie: true, cnpj: { select: { cnpj: true, razaoSocial: true } } },
    });
    if (notas.length === 0) break;

    log(`Lote: ${notas.length} nota(s) (a partir do id ${cursorId}).`);
    for (const nota of notas) {
      cursorId = nota.id;
      try {
        const r = await processarNota(nota);
        cont.verificadas++;
        if (r.alterada) cont.atualizadas++;
        if (!r.encontrada) cont.naoEncontradas++;
      } catch (error) {
        cont.erros++;
        log(`  ${nota.chave} erro=${error?.message || String(error)}`);
      }
      if (parando) break;
      if (SLEEP_MS > 0) await sleep(SLEEP_MS);
    }
    if (parando) break;
    if (BATCH_SLEEP_MS > 0) await sleep(BATCH_SLEEP_MS);
  }

  log(`Volta concluida: verificadas=${cont.verificadas} atualizadas=${cont.atualizadas} nao_encontradas=${cont.naoEncontradas} erros=${cont.erros}`);
  return cont;
}

async function main() {
  log(`Worker de status ERP iniciado. batch=${BATCH_SIZE} sleep=${SLEEP_MS}ms batchSleep=${BATCH_SLEEP_MS}ms intervaloEntreVoltas=${CICLO_INTERVALO_MIN}min`);
  while (!parando) {
    try {
      await rodarCiclo();
    } catch (error) {
      log(`Falha na volta: ${error?.stack || error?.message || String(error)}`);
    }
    if (parando) break;
    log(`Aguardando ${CICLO_INTERVALO_MIN} minuto(s) para a proxima volta.`);
    for (let i = 0; i < CICLO_INTERVALO_MIN * 60 && !parando; i++) await sleep(1000);
  }
  await prisma.$disconnect();
  log('Worker de status ERP encerrado.');
  process.exit(0);
}

main().catch(async (error) => {
  console.error(`[fatal] ${error?.stack || error?.message || String(error)}`);
  await prisma.$disconnect();
  process.exit(1);
});
