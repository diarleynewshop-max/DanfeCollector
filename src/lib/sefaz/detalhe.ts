import { XMLParser } from 'fast-xml-parser';

export interface DanfeItem {
  nItem: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  ean: string;
  vBC: number;
  pICMS: number;
  vICMS: number;
  vBCST: number;
  vICMSST: number;
}

export interface DanfeEndereco {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  fone: string;
}

export interface DanfeData {
  chave: string;
  numero: string;
  serie: string;
  modelo: string;
  natOp: string;
  tipoOperacao: string; // "Entrada" | "Saída"
  tpNF: string; // "0" | "1"
  dhEmi: string;
  dhSaiEnt: string;
  protocolo: string;
  dhProt: string;
  situacao: string;
  emit: {
    nome: string;
    fantasia: string;
    cnpj: string;
    ie: string;
    endereco: DanfeEndereco;
  };
  dest: {
    nome: string;
    cnpjCpf: string;
    ie: string;
    endereco: DanfeEndereco;
  };
  total: {
    vBC: number;
    vICMS: number;
    vBCST: number;
    vST: number;
    vProd: number;
    vFrete: number;
    vSeg: number;
    vDesc: number;
    vOutro: number;
    vIPI: number;
    vNF: number;
    vTotTrib: number;
  };
  transp: {
    modFrete: string;
    transportadora: string;
  };
  infAdic: string;
  itens: DanfeItem[];
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

const MOD_FRETE: Record<string, string> = {
  '0': '0 - Por conta do emitente',
  '1': '1 - Por conta do destinatário',
  '2': '2 - Por conta de terceiros',
  '3': '3 - Transporte próprio (remetente)',
  '4': '4 - Transporte próprio (destinatário)',
  '9': '9 - Sem frete',
};

function endereco(ender: Record<string, unknown> | undefined): DanfeEndereco {
  const e = ender ?? {};
  return {
    logradouro: s(e.xLgr),
    numero: s(e.nro),
    bairro: s(e.xBairro),
    municipio: s(e.xMun),
    uf: s(e.UF),
    cep: s(e.CEP),
    fone: s(e.fone),
  };
}

function primeiroGrupoIcms(imposto: Record<string, unknown> | undefined): Record<string, unknown> {
  const icms = imposto?.ICMS as Record<string, unknown> | undefined;
  if (!icms) return {};
  for (const valor of Object.values(icms)) {
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      return valor as Record<string, unknown>;
    }
  }
  return {};
}

/**
 * Parseia o XML de uma NF-e completa (procNFe) em uma estrutura pronta para a DANFE.
 * Retorna null se não for uma nota completa (resumos não têm itens).
 */
export function parseDanfe(xml: string): DanfeData | null {
  const json = parser.parse(xml);
  const inf = json?.nfeProc?.NFe?.infNFe ?? json?.NFe?.infNFe;
  if (!inf) return null;

  const ide = inf.ide ?? {};
  const emit = inf.emit ?? {};
  const dest = inf.dest ?? {};
  const tot = inf.total?.ICMSTot ?? {};
  const transp = inf.transp ?? {};
  const prot = json?.nfeProc?.protNFe?.infProt ?? {};

  const chave = s(prot.chNFe || s(inf['@_Id']).replace(/^NFe/, ''));

  const detRaw = inf.det ?? [];
  const dets = Array.isArray(detRaw) ? detRaw : [detRaw];
  const itens: DanfeItem[] = dets
    .filter((d: unknown) => d && (d as Record<string, unknown>).prod)
    .map((d: Record<string, unknown>) => {
      const p = d.prod as Record<string, unknown>;
      const icms = primeiroGrupoIcms(d.imposto as Record<string, unknown> | undefined);
      return {
        nItem: n(d['@_nItem']),
        codigo: s(p.cProd),
        descricao: s(p.xProd),
        ncm: s(p.NCM),
        cfop: s(p.CFOP),
        unidade: s(p.uCom),
        quantidade: n(p.qCom),
        valorUnitario: n(p.vUnCom),
        valorTotal: n(p.vProd),
        ean: s(p.cEAN),
        vBC: n(icms.vBC),
        pICMS: n(icms.pICMS),
        vICMS: n(icms.vICMS),
        vBCST: n(icms.vBCST),
        vICMSST: n(icms.vICMSST ?? icms.vST),
      };
    });

  const transporta = transp.transporta as Record<string, unknown> | undefined;

  return {
    chave,
    numero: s(ide.nNF),
    serie: s(ide.serie),
    modelo: s(ide.mod),
    natOp: s(ide.natOp),
    tipoOperacao: s(ide.tpNF) === '0' ? 'Entrada' : 'Saída',
    tpNF: s(ide.tpNF),
    dhEmi: s(ide.dhEmi || ide.dEmi),
    dhSaiEnt: s(ide.dhSaiEnt || ide.dSaiEnt),
    protocolo: s(prot.nProt),
    dhProt: s(prot.dhRecbto),
    situacao: s(prot.xMotivo),
    emit: {
      nome: s(emit.xNome),
      fantasia: s(emit.xFant),
      cnpj: s(emit.CNPJ || emit.CPF),
      ie: s(emit.IE),
      endereco: endereco(emit.enderEmit),
    },
    dest: {
      nome: s(dest.xNome),
      cnpjCpf: s(dest.CNPJ || dest.CPF),
      ie: s(dest.IE),
      endereco: endereco(dest.enderDest),
    },
    total: {
      vBC: n(tot.vBC),
      vICMS: n(tot.vICMS),
      vBCST: n(tot.vBCST),
      vST: n(tot.vST),
      vProd: n(tot.vProd),
      vFrete: n(tot.vFrete),
      vSeg: n(tot.vSeg),
      vDesc: n(tot.vDesc),
      vOutro: n(tot.vOutro),
      vIPI: n(tot.vIPI),
      vNF: n(tot.vNF),
      vTotTrib: n(tot.vTotTrib),
    },
    transp: {
      modFrete: MOD_FRETE[s(transp.modFrete)] ?? s(transp.modFrete),
      transportadora: transporta ? s(transporta.xNome) : '',
    },
    infAdic: s(inf.infAdic?.infCpl),
    itens,
  };
}
