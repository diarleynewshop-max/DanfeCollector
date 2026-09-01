export const NFSE_CNPJ_AUTORIZADO = '45998339000329';
export const NFSE_MUNICIPIO_AUTORIZADO = 'Fortaleza';
export const NFSE_UF_AUTORIZADA = 'CE';

export type NfseEmissaoInput = {
  prestadorCnpj: string;
  tomadorDocumento: string;
  tomadorNome: string;
  tomadorEmail?: string;
  tomadorMunicipio?: string;
  tomadorUf?: string;
  tomadorEndereco?: string;
  competencia: string;
  municipioIncidencia: string;
  ufIncidencia: string;
  codigoMunicipioIbge: string;
  descricao: string;
  itemListaServico: string;
  codigoTributacaoMunicipio: string;
  cnae: string;
  nbs: string;
  regimeTributario: string;
  optanteSimples: boolean;
  exigibilidadeIss: string;
  naturezaOperacao: string;
  localPrestacao: string;
  valorServico: number;
  deducaoBaseCalculo: number;
  descontoIncondicionado: number;
  descontoCondicionado: number;
  aliquotaIss: number;
  issRetido: boolean;
  responsavelRetencao: string;
  pisNaoRetido: number;
  cofinsNaoRetido: number;
  pisRetido: number;
  cofinsRetido: number;
  csllRetido: number;
  irrfRetido: number;
  inssRetido: number;
  csrfRetido: number;
  outrasRetencoes: number;
  baseCalculoIbsCbs: number;
  aliquotaIbs: number;
  valorIbs: number;
  aliquotaCbs: number;
  valorCbs: number;
  observacao?: string;
};

export type NfsePreview = {
  prestadorCnpj: string;
  municipio: string;
  municipioIncidencia: string;
  codigoMunicipioIbge: string;
  tomadorDocumento: string;
  tomadorNome: string;
  competencia: string;
  descricao: string;
  itemListaServico: string;
  codigoTributacaoMunicipio: string;
  cnae: string;
  nbs: string;
  regimeTributario: string;
  optanteSimples: boolean;
  exigibilidadeIss: string;
  naturezaOperacao: string;
  valorServico: number;
  baseCalculoIss: number;
  aliquotaIss: number;
  valorIss: number;
  retencoesFederais: number;
  totalRetencoes: number;
  valorLiquido: number;
  pisNaoRetido: number;
  cofinsNaoRetido: number;
  baseCalculoIbsCbs: number;
  valorIbs: number;
  valorCbs: number;
  issRetido: boolean;
  avisos: string[];
  escritaHabilitada: boolean;
  provedorConfigurado: boolean;
  podeEmitir: boolean;
};

export function limparCpfCnpj(valor: string): string {
  return valor.replace(/\D/g, '');
}

function textoObrigatorio(valor: string | undefined | null): boolean {
  return !!valor?.trim();
}

