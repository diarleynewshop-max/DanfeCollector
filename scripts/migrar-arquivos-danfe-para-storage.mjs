#!/usr/bin/env node

/**
 * Copies a directory to a private Supabase Storage bucket with deterministic
 * object keys and a SHA-256 manifest. It is safe to run again: uploads use
 * x-upsert and therefore act as a delta sync before the final cutover.
 *
 * Required environment:
 *   SUPABASE_URL=http://127.0.0.1:8000
 *   SUPABASE_SERVICE_ROLE_KEY=<server-only key>
 *
 * Example:
 *   node scripts/migrar-arquivos-danfe-para-storage.mjs \
 *     --source /home/danfe/htdocs/danfe.newgrup.cloud/downloads \
 *     --bucket danfe-xml --prefix downloads --manifest /tmp/xml-manifest.jsonl
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIME_BY_EXTENSION = {
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.gif': 'image/gif',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
};

function lerArgumentos(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const atual = argv[i];
    if (!atual.startsWith('--')) continue;
    const nome = atual.slice(2);
    const proximo = argv[i + 1];
    if (!proximo || proximo.startsWith('--')) {
      args.set(nome, 'true');
    } else {
      args.set(nome, proximo);
      i += 1;
    }
  }
  return args;
}

function uso() {
  return [
    'Uso: node scripts/migrar-arquivos-danfe-para-storage.mjs',
    '  --source <pasta> --bucket <bucket> --prefix <prefixo> --manifest <arquivo>',
    '  [--extensions .xml,.pdf] [--concurrency 4] [--dry-run]',
  ].join('\n');
}

function normalizarPrefixo(valor) {
  return (valor ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function mimeDoArquivo(arquivo) {
  return MIME_BY_EXTENSION[path.extname(arquivo).toLowerCase()] ?? 'application/octet-stream';
}

function urlDoObjeto(baseUrl, bucket, chave) {
  const caminho = chave.split('/').map(encodeURIComponent).join('/');
  return `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${caminho}`;
}

async function listarArquivos(raiz, atual = raiz, acumulado = []) {
  const entradas = await fs.readdir(atual, { withFileTypes: true });
  for (const entrada of entradas) {
    const absoluto = path.join(atual, entrada.name);
    if (entrada.isDirectory()) {
      await listarArquivos(raiz, absoluto, acumulado);
    } else if (entrada.isFile()) {
      acumulado.push({
        absoluto,
        relativo: path.relative(raiz, absoluto).split(path.sep).join('/'),
      });
    }
  }
  return acumulado;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enviarComTentativas({ baseUrl, chaveApi, bucket, chave, mime, bytes }) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    try {
      const resposta = await fetch(urlDoObjeto(baseUrl, bucket, chave), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${chaveApi}`,
          apikey: chaveApi,
          'content-type': mime,
          'cache-control': 'private, max-age=0, no-store',
          'x-upsert': 'true',
        },
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      });

      if (resposta.ok) return;

      const texto = (await resposta.text()).slice(0, 300);
      const erro = new Error(`Storage HTTP ${resposta.status}: ${texto}`);
      if (resposta.status < 500 && resposta.status !== 429) throw erro;
      ultimoErro = erro;
    } catch (erro) {
      ultimoErro = erro;
    }

    if (tentativa < 4) await esperar(500 * tentativa * tentativa);
  }

  throw ultimoErro ?? new Error('Falha desconhecida no Storage.');
}

async function main() {
  const args = lerArgumentos(process.argv.slice(2));
  const origem = args.get('source');
  const bucket = args.get('bucket');
  const prefixo = normalizarPrefixo(args.get('prefix'));
  const manifesto = args.get('manifest');
  const dryRun = args.get('dry-run') === 'true';
  const extensoes = new Set(
    (args.get('extensions') ?? '')
      .split(',')
      .map((extensao) => extensao.trim().toLowerCase())
      .filter(Boolean)
  );
  const concurrency = Math.min(8, Math.max(1, Number(args.get('concurrency') ?? 4) || 4));
  const baseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const chaveApi = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!origem || !bucket || !manifesto) throw new Error(uso());
  if (!dryRun && (!baseUrl || !chaveApi)) {
    throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no ambiente do servidor.');
  }

  const raiz = path.resolve(origem);
  const stat = await fs.stat(raiz);
  if (!stat.isDirectory()) throw new Error(`Pasta invalida: ${raiz}`);

  const arquivos = (await listarArquivos(raiz))
    .filter((arquivo) => extensoes.size === 0 || extensoes.has(path.extname(arquivo.relativo).toLowerCase()))
    .sort((a, b) => a.relativo.localeCompare(b.relativo));
  const resultados = new Array(arquivos.length);
  let proximo = 0;
  let concluidos = 0;
  let totalBytes = 0;

  async function worker() {
    while (true) {
      const indice = proximo;
      proximo += 1;
      if (indice >= arquivos.length) return;

      const arquivo = arquivos[indice];
      const bytes = await fs.readFile(arquivo.absoluto);
      const chave = [prefixo, arquivo.relativo].filter(Boolean).join('/');
      const mime = mimeDoArquivo(arquivo.relativo);
      const sha256 = createHash('sha256').update(bytes).digest('hex');

      if (!dryRun) {
        await enviarComTentativas({ baseUrl, chaveApi, bucket, chave, mime, bytes });
      }

      resultados[indice] = JSON.stringify({
        bucket,
        key: chave,
        relativePath: arquivo.relativo,
        size: bytes.length,
        sha256,
        mime,
      });

      concluidos += 1;
      totalBytes += bytes.length;
      if (concluidos % 100 === 0 || concluidos === arquivos.length) {
        process.stderr.write(`[storage] ${bucket}: ${concluidos}/${arquivos.length} arquivos\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await fs.mkdir(path.dirname(path.resolve(manifesto)), { recursive: true });
  await fs.writeFile(manifesto, `${resultados.join('\n')}\n`, 'utf8');

  process.stdout.write(JSON.stringify({
    bucket,
    files: arquivos.length,
    bytes: totalBytes,
    manifest: path.resolve(manifesto),
    dryRun,
  }) + '\n');
}

main().catch((erro) => {
  process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exitCode = 1;
});
