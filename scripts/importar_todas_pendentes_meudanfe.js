const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { XMLParser } = require('fast-xml-parser');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

const docModule = require(path.resolve(__dirname, '_sefaz-build', 'documentos.js'));
const processarDocumento = docModule.processarDocumento;

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const API_KEY = process.env.MEUDANFE_API_KEY || '2ab335f0-120b-45a1-9060-b7105287400f';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getCertParaCnpj(cnpj) {
  const cnpjLimpo = String(cnpj).replace(/\D/g, '');
  const raiz = cnpjLimpo.slice(0, 8);

  let pfxPath =
    process.env[`CERT_PFX_PATH_${cnpjLimpo}`] ||
    process.env[`CERT_PFX_PATH_RAIZ_${raiz}`] ||
    process.env.CERT_PFX_PATH;
  let passphrase =
    process.env[`CERT_PFX_PASSWORD_${cnpjLimpo}`] ||
    process.env[`CERT_PFX_PASSWORD_RAIZ_${raiz}`] ||
    process.env.CERT_PFX_PASSWORD;

  const resolved = path.resolve(__dirname, '..', pfxPath);
  return {
    pfx: fs.readFileSync(resolved),
    passphrase,
  };
}

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

function postSefaz(body, cert) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www1.nfe.fazenda.gov.br',
        path: '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
        method: 'POST',
        pfx: cert.pfx,
        passphrase: cert.passphrase,
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function buscarXmlMeuDanfe(chave) {
  await fetch(`https://api.meudanfe.com.br/v2/fd/add/${chave}`, {
    method: 'PUT',
    headers: { 'Api-Key': API_KEY, Accept: 'application/json' },
  }).catch(() => {});

  await sleep(1000);

  for (let t = 1; t <= 3; t++) {
    const res = await fetch(`https://api.meudanfe.com.br/v2/fd/get/xml/${chave}`, {
      method: 'GET',
      headers: { 'Api-Key': API_KEY, Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (typeof data.data === 'string' && data.data.includes('<infNFe')) {
      return data.data;
    }
    if (t < 3) await sleep(1500);
  }
  return null;
}

async function buscarXmlSefaz(cnpj, chave) {
  try {
    const cert = getCertParaCnpj(cnpj);
    const soapBody = soapConsChNFe(23, cnpj, chave);
    const xmlResp = await postSefaz(soapBody, cert);
    const json = parser.parse(xmlResp);
    const ret = json?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;
    if (ret && Number(ret.cStat) === 138 && ret.loteDistDFeInt?.docZip) {
      const lote = ret.loteDistDFeInt.docZip;
      const it = Array.isArray(lote) ? lote[0] : lote;
      const conteudo = typeof it === 'string' ? it : it['#text'];
      const xml = zlib.gunzipSync(Buffer.from(conteudo, 'base64')).toString('utf8');
      if (xml.includes('<infNFe')) return xml;
    }
  } catch (e) {
    // fallback
  }
  return null;
}

async function processarUmaChave(chave, cnpjSugestao, cnpjsMap) {
  const ja = await prisma.notaFiscal.findUnique({ where: { chave } });
  if (ja && ja.status === 'COMPLETA') {
    console.log(`  ℹ️ [${chave}] Já cadastrada como COMPLETA no banco (ID ${ja.id}).`);
    return true;
  }

  let origem = 'meudanfe';
  let xml = await buscarXmlMeuDanfe(chave);

  if (!xml && cnpjSugestao) {
    origem = 'sefaz';
    xml = await buscarXmlSefaz(cnpjSugestao, chave);
  }

  if (!xml) {
    console.log(`  ❌ [${chave}] Não foi possível obter XML nem no MeuDanfe nem na SEFAZ.`);
    return false;
  }

  const json = parser.parse(xml);
  const inf =
    json?.nfeProc?.NFe?.infNFe ??
    json?.NFe?.infNFe;
  if (!inf) {
    console.log(`  ❌ [${chave}] XML não possui infNFe.`);
    return false;
  }

  const destCnpj = String(inf.dest?.CNPJ ?? inf.dest?.CPF ?? cnpjSugestao ?? '').replace(/\D/g, '');
  const empresaDb = cnpjsMap.get(destCnpj) || cnpjsMap.get(cnpjSugestao);
  if (!empresaDb) {
    console.log(`  ⚠️ [${chave}] Empresa destinatária ${destCnpj} não encontrada no banco!`);
    return false;
  }

  const dados = processarDocumento({ nsu: '', schema: 'procNFe_v4.00', xml }, destCnpj);
  if (!dados) {
    console.log(`  ❌ [${chave}] Falha no processarDocumento.`);
    return false;
  }

  if (!ja) {
    const criada = await prisma.notaFiscal.create({
      data: {
        ...dados,
        cnpjId: empresaDb.id,
      },
    });
    console.log(`  ✅ [${chave}] CRIADA via ${origem}! NF ${dados.numero} - ${dados.emitenteNome} - R$ ${dados.valorTotal} (ID ${criada.id}, Empresa: ${empresaDb.cnpj})`);
  } else {
    const { status, chave: _, ...campos } = dados;
    const atualizada = await prisma.notaFiscal.update({
      where: { chave },
      data: { ...campos, status },
    });
    console.log(`  ✅ [${chave}] ATUALIZADA para COMPLETA via ${origem}! NF ${dados.numero} (ID ${atualizada.id})`);
  }
  return true;
}

async function main() {
  const cnpjs = await prisma.cnpj.findMany();
  const cnpjsMap = new Map(cnpjs.map((c) => [c.cnpj.replace(/\D/g, ''), c]));

  let chavesParaProcessar = [];

  if (process.argv[2]) {
    chavesParaProcessar = process.argv.slice(2).map((c) => ({ chave: c }));
  } else {
    console.log('Detectando todas as notas faltantes no ERP nos últimos 30 dias...');
    const { getFaltantes } = require('./obter_faltantes_30d.js');
    chavesParaProcessar = await getFaltantes();
  }

  console.log(`Iniciando importação de ${chavesParaProcessar.length} notas...`);
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < chavesParaProcessar.length; i++) {
    const item = chavesParaProcessar[i];
    console.log(`\n[${i + 1}/${chavesParaProcessar.length}] Processando chave: ${item.chave}...`);
    try {
      const sucesso = await processarUmaChave(item.chave, item.cnpj || '45998339000167', cnpjsMap);
      if (sucesso) ok++;
      else fail++;
    } catch (e) {
      console.error(`  Erro na chave ${item.chave}:`, e.message);
      fail++;
    }
    await sleep(1000);
  }

  console.log('\n========================================');
  console.log(`FINALIZADO: ${ok} notas importadas com sucesso, ${fail} falhas.`);
  console.log('========================================');
}

if (require.main === module) {
  main()
    .catch((e) => console.error('FATAL:', e))
    .finally(() => prisma.$disconnect());
}

module.exports = { processarUmaChave, buscarXmlMeuDanfe, buscarXmlSefaz };
