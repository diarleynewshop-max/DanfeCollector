import * as fs from 'fs';
import * as path from 'path';
import forge from 'node-forge';

export interface CertificadoA1 {
  pfx: Buffer;
  passphrase: string;
  origem: string;
  cnpjCertificado?: string;
}

export interface CertificadoPfxInfo {
  cnpj: string;
  razaoSocial: string | null;
  serial: string | null;
  vencimento: Date;
}

interface CertificadoCandidato extends CertificadoA1 {
  cnpjCertificado: string;
}

const cachePorArquivo = new Map<string, CertificadoCandidato | null>();
const cachePorCnpj = new Map<string, CertificadoA1>();

function caminhoAbsoluto(pfxPath: string): string {
  return path.isAbsolute(pfxPath) ? pfxPath : path.resolve(process.cwd(), pfxPath);
}

function limparCnpj(valor: string | undefined | null): string {
  return (valor ?? '').replace(/\D/g, '');
}

function envNome(sufixo: string, cnpj: string): string {
  return `${sufixo}_${cnpj}`;
}

function envRaiz(sufixo: string, raiz: string): string[] {
  return [`${sufixo}_RAIZ_${raiz}`, `${sufixo}_ROOT_${raiz}`];
}

function lerEnvCert(cnpj: string): { paths: string[]; senhas: string[] } {
  const raiz = cnpj.slice(0, 8);
  const pathKeys = [envNome('CERT_PFX_PATH', cnpj), ...envRaiz('CERT_PFX_PATH', raiz)];
  const senhaKeys = [envNome('CERT_PFX_PASSWORD', cnpj), ...envRaiz('CERT_PFX_PASSWORD', raiz)];

  return {
    paths: pathKeys.map((key) => process.env[key]).filter((v): v is string => !!v),
    senhas: senhaKeys.map((key) => process.env[key]).filter((v): v is string => !!v),
  };
}

function senhaNoNomeArquivo(arquivo: string): string | null {
  const base = path.basename(arquivo, path.extname(arquivo));
  const match = base.match(/senha[\s_-]*(.+)$/i);
  if (!match?.[1]) return null;
  return match[1].replace(/^[\s_-]+/, '').trim() || null;
}

function uniq<T>(valores: T[]): T[] {
  return [...new Set(valores.filter(Boolean))];
}

function extrairCnpjDoPfx(pfx: Buffer, passphrase: string): string | null {
  return inspecionarCertificadoPfx(pfx, passphrase).cnpj;
}

export function inspecionarCertificadoPfx(pfx: Buffer, passphrase: string): CertificadoPfxInfo {
  const p12Der = forge.util.createBuffer(pfx.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (certBags[forge.pki.oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((cert): cert is forge.pki.Certificate => !!cert);

  for (const cert of certs) {
    const campos = cert.subject.attributes.map((attr) => String(attr.value ?? ''));
    const texto = campos.join(' ');
    const cn = cert.subject.getField('CN')?.value;
    const candidatoCn = limparCnpj(String(cn ?? '').split(':').pop());
    const cnpj = candidatoCn.length === 14 ? candidatoCn : texto.match(/\b\d{14}\b/)?.[0];
    if (cnpj) {
      return {
        cnpj,
        razaoSocial: String(cn ?? '').split(':')[0]?.trim() || null,
        serial: cert.serialNumber || null,
        vencimento: cert.validity.notAfter,
      };
    }

  }

  throw new Error('Nao foi possivel localizar CNPJ no certificado PFX.');
}

function tentarCarregar(arquivo: string, senhas: string[]): CertificadoCandidato | null {
  const absoluto = caminhoAbsoluto(arquivo);
  if (!fs.existsSync(absoluto)) return null;

  for (const senha of uniq(senhas)) {
    const chaveCache = `${absoluto}|${senha}`;
    if (cachePorArquivo.has(chaveCache)) return cachePorArquivo.get(chaveCache) ?? null;

    try {
      const pfx = fs.readFileSync(absoluto);
      const cnpjCertificado = extrairCnpjDoPfx(pfx, senha);
      if (!cnpjCertificado) {
        cachePorArquivo.set(chaveCache, null);
        continue;
      }

      const cert = { pfx, passphrase: senha, origem: absoluto, cnpjCertificado };
      cachePorArquivo.set(chaveCache, cert);
      return cert;
    } catch {
      cachePorArquivo.set(chaveCache, null);
    }
  }

  return null;
}

function arquivosPfxLocais(): string[] {
  const pasta = path.resolve(process.cwd(), 'certs');
  if (!fs.existsSync(pasta)) return [];
  return fs
    .readdirSync(pasta)
    .filter((nome) => nome.toLowerCase().endsWith('.pfx'))
    .map((nome) => path.join(pasta, nome));
}

function candidatosPara(cnpj: string): CertificadoCandidato[] {
  const env = lerEnvCert(cnpj);
  const paths = uniq([...env.paths, process.env.CERT_PFX_PATH, ...arquivosPfxLocais()])
    .filter((valor): valor is string => !!valor);
  const achados: CertificadoCandidato[] = [];

  for (const arquivo of paths) {
    const senhaNome = senhaNoNomeArquivo(arquivo);
    const senhas = uniq([
      ...env.senhas,
      process.env.CERT_PFX_PASSWORD,
      senhaNome,
    ]).filter((valor): valor is string => !!valor);
    const cert = tentarCarregar(arquivo, senhas);
    if (cert) achados.push(cert);
  }

  return achados;
}

/**
 * Carrega o certificado A1 (.pfx) correto para o CNPJ informado.
 * Regra: match exato do CNPJ primeiro; depois certificado da mesma raiz.
 * Sem CNPJ informado, preserva o comportamento antigo: usa CERT_PFX_PATH.
 */
export function carregarCertificado(cnpjInteressado?: string): CertificadoA1 {
  const cnpj = limparCnpj(cnpjInteressado);
  if (!cnpj) {
    const pfxPath = process.env.CERT_PFX_PATH;
    const passphrase = process.env.CERT_PFX_PASSWORD;
    if (!pfxPath || !passphrase) {
      throw new Error(
        'Certificado nao configurado. Defina CERT_PFX_PATH e CERT_PFX_PASSWORD no .env ' +
          '(coloque o arquivo .pfx original do certificado A1 na pasta certs/).'
      );
    }

    const origem = caminhoAbsoluto(pfxPath);
    if (!fs.existsSync(origem)) throw new Error(`Arquivo do certificado nao encontrado: ${origem}`);
    return { pfx: fs.readFileSync(origem), passphrase, origem };
  }

  const emCache = cachePorCnpj.get(cnpj);
  if (emCache) return emCache;

  const raiz = cnpj.slice(0, 8);
  const candidatos = candidatosPara(cnpj);
  const escolhido =
    candidatos.find((cert) => cert.cnpjCertificado === cnpj) ??
    candidatos.find((cert) => cert.cnpjCertificado.slice(0, 8) === raiz);

  if (!escolhido) {
    throw new Error(
      `Nenhum certificado PFX encontrado para o CNPJ ${cnpj}. ` +
        `Configure CERT_PFX_PATH_${cnpj} no .env ou coloque o .pfx em certs/ com a senha no nome do arquivo.`
    );
  }

  cachePorCnpj.set(cnpj, escolhido);
  return escolhido;
}

export function limparCacheCertificados() {
  cachePorArquivo.clear();
  cachePorCnpj.clear();
}
