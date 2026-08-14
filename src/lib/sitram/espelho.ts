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

export type OrigemTributoSitram = 'ITEM' | 'LANCAMENTOS' | 'NAO_INFORMADO';

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
  temCalculadoraSitram: boolean;
  origemTributo: OrigemTributoSitram;
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

const TOLERANCIA_CENTAVOS = 1;
const MAX_ESTADOS_SUBCONJUNTO = 20_000;

function centavos(valor: number | null | undefined): number {
  return Math.round((valor ?? 0) * 100);
}

function valorTributoItem(item: SitramEspelhoItem): number {
  return item.icms ?? item.icmsDestacado ?? 0;
}

function ehTipoItem(item: SitramEspelhoItem, tipo: TipoTributoDae): boolean {
  return tipo === 'ST' ? item.temSt : tipo === 'ANTECIPACAO' ? item.temAntecipacao : false;
}

function normalizarCodigoAgrupamento(codigo: string | null): string | null {
  const normalizado = codigo?.trim();
  return normalizado || null;
}

interface GrupoTributoInferido {
  indices: number[];
  valorCentavos: number;
}

function gruposTributoDesconhecido(itens: SitramEspelhoItem[]): GrupoTributoInferido[] {
  const grupos = new Map<string, GrupoTributoInferido>();

  itens.forEach((item, indice) => {
    if (item.temSt || item.temAntecipacao) return;

    const valorCentavos = centavos(valorTributoItem(item));
    const codigo = normalizarCodigoAgrupamento(item.codigo);
    if (!codigo || valorCentavos <= 0) return;

    const grupo = grupos.get(codigo) ?? { indices: [], valorCentavos: 0 };
    grupo.indices.push(indice);
    grupo.valorCentavos += valorCentavos;
    grupos.set(codigo, grupo);
  });

  return [...grupos.values()];
}

function subconjuntoUnicoPorValor(
  grupos: GrupoTributoInferido[],
  alvoCentavos: number
): number[] | null {
  if (alvoCentavos === 0) return [];
  if (alvoCentavos < 0) return null;

  type Estado = { grupos: number[]; ambiguo: boolean };
  const estados = new Map<number, Estado>([[0, { grupos: [], ambiguo: false }]]);

  for (let indice = 0; indice < grupos.length; indice += 1) {
    const grupo = grupos[indice];
    if (grupo.valorCentavos <= 0 || grupo.valorCentavos > alvoCentavos + TOLERANCIA_CENTAVOS) continue;

    for (const [subtotal, estado] of [...estados.entries()]) {
      const proximo = subtotal + grupo.valorCentavos;
      if (proximo > alvoCentavos + TOLERANCIA_CENTAVOS) continue;

      const existente = estados.get(proximo);
      if (!existente) {
        estados.set(proximo, {
          grupos: [...estado.grupos, indice],
          ambiguo: estado.ambiguo,
        });
      } else {
        existente.ambiguo = true;
      }
    }

    if (estados.size > MAX_ESTADOS_SUBCONJUNTO) return null;
  }

  const exato = estados.get(alvoCentavos);
  if (exato && !exato.ambiguo) return exato.grupos;

  for (const diferenca of [-TOLERANCIA_CENTAVOS, TOLERANCIA_CENTAVOS]) {
    const aproximado = estados.get(alvoCentavos + diferenca);
    if (aproximado && !aproximado.ambiguo) return aproximado.grupos;
  }

  return null;
}

function comTributoInferido(item: SitramEspelhoItem, tipo: TipoTributoDae): SitramEspelhoItem {
  const icms = valorTributoItem(item) || null;
  if (tipo === 'ST') {
    return {
      ...item,
      tipoTributo: 'ST',
      temSt: true,
      temAntecipacao: false,
      icmsSt: item.icmsSt ?? icms,
      origemTributo: 'LANCAMENTOS',
    };
  }

  return {
    ...item,
    tipoTributo: 'ANTECIPACAO',
    temSt: false,
    temAntecipacao: true,
    icmsAntecipacao: item.icmsAntecipacao ?? icms,
    origemTributo: 'LANCAMENTOS',
  };
}

