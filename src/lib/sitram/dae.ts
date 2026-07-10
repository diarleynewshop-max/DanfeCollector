export type TipoTributoDae = 'ST' | 'ANTECIPACAO' | 'OUTRO';

export interface LancamentoDaeNormalizado {
  codigo: string | null;
  identificador: string | null;
  descricao: string;
  tipo: TipoTributoDae;
  valor: number | null;
  valorPago: number | null;
  valorAberto: number | null;
  vencimento: string | null;
  situacao: string | null;
  pago: boolean;
}

export interface ResumoDaeNormalizado {
  numeroNota: string | null;
  classificacao: string;
  situacaoImposto: string | null;
  documentoGeradoEm: string | null;
  passouPostoEm: string | null;
  postoFiscal: string | null;
  acaoFiscal: string | null;
  lancamentos: LancamentoDaeNormalizado[];
}

export interface DaeCompartilhadoInfo {
  chave: string;
  titulo: string;
  identificador: string | null;
  codigo: string | null;
  descricao: string;
  vencimento: string | null;
  valor: number | null;
}

export function ehLancamentoFecop2020(lancamento: Pick<LancamentoDaeNormalizado, 'codigo' | 'descricao'>): boolean {
  const alvo = semAcentos(`${lancamento.codigo ?? ''} ${lancamento.descricao ?? ''}`);
  return /\b2020\b/.test(alvo) && /\bfecop\b/.test(alvo);
}

export function lancamentosVisiveisDae(lancamentos: LancamentoDaeNormalizado[]): LancamentoDaeNormalizado[] {
  return lancamentos.filter((lancamento) => !ehLancamentoFecop2020(lancamento));
}

export interface NotaComDadosDae {
  sitramDaeStatus?: string | null;
  sitramDaeResumo?: string | null;
  sitramDetalhe?: string | null;
}

type Registro = Record<string, unknown>;

