import 'server-only';

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Pasta raiz dos anexos no disco (fora do banco). Configurável por env.
const ANEXOS_ROOT = process.env.ANEXOS_PATH || './anexos';

// Tamanho máximo por arquivo (bytes). Fotos de comprovante podem ser grandes.
export const TAMANHO_MAX = 25 * 1024 * 1024; // 25 MB

// Tipos aceitos: PDF, imagens e planilhas.
export const MIMES_ACEITOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/html': 'html',
  'text/csv': 'csv',
  'application/csv': 'csv',
};

export function mimeAceito(mime: string): boolean {
  return mime in MIMES_ACEITOS;
}

export function extensaoDoMime(mime: string): string {
  return MIMES_ACEITOS[mime] || 'bin';
}

function raizAbsoluta(): string {
  return path.resolve(process.cwd(), ANEXOS_ROOT);
}

// Resolve o caminho absoluto de um anexo garantindo que fique dentro da raiz
// (proteção contra path traversal em `caminho` vindo do banco).
export function caminhoAbsoluto(caminhoRelativo: string): string {
  const raiz = raizAbsoluta();
  const abs = path.resolve(raiz, caminhoRelativo);
  if (abs !== raiz && !abs.startsWith(raiz + path.sep)) {
    throw new Error('Caminho de anexo inválido.');
  }
  return abs;
}

// Grava o arquivo no disco e retorna o caminho relativo salvo.
export async function salvarArquivo(
  notaId: number,
  mime: string,
  bytes: Buffer
): Promise<string> {
  const ext = extensaoDoMime(mime);
  const nomeUnico = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const relativo = path.join(String(notaId), nomeUnico);
  const destino = caminhoAbsoluto(relativo);
  await fs.promises.mkdir(path.dirname(destino), { recursive: true });
  await fs.promises.writeFile(destino, bytes);
  // Normaliza separadores para "/" no banco (portável entre Windows/Linux).
  return relativo.split(path.sep).join('/');
}

export async function apagarArquivo(caminhoRelativo: string): Promise<void> {
  try {
    await fs.promises.unlink(caminhoAbsoluto(caminhoRelativo));
  } catch (e) {
    // Se o arquivo já não existe, seguimos — o registro no banco é a fonte da verdade.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export function lerArquivo(caminhoRelativo: string): Buffer {
  return fs.readFileSync(caminhoAbsoluto(caminhoRelativo));
}