function classificarRestantePorLancamento(
  itens: SitramEspelhoItem[],
  tipo: Extract<TipoTributoDae, 'ST' | 'ANTECIPACAO'>,
  totalLancamento: number | null
): SitramEspelhoItem[] {
  if (totalLancamento === null || totalLancamento <= 0) return itens;

  const totalConhecido = itens.reduce(
    (total, item) => total + (ehTipoItem(item, tipo) ? centavos(valorTributoItem(item)) : 0),
    0
  );
  const alvoCentavos = centavos(totalLancamento) - totalConhecido;
  if (alvoCentavos <= 0) return itens;

  const desconhecidos = itens
    .map((item, indice) => ({ item, indice }))
    .filter(({ item }) => !item.temSt && !item.temAntecipacao && centavos(valorTributoItem(item)) > 0);
  const totalDesconhecido = desconhecidos.reduce(
    (total, { item }) => total + centavos(valorTributoItem(item)),
    0
  );

  if (Math.abs(totalDesconhecido - alvoCentavos) <= TOLERANCIA_CENTAVOS) {
    const indices = new Set(desconhecidos.map(({ indice }) => indice));
    return itens.map((item, indice) => indices.has(indice) ? comTributoInferido(item, tipo) : item);
  }

  const grupos = gruposTributoDesconhecido(itens);
  const selecionados = subconjuntoUnicoPorValor(grupos, alvoCentavos);
  if (!selecionados) return itens;

  const indices = new Set(selecionados.flatMap((indice) => grupos[indice].indices));
  return itens.map((item, indice) => indices.has(indice) ? comTributoInferido(item, tipo) : item);
}

