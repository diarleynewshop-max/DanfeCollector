"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODIGO_UF = void 0;
exports.consultarDistribuicaoDFe = consultarDistribuicaoDFe;
const https = __importStar(require("https"));
const zlib = __importStar(require("zlib"));
const fast_xml_parser_1 = require("fast-xml-parser");
const certificado_1 = require("./certificado");
// Distribuição DFe é um serviço do Ambiente Nacional (AN), não da SEFAZ estadual.
const ENDPOINT_PRODUCAO = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
const ENDPOINT_HOMOLOGACAO = 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
exports.CODIGO_UF = {
    AC: 12, AL: 27, AP: 16, AM: 13, BA: 29, CE: 23, DF: 53, ES: 32, GO: 52,
    MA: 21, MT: 51, MS: 50, MG: 31, PA: 15, PB: 25, PR: 41, PE: 26, PI: 22,
    RJ: 33, RN: 24, RS: 43, RO: 11, RR: 14, SC: 42, SP: 35, SE: 28, TO: 17,
};
const parser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
});
function montarEnvelope(tpAmb, cUFAutor, cnpj, ultNSU) {
    const nsuPad = ultNSU.padStart(15, '0');
    return ('<?xml version="1.0" encoding="utf-8"?>' +
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
        '</soap12:Envelope>');
}
function requisicaoSoap(url, body) {
    const { pfx, passphrase } = (0, certificado_1.carregarCertificado)();
    const { hostname, pathname } = new URL(url);
    return new Promise((resolve, reject) => {
        const req = https.request({
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
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const texto = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode !== 200) {
                    reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${texto.slice(0, 300)}`));
                }
                else {
                    resolve(texto);
                }
            });
        });
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
async function consultarDistribuicaoDFe(cnpj, uf, ultNSU, homologacao = false) {
    const cUF = exports.CODIGO_UF[uf.toUpperCase()];
    if (!cUF)
        throw new Error(`UF desconhecida: ${uf}`);
    const tpAmb = homologacao ? 2 : 1;
    const endpoint = homologacao ? ENDPOINT_HOMOLOGACAO : ENDPOINT_PRODUCAO;
    const envelope = montarEnvelope(tpAmb, cUF, cnpj, ultNSU);
    const respostaXml = await requisicaoSoap(endpoint, envelope);
    const json = parser.parse(respostaXml);
    // Caminho: Envelope > Body > nfeDistDFeInteresseResponse > nfeDistDFeInteresseResult > retDistDFeInt
    const ret = json?.Envelope?.Body?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;
    if (!ret) {
        throw new Error(`Resposta inesperada da SEFAZ: ${respostaXml.slice(0, 300)}`);
    }
    const documentos = [];
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
        ultNSU: String(ret.ultNSU ?? ultNSU),
        maxNSU: String(ret.maxNSU ?? '0'),
        documentos,
    };
}
