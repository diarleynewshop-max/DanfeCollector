import * as https from 'https';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { obterPemDoCertificado } from './assinatura';
import { CODIGO_UF } from './distribuicao';

const ENDPOINT_PRODUCAO = 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx';
const ENDPOINT_HOMOLOGACAO = 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx';

export interface DocumentoCteDFe {
  nsu: string;
  schema: string;
  xml: string;
}

export interface RetornoDistribuicaoCte {
  cStat: number;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documentos: DocumentoCteDFe[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function montarEnvelope(tpAmb: number, cUFAutor: number, cnpj: string, ultNSU: string): string {
  const nsuPad = ultNSU.padStart(15, '0');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    '<cteDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe">' +
    '<cteDadosMsg>' +
    '<distDFeInt xmlns="http://www.portalfiscal.inf.br/cte" versao="1.00">' +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${nsuPad}</ultNSU></distNSU>` +
    '</distDFeInt>' +
    '</cteDadosMsg>' +
    '</cteDistDFeInteresse>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

function requisicaoSoap(url: string, body: string, cnpj: string): Promise<string> {
  const { privateKeyPem, certificatePem } = obterPemDoCertificado(cnpj);
  const { hostname, pathname } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        key: privateKeyPem,
        cert: certificatePem,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const texto = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`SEFAZ CT-e HTTP ${res.statusCode}: ${texto.slice(0, 300)}`));
          } else {
            resolve(texto);
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na comunicacao com a SEFAZ CT-e (60s).'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function consultarDistribuicaoCteDFe(
  cnpj: string,
  uf: string,
  ultNSU: string,
  homologacao = false,
): Promise<RetornoDistribuicaoCte> {
  const cUF = CODIGO_UF[uf.toUpperCase()];
  if (!cUF) throw new Error(`UF desconhecida: ${uf}`);

  const tpAmb = homologacao ? 2 : 1;
  const endpoint = homologacao ? ENDPOINT_HOMOLOGACAO : ENDPOINT_PRODUCAO;
  const envelope = montarEnvelope(tpAmb, cUF, cnpj, ultNSU);
  const respostaXml = await requisicaoSoap(endpoint, envelope, cnpj);
  return parseRetornoCte(respostaXml, ultNSU);
}

function parseRetornoCte(respostaXml: string, ultNSUFallback: string): RetornoDistribuicaoCte {
  const json = parser.parse(respostaXml);
  const ret =
    json?.Envelope?.Body?.cteDistDFeInteresseResponse?.cteDistDFeInteresseResult?.retDistDFeInt ??
    json?.Envelope?.Body?.cteDistDFeInteresseResponse?.cteDistDFeInteresseResult?.retDistDFeInt;

  if (!ret) {
    throw new Error(`Resposta inesperada da SEFAZ CT-e: ${respostaXml.slice(0, 300)}`);
  }

  const documentos: DocumentoCteDFe[] = [];
  const lote = ret.loteDistDFeInt?.docZip;
  if (lote) {
    const itens = Array.isArray(lote) ? lote : [lote];
    for (const item of itens) {
      const conteudo = typeof item === 'string' ? item : item['#text'];
      const xml = zlib.gunzipSync(Buffer.from(conteudo, 'base64')).toString('utf8');
      documentos.push({
        nsu: String(item['@_NSU'] ?? ''),
        schema: String(item['@_schema'] ?? ''),
        xml,
      });
    }
  }

  return {
    cStat: Number(ret.cStat),
    xMotivo: String(ret.xMotivo ?? ''),
    ultNSU: String(ret.ultNSU ?? ultNSUFallback),
    maxNSU: String(ret.maxNSU ?? '0'),
    documentos,
  };
}
