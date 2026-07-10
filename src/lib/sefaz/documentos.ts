import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { DocumentoDFe } from './distribuicao';

export interface NotaExtraida {
  chave: string;
  nsu: string;
  numero?: string;
  serie?: string;
  emitidaEm: Date;
  tipoOperacao?: string;
  naturezaOp?: string;
  emitenteNome?: string;
  emitenteCnpj?: string;
  emitenteIe?: string;
  emitenteUf?: string;
  destNome?: string;
  destCnpj?: string;
  valorTotal?: number;
  valorProdutos?: number;
  valorFrete?: number;
  valorDesconto?: number;
  valorIcms?: number;
  modalidadeFrete?: string;
  transportadoraNome?: string;
  transportadoraCnpj?: string;
  transportadoraIe?: string;
  transportadoraUf?: string;
  transportadoraMunicipio?: string;
  qtdItens?: number;
  status: 'RESUMO' | 'COMPLETA';
  situacaoSefaz: 'AUTORIZADA' | 'DENEGADA';
  xmlPath: string;
}

export interface TransporteExtraido {
  valorFrete?: number;
  modalidadeFrete?: string;
  transportadoraNome?: string;
  transportadoraCnpj?: string;
  transportadoraIe?: string;
  transportadoraUf?: string;
  transportadoraMunicipio?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function pastaDestino(cnpj: string, data: Date): string {
  const base = process.env.DOWNLOAD_PATH || './downloads';
  const ano = String(data.getFullYear());
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const destino = path.resolve(process.cwd(), base, cnpj, ano, mes);
  fs.mkdirSync(destino, { recursive: true });
  return destino;
}

function tipoOperacao(tpNF: unknown): string | undefined {
  if (tpNF === undefined || tpNF === null || tpNF === '') return undefined;
  return String(tpNF) === '0' ? 'Entrada' : 'Saída';
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

const MOD_FRETE: Record<string, string> = {
  '0': '0 - Por conta do emitente',
  '1': '1 - Por conta do destinatario',
  '2': '2 - Por conta de terceiros',
  '3': '3 - Transporte proprio (remetente)',
  '4': '4 - Transporte proprio (destinatario)',
  '9': '9 - Sem frete',
};

function modalidadeFrete(v: unknown): string | undefined {
  const codigo = str(v);
  if (!codigo) return undefined;
  return MOD_FRETE[codigo] ?? codigo;
}

function extrairTransporteInf(inf: Record<string, unknown>): TransporteExtraido {
  const transp = obj(inf.transp);
  const transporta = obj(transp.transporta);

  return {
    valorFrete: num(obj(obj(inf.total).ICMSTot).vFrete),
    modalidadeFrete: modalidadeFrete(transp.modFrete),
    transportadoraNome: str(transporta.xNome),
    transportadoraCnpj: str(transporta.CNPJ ?? transporta.CPF),
    transportadoraIe: str(transporta.IE),
    transportadoraUf: str(transporta.UF),
    transportadoraMunicipio: str(transporta.xMun),
  };
}

export function extrairTransporteXml(xml: string): TransporteExtraido | null {
  const json = parser.parse(xml);
  const inf =
    obj(obj(obj(json).nfeProc).NFe).infNFe ??
    obj(obj(json).NFe).infNFe;
  const infObj = obj(inf);
  if (Object.keys(infObj).length === 0) return null;
  return extrairTransporteInf(infObj);
}

/**
 * Detecta um evento de Ciência da Operação (tpEvento 210210) num documento da
 * Distribuição DFe. Retorna a chave da NF-e e o CNPJ de quem manifestou, para
 * que possamos marcar a nota como já manifestada e nunca declarar Ciência 2x.
 */
export function interpretarEventoCiencia(
  xml: string
): { chave: string; cnpjAutor: string; dhEvento: string } | null {
  if (!xml.includes('210210')) return null; // atalho: só parseia se for plausível
  const json = parser.parse(xml);
  const inf = json?.procEventoNFe?.evento?.infEvento ?? json?.evento?.infEvento;
  if (!inf || String(inf.tpEvento) !== '210210') return null;
  return {
    chave: String(inf.chNFe ?? ''),
    cnpjAutor: String(inf.CNPJ ?? ''),
    dhEvento: String(inf.dhEvento ?? ''),
  };
}

/**
 * Detecta um evento de cancelamento (tpEvento 110111) num documento da
 * Distribuição DFe. Retorna a chave da NF-e para marcar como CANCELADA.
 */
export function interpretarEventoCancelamento(
  xml: string
): { chave: string; dhEvento: string } | null {
  if (!xml.includes('110111')) return null;
  const json = parser.parse(xml);
  const inf = json?.procEventoNFe?.evento?.infEvento ?? json?.evento?.infEvento;
  if (!inf || String(inf.tpEvento) !== '110111') return null;
  return {
    chave: String(inf.chNFe ?? ''),
    dhEvento: String(inf.dhEvento ?? ''),
  };
}

/**
 * Interpreta um documento da Distribuição DFe (resumo ou nota completa) e grava o XML.
 * Extrai todos os campos do cabeçalho da NF-e — exceto os produtos/itens (det).
 * Retorna null para schemas que não são notas (eventos, etc.).
 */
export function processarDocumento(doc: DocumentoDFe, cnpjInteressado: string): NotaExtraida | null {
  const json = parser.parse(doc.xml);

  // Resumo de NF-e (resNFe): dados limitados que a SEFAZ libera antes da manifestação
  if (doc.schema.startsWith('resNFe')) {
    const res = json.resNFe;
    if (!res) return null;
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
      situacaoSefaz: 'AUTORIZADA',
      xmlPath,
    };
  }

  // NF-e completa (procNFe): XML integral autorizado — todo o cabeçalho disponível
  if (doc.schema.startsWith('procNFe')) {
    const inf = json.nfeProc?.NFe?.infNFe;
    if (!inf) return null;
    const chave = String(
      json.nfeProc?.protNFe?.infProt?.chNFe ?? inf['@_Id']?.replace(/^NFe/, '') ?? ''
    );
    const emitidaEm = new Date(inf.ide?.dhEmi ?? inf.ide?.dEmi);
    const destino = pastaDestino(cnpjInteressado, emitidaEm);
    const xmlPath = path.join(destino, `${chave}.xml`);
    fs.writeFileSync(xmlPath, doc.xml, 'utf8');

    const dest = inf.dest ?? {};
    const tot = inf.total?.ICMSTot ?? {};
    const transporte = extrairTransporteInf(inf);
    const detRaw = inf.det ?? [];
    const qtdItens = Array.isArray(detRaw) ? detRaw.length : detRaw ? 1 : 0;
    // cStat 110 = Uso Denegado (nota DENEGADA pela SEFAZ, não autorizada)
    const cStatProt = Number(json.nfeProc?.protNFe?.infProt?.cStat ?? 100);
    const situacaoSefaz: 'AUTORIZADA' | 'DENEGADA' = cStatProt === 110 ? 'DENEGADA' : 'AUTORIZADA';

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
      valorFrete: transporte.valorFrete,
      valorDesconto: num(tot.vDesc),
      valorIcms: num(tot.vICMS),
      modalidadeFrete: transporte.modalidadeFrete,
      transportadoraNome: transporte.transportadoraNome,
      transportadoraCnpj: transporte.transportadoraCnpj,
      transportadoraIe: transporte.transportadoraIe,
      transportadoraUf: transporte.transportadoraUf,
      transportadoraMunicipio: transporte.transportadoraMunicipio,
      qtdItens,
      status: 'COMPLETA',
      situacaoSefaz,
      xmlPath,
    };
  }

  // Outros schemas (resEvento, procEventoNFe...): grava para auditoria, sem registro de nota
  const destino = pastaDestino(cnpjInteressado, new Date());
  fs.writeFileSync(path.join(destino, `NSU-${doc.nsu}-${doc.schema.split('_')[0]}.xml`), doc.xml, 'utf8');
  return null;
}
