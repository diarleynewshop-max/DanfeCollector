import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const HOSTS = {
  NEWSHOP: 'newshop.varejofacil.com',
  FACIL: 'facil.varejofacil.com',
  SOYE: 'facil.varejofacil.com',
  SEFULY: 'sefuly.varejofacil.com',
};

const STATUS_TAGS_ERP = ['Efetivada', 'Pendente a Entrega', 'Inconsistente', 'Recusada'];
const RAIZ_DESTINO = {
  NEWSHOP: '45998339',
  FACIL: '50767035',
  SOYE: '62803717',
};

function uso() {
  console.log(`Uso:
node scripts/atualizar-status-erp-notas.mjs [opcoes]

Opcoes:
  --ano <aaaa>           Ano das notas pelo campo emitidaEm (padrao: 2026)
  --empresa <nome>       AUTO, NEWSHOP, FACIL, SOYE ou SEFULY (padrao: AUTO)
  --destino <nome>       Filtra CNPJ destinatario: NEWSHOP, FACIL ou SOYE
  --batch-size <n>       Quantidade buscada por lote no banco (padrao: 20)
  --sleep-ms <n>         Pausa entre consultas ao ERP (padrao: 300)
  --batch-sleep-ms <n>   Pausa entre lotes (padrao: 1500)
  --limite <n>           Processa no maximo n notas
  --dry-run              Consulta sem gravar

Credencial:
  ERP_WEB_COOKIE_NEWSHOP ou ERP_USERNAME_NEWSHOP + ERP_PASSWORD_NEWSHOP
`);
}

