import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const STATUS_RECEBIMENTO_CONHECIDOS = [
  'NF A CHEGAR',
  'CONCLUIDO RECEBIMENTO',
  'AGUARDANDO PRECO',
  'AGUARDANDO CADASTRO',
  'AGUARDANDO ENVIO',
  'NF ENVIADA',
];

function uso() {
  console.log(`Uso:
node scripts/consultar-status-recebimento-todas.mjs [opcoes]

Opcoes:
  --raiz <8digitos>       Processa somente CNPJs dessa raiz (ex.: 45998339)
  --cnpj <14digitos>      Processa somente um CNPJ
  --limite <n>            Processa no maximo n notas
  --sleep-ms <n>          Pausa entre consultas (padrao: 120)
  --somente-pendentes     Ignora notas que ja possuem recebimentoStatus
  --dry-run               Conta sem gravar
`);
}

function parseArgs(argv) {
  const args = { limite: 0, sleepMs: 120, somentePendentes: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--raiz') args.raiz = digits(argv[++i]).slice(0, 8);
    else if (arg === '--cnpj') args.cnpj = digits(argv[++i]).slice(0, 14);
    else if (arg === '--limite') args.limite = Number(argv[++i]);
    else if (arg === '--sleep-ms') args.sleepMs = Number(argv[++i]);
    else if (arg === '--somente-pendentes') args.somentePendentes = true;
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

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function texto(valor) {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo || null;
}

function parseData(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function etiquetasSemStatus(etiquetaAtual, statusAnterior) {
  const remover = new Set(STATUS_RECEBIMENTO_CONHECIDOS);
  if (statusAnterior) remover.add(statusAnterior);
  return String(etiquetaAtual ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag && !remover.has(tag));
}

function etiquetaComStatus(etiquetaAtual, statusAnterior, statusNovo) {
  const tags = etiquetasSemStatus(etiquetaAtual, statusAnterior);
  if (statusNovo && !tags.includes(statusNovo)) tags.push(statusNovo);
  return tags.length > 0 ? tags.join(',') : null;
}

async function consultarApi(baseUrl, token, chave) {
  const url = new URL(baseUrl);
  url.searchParams.set('chave', chave);
  const resposta = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const rawText = await resposta.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new Error(`Resposta invalida HTTP ${resposta.status}`);
    }
  }

  if (resposta.status === 404) return { found: false };
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${payload?.error || resposta.statusText}`);
  }

  const result = payload?.result;
  if (!result || result.found === false) return { found: false };
  if (!texto(result.status)) throw new Error('API retornou nota sem status.');
  return { found: true, result };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    uso();
    return;
  }

  loadEnv();
  const baseUrl = process.env.NF_STATUS_API_URL || 'https://api-recebimento.newgrup.cloud/functions/v1/nf-status-integration';
  const token = process.env.NF_STATUS_API_TOKEN;
  if (!token) throw new Error('NF_STATUS_API_TOKEN nao configurado.');

  const prisma = new PrismaClient();
  const where = {};
  if (args.somentePendentes) where.recebimentoStatus = null;
if (args.cnpj) {
  where.cnpj = { is: { cnpj: args.cnpj } };
} else if (args.raiz) {
  where.cnpj = { is: { cnpj: { startsWith: args.raiz } } };
}

  const notas = await prisma.notaFiscal.findMany({
    where,
    orderBy: { emitidaEm: 'desc' },
    take: args.limite > 0 ? args.limite : undefined,
    select: {
      id: true,
      chave: true,
      etiqueta: true,
      recebimentoStatus: true,
      cnpj: { select: { cnpj: true, razaoSocial: true } },
    },
  });

  console.log(`[inicio] notas=${notas.length} raiz=${args.raiz || ''} cnpj=${args.cnpj || ''} dryRun=${args.dryRun}`);

  const cont = { encontradas: 0, naoEncontradas: 0, erros: 0 };
  const porStatus = new Map();

  for (let i = 0; i < notas.length; i++) {
    const nota = notas[i];
    const prefixo = `[${i + 1}/${notas.length}] ${nota.chave}`;
    try {
      const resposta = await consultarApi(baseUrl, token, nota.chave);
      const consultadoEm = new Date();

      if (!resposta.found) {
        cont.naoEncontradas++;
        if (!args.dryRun) {
          await prisma.notaFiscal.update({
            where: { id: nota.id },
            data: {
              recebimentoStatus: null,
              recebimentoKanbanStatus: null,
              recebimentoStatusOperacional: null,
              recebimentoStatusOperacionalCodigo: null,
              recebimentoAtualizadoEm: null,
              recebimentoAtualizadoPor: null,
              recebimentoConsultadoEm: consultadoEm,
              recebimentoErro: 'NF nao encontrada no app de recebimento.',
              etiqueta: etiquetaComStatus(nota.etiqueta, nota.recebimentoStatus, null),
            },
          });
        }
        console.log(`${prefixo} nao-encontrada`);
      } else {
        const result = resposta.result;
        const status = texto(result.status);
        cont.encontradas++;
        porStatus.set(status, (porStatus.get(status) ?? 0) + 1);
        if (!args.dryRun) {
          await prisma.notaFiscal.update({
            where: { id: nota.id },
            data: {
              recebimentoStatus: status,
              recebimentoKanbanStatus: texto(result.kanbanStatus),
              recebimentoStatusOperacional: texto(result.statusOperacional),
              recebimentoStatusOperacionalCodigo: texto(result.statusOperacionalCodigo),
              recebimentoAtualizadoEm: parseData(texto(result.kanbanUpdatedAt)),
              recebimentoAtualizadoPor: texto(result.kanbanUpdatedBy),
              recebimentoConsultadoEm: consultadoEm,
              recebimentoErro: null,
              etiqueta: etiquetaComStatus(nota.etiqueta, nota.recebimentoStatus, status),
            },
          });
        }
        console.log(`${prefixo} status=${status}`);
      }
    } catch (error) {
      cont.erros++;
      const message = error.message || String(error);
      if (!args.dryRun) {
        await prisma.notaFiscal.update({
          where: { id: nota.id },
          data: { recebimentoConsultadoEm: new Date(), recebimentoErro: message },
        });
      }
      console.log(`${prefixo} erro=${message}`);
    }
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }

  console.log(`[fim] encontradas=${cont.encontradas} nao_encontradas=${cont.naoEncontradas} erros=${cont.erros}`);
  console.log(`[status] ${[...porStatus.entries()].map(([status, qtd]) => `${status}=${qtd}`).join(' | ')}`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
