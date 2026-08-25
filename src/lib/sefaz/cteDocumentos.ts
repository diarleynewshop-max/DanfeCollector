import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { DocumentoCteDFe } from './cteDistribuicao';
import {
  bucketXmlDanfe,
  salvarObjetoSupabase,
  storageSupabaseConfigurado,
} from '../supabaseStorage';

type Registro = Record<string, unknown>;

export interface CteExtraido {
  chave: string;
  nsu: string;
  numero?: string;
  serie?: string;
  emitidaEm: Date;
  naturezaOp?: string;
  cfop?: string;
  status: 'RESUMO' | 'COMPLETO';
  situacaoSefaz: 'AUTORIZADO' | 'CANCELADO' | 'DENEGADO';
  emitenteNome?: string;
  emitenteCnpj?: string;
  emitenteIe?: string;
  emitenteUf?: string;
  tomadorNome?: string;
  tomadorCnpj?: string;
  remetenteNome?: string;
  remetenteCnpj?: string;
  destinatarioNome?: string;
  destinatarioCnpj?: string;
  valorTotal?: number;
  valorPrestacao?: number;
  valorCarga?: number;
  nfeChaves: string[];
  xmlPath: string;
  xmlStorageKey: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function registro(valor: unknown): Registro {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : {};
}

function array<T>(valor: T | T[] | undefined | null): T[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function texto(valor: unknown): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined;
  return String(valor).trim() || undefined;
}

function numero(valor: unknown): number | undefined {
  const raw = texto(valor);
  if (!raw) return undefined;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function data(valor: unknown): Date {
  const raw = texto(valor);
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function documentoPessoa(entidade: Registro): { nome?: string; cnpj?: string } {
  return {
    nome: texto(entidade.xNome),
    cnpj: texto(entidade.CNPJ ?? entidade.CPF),
  };
}

function pastaDestino(cnpj: string, dataEmissao: Date): string {
  const base = process.env.DOWNLOAD_PATH || './downloads';
  const ano = String(dataEmissao.getFullYear());
  const mes = String(dataEmissao.getMonth() + 1).padStart(2, '0');
  return path.resolve(process.cwd(), base, cnpj, ano, mes);
}

function chaveStorageXml(cnpj: string, dataEmissao: Date, nomeArquivo: string): string {
  const ano = String(dataEmissao.getFullYear());
  const mes = String(dataEmissao.getMonth() + 1).padStart(2, '0');
  return `downloads/${cnpj}/${ano}/${mes}/${nomeArquivo}`;
}

async function salvarXmlComFallback(
  destino: string,
  xmlPath: string,
  storageKey: string,
  xml: string,
): Promise<string | null> {
  const storageConfigurado = storageSupabaseConfigurado();
  let salvoNoDisco = false;
  let erroDisco: unknown = null;
  try {
    await fs.promises.mkdir(destino, { recursive: true });
    await fs.promises.writeFile(xmlPath, xml, 'utf8');
    salvoNoDisco = true;
  } catch (erro) {
    erroDisco = erro;
  }

  let salvoNoStorage = false;
  let erroStorage: unknown = null;
  try {
    salvoNoStorage = await salvarObjetoSupabase(
      bucketXmlDanfe(),
      storageKey,
      Buffer.from(xml, 'utf8'),
      'application/xml',
    );
  } catch (erro) {
    erroStorage = erro;
  }

  if (storageConfigurado && !salvoNoStorage) {
    const detalhe = erroStorage instanceof Error ? erroStorage.message : 'falha no upload';
    throw new Error(`Nao foi possivel salvar o XML CT-e no Storage configurado: ${detalhe}`);
  }

  if (!salvoNoDisco && !salvoNoStorage) {
    const detalheDisco = erroDisco instanceof Error ? erroDisco.message : 'falha no disco';
    const detalheStorage = erroStorage instanceof Error ? erroStorage.message : 'Storage indisponivel ou nao configurado';
    throw new Error(`Nao foi possivel salvar o XML CT-e: ${detalheDisco}; ${detalheStorage}`);
  }

  return salvoNoStorage ? storageKey : null;
}

function extrairChavesNfe(infCte: Registro): string[] {
  const infCteNorm = registro(infCte.infCTeNorm);
  const infDoc = registro(infCteNorm.infDoc);
  const chaves = new Set<string>();
  for (const item of array(infDoc.infNFe)) {
    const chave = texto(registro(item).chave ?? registro(item).chNFe);
    if (chave && /^\d{44}$/.test(chave)) chaves.add(chave);
  }
  return [...chaves];
}

function tomadorCte(infCte: Registro): { nome?: string; cnpj?: string } {
  const ide = registro(infCte.ide);
  const toma4 = registro(ide.toma4);
  if (Object.keys(toma4).length > 0) return documentoPessoa(toma4);

  const toma = texto(registro(ide.toma3).toma);
  const mapa: Record<string, Registro> = {
    '0': registro(infCte.rem),
    '1': registro(infCte.exped),
    '2': registro(infCte.receb),
    '3': registro(infCte.dest),
  };
  return toma && mapa[toma] ? documentoPessoa(mapa[toma]) : {};
}

export async function processarDocumentoCte(doc: DocumentoCteDFe, cnpjInteressado: string): Promise<CteExtraido | null> {
  const json = parser.parse(doc.xml);

  if (doc.schema.startsWith('resCTe')) {
    const res = registro(json.resCTe);
    const chave = texto(res.chCTe);
    if (!chave) return null;
    const emitidaEm = data(res.dhEmi);
    const destino = pastaDestino(cnpjInteressado, emitidaEm);
    const arquivoXml = `${chave}-res-cte.xml`;
    const xmlPath = path.join(destino, arquivoXml);
    const xmlStorageKey = await salvarXmlComFallback(
      destino,
      xmlPath,
      chaveStorageXml(cnpjInteressado, emitidaEm, arquivoXml),
      doc.xml,
    );

    return {
      chave,
      nsu: doc.nsu,
      emitidaEm,
      status: 'RESUMO',
      situacaoSefaz: 'AUTORIZADO',
      emitenteNome: texto(res.xNome),
      emitenteCnpj: texto(res.CNPJ ?? res.CPF),
      emitenteIe: texto(res.IE),
      valorTotal: numero(res.vPrest ?? res.vTPrest),
      nfeChaves: [],
      xmlPath,
      xmlStorageKey,
    };
  }

  if (doc.schema.startsWith('procCTe')) {
    const proc = registro(json.cteProc ?? json.procCTe);
    const cte = registro(proc.CTe ?? json.CTe);
    const inf = registro(cte.infCte);
    if (Object.keys(inf).length === 0) return null;

    const chave = texto(registro(proc.protCTe).infProt && registro(registro(proc.protCTe).infProt).chCTe)
      ?? texto(inf['@_Id'])?.replace(/^CTe/, '')
      ?? '';
    if (!chave) return null;

    const ide = registro(inf.ide);
    const emit = registro(inf.emit);
    const rem = documentoPessoa(registro(inf.rem));
    const dest = documentoPessoa(registro(inf.dest));
    const toma = tomadorCte(inf);
    const vPrest = registro(inf.vPrest);
    const infCarga = registro(registro(inf.infCTeNorm).infCarga);
    const emitidaEm = data(ide.dhEmi ?? ide.dEmi);
    const destino = pastaDestino(cnpjInteressado, emitidaEm);
    const arquivoXml = `${chave}-cte.xml`;
    const xmlPath = path.join(destino, arquivoXml);
    const xmlStorageKey = await salvarXmlComFallback(
      destino,
      xmlPath,
      chaveStorageXml(cnpjInteressado, emitidaEm, arquivoXml),
      doc.xml,
    );
    const cStat = Number(registro(registro(proc.protCTe).infProt).cStat ?? 100);

    return {
      chave,
      nsu: doc.nsu,
      numero: texto(ide.nCT),
      serie: texto(ide.serie),
      emitidaEm,
      naturezaOp: texto(ide.natOp),
      cfop: texto(ide.CFOP),
      status: 'COMPLETO',
      situacaoSefaz: cStat === 110 ? 'DENEGADO' : 'AUTORIZADO',
      emitenteNome: texto(emit.xNome),
      emitenteCnpj: texto(emit.CNPJ ?? emit.CPF),
      emitenteIe: texto(emit.IE),
      emitenteUf: texto(registro(emit.enderEmit).UF),
      tomadorNome: toma.nome,
      tomadorCnpj: toma.cnpj,
      remetenteNome: rem.nome,
      remetenteCnpj: rem.cnpj,
      destinatarioNome: dest.nome,
      destinatarioCnpj: dest.cnpj,
      valorTotal: numero(vPrest.vTPrest),
      valorPrestacao: numero(vPrest.vTPrest),
      valorCarga: numero(infCarga.vCarga),
      nfeChaves: extrairChavesNfe(inf),
      xmlPath,
      xmlStorageKey,
    };
  }

  const emitidaEm = new Date();
  const destino = pastaDestino(cnpjInteressado, emitidaEm);
  const arquivoXml = `NSU-${doc.nsu}-${doc.schema.split('_')[0]}-cte.xml`;
  await salvarXmlComFallback(
    destino,
    path.join(destino, arquivoXml),
    chaveStorageXml(cnpjInteressado, emitidaEm, arquivoXml),
    doc.xml,
  );
  return null;
}

export function interpretarEventoCancelamentoCte(xml: string): { chave: string; dhEvento: string } | null {
  if (!xml.includes('110111')) return null;
  const json = parser.parse(xml);
  const inf = registro(registro(registro(json.procEventoCTe).evento).infEvento ?? registro(json.evento).infEvento);
  if (texto(inf.tpEvento) !== '110111') return null;
  const chave = texto(inf.chCTe);
  if (!chave) return null;
  return { chave, dhEvento: texto(inf.dhEvento) ?? '' };
}
