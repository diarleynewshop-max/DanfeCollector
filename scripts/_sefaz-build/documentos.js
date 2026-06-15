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
exports.interpretarEventoCiencia = interpretarEventoCiencia;
exports.processarDocumento = processarDocumento;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fast_xml_parser_1 = require("fast-xml-parser");
const parser = new fast_xml_parser_1.XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
});
function pastaDestino(cnpj, data) {
    const base = process.env.DOWNLOAD_PATH || './downloads';
    const ano = String(data.getFullYear());
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const destino = path.resolve(process.cwd(), base, cnpj, ano, mes);
    fs.mkdirSync(destino, { recursive: true });
    return destino;
}
function tipoOperacao(tpNF) {
    if (tpNF === undefined || tpNF === null || tpNF === '')
        return undefined;
    return String(tpNF) === '0' ? 'Entrada' : 'Saída';
}
function num(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function str(v) {
    if (v === undefined || v === null || v === '')
        return undefined;
    return String(v);
}
/**
 * Detecta um evento de Ciência da Operação (tpEvento 210210) num documento da
 * Distribuição DFe. Retorna a chave da NF-e e o CNPJ de quem manifestou, para
 * que possamos marcar a nota como já manifestada e nunca declarar Ciência 2x.
 */
function interpretarEventoCiencia(xml) {
    if (!xml.includes('210210'))
        return null; // atalho: só parseia se for plausível
    const json = parser.parse(xml);
    const inf = json?.procEventoNFe?.evento?.infEvento ?? json?.evento?.infEvento;
    if (!inf || String(inf.tpEvento) !== '210210')
        return null;
    return {
        chave: String(inf.chNFe ?? ''),
        cnpjAutor: String(inf.CNPJ ?? ''),
        dhEvento: String(inf.dhEvento ?? ''),
    };
}
/**
 * Interpreta um documento da Distribuição DFe (resumo ou nota completa) e grava o XML.
 * Extrai todos os campos do cabeçalho da NF-e — exceto os produtos/itens (det).
 * Retorna null para schemas que não são notas (eventos, etc.).
 */
function processarDocumento(doc, cnpjInteressado) {
    const json = parser.parse(doc.xml);
    // Resumo de NF-e (resNFe): dados limitados que a SEFAZ libera antes da manifestação
    if (doc.schema.startsWith('resNFe')) {
        const res = json.resNFe;
        if (!res)
            return null;
        const emitidaEm = new Date(res.dhEmi);
        const destino = pastaDestino(cnpjInteressado, emitidaEm);
        const xmlPath = path.join(destino, `${res.chNFe}-res.xml`);
        fs.writeFileSync(xmlPath, doc.xml, 'utf8');
        return {
            chave: String(res.chNFe),
            nsu: doc.nsu,
            emitidaEm,
            tipoOperacao: tipoOperacao(res.tpNF),
            emitenteNome: str(res.xNome),
            emitenteCnpj: str(res.CNPJ),
            emitenteIe: str(res.IE),
            valorTotal: num(res.vNF),
            status: 'RESUMO',
            xmlPath,
        };
    }
    // NF-e completa (procNFe): XML integral autorizado — todo o cabeçalho disponível
    if (doc.schema.startsWith('procNFe')) {
        const inf = json.nfeProc?.NFe?.infNFe;
        if (!inf)
            return null;
        const chave = String(json.nfeProc?.protNFe?.infProt?.chNFe ?? inf['@_Id']?.replace(/^NFe/, '') ?? '');
        const emitidaEm = new Date(inf.ide?.dhEmi ?? inf.ide?.dEmi);
        const destino = pastaDestino(cnpjInteressado, emitidaEm);
        const xmlPath = path.join(destino, `${chave}.xml`);
        fs.writeFileSync(xmlPath, doc.xml, 'utf8');
        const dest = inf.dest ?? {};
        const tot = inf.total?.ICMSTot ?? {};
        return {
            chave,
            nsu: doc.nsu,
            numero: str(inf.ide?.nNF),
            serie: str(inf.ide?.serie),
            emitidaEm,
            tipoOperacao: tipoOperacao(inf.ide?.tpNF),
            naturezaOp: str(inf.ide?.natOp),
            emitenteNome: str(inf.emit?.xNome),
            emitenteCnpj: str(inf.emit?.CNPJ ?? inf.emit?.CPF),
            emitenteIe: str(inf.emit?.IE),
            emitenteUf: str(inf.emit?.enderEmit?.UF),
            destNome: str(dest.xNome),
            destCnpj: str(dest.CNPJ ?? dest.CPF),
            valorTotal: num(tot.vNF),
            valorProdutos: num(tot.vProd),
            valorFrete: num(tot.vFrete),
            valorDesconto: num(tot.vDesc),
            valorIcms: num(tot.vICMS),
            status: 'COMPLETA',
            xmlPath,
        };
    }
    // Outros schemas (resEvento, procEventoNFe...): grava para auditoria, sem registro de nota
    const destino = pastaDestino(cnpjInteressado, new Date());
    fs.writeFileSync(path.join(destino, `NSU-${doc.nsu}-${doc.schema.split('_')[0]}.xml`), doc.xml, 'utf8');
    return null;
}
