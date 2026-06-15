// Testa a assinatura digital do evento OFFLINE (não contata a SEFAZ).
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { assinarInfEvento, obterPemDoCertificado } = require(path.join(__dirname, '_sefaz-build', 'assinatura.js'));

// Confere que o PEM foi extraído do .pfx
const pem = obterPemDoCertificado();
console.log('Chave privada PEM:', pem.privateKeyPem.slice(0, 27), '...');
console.log('Certificado PEM:', pem.certificatePem.slice(0, 27), '...');

const chave = '23260641426966002205550010000700191719889759';
const id = `ID210210${chave}01`;
const evento =
  `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">` +
  `<infEvento Id="${id}">` +
  `<cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>45998339000329</CNPJ>` +
  `<chNFe>${chave}</chNFe><dhEvento>2026-06-13T09:00:00-03:00</dhEvento>` +
  `<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
  `<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento>` +
  `</infEvento></evento>`;

const assinado = assinarInfEvento(evento);

console.log('\n--- Verificações ---');
console.log('Tem <Signature>:', assinado.includes('<Signature') || assinado.includes(':Signature'));
console.log('Tem DigestValue:', /<(\w+:)?DigestValue>[^<]+/.test(assinado));
console.log('Tem SignatureValue:', /<(\w+:)?SignatureValue>[^<]+/.test(assinado));
console.log('Tem X509Certificate:', /<(\w+:)?X509Certificate>[^<]+/.test(assinado));
const refMatch = assinado.match(/Reference URI="([^"]*)"/);
console.log('Reference URI:', refMatch ? refMatch[1] : '(não encontrado)');
console.log('URI bate com o Id:', refMatch ? refMatch[1] === `#${id}` : false);
console.log('\nXML assinado (300 chars finais):\n', assinado.slice(-300));
