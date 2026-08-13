import { extrairResumoDae, lancamentosVisiveisDae, type TipoTributoDae } from './dae';

type Registro = Record<string, unknown>;

export interface NotaComEspelhoSitram {
  chave: string;
  numero?: string | null;
  serie?: string | null;
  emitidaEm?: Date | string | null;
  naturezaOp?: string | null;
  emitenteNome?: string | null;
  emitenteCnpj?: string | null;
  emitenteUf?: string | null;
  destNome?: string | null;
  destCnpj?: string | null;
  valorTotal?: number | null;
  valorProdutos?: number | null;
  valorFrete?: number | null;
  valorDesconto?: number | null;
  valorIcms?: number | null;
  sitramDaeStatus?: string | null;
  sitramDaeResumo?: string | null;
  sitramDetalhe?: string | null;
  pagamentoManualEm?: Date | string | null;
  cnpj?: {
    cnpj: string;
    razaoSocial: string | null;
  };
}

export interface SitramEspelhoItem {
  nItem: string;
  codigo: string | null;
  ncm: string | null;
  produto: string;
  cfop: string | null;
  cst: string | null;
  quantidade: number | null;
  valorUnitario: number | null;
  valorTotal: number | null;
  aliquota: number | null;
  baseCalculo: number | null;
  icms: number | null;
  baseCalculoSt: number | null;
  icmsSt: number | null;
  baseCalculoAntecipacao: number | null;
  icmsAntecipacao: number | null;
  icmsDestacado: number | null;
  fecop: number | null;
  temFecop: boolean;
  ipi: number | null;
  tipoTributo: TipoTributoDae;
  temSt: boolean;
  temAntecipacao: boolean;
  tipoRegime: string | null;
  regimeDescricao: string | null;
}

export interface SitramEspelhoLancamento {
  codigo: string | null;
  descricao: string;
  valor: number | null;
  valorAberto: number | null;
  valorPago: number | null;
  vencimento: string | null;
  pago: boolean;
}

export interface SitramEspelhoData {
  chave: string;
  numero: string | null;
  serie: string | null;
  emitidaEm: string | null;
  naturezaOp: string | null;
  emitente: {
    nome: string | null;
    cnpj: string | null;
    uf: string | null;
  };
  destinatario: {
    nome: string | null;
    cnpj: string | null;
    uf: string | null;
  };
  totais: {
    produtos: number | null;
    nota: number | null;
    frete: number | null;
    desconto: number | null;
    baseCalculo: number | null;
    icms: number | null;
    baseCalculoSt: number | null;
    icmsSt: number | null;
    baseCalculoAntecipacao: number | null;
    icmsAntecipacao: number | null;
    valorLancamentoSt: number | null;
    valorLancamentoAntecipacao: number | null;
    icmsDestacado: number | null;
    fecop: number | null;
    ipi: number | null;
  };
  dae: {
    classificacao: string;
    situacaoImposto: string | null;
    lancamentos: SitramEspelhoLancamento[];
  };
  itens: SitramEspelhoItem[];
}

function registro(valor: unknown): Registro {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : {};
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trim()) return null;

  const limpo = valor
    .replace(/\s/g, '')
    .replace(/^R\$/i, '');
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

function primeiroTexto(...valores: unknown[]): string | null {
  for (const valor of valores) {
    const resultado = texto(valor);
    if (resultado) return resultado;
  }
  return null;
}

function primeiraDataIso(...valores: unknown[]): string | null {
  for (const valor of valores) {
    if (valor instanceof Date && !Number.isNaN(valor.getTime())) return valor.toISOString();
    const raw = texto(valor);
    if (raw) return raw;
  }
  return null;
}