function classificarItensPorLancamentos(
  itens: SitramEspelhoItem[],
  lancamentos: SitramEspelhoLancamento[]
): SitramEspelhoItem[] {
  // O portal nem sempre informa a receita no item; so classificamos grupos cujo
  // ICMS fecha exatamente com os lancamentos 1023/1031 da mesma NF-e.
  const totalAntecipacao = somaLancamentos(lancamentos, '1023');
  const totalSt = somaLancamentos(lancamentos, '1031');

  let classificados = classificarRestantePorLancamento(itens, 'ANTECIPACAO', totalAntecipacao);
  classificados = classificarRestantePorLancamento(classificados, 'ST', totalSt);
  return classificarRestantePorLancamento(classificados, 'ANTECIPACAO', totalAntecipacao);
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

interface ReceitaCalculadoraSitram {
  codigo: string;
  descricao: string;
  valor: number;
}

interface DadosCalculadoraSitram {
  trilha: string;
  baseCalculo: number | null;
  regra: string | null;
  receitas: ReceitaCalculadoraSitram[];
}

function trilhaDaCalculadoraSitram(raw: Registro): string | null {
  const calculadora = registro(raw.calculadoraSitram ?? raw.calculadora);
  return primeiroTexto(calculadora.trilha);
}

function valorDaLinhaDaCalculadora(trilha: string, padrao: RegExp): number | null {
  const encontrado = trilha.match(padrao);
  return encontrado ? numero(encontrado[1]) : null;
}

function dadosDaCalculadoraSitram(raw: Registro): DadosCalculadoraSitram | null {
  const trilha = trilhaDaCalculadoraSitram(raw);
  if (!trilha) return null;

  const receitas: ReceitaCalculadoraSitram[] = [];
  const tabelaReceitas = /\|\s*(\d{4})\s*-\s*([^|]+?)\s*\|\s*R\$\s*([0-9.,]+)\s*\|/g;
  for (const resultado of trilha.matchAll(tabelaReceitas)) {
    const valor = numero(resultado[3]);
    if (valor === null) continue;
    receitas.push({
      codigo: resultado[1],
      descricao: resultado[2].trim(),
      valor,
    });
  }

  const regra = trilha.match(/^\s*Regra escolhida:\s*(.+?)\s*$/im)?.[1]?.trim() ?? null;
  return {
    trilha,
    baseCalculo: valorDaLinhaDaCalculadora(
      trilha,
      /^\s*Base de c(?:a|\u00e1)lculo\s*:\s*R\$\s*([0-9.,]+)\s*$/im
    ),
    regra,
    receitas,
  };
}

function possuiReceitaDaCalculadora(dados: DadosCalculadoraSitram | null, codigo: string): boolean {
  return dados?.receitas.some((receita) => receita.codigo === codigo) ?? false;
}

function totalReceitasDaCalculadora(
  dados: DadosCalculadoraSitram | null,
  seletor: (receita: ReceitaCalculadoraSitram) => boolean
): number | null {
  let total = 0;
  let encontrou = false;
  for (const receita of dados?.receitas ?? []) {
    if (!seletor(receita)) continue;
    total += receita.valor;
    encontrou = true;
  }
  return encontrou ? total : null;
}

function valorFecopDaCalculadora(dados: DadosCalculadoraSitram | null): number | null {
  return totalReceitasDaCalculadora(dados, (receita) =>
    receita.codigo === '2020' || /fecop|fcp/i.test(receita.descricao)
  );
}

function classificarTributoItem(raw: Registro): TipoTributoDae {
  const calculadora = dadosDaCalculadoraSitram(raw);
  if (possuiReceitaDaCalculadora(calculadora, '1031')) return 'ST';
  if (possuiReceitaDaCalculadora(calculadora, '1023')) return 'ANTECIPACAO';

  const alvo = textoTributoItem(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const baseSt = numero(raw.valorBcICMSSt);
  const icmsSt = numero(raw.valorICMSSt);

  if (/\b1031\b|subt|substituicao|\bst\b/.test(alvo) || (baseSt !== null && baseSt > 0) || (icmsSt !== null && icmsSt > 0)) {
    return 'ST';
  }
  if (/\b1023\b|antec|antecip/.test(alvo)) return 'ANTECIPACAO';
  return 'OUTRO';
}

function normalizarItem(valorBruto: unknown, indice: number): SitramEspelhoItem {
  const raw = registro(valorBruto);
  const cstPartes = [primeiroTexto(raw.codigoCSTA), primeiroTexto(raw.codigoCSTB)].filter(Boolean);
  const calculadora = dadosDaCalculadoraSitram(raw);
  const tipoTributo = classificarTributoItem(raw);
  const receitaSt = totalReceitasDaCalculadora(calculadora, (receita) => receita.codigo === '1031');
  const receitaAntecipacao = totalReceitasDaCalculadora(calculadora, (receita) => receita.codigo === '1023');
  const baseCalculo = calculadora?.baseCalculo ?? numero(raw.valorBc);
  const icmsCalculado = tipoTributo === 'ST'
    ? receitaSt
    : tipoTributo === 'ANTECIPACAO'
      ? receitaAntecipacao
      : null;
  const icms = icmsCalculado ?? numero(raw.icms);
  const baseCalculoStDireta = numero(raw.valorBcICMSSt);
  const icmsStDireto = numero(raw.valorICMSSt);
  const baseCalculoSt = tipoTributo === 'ST'
    ? calculadora?.baseCalculo ?? baseCalculoStDireta ?? baseCalculo
    : null;
  const icmsSt = receitaSt ?? icmsStDireto ?? (tipoTributo === 'ST' ? icms : null);
  const baseCalculoAntecipacao = tipoTributo === 'ANTECIPACAO' ? baseCalculo : null;
  const icmsAntecipacao = receitaAntecipacao ?? (tipoTributo === 'ANTECIPACAO' ? icms : null);
  const fecop = valorFecopDaCalculadora(calculadora) ?? primeiroNumeroPorChaves(raw, CHAVES_VALOR_FECOP);
  const textoFecop = coletarValoresCampos(raw, (chave) => /fecop|fcp|receita|tribut|calculadora|calculoicms/.test(chave))
    .join(' ');
  const temFecop =
    (fecop !== null && fecop > 0) ||
    temNumeroPositivoPorChave(raw, /fecop|fcp/) ||
    (!calculadora && /\bfecop\b|\bfcp\b|\b2020\b/i.test(textoFecop));

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
    temCalculadoraSitram: calculadora !== null,
    origemTributo: calculadora || tipoTributo !== 'OUTRO' ? 'ITEM' : 'NAO_INFORMADO',
    tipoRegime: primeiroTexto(raw.tipoRegime, calculadora?.regra),
    regimeDescricao: primeiroTexto(raw.nomeConfiguracao, raw.tipoCobranca, raw.tipoAlteracaoNotaItem, calculadora?.regra),
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
  const itens = classificarItensPorLancamentos(
    itensBrutosDoDetalhe(detalhe).map((item, indice) => normalizarItem(item, indice)),
    lancamentos
  );

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