function registro(valor: unknown): Registro {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : {};
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function primeiroTexto(...valores: unknown[]): string | null {
  for (const valor of valores) {
    const resultado = texto(valor);
    if (resultado) return resultado;
  }
  return null;
}

function semAcentos(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tipoTributo(raw: Registro): TipoTributoDae {
  const alvo = semAcentos([
    texto(raw.codigo),
    texto(raw.codReceita),
    texto(raw.descricaoAbreviada),
    texto(raw.descricao),
    texto(raw.descricaoRec),
  ].filter(Boolean).join(' '));

  if (/\b1031\b|\bsubt\b|substituicao/.test(alvo)) return 'ST';
  if (/\b1023\b|\bantc\b|antecip/.test(alvo)) return 'ANTECIPACAO';
  return 'OUTRO';
}

function normalizarLancamento(valorBruto: unknown): LancamentoDaeNormalizado {
  const raw = registro(valorBruto);
  const codigo = primeiroTexto(raw.codigo, raw.codReceita);
  const identificador = primeiroTexto(raw.identificadorUnico);
  const descricao = [
    primeiroTexto(raw.descricaoAbreviada),
    primeiroTexto(raw.descricao, raw.descricaoRec),
  ].filter(Boolean).join(' - ') || 'Lançamento SITRAM';
  const valor = numero(raw.valor) ?? numero(raw.icmsDevido) ?? numero(raw.icmsCalculado);
  const valorPago = numero(raw.valorPago);
  const situacao = primeiroTexto(raw.siuacaoDescricao, raw.situacaoDescricao, raw.situacao);
  const situacaoNormalizada = semAcentos(situacao);
  const indicaAberto = /a pagar|aberto|pendente|retid|autuad/.test(situacaoNormalizada);
  const indicaPago = /pago|paga|parcelad|quitad|baixad|recolhid/.test(situacaoNormalizada);

  let pago: boolean;
  if (valorPago !== null) {
    if (valor !== null && valor > 0) pago = valorPago + 0.005 >= valor;
    else pago = valorPago > 0 || (valor === 0 && indicaPago && !indicaAberto);
  } else {
    pago = indicaPago && !indicaAberto;
  }

  const valorAberto = valor === null
    ? null
    : Math.max(0, valor - (valorPago ?? 0));

  return {
    codigo,
    identificador,
    descricao,
    tipo: tipoTributo(raw),
    valor,
    valorPago,
    valorAberto,
    vencimento: primeiroTexto(raw.vencimento),
    situacao,
    pago,
  };
}

function valorChaveCompartilhada(valor: number | null): string {
  return valor === null ? 'sem-valor' : valor.toFixed(2);
}

function normalizarTextoChave(valor: string | null | undefined): string {
  return semAcentos(valor)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sem-texto';
}

export function chaveCompartilhadaDae(lancamento: LancamentoDaeNormalizado): string {
  if (lancamento.identificador) {
    return `sitram:${normalizarTextoChave(lancamento.identificador)}`;
  }

  return [
    'composto',
    normalizarTextoChave(lancamento.codigo),
    normalizarTextoChave(lancamento.descricao),
    normalizarTextoChave(chaveDataLocal(lancamento.vencimento)),
    valorChaveCompartilhada(lancamento.valor),
  ].join(':');
}

function tituloCompartilhadoDae(lancamento: LancamentoDaeNormalizado): string {
  const partes = [
    lancamento.codigo ? `${lancamento.codigo} - ${lancamento.descricao}` : lancamento.descricao,
    lancamento.vencimento ? `venc. ${new Date(lancamento.vencimento).toLocaleDateString('pt-BR')}` : null,
    lancamento.valor !== null
      ? `R$ ${lancamento.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null,
  ].filter(Boolean);
  return partes.join(' | ');
}

export function opcoesCompartilhadasDae(nota: NotaComDadosDae): DaeCompartilhadoInfo[] {
  const mapa = new Map<string, DaeCompartilhadoInfo>();

  for (const lancamento of extrairResumoDae(nota).lancamentos) {
    const chave = chaveCompartilhadaDae(lancamento);
    if (mapa.has(chave)) continue;
    mapa.set(chave, {
      chave,
      titulo: tituloCompartilhadoDae(lancamento),
      identificador: lancamento.identificador,
      codigo: lancamento.codigo,
      descricao: lancamento.descricao,
      vencimento: lancamento.vencimento,
      valor: lancamento.valor,
    });
  }

  return [...mapa.values()];
}

function classificacaoTributo(notaFiscal: Registro, lancamentos: LancamentoDaeNormalizado[]): string {
  const tipos = new Set(lancamentos.map((l) => l.tipo));
  if (tipos.has('ST') && tipos.has('ANTECIPACAO')) return 'ST + Antecipação';
  if (tipos.has('ST')) return 'ST';
  if (tipos.has('ANTECIPACAO')) return 'Antecipação';

  const situacao = semAcentos(primeiroTexto(notaFiscal.situacaoDoImposto));
  if (/\bsubt\b|substituicao/.test(situacao)) return 'ST';
  if (/\bantc\b|antecip/.test(situacao)) return 'Antecipação';
  return 'Sem ST';
}

function montarResumoDae(notaFiscalBruta: unknown, lancamentosBrutos: unknown[]): ResumoDaeNormalizado {
  const notaFiscal = registro(notaFiscalBruta);
  const lancamentos = lancamentosBrutos.map(normalizarLancamento);

  return {
    numeroNota: primeiroTexto(notaFiscal.numero),
    classificacao: classificacaoTributo(notaFiscal, lancamentos),
    situacaoImposto: primeiroTexto(
      notaFiscal.situacaoDoImposto,
      notaFiscal.situacaoDescricao,
      notaFiscal.descricaoStatusNF,
      notaFiscal.descricaoSituacao,
    ),
    documentoGeradoEm: primeiroTexto(notaFiscal.dataInclusao),
    passouPostoEm: primeiroTexto(notaFiscal.dataFatoGerador),
    postoFiscal: primeiroTexto(
      notaFiscal.descricaoOrgaoLocal,
      notaFiscal.orgaoLocalEventoDescricao,
      notaFiscal.orgaoLocalEventoSigla,
    ),
    acaoFiscal: primeiroTexto(notaFiscal.acaoFiscalSituacaoDescricao),
    lancamentos,
  };
}

export function extrairResumoDae(nota: NotaComDadosDae): ResumoDaeNormalizado {
  if (!nota.sitramDetalhe) return montarResumoDae({}, []);

  try {
    const detalhe = registro(JSON.parse(nota.sitramDetalhe));
    const notaFiscal = registro(detalhe.notaFiscal);
    const lancamentosRaiz = Array.isArray(detalhe.lancamentos) ? detalhe.lancamentos : null;
    const lancamentosNota = Array.isArray(notaFiscal.lancamentos) ? notaFiscal.lancamentos : [];
    return montarResumoDae(notaFiscal, lancamentosRaiz ?? lancamentosNota);
  } catch {
    return montarResumoDae({}, []);
  }
}

export function statusDaeEfetivo(nota: NotaComDadosDae): string {
  const resumo = extrairResumoDae(nota);
  if (resumo.lancamentos.length > 0) {
    return resumo.lancamentos.every((l) => l.pago) ? 'PAGO' : 'EM_ABERTO';
  }

  const textos = semAcentos(`${resumo.situacaoImposto ?? ''} ${nota.sitramDaeResumo ?? ''}`);
  if (/pago\s*r\$\s*0(?:[.,]0+)?/.test(textos)) return 'EM_ABERTO';
  if (/a pagar|aberto|pendente|retid|autuad/.test(textos)) return 'EM_ABERTO';
  if (/sem cobran/.test(textos)) return 'SEM_DAE';
  if (/pago|paga|parcelad|quitad|baixad|recolhid/.test(textos)) return 'PAGO';
  return nota.sitramDaeStatus ?? '';
}

export function classificarStatusDaePortal(notaFiscal: unknown, lancamentos: unknown[]): string {
  const resumo = montarResumoDae(notaFiscal, lancamentos);
  if (resumo.lancamentos.length > 0) {
    return resumo.lancamentos.every((l) => l.pago) ? 'PAGO' : 'EM_ABERTO';
  }

  const situacao = semAcentos(resumo.situacaoImposto);
  if (/a pagar|aberto|pendente|retid|autuad/.test(situacao)) return 'EM_ABERTO';
  if (/sem cobran/.test(situacao)) return 'SEM_DAE';
  if (/pago|paga|parcelad|quitad|baixad|recolhid/.test(situacao)) return 'PAGO';
  return situacao ? 'CONSULTADO' : 'SEM_DAE';
}

export function chaveDataLocal(dataIso: string | null | undefined): string | null {
  if (!dataIso) return null;
  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) return null;
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

export function diasAteVencimento(dataIso: string | null | undefined, referencia = new Date()): number | null {
  if (!dataIso) return null;
  const vencimento = new Date(dataIso);
  if (Number.isNaN(vencimento.getTime())) return null;
  vencimento.setHours(0, 0, 0, 0);
  const hoje = new Date(referencia);
  hoje.setHours(0, 0, 0, 0);
  return Math.round((vencimento.getTime() - hoje.getTime()) / 86_400_000);
}
