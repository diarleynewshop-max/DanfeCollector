"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.obterPemDoCertificado = obterPemDoCertificado;
exports.assinarInfEvento = assinarInfEvento;
const node_forge_1 = __importDefault(require("node-forge"));
const xml_crypto_1 = require("xml-crypto");
const certificado_1 = require("./certificado");
let cachePem = null;
/**
 * Extrai a chave privada e o certificado (folha) do .pfx em formato PEM,
 * que é o formato exigido pelo xml-crypto para assinar.
 */
function obterPemDoCertificado() {
    if (cachePem)
        return cachePem;
    const { pfx, passphrase } = (0, certificado_1.carregarCertificado)();
    const p12Der = node_forge_1.default.util.createBuffer(pfx.toString('binary'));
    const p12Asn1 = node_forge_1.default.asn1.fromDer(p12Der);
    const p12 = node_forge_1.default.pkcs12.pkcs12FromAsn1(p12Asn1, passphrase);
    const keyBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag });
    const keyBag = keyBags[node_forge_1.default.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    if (!keyBag?.key)
        throw new Error('Chave privada não encontrada no certificado .pfx.');
    const privateKey = keyBag.key;
    // Seleciona o certificado-folha (cujo módulo público bate com a chave privada),
    // ignorando certificados de cadeia (ICP-Brasil, AC intermediárias).
    const certBags = p12.getBags({ bagType: node_forge_1.default.pki.oids.certBag });
    const certs = (certBags[node_forge_1.default.pki.oids.certBag] ?? [])
        .map((b) => b.cert)
        .filter((c) => !!c);
    const folha = certs.find((c) => {
        const pub = c.publicKey;
        return pub?.n?.toString(16) === privateKey.n.toString(16);
    });
    if (!folha)
        throw new Error('Certificado-folha não localizado no .pfx.');
    cachePem = {
        privateKeyPem: node_forge_1.default.pki.privateKeyToPem(privateKey),
        certificatePem: node_forge_1.default.pki.certificateToPem(folha),
    };
    return cachePem;
}
/**
 * Assina o elemento `<infEvento>` de um evento NF-e conforme exigido pela SEFAZ:
 * assinatura envelopada, canonicalização C14N, RSA-SHA1, digest SHA1, com a
 * <Signature> inserida logo após o `<infEvento>`.
 */
function assinarInfEvento(xml) {
    const { privateKeyPem, certificatePem } = obterPemDoCertificado();
    const sig = new xml_crypto_1.SignedXml({
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
