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
  indicadorOperacao: string;
  cstIss: string;
  classificacaoTributariaIbsCbs: string;
  destinatarioServico: string;
  valorServico: number;
  deducaoBaseCalculo: number;
  descontoIncondicionado: number;
  descontoCondicionado: number;
  aliquotaIss: number;
  issRetido: boolean;
  responsavelRetencao: string;
  tipoRetencaoPisCofinsCsll: string;
  codigoSituacaoTributariaPisCofins: string;
  baseCalculoPisCofins: number;
  aliquotaPis: number;
  aliquotaCofins: number;
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
  indicadorOperacao: string;
  cstIss: string;
  classificacaoTributariaIbsCbs: string;
  destinatarioServico: string;
  valorServico: number;
  baseCalculoIss: number;
  aliquotaIss: number;
  valorIss: number;
  tipoRetencaoPisCofinsCsll: string;
  codigoSituacaoTributariaPisCofins: string;
  baseCalculoPisCofins: number;
  aliquotaPis: number;
  aliquotaCofins: number;
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

export function limparCodigoFiscal(valor: string): string {
  return valor.replace(/\D/g, '');
}

function todosDigitosIguais(valor: string): boolean {
  return /^(\d)\1+$/.test(valor);
}

function validarCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || todosDigitosIguais(cpf)) return false;

  const calcularDigito = (base: string, pesoInicial: number) => {
    const soma = base
      .split('')
      .reduce((total, digito, index) => total + Number(digito) * (pesoInicial - index), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const digito1 = calcularDigito(cpf.slice(0, 9), 10);
  const digito2 = calcularDigito(cpf.slice(0, 10), 11);
  return cpf[9] === String(digito1) && cpf[10] === String(digito2);
}

function validarCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || todosDigitosIguais(cnpj)) return false;

  const calcularDigito = (base: string, pesos: number[]) => {
    const soma = base
      .split('')
      .reduce((total, digito, index) => total + Number(digito) * pesos[index], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const digito1 = calcularDigito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const digito2 = calcularDigito(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj[12] === String(digito1) && cnpj[13] === String(digito2);
}

function validarCpfOuCnpj(documento: string): boolean {
  if (documento.length === 11) return validarCpf(documento);
  if (documento.length === 14) return validarCnpj(documento);
  return false;
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
  const codigoMunicipioIbge = limparCodigoFiscal(input.codigoMunicipioIbge);
  const cnae = limparCodigoFiscal(input.cnae);
  const nbs = limparCodigoFiscal(input.nbs);
  const valorServico = numeroSeguro(input.valorServico);
  const deducaoBaseCalculo = numeroSeguro(input.deducaoBaseCalculo);
  const descontoIncondicionado = numeroSeguro(input.descontoIncondicionado);
  const descontoCondicionado = numeroSeguro(input.descontoCondicionado);
  const aliquotaIss = numeroSeguro(input.aliquotaIss);
  const baseCalculoPisCofinsInformada = numeroSeguro(input.baseCalculoPisCofins);
  const aliquotaPis = numeroSeguro(input.aliquotaPis);
  const aliquotaCofins = numeroSeguro(input.aliquotaCofins);
  const pisRetido = numeroSeguro(input.pisRetido);
  const cofinsRetido = numeroSeguro(input.cofinsRetido);
  const csllRetido = numeroSeguro(input.csllRetido);
  const irrfRetido = numeroSeguro(input.irrfRetido);
  const inssRetido = numeroSeguro(input.inssRetido);
  const csrfRetido = numeroSeguro(input.csrfRetido);
  const outrasRetencoes = numeroSeguro(input.outrasRetencoes);
  const pisNaoRetidoInformado = numeroSeguro(input.pisNaoRetido);
  const cofinsNaoRetidoInformado = numeroSeguro(input.cofinsNaoRetido);
  const baseCalculoIbsCbs = numeroSeguro(input.baseCalculoIbsCbs);
  const aliquotaIbs = numeroSeguro(input.aliquotaIbs);
  const valorIbsInformado = numeroSeguro(input.valorIbs);
  const aliquotaCbs = numeroSeguro(input.aliquotaCbs);
  const valorCbsInformado = numeroSeguro(input.valorCbs);

  if (prestadorCnpj !== NFSE_CNPJ_AUTORIZADO) {
    avisos.push('Emissao de NFS-e limitada ao CNPJ 45.998.339/0003-29.');
  }
  if (!validarCpfOuCnpj(tomadorDocumento)) {
    avisos.push('Documento do tomador deve ser CPF ou CNPJ valido.');
  }
  if (!textoObrigatorio(input.tomadorNome)) avisos.push('Informe o nome/razao social do tomador.');
  if (!textoObrigatorio(input.competencia)) avisos.push('Informe a competencia do servico.');
  if (!textoObrigatorio(input.municipioIncidencia)) avisos.push('Informe o municipio de incidencia do ISS.');
  if (!textoObrigatorio(input.ufIncidencia)) avisos.push('Informe a UF de incidencia do ISS.');
  if (!codigoMunicipioIbge) avisos.push('Informe o codigo IBGE do municipio de incidencia.');
  if (codigoMunicipioIbge && codigoMunicipioIbge.length !== 7) {
    avisos.push('Codigo IBGE do municipio deve ter 7 digitos.');
  }
  if (!textoObrigatorio(input.descricao) || input.descricao.trim().length < 10) {
    avisos.push('Descreva o servico com pelo menos 10 caracteres.');
  }
  if (!textoObrigatorio(input.itemListaServico)) avisos.push('Informe o item da lista de servicos.');
  if (!textoObrigatorio(input.codigoTributacaoMunicipio)) {
    avisos.push('Informe o codigo de tributacao municipal.');
  }
  if (!cnae) avisos.push('Informe o CNAE usado na prestacao.');
  if (cnae && cnae.length !== 7) avisos.push('CNAE deve ter 7 digitos.');
  if (!nbs) avisos.push('Informe a NBS quando aplicavel ao servico.');
  if (nbs && nbs.length !== 9) avisos.push('NBS deve ter 9 digitos quando informado.');
  if (!textoObrigatorio(input.regimeTributario)) avisos.push('Informe o regime tributario da empresa.');
  if (!textoObrigatorio(input.exigibilidadeIss)) avisos.push('Informe a exigibilidade do ISS.');
  if (!textoObrigatorio(input.naturezaOperacao)) avisos.push('Informe a natureza da operacao.');
  if (!textoObrigatorio(input.localPrestacao)) avisos.push('Informe o local da prestacao.');
  if (!textoObrigatorio(input.indicadorOperacao)) avisos.push('Informe o indicador da operacao.');
  if (!textoObrigatorio(input.cstIss)) avisos.push('Informe o CST do ISS.');
  if (!textoObrigatorio(input.classificacaoTributariaIbsCbs)) {
    avisos.push('Informe a classificacao tributaria do IBS/CBS.');
  }
  if (!textoObrigatorio(input.destinatarioServico)) avisos.push('Informe o destinatario do servico.');
  if (!textoObrigatorio(input.tipoRetencaoPisCofinsCsll)) {
    avisos.push('Informe o tipo de retencao de PIS/COFINS/CSLL.');
  }
  if (!textoObrigatorio(input.codigoSituacaoTributariaPisCofins)) {
    avisos.push('Informe o codigo de situacao tributaria do PIS/COFINS.');
  }
  if (input.issRetido && !textoObrigatorio(input.responsavelRetencao)) {
    avisos.push('Informe o responsavel pela retencao do ISS.');
  }
  if (!Number.isFinite(valorServico) || valorServico <= 0) avisos.push('Valor do servico deve ser maior que zero.');
  if (!Number.isFinite(aliquotaIss) || aliquotaIss < 0 || aliquotaIss > 100) {
    avisos.push('Aliquota ISS deve ficar entre 0 e 100.');
  }
  if (!Number.isFinite(aliquotaPis) || aliquotaPis < 0 || aliquotaPis > 100) {
    avisos.push('Aliquota PIS deve ficar entre 0 e 100.');
  }
  if (!Number.isFinite(aliquotaCofins) || aliquotaCofins < 0 || aliquotaCofins > 100) {
    avisos.push('Aliquota COFINS deve ficar entre 0 e 100.');
  }
  if (!Number.isFinite(aliquotaIbs) || aliquotaIbs < 0 || aliquotaIbs > 100) {
    avisos.push('Aliquota IBS deve ficar entre 0 e 100.');
  }
  if (!Number.isFinite(aliquotaCbs) || aliquotaCbs < 0 || aliquotaCbs > 100) {
    avisos.push('Aliquota CBS deve ficar entre 0 e 100.');
  }
  if (baseCalculoIbsCbs <= 0 && !/ibs|cbs/i.test(input.observacao ?? '')) {
    avisos.push('Informe a base de calculo de IBS/CBS ou justifique zero na observacao.');
  }

  const escritaHabilitada = nfseEscritaHabilitada();
  const provedorConfigurado = nfseProvedorConfigurado();
  if (!provedorConfigurado) avisos.push('Provedor NFS-e ainda nao configurado na VPS.');
  if (!escritaHabilitada) avisos.push('NFSE_ENABLE_WRITE precisa ser true para envio externo.');

  const baseCalculoIss = Math.max(0, valorServico - deducaoBaseCalculo - descontoIncondicionado);
  const valorIss = arredondarMoeda(baseCalculoIss * (aliquotaIss / 100));
  const baseCalculoPisCofins = baseCalculoPisCofinsInformada > 0 ? baseCalculoPisCofinsInformada : valorServico;
  const pisNaoRetido = pisNaoRetidoInformado > 0
    ? pisNaoRetidoInformado
    : arredondarMoeda(baseCalculoPisCofins * (aliquotaPis / 100));
  const cofinsNaoRetido = cofinsNaoRetidoInformado > 0
    ? cofinsNaoRetidoInformado
    : arredondarMoeda(baseCalculoPisCofins * (aliquotaCofins / 100));
  const retencoesFederais = arredondarMoeda(
    pisRetido + cofinsRetido + csllRetido + irrfRetido + inssRetido + csrfRetido + outrasRetencoes,
  );
  const totalRetencoes = arredondarMoeda((input.issRetido ? valorIss : 0) + retencoesFederais);
  const valorIbs = valorIbsInformado > 0 ? valorIbsInformado : arredondarMoeda(baseCalculoIbsCbs * (aliquotaIbs / 100));
  const valorCbs = valorCbsInformado > 0 ? valorCbsInformado : arredondarMoeda(baseCalculoIbsCbs * (aliquotaCbs / 100));

  return {
    prestadorCnpj,
    municipio: `${NFSE_MUNICIPIO_AUTORIZADO}/${NFSE_UF_AUTORIZADA}`,
    municipioIncidencia: `${input.municipioIncidencia.trim() || '-'}${input.ufIncidencia ? `/${input.ufIncidencia.trim().toUpperCase()}` : ''}`,
    codigoMunicipioIbge,
    tomadorDocumento,
    tomadorNome: input.tomadorNome.trim(),
    competencia: input.competencia,
    descricao: input.descricao.trim(),
    itemListaServico: input.itemListaServico.trim(),
    codigoTributacaoMunicipio: input.codigoTributacaoMunicipio.trim(),
    cnae,
    nbs,
    regimeTributario: input.regimeTributario.trim(),
    optanteSimples: input.optanteSimples,
    exigibilidadeIss: input.exigibilidadeIss.trim(),
    naturezaOperacao: input.naturezaOperacao.trim(),
    indicadorOperacao: input.indicadorOperacao.trim(),
    cstIss: input.cstIss.trim(),
    classificacaoTributariaIbsCbs: input.classificacaoTributariaIbsCbs.trim(),
    destinatarioServico: input.destinatarioServico.trim(),
    valorServico: arredondarMoeda(valorServico),
    baseCalculoIss: arredondarMoeda(baseCalculoIss),
    aliquotaIss,
    valorIss,
    tipoRetencaoPisCofinsCsll: input.tipoRetencaoPisCofinsCsll.trim(),
    codigoSituacaoTributariaPisCofins: input.codigoSituacaoTributariaPisCofins.trim(),
    baseCalculoPisCofins: arredondarMoeda(baseCalculoPisCofins),
    aliquotaPis,
    aliquotaCofins,
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