function parseArgs(argv) {
  const args = {
    ano: 2026,
    empresa: 'AUTO',
    batchSize: 20,
    sleepMs: 300,
    batchSleepMs: 1500,
    limite: 0,
    destino: '',
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ano') args.ano = Number(argv[++i]);
    else if (arg === '--empresa') args.empresa = String(argv[++i] || 'NEWSHOP').trim().toUpperCase();
    else if (arg === '--destino') args.destino = String(argv[++i] || '').trim().toUpperCase();
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (arg === '--sleep-ms') args.sleepMs = Number(argv[++i]);
    else if (arg === '--batch-sleep-ms') args.batchSleepMs = Number(argv[++i]);
    else if (arg === '--limite') args.limite = Number(argv[++i]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
  }
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
  const configured = normalizarCookie(envErp(empresa, 'WEB_COOKIE') || envErp(empresa, 'SESSION_COOKIE'));
  if (configured) return configured;

  const username = envErp(empresa, 'USERNAME');
  const password = envErp(empresa, 'PASSWORD');
  if (!username || !password) {
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
    },
    signal: AbortSignal.timeout(30000),
  });

  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/JSESSIONID=([^;]+)/);
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
      'User-Agent': 'DanfeCollector/1.0',
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    uso();
    return;
  }
  if (args.empresa !== 'AUTO' && !HOSTS[baseEmpresa(args.empresa)]) throw new Error(`Empresa invalida: ${args.empresa}`);
  if (args.destino && !RAIZ_DESTINO[args.destino]) throw new Error(`Destino invalido: ${args.destino}`);
  args.batchSize = Math.max(1, Math.min(20, Number(args.batchSize) || 20));
  args.sleepMs = Math.max(0, Number(args.sleepMs) || 0);
  args.batchSleepMs = Math.max(0, Number(args.batchSleepMs) || 0);

  loadEnv();
  const prisma = new PrismaClient();
  const cookiesPorEmpresa = new Map();
  async function cookieDaEmpresa(empresa) {
    if (!cookiesPorEmpresa.has(empresa)) {
      cookiesPorEmpresa.set(empresa, await obterCookieWeb(empresa));
    }
    return cookiesPorEmpresa.get(empresa);
  }
  const inicio = new Date(Date.UTC(args.ano, 0, 1, 3, 0, 0));
  const fim = new Date(Date.UTC(args.ano + 1, 0, 1, 3, 0, 0));
  const where = { emitidaEm: { gte: inicio, lt: fim } };
  if (args.destino) {
    where.cnpj = { is: { cnpj: { startsWith: RAIZ_DESTINO[args.destino] } } };
  }
  const totalBanco = await prisma.notaFiscal.count({ where });
  const totalProcessar = args.limite > 0 ? Math.min(args.limite, totalBanco) : totalBanco;
  console.log(`[inicio] ano=${args.ano} empresa=${args.empresa} destino=${args.destino || 'TODOS'} notas=${totalBanco} processar=${totalProcessar} batchSize=${args.batchSize} dryRun=${args.dryRun}`);

  const cont = { atualizadas: 0, semAlteracao: 0, naoEncontradas: 0, ignoradas: 0, erros: 0 };
  const porSituacao = new Map();
  const porEmpresa = new Map();
  let cursorId = 0;
  let processadas = 0;

  while (processadas < totalProcessar) {
    const take = Math.min(args.batchSize, totalProcessar - processadas);
    const notas = await prisma.notaFiscal.findMany({
      where: { ...where, id: { gt: cursorId } },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        chave: true,
        etiqueta: true,
        numero: true,
        serie: true,
        cnpj: { select: { cnpj: true, razaoSocial: true } },
      },
    });
    if (notas.length === 0) break;

    console.log(`[lote] ${processadas + 1}-${processadas + notas.length} de ${totalProcessar}`);

    for (const nota of notas) {
      cursorId = nota.id;
      processadas++;
      const prefixo = `[${processadas}/${totalProcessar}] ${nota.chave}`;
      try {
        const empresaNota = args.empresa === 'AUTO' ? empresaPorCnpj(nota.cnpj?.cnpj, nota.cnpj?.razaoSocial) : args.empresa;
        porEmpresa.set(empresaNota, (porEmpresa.get(empresaNota) ?? 0) + 1);
        const resultado = await consultarNotaCompraErp({ empresa: empresaNota, cookie: await cookieDaEmpresa(empresaNota), chave: nota.chave });
        if (!resultado.found) {
          cont.naoEncontradas++;
          console.log(`${prefixo} empresa=${empresaNota} nao-encontrada`);
        } else {
          const situacao = resultado.situacao || 'SEM_SITUACAO';
          porSituacao.set(situacao, (porSituacao.get(situacao) ?? 0) + 1);
          const etiquetaErp = statusParaEtiqueta(situacao);
          if (!etiquetaErp) {
            cont.ignoradas++;
            console.log(`${prefixo} empresa=${empresaNota} situacao=${situacao} etiqueta=ignorada`);
          } else {
            const proximaEtiqueta = atualizarEtiqueta(nota.etiqueta, etiquetaErp);
            if (proximaEtiqueta === (nota.etiqueta ?? null)) {
              cont.semAlteracao++;
            } else {
              cont.atualizadas++;
              if (!args.dryRun) {
                await prisma.notaFiscal.update({
                  where: { id: nota.id },
                  data: { etiqueta: proximaEtiqueta },
                });
              }
            }
            console.log(`${prefixo} empresa=${empresaNota} nf=${resultado.numero || nota.numero || '-'} situacao=${situacao} etiqueta=${etiquetaErp}${args.dryRun ? ' dry-run' : ''}`);
          }
        }
      } catch (error) {
        cont.erros++;
        console.log(`${prefixo} erro=${error.message || String(error)}`);
      }

      if (args.sleepMs > 0 && processadas < totalProcessar) await sleep(args.sleepMs);
    }

    if (args.batchSleepMs > 0 && processadas < totalProcessar) await sleep(args.batchSleepMs);
  }

  console.log(`[fim] processadas=${processadas} atualizadas=${cont.atualizadas} sem_alteracao=${cont.semAlteracao} nao_encontradas=${cont.naoEncontradas} ignoradas=${cont.ignoradas} erros=${cont.erros}`);
  console.log(`[situacoes] ${[...porSituacao.entries()].map(([status, qtd]) => `${status}=${qtd}`).join(' | ') || '-'}`);
  console.log(`[empresas] ${[...porEmpresa.entries()].map(([empresa, qtd]) => `${empresa}=${qtd}`).join(' | ') || '-'}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
