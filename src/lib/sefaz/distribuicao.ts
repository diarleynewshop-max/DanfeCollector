import * as https from 'https';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { carregarCertificado } from './certificado';

// Distribuição DFe é um serviço do Ambiente Nacional (AN), não da SEFAZ estadual.
const ENDPOINT_PRODUCAO = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const ENDPOINT_HOMOLOGACAO = 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

export const CODIGO_UF: Record<string, number> = {
  AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
  MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
  RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};

export interface DocumentoDFe {
  nsu: string;
  schema: string;
  xml: string;
}

export interface RetornoDistribuicao {
  cStat: number;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  documentos: DocumentoDFe[];
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
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
    '<nfeDadosMsg>' +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<distNSU><ultNSU>${nsuPad}</ultNSU></distNSU>` +
    '</distDFeInt>' +
    '</nfeDadosMsg>' +
    '</nfeDistDFeInteresse>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

function requisicaoSoap(url: string, body: string): Promise<string> {
  const { pfx, passphrase } = carregarCertificado();
  const { hostname, pathname } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        pfx,
        passphrase,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${texto.slice(0, 300)}`));
          } else {
            resolve(texto);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na comunicação com a SEFAZ (60s).'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Consulta a Distribuição DFe do Ambiente Nacional para um CNPJ a partir do último NSU.
 * Retorna os documentos já descompactados (docZip é gzip + base64).
 */
export async function consultarDistribuicaoDFe(
  cnpj: string,
  uf: string,
  ultNSU: string,
  homologacao = false
): Promise<RetornoDistribuicao> {
  const cUF = CODIGO_UF[uf.toUpperCase()];
  if (!cUF) throw new Error(`UF desconhecida: ${uf}`);

  const tpAmb = homologacao ? 2 : 1;
  const endpoint = homologacao ? ENDPOINT_HOMOLOGACAO : ENDPOINT_PRODUCAO;
  const envelope = montarEnvelope(tpAmb, cUF, cnpj, ultNSU);

  const respostaXml = await requisicaoSoap(endpoint, envelope);
  return parseRetorno(respostaXml, ultNSU);
}

function montarEnvelopeChave(tpAmb: number, cUFAutor: number, cnpj: string, chave: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">' +
    '<nfeDadosMsg>' +
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<consChNFe><chNFe>${chave}</chNFe></consChNFe>` +
    '</distDFeInt>' +
    '</nfeDadosMsg>' +
    '</nfeDistDFeInteresse>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

/**
 * Consulta uma NF-e específica pela chave de acesso (consChNFe). Não depende do
 * NSU — funciona mesmo para notas antigas já consumidas. Retorna o XML completo
 * (procNFe) se o CNPJ tiver direito (manifestado/emitente) ou apenas o resumo.
 */
export async function consultarPorChave(
  cnpj: string,
  uf: string,
  chave: string,
  homologacao = false
): Promise<RetornoDistribuicao> {
  const cUF = CODIGO_UF[uf.toUpperCase()];
  if (!cUF) throw new Error(`UF desconhecida: ${uf}`);

  const tpAmb = homologacao ? 2 : 1;
  const endpoint = homologacao ? ENDPOINT_HOMOLOGACAO : ENDPOINT_PRODUCAO;
  const envelope = montarEnvelopeChave(tpAmb, cUF, cnpj, chave);

  const respostaXml = await requisicaoSoap(endpoint, envelope);
  return parseRetorno(respostaXml, '0');
}

function parseRetorno(respostaXml: string, ultNSUFallback: string): RetornoDistribuicao {
  const json = parser.parse(respostaXml);
  const ret =
    json?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;
  if (!ret) {
    throw new Error(`Resposta inesperada da SEFAZ: ${respostaXml.slice(0, 300)}`);
  }

  const documentos: DocumentoDFe[] = [];
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