function somaNumeros(itens: SitramEspelhoItem[], seletor: (item: SitramEspelhoItem) => number | null): number | null {
  let total = 0;
  let encontrou = false;
  for (const item of itens) {
    const valor = seletor(item);
    if (valor === null) continue;
    total += valor;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function somaFecop(itens: SitramEspelhoItem[]): number | null {
  let total = 0;
  let encontrou = false;
  for (const item of itens) {
    if (item.fecop === null || item.fecop <= 0) continue;
    total += item.fecop;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function somaLancamentos(lancamentos: SitramEspelhoLancamento[], codigo: string): number | null {
  let total = 0;
  let encontrou = false;
  for (const lancamento of lancamentos) {
    if ((lancamento.codigo ?? '').replace(/\D/g, '') !== codigo) continue;
    total += lancamento.valor ?? 0;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function semAcentos(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function chaveNormalizada(chave: string): string {
  return semAcentos(chave).replace(/[^a-z0-9]/g, '');
}

function coletarValoresCampos(
  valor: unknown,
  chaveRelevante: (chave: string) => boolean,
  dentroDeCampoRelevante = false,
  profundidade = 0
): string[] {
  if (profundidade > 6) return [];

  const textoDireto = texto(valor);
  if (textoDireto && dentroDeCampoRelevante) return [textoDireto];
  if (!valor || typeof valor !== 'object') return [];

  if (Array.isArray(valor)) {
    return valor.flatMap((item) =>
      coletarValoresCampos(item, chaveRelevante, dentroDeCampoRelevante, profundidade + 1)
    );
  }

  return Object.entries(valor as Registro).flatMap(([chave, item]) => {
    const relevante = dentroDeCampoRelevante || chaveRelevante(chaveNormalizada(chave));
    return coletarValoresCampos(item, chaveRelevante, relevante, profundidade + 1);
  });
}

function primeiroNumeroPorChaves(valor: unknown, chaves: Set<string>, profundidade = 0): number | null {
  if (profundidade > 6 || !valor || typeof valor !== 'object') return null;
  let fallbackZero: number | null = null;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = primeiroNumeroPorChaves(item, chaves, profundidade + 1);
      if (encontrado !== null && encontrado > 0) return encontrado;
      if (encontrado !== null && fallbackZero === null) fallbackZero = encontrado;
    }
    return fallbackZero;
  }

  for (const [chave, item] of Object.entries(valor as Registro)) {
    if (chaves.has(chaveNormalizada(chave))) {
      const encontrado = numero(item);
      if (encontrado !== null && encontrado > 0) return encontrado;
      if (encontrado !== null && fallbackZero === null) fallbackZero = encontrado;
    }
    const encontrado = primeiroNumeroPorChaves(item, chaves, profundidade + 1);
    if (encontrado !== null && encontrado > 0) return encontrado;
    if (encontrado !== null && fallbackZero === null) fallbackZero = encontrado;
  }
  return fallbackZero;
}

function temNumeroPositivoPorChave(valor: unknown, padraoChave: RegExp, profundidade = 0): boolean {
  if (profundidade > 6 || !valor || typeof valor !== 'object') return false;
  if (Array.isArray(valor)) return valor.some((item) => temNumeroPositivoPorChave(item, padraoChave, profundidade + 1));

  for (const [chave, item] of Object.entries(valor as Registro)) {
    if (padraoChave.test(chaveNormalizada(chave)) && (numero(item) ?? 0) > 0) return true;
    if (temNumeroPositivoPorChave(item, padraoChave, profundidade + 1)) return true;
  }
  return false;
}

const CHAVES_VALOR_FECOP = new Set([
  'valorfecop',
  'valorfcp',
  'vfcp',
  'vfcpst',
  'vfcpstret',
  'vfcpuFdest'.toLowerCase(),
  'vfcufdest',
  'valorfcpuFdest'.toLowerCase(),
]);

function numeroDaChave(chave: string): string | null {
  const normalizada = chave.replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  return normalizada.slice(25, 34).replace(/^0+/, '') || normalizada.slice(25, 34);
}

function serieDaChave(chave: string): string | null {
  const normalizada = chave.replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  return normalizada.slice(22, 25).replace(/^0+/, '') || normalizada.slice(22, 25);
}

function parseDetalheSitram(sitramDetalhe: string | null | undefined): Registro {
  if (!sitramDetalhe) return {};
  try {
    return registro(JSON.parse(sitramDetalhe));
  } catch {
    return {};
  }
}

function itensBrutosDoDetalhe(detalhe: Registro): unknown[] {
  if (Array.isArray(detalhe.itens)) return detalhe.itens;

  const itens = registro(detalhe.itens);
  if (Array.isArray(itens.content)) return itens.content;

  const notaFiscal = registro(detalhe.notaFiscal);
  if (Array.isArray(notaFiscal.itens)) return notaFiscal.itens;

  return [];
}

function textoTributoItem(raw: Registro): string {
  const camposTributarios = coletarValoresCampos(raw, (chave) =>
    /receita|regime|tribut|cobranc|configuracao|alteracao|incidencia|ajuste|calculoicms|calculadora/.test(chave)
  );

  return [
    primeiroTexto(raw.codigoReceita, raw.receita, raw.codReceita),
    primeiroTexto(raw.tipoRegime, raw.tipoCobranca, raw.nomeConfiguracao, raw.tipoAlteracaoNotaItem),
    ...camposTributarios,
  ].filter(Boolean).join(' ').toLowerCase();
}

function classificarTributoItem(raw: Registro, tiposNota: TipoTributoDae[]): TipoTributoDae {
  const alvo = textoTributoItem(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const baseSt = numero(raw.valorBcICMSSt);
  const icmsSt = numero(raw.valorICMSSt);

  if (/\b1031\b|subt|substituicao|\bst\b/.test(alvo) || (baseSt !== null && baseSt > 0) || (icmsSt !== null && icmsSt > 0)) {
    return 'ST';
  }
  if (/\b1023\b|antec|antecip/.test(alvo)) return 'ANTECIPACAO';
  if (tiposNota.length === 1) return tiposNota[0];
  return 'OUTRO';
}

function normalizarItem(valorBruto: unknown, indice: number, tiposNota: TipoTributoDae[] = []): SitramEspelhoItem {
  const raw = registro(valorBruto);
  const cstPartes = [primeiroTexto(raw.codigoCSTA), primeiroTexto(raw.codigoCSTB)].filter(Boolean);
  const tipoTributo = classificarTributoItem(raw, tiposNota);
  const baseCalculo = numero(raw.valorBc);
  const icms = numero(raw.icms);
  const baseCalculoStDireta = numero(raw.valorBcICMSSt);
  const icmsStDireto = numero(raw.valorICMSSt);
  const baseCalculoSt = baseCalculoStDireta ?? (tipoTributo === 'ST' ? baseCalculo : null);
  const icmsSt = icmsStDireto ?? (tipoTributo === 'ST' ? icms : null);
  const baseCalculoAntecipacao = tipoTributo === 'ANTECIPACAO' ? baseCalculo : null;
  const icmsAntecipacao = tipoTributo === 'ANTECIPACAO' ? icms : null;
  const fecop = primeiroNumeroPorChaves(raw, CHAVES_VALOR_FECOP);
  const textoFecop = coletarValoresCampos(raw, (chave) => /fecop|fcp|receita|tribut|calculadora|calculoicms/.test(chave))
    .join(' ');
  const temFecop =
    (fecop !== null && fecop > 0) ||
    temNumeroPositivoPorChave(raw, /fecop|fcp/) ||
    /\bfecop\b|\bfcp\b|\b2020\b/i.test(textoFecop);

  return {
    nItem: primeiroTexto(raw.numero, raw.nItem, raw.item) ?? String(indice + 1),
    codigo: primeiroTexto(raw.codigoProduto, raw.codigo, raw.cProd),
    ncm: primeiroTexto(raw.ncm),
    produto: primeiroTexto(raw.descricaoProduto, raw.produto, raw.xProd) ?? 'Produto sem descricao no SITRAM',
    cfop: primeiroTexto(raw.cfop),
    cst: cstPartes.length > 0 ? cstPartes.join(' / ') : primeiroTexto(raw.cst, raw.CST, raw.codigoCst),
    quantidade: numero(raw.quantidade),
    valorUnitario: numero(raw.valorUnitario),
    valorTotal: numero(raw.valorTotal),
    aliquota: numero(raw.valorAliquota),
    baseCalculo,
    icms,
    baseCalculoSt,
    icmsSt,
    baseCalculoAntecipacao,
    icmsAntecipacao,
    icmsDestacado: numero(raw.valorIcmsDestacado),
    fecop,
    temFecop,
    ipi: numero(raw.valorIPI),
    tipoTributo,
    temSt: tipoTributo === 'ST',
    temAntecipacao: tipoTributo === 'ANTECIPACAO',
    tipoRegime: primeiroTexto(raw.tipoRegime),
    regimeDescricao: primeiroTexto(raw.nomeConfiguracao, raw.tipoCobranca, raw.tipoAlteracaoNotaItem),
  };
}

export function extrairItensSitram(nota: Pick<NotaComEspelhoSitram, 'sitramDetalhe'>): SitramEspelhoItem[] {
  const detalhe = parseDetalheSitram(nota.sitramDetalhe);
  return itensBrutosDoDetalhe(detalhe).map((item, indice) => normalizarItem(item, indice));
}

export function extrairEspelhoSitram(nota: NotaComEspelhoSitram): SitramEspelhoData | null {
  const detalhe = parseDetalheSitram(nota.sitramDetalhe);
  const notaFiscal = registro(detalhe.notaFiscal);
  const resumoDae = extrairResumoDae(nota);
  const lancamentos = lancamentosVisiveisDae(resumoDae.lancamentos).map((lancamento) => ({
    codigo: lancamento.codigo,
    descricao: lancamento.descricao,
    valor: lancamento.valor,
    valorAberto: lancamento.valorAberto,
    valorPago: lancamento.valorPago,
    vencimento: lancamento.vencimento,
    pago: lancamento.pago,
  }));
  const tiposNota = [...new Set(lancamentos.map((lancamento) => {
    const codigo = (lancamento.codigo ?? '').replace(/\D/g, '');
    if (codigo === '1031') return 'ST' as TipoTributoDae;
    if (codigo === '1023') return 'ANTECIPACAO' as TipoTributoDae;
    return null;
  }).filter((tipo): tipo is TipoTributoDae => !!tipo))];
  const itens = itensBrutosDoDetalhe(detalhe).map((item, indice) => normalizarItem(item, indice, tiposNota));

  if (itens.length === 0) return null;

  const totalProdutos = nota.valorProdutos ?? somaNumeros(itens, (item) => item.valorTotal);
  const baseCalculoSt = somaNumeros(itens, (item) => item.baseCalculoSt);
  const icmsSt = somaNumeros(itens, (item) => item.icmsSt);
  const baseCalculoAntecipacao = somaNumeros(itens, (item) => item.baseCalculoAntecipacao);
  const icmsAntecipacao = somaNumeros(itens, (item) => item.icmsAntecipacao);

  return {
    chave: nota.chave,
    numero: nota.numero ?? primeiroTexto(notaFiscal.numero) ?? numeroDaChave(nota.chave),
    serie: nota.serie ?? serieDaChave(nota.chave),
    emitidaEm: primeiraDataIso(nota.emitidaEm, notaFiscal.dataEmissao, notaFiscal.dataFatoGerador),
    naturezaOp: nota.naturezaOp ?? null,
    emitente: {
      nome: nota.emitenteNome ?? primeiroTexto(notaFiscal.nomeEmitente),
      cnpj: nota.emitenteCnpj ?? primeiroTexto(notaFiscal.codigoEmitente),
      uf: nota.emitenteUf ?? primeiroTexto(notaFiscal.ufEmitente),
    },
    destinatario: {
      nome: nota.destNome ?? primeiroTexto(notaFiscal.nomeDestinatario, nota.cnpj?.razaoSocial),
      cnpj: nota.destCnpj ?? primeiroTexto(notaFiscal.codigoDestinatario, nota.cnpj?.cnpj),
      uf: primeiroTexto(notaFiscal.ufDestinatario),
    },
    totais: {
      produtos: totalProdutos,
      nota: nota.valorTotal ?? totalProdutos,
      frete: nota.valorFrete ?? null,
      desconto: nota.valorDesconto ?? null,
      baseCalculo: somaNumeros(itens, (item) => item.baseCalculo),
      icms: somaNumeros(itens, (item) => item.icms ?? item.icmsDestacado),
      baseCalculoSt,
      icmsSt,
      baseCalculoAntecipacao,
      icmsAntecipacao,
      valorLancamentoSt: somaLancamentos(lancamentos, '1031'),
      valorLancamentoAntecipacao: somaLancamentos(lancamentos, '1023'),
      icmsDestacado: nota.valorIcms ?? somaNumeros(itens, (item) => item.icmsDestacado),
      fecop: somaFecop(itens),
      ipi: somaNumeros(itens, (item) => item.ipi),
    },
    dae: {
      classificacao: resumoDae.classificacao,
      situacaoImposto: resumoDae.situacaoImposto,
      lancamentos,
    },
    itens,
  };
}
