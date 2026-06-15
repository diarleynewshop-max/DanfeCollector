import * as fs from 'fs';
import * as path from 'path';

export interface CertificadoA1 {
  pfx: Buffer;
  passphrase: string;
}

/**
 * Carrega o certificado A1 (.pfx) configurado no .env.
 * O arquivo NUNCA deve ser commitado (pasta certs/ está no .gitignore).
 */
export function carregarCertificado(): CertificadoA1 {
  const pfxPath = process.env.CERT_PFX_PATH;
  const passphrase = process.env.CERT_PFX_PASSWORD;

  if (!pfxPath || !passphrase) {
    throw new Error(
      'Certificado não configurado. Defina CERT_PFX_PATH e CERT_PFX_PASSWORD no .env ' +
        '(coloque o arquivo .pfx original do certificado A1 na pasta certs/).'
    );
  }

  const caminhoAbsoluto = path.isAbsolute(pfxPath)
    ? pfxPath
    : path.resolve(process.cwd(), pfxPath);

  if (!fs.existsSync(caminhoAbsoluto)) {
    throw new Error(`Arquivo do certificado não encontrado: ${caminhoAbsoluto}`);
  }

  return { pfx: fs.readFileSync(caminhoAbsoluto), passphrase };
}
