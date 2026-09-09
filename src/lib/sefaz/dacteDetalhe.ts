import { XMLParser } from 'fast-xml-parser';

export interface DacteEndereco {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  fone: string;
}

export interface DactePessoa {
  nome: string;
  cnpjCpf: string;
  ie: string;
  endereco: DacteEndereco;
}

export interface DacteComponente {
  nome: string;
  valor: number;
}

export interface DacteData {
  chave: string;
  numero: string;
  serie: string;
  modelo: string;
  tpCTe: string;
  natOp: string;
  cfop: string;
  modal: string;
  tpServico: string;
  dhEmi: string;
  municipioIni: string;
  ufIni: string;
  municipioFim: string;
  ufFim: string;
  protocolo: string;
  dhProt: string;
  situacao: string;
  emit: DactePessoa & { fantasia: string };
  rem: DactePessoa;
  dest: DactePessoa;
  exped: DactePessoa | null;
  receb: DactePessoa | null;
  tomador: { descricao: string; pessoa: DactePessoa | null };
  vPrest: { total: number; receber: number; componentes: DacteComponente[] };
  icms: { cst: string; vBC: number; pICMS: number; vICMS: number; situacao: string };
  carga: { produtoPredominante: string; valorCarga: number; pesoBrutoKg: number | null };
  nfeChaves: string[];
  rntrc: string;
  obs: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function array<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

const MODAL: Record<string, string> = {
  '01': 'Rodoviário', '02': 'Aéreo', '03': 'Aquaviário', '04': 'Ferroviário', '05': 'Dutoviário', '06': 'Multimodal',
};
const TIPO_SERVICO: Record<string, string> = {
  '0': 'Normal', '1': 'Subcontratação', '2': 'Redespacho', '3': 'Redespacho Intermediário', '4': 'Multimodal',
};
const TIPO_CTE: Record<string, string> = {
  '0': 'Normal', '1': 'Complemento de Valores', '2': 'Anulação', '3': 'Substituto',
};

function endereco(ender: Record<string, unknown>): DacteEndereco {
  return {
    logradouro: s(ender.xLgr),
    numero: s(ender.nro),
    bairro: s(ender.xBairro),
    municipio: s(ender.xMun),
    uf: s(ender.UF),
    cep: s(ender.CEP),
    fone: s(ender.fone),
  };
}

function pessoa(bloco: Record<string, unknown>, chaveEndereco: string): DactePessoa {
  return {
    nome: s(bloco.xNome),
    cnpjCpf: s(bloco.CNPJ || bloco.CPF),
    ie: s(bloco.IE),
    endereco: endereco(obj(bloco[chaveEndereco])),
  };
}

function pessoaOuNull(bloco: Record<string, unknown>, chaveEndereco: string): DactePessoa | null {
  if (Object.keys(bloco).length === 0) return null;
  return pessoa(bloco, chaveEndereco);
}

function tomadorDoServico(ide: Record<string, unknown>, rem: Record<string, unknown>, dest: Record<string, unknown>, exped: Record<string, unknown>, receb: Record<string, unknown>): { descricao: string; pessoa: DactePessoa | null } {
  const toma4 = obj(ide.toma4);
  if (Object.keys(toma4).length > 0) {
    return { descricao: 'Outros (informado no CT-e)', pessoa: pessoa(toma4, 'enderToma') };
  }
  const toma3 = s(obj(ide.toma3).toma);
  const mapa: Record<string, { descricao: string; bloco: Record<string, unknown>; chave: string }> = {
    '0': { descricao: 'Remetente', bloco: rem, chave: 'enderReme' },
    '1': { descricao: 'Expedidor', bloco: exped, chave: 'enderExped' },
    '2': { descricao: 'Recebedor', bloco: receb, chave: 'enderReceb' },
    '3': { descricao: 'Destinatário', bloco: dest, chave: 'enderDest' },
  };
  const escolhido = mapa[toma3];
  if (!escolhido || Object.keys(escolhido.bloco).length === 0) return { descricao: '-', pessoa: null };
  return { descricao: escolhido.descricao, pessoa: pessoa(escolhido.bloco, escolhido.chave) };
}

function primeiroGrupoIcms(imp: Record<string, unknown>): { grupo: string; dados: Record<string, unknown> } {
  const icms = obj(imp.ICMS);
  for (const [grupo, dados] of Object.entries(icms)) {
    if (dados && typeof dados === 'object' && !Array.isArray(dados)) {
      return { grupo, dados: dados as Record<string, unknown> };
    }
  }
  return { grupo: '', dados: {} };
}

function pesoBrutoKg(infQ: Record<string, unknown>[]): number | null {
  const item = infQ.find((q) => /peso.*bruto|kg/i.test(s(q.tpMed)));
  return item ? n(item.qCarga) : null;
}

/**
 * Parseia o XML completo de um CT-e (procCTe) em uma estrutura pronta para o DACTE.
 * Retorna null se não for um CT-e completo (resumos não têm todos os dados).
 */
export function parseDacte(xml: string): DacteData | null {
  const json = parser.parse(xml);
  const proc = obj(json.cteProc ?? json.procCTe);
  const cte = obj(proc.CTe ?? json.CTe);
  const inf = obj(cte.infCte);
  if (Object.keys(inf).length === 0) return null;

  const ide = obj(inf.ide);
  const compl = obj(inf.compl);
  const emit = obj(inf.emit);
  const rem = obj(inf.rem);
  const dest = obj(inf.dest);
  const exped = obj(inf.exped);
  const receb = obj(inf.receb);
  const vPrestRaw = obj(inf.vPrest);
  const imp = obj(inf.imp);
  const infCTeNorm = obj(inf.infCTeNorm);
  const infCarga = obj(infCTeNorm.infCarga);
  const infModal = obj(infCTeNorm.infModal);
  const rodo = obj(infModal.rodo);
  const infProt = obj(proc.protCTe ? obj(proc.protCTe).infProt : undefined);

  const chave = s(infProt.chCTe) || s(inf['@_Id']).replace(/^CTe/, '');
  if (!chave) return null;

  const componentes: DacteComponente[] = array(vPrestRaw.Comp).map((c) => ({
    nome: s(obj(c).xNome),
    valor: n(obj(c).vComp),
  }));

  const { grupo, dados: icmsDados } = primeiroGrupoIcms(imp);
  const cst = grupo.replace(/^ICMS/, '') || s(icmsDados.CST);

  return {
    chave,
    numero: s(ide.nCT),
    serie: s(ide.serie),
    modelo: s(ide.mod),
    tpCTe: TIPO_CTE[s(ide.tpCTe)] ?? s(ide.tpCTe),
    natOp: s(ide.natOp),
    cfop: s(ide.CFOP),
    modal: MODAL[s(ide.modal)] ?? s(ide.modal),
    tpServico: TIPO_SERVICO[s(ide.tpServ)] ?? s(ide.tpServ),
    dhEmi: s(ide.dhEmi),
    municipioIni: s(ide.xMunIni),
    ufIni: s(ide.UFIni),
    municipioFim: s(ide.xMunFim),
    ufFim: s(ide.UFFim),
    protocolo: s(infProt.nProt),
    dhProt: s(infProt.dhRecbto),
    situacao: s(infProt.xMotivo),
    emit: { ...pessoa(emit, 'enderEmit'), fantasia: s(emit.xFant) },
    rem: pessoa(rem, 'enderReme'),
    dest: pessoa(dest, 'enderDest'),
    exped: pessoaOuNull(exped, 'enderExped'),
    receb: pessoaOuNull(receb, 'enderReceb'),
    tomador: tomadorDoServico(ide, rem, dest, exped, receb),
    vPrest: {
      total: n(vPrestRaw.vTPrest),
      receber: n(vPrestRaw.vRec),
      componentes,
    },
    icms: {
      cst,
      vBC: n(icmsDados.vBC),
      pICMS: n(icmsDados.pICMS),
      vICMS: n(icmsDados.vICMS),
      situacao: grupo === 'ICMSSN' ? 'Simples Nacional' : (grupo ? `CST ${cst}` : '-'),
    },
    carga: {
      produtoPredominante: s(infCarga.proPred),
      valorCarga: n(infCarga.vCarga),
      pesoBrutoKg: pesoBrutoKg(array(infCarga.infQ).map(obj)),
    },
    nfeChaves: array(obj(infCTeNorm.infDoc).infNFe).map((item) => s(obj(item).chave)).filter(Boolean),
    rntrc: s(rodo.RNTRC),
    obs: s(compl.xObs),
  };
}
