// Testa a consulta DIRETA por chave (consChNFe) na Distribuição DFe da SEFAZ.
// Descobre se conseguimos baixar o XML de uma nota só com a chave (grátis).
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const pfx = fs.readFileSync(path.resolve(__dirname, '..', process.env.CERT_PFX_PATH));
const passphrase = process.env.CERT_PFX_PASSWORD;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false });

const CODIGO_UF = { CE: 23 };

function soapConsChNFe(cUF, cnpj, chave) {
  const dist =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>1</tpAmb><cUFAutor>${cUF}</cUFAutor><CNPJ>${cnpj}</CNPJ>` +
    `<consChNFe><chNFe>${chave}</chNFe></consChNFe></distDFeInt>`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>' +
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
    `<nfeDadosMsg>${dist}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`
  );
}

function post(body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www1.nfe.fazenda.gov.br',
        path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
        method: 'POST', pfx, passphrase, minVersion: 'TLSv1.2',
        headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
        timeout: 60000,
      },
      (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); }
    );
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

(async () => {
  const cnpj = process.argv[2];
  const chave = process.argv[3];
  if (!cnpj || !chave) { console.error('Uso: node test-conschave.js <cnpj-interessado> <chave>'); process.exit(1); }

  const xml = await post(soapConsChNFe(CODIGO_UF.CE, cnpj, chave));
  const json = parser.parse(xml);
  const ret = json?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;
  if (!ret) { console.log('Resposta inesperada:', xml.slice(0, 400)); return; }

  console.log('cStat:', ret.cStat, '| xMotivo:', ret.xMotivo);
  const lote = ret.loteDistDFeInt?.docZip;
  if (lote) {
    const itens = Array.isArray(lote) ? lote : [lote];
    for (const it of itens) {
      const conteudo = typeof it === 'string' ? it : it['#text'];
      const schema = it['@_schema'] || '';
      const descomp = zlib.gunzipSync(Buffer.from(conteudo, 'base64')).toString('utf8');
      const ehCompleta = descomp.includes('<nfeProc') || descomp.includes('<procNFe');
      console.log(`  -> schema=${schema} | ${ehCompleta ? 'XML COMPLETO (procNFe) ✅' : 'apenas RESUMO/evento'} | ${descomp.length} bytes`);
    }
  } else {
    console.log('  (nenhum documento retornado)');
  }
})().catch((e) => console.error('ERRO:', e.message));
