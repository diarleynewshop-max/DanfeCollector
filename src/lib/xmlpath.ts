import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve o caminho físico do XML (ou PDF) de uma nota de forma portátil.
 *
 * O banco pode ter sido gerado em outra máquina (ex.: PC Windows) e depois
 * movido para o servidor (Linux). Nesses casos o caminho absoluto gravado no
 * banco não existe aqui. Este helper:
 *   1. usa o caminho gravado se ele existir (mesma máquina que baixou);
 *   2. senão, reconstrói o trecho relativo à pasta `downloads` atual
 *      (`cnpj/ano/mes/arquivo.xml`), que é idêntico em qualquer sistema.
 *
 * Retorna um caminho utilizável ou `null` se o arquivo não for encontrado.
 */
export function resolverXmlPath(caminhoGravado: string | null | undefined): string | null {
  if (!caminhoGravado) return null;
  if (fs.existsSync(caminhoGravado)) return caminhoGravado;

  const normalizado = caminhoGravado.replace(/\\/g, '/');
  const marcador = '/downloads/';
  const idx = normalizado.toLowerCase().lastIndexOf(marcador);
  if (idx === -1) return null;

  const relativo = normalizado.slice(idx + marcador.length); // cnpj/ano/mes/arquivo.xml
  const base = process.env.DOWNLOAD_PATH || './downloads';
  const candidato = path.resolve(process.cwd(), base, relativo);
  return fs.existsSync(candidato) ? candidato : null;
}