function arredondarMoeda(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function numeroSeguro(valor: number | undefined | null): number {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

export function nfseEscritaHabilitada(): boolean {
  return process.env.NFSE_ENABLE_WRITE === 'true';
}

export function nfseProvedorConfigurado(): boolean {
  const provedor = process.env.NFSE_PROVIDER?.trim();
  if (!provedor) return false;

  if (provedor === 'nacional') {
    return !!process.env.NFSE_NACIONAL_API_URL?.trim();
  }

  if (provedor === 'fortaleza') {
    return !!process.env.NFSE_FORTALEZA_API_URL?.trim();
  }

  return false;
}

export function montarPreviewNfse(input: NfseEmissaoInput): NfsePreview {
  const avisos: string[] = [];
  const prestadorCnpj = limparCpfCnpj(input.prestadorCnpj);
  const tomadorDocumento = limparCpfCnpj(input.tomadorDocumento);
  const valorServico = numeroSeguro(input.valorServico);
  const deducaoBaseCalculo = numeroSeguro(input.deducaoBaseCalculo);
  const descontoIncondicionado = numeroSeguro(input.descontoIncondicionado);
  const descontoCondicionado = numeroSeguro(input.descontoCondicionado);
  const aliquotaIss = numeroSeguro(input.aliquotaIss);
  const pisRetido = numeroSeguro(input.pisRetido);
  const cofinsRetido = numeroSeguro(input.cofinsRetido);
  const csllRetido = numeroSeguro(input.csllRetido);
  const irrfRetido = numeroSeguro(input.irrfRetido);
  const inssRetido = numeroSeguro(input.inssRetido);
  const csrfRetido = numeroSeguro(input.csrfRetido);
  const outrasRetencoes = numeroSeguro(input.outrasRetencoes);
  const pisNaoRetido = numeroSeguro(input.pisNaoRetido);
  const cofinsNaoRetido = numeroSeguro(input.cofinsNaoRetido);
  const baseCalculoIbsCbs = numeroSeguro(input.baseCalculoIbsCbs);
  const valorIbs = numeroSeguro(input.valorIbs);
  const valorCbs = numeroSeguro(input.valorCbs);

  if (prestadorCnpj !== NFSE_CNPJ_AUTORIZADO) {
    avisos.push('Emissao de NFS-e limitada ao CNPJ 45.998.339/0003-29.');
  }
  if (![11, 14].includes(tomadorDocumento.length)) {
    avisos.push('Documento do tomador deve ser CPF ou CNPJ valido em quantidade de digitos.');
  }
  if (!textoObrigatorio(input.tomadorNome)) avisos.push('Informe o nome/razao social do tomador.');
  if (!textoObrigatorio(input.competencia)) avisos.push('Informe a competencia do servico.');
  if (!textoObrigatorio(input.municipioIncidencia)) avisos.push('Informe o municipio de incidencia do ISS.');
  if (!textoObrigatorio(input.ufIncidencia)) avisos.push('Informe a UF de incidencia do ISS.');
  if (!textoObrigatorio(input.codigoMunicipioIbge)) avisos.push('Informe o codigo IBGE do municipio de incidencia.');
  if (!textoObrigatorio(input.descricao) || input.descricao.trim().length < 10) {
    avisos.push('Descreva o servico com pelo menos 10 caracteres.');
  }
  if (!textoObrigatorio(input.itemListaServico)) avisos.push('Informe o item da lista de servicos.');
  if (!textoObrigatorio(input.codigoTributacaoMunicipio)) {
    avisos.push('Informe o codigo de tributacao municipal.');
  }
  if (!textoObrigatorio(input.cnae)) avisos.push('Informe o CNAE usado na prestacao.');
  if (!textoObrigatorio(input.nbs)) avisos.push('Informe a NBS quando aplicavel ao servico.');
  if (!textoObrigatorio(input.regimeTributario)) avisos.push('Informe o regime tributario da empresa.');
  if (!textoObrigatorio(input.exigibilidadeIss)) avisos.push('Informe a exigibilidade do ISS.');
  if (!textoObrigatorio(input.naturezaOperacao)) avisos.push('Informe a natureza da operacao.');
  if (!textoObrigatorio(input.localPrestacao)) avisos.push('Informe o local da prestacao.');
  if (input.issRetido && !textoObrigatorio(input.responsavelRetencao)) {
    avisos.push('Informe o responsavel pela retencao do ISS.');
  }
  if (!Number.isFinite(valorServico) || valorServico <= 0) avisos.push('Valor do servico deve ser maior que zero.');
  if (!Number.isFinite(aliquotaIss) || aliquotaIss < 0 || aliquotaIss > 100) {
    avisos.push('Aliquota ISS deve ficar entre 0 e 100.');
  }
  if (baseCalculoIbsCbs <= 0) avisos.push('Informe a base de calculo de IBS/CBS, mesmo que seja zero por regra validada.');

  const escritaHabilitada = nfseEscritaHabilitada();
  const provedorConfigurado = nfseProvedorConfigurado();
  if (!provedorConfigurado) avisos.push('Provedor NFS-e ainda nao configurado na VPS.');
  if (!escritaHabilitada) avisos.push('NFSE_ENABLE_WRITE precisa ser true para envio externo.');

  const baseCalculoIss = Math.max(0, valorServico - deducaoBaseCalculo - descontoIncondicionado);
  const valorIss = arredondarMoeda(baseCalculoIss * (aliquotaIss / 100));
  const retencoesFederais = arredondarMoeda(
    pisRetido + cofinsRetido + csllRetido + irrfRetido + inssRetido + csrfRetido + outrasRetencoes,
  );
  const totalRetencoes = arredondarMoeda((input.issRetido ? valorIss : 0) + retencoesFederais);

  return {
    prestadorCnpj,
    municipio: `${NFSE_MUNICIPIO_AUTORIZADO}/${NFSE_UF_AUTORIZADA}`,
    municipioIncidencia: `${input.municipioIncidencia.trim() || '-'}${input.ufIncidencia ? `/${input.ufIncidencia.trim().toUpperCase()}` : ''}`,
    codigoMunicipioIbge: input.codigoMunicipioIbge.trim(),
    tomadorDocumento,
    tomadorNome: input.tomadorNome.trim(),
    competencia: input.competencia,
    descricao: input.descricao.trim(),
    itemListaServico: input.itemListaServico.trim(),
    codigoTributacaoMunicipio: input.codigoTributacaoMunicipio.trim(),
    cnae: input.cnae.trim(),
    nbs: input.nbs.trim(),
    regimeTributario: input.regimeTributario.trim(),
    optanteSimples: input.optanteSimples,
    exigibilidadeIss: input.exigibilidadeIss.trim(),
    naturezaOperacao: input.naturezaOperacao.trim(),
    valorServico: arredondarMoeda(valorServico),
    baseCalculoIss: arredondarMoeda(baseCalculoIss),
    aliquotaIss,
    valorIss,
    retencoesFederais,
    totalRetencoes,
    valorLiquido: arredondarMoeda(valorServico - totalRetencoes - descontoCondicionado),
    pisNaoRetido: arredondarMoeda(pisNaoRetido),
    cofinsNaoRetido: arredondarMoeda(cofinsNaoRetido),
    baseCalculoIbsCbs: arredondarMoeda(baseCalculoIbsCbs),
    valorIbs: arredondarMoeda(valorIbs),
    valorCbs: arredondarMoeda(valorCbs),
    issRetido: input.issRetido,
    avisos,
    escritaHabilitada,
    provedorConfigurado,
    podeEmitir: avisos.length === 0,
  };
}
