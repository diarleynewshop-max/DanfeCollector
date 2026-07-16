import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import { carregarCertificado } from './certificado';

export interface ParPem {
  privateKeyPem: string;
  certificatePem: string;
}

let cachePem: ParPem | null = null;
const cachePemPorCnpj = new Map<string, ParPem>();

export function obterPemDePfx(pfx: Buffer, passphrase: string): ParPem {
  const p12Der = forge.util.createBuffer(pfx.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) throw new Error('Chave privada nao encontrada no certificado .pfx.');
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (certBags[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);

  const folha = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n?.toString(16) === privateKey.n.toString(16);
  });
  if (!folha) throw new Error('Certificado-folha nao localizado no .pfx.');

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(folha),
  };
}

/**
 * Extrai a chave privada e o certificado (folha) do .pfx em formato PEM,
 * que é o formato exigido pelo xml-crypto para assinar.
 */
export function obterPemDoCertificado(cnpjInteressado?: string): ParPem {
  const cnpj = (cnpjInteressado ?? '').replace(/\D/g, '');
  if (!cnpj && cachePem) return cachePem;
  if (cnpj) {
    const emCache = cachePemPorCnpj.get(cnpj);
    if (emCache) return emCache;
  }

  const { pfx, passphrase } = carregarCertificado(cnpj || undefined);
  const p12Der = forge.util.createBuffer(pfx.toString('binary'));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no certificado .pfx.');
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;

  // Seleciona o certificado-folha (cujo módulo público bate com a chave privada),
  // ignorando certificados de cadeia (ICP-Brasil, AC intermediárias).
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (certBags[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);

  const folha = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n?.toString(16) === privateKey.n.toString(16);
  });
  if (!folha) throw new Error('Certificado-folha não localizado no .pfx.');

  const par = {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certificatePem: forge.pki.certificateToPem(folha),
  };

  if (cnpj) cachePemPorCnpj.set(cnpj, par);
  else cachePem = par;
  return par;
}

export function limparCachePemCertificado() {
  cachePem = null;
  cachePemPorCnpj.clear();
}

/**
 * Assina o elemento `<infEvento>` de um evento NF-e conforme exigido pela SEFAZ:
 * assinatura envelopada, canonicalização C14N, RSA-SHA1, digest SHA1, com a
 * <Signature> inserida logo após o `<infEvento>`.
 */
export function assinarInfEvento(xml: string, cnpjInteressado?: string): string {
  const { privateKeyPem, certificatePem } = obterPemDoCertificado(cnpjInteressado);

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='infEvento']", action: 'after' },
  });

  return sig.getSignedXml();
}
