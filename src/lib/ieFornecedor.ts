import { consultarCadastroContribuinteSefaz } from './sefaz/cadastro';
import { LINK_CCC_SEFAZ, LINKS_SEFAZ_IE, UFS_BRASIL } from './ieFornecedorConstantes';
import { chamarFiscalWorker, usarProxyFiscal } from './fiscalProxy';

export { LINK_CCC_SEFAZ, LINKS_SEFAZ_IE, UFS_BRASIL };

export type InscricaoEstadualFornecedor = {
  inscricao: string;
  uf: string;
  estado: string;
  ativo: boolean;
  atualizadoEm: string | null;
  situacao?: string | null;
  regimeApuracao?: string | null;
};

export type ConsultaIeFornecedor = {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string | null;
  uf: string | null;
  cidade: string | null;
  cep: string | null;
  endereco: string | null;
  cnaePrincipal: string | null;
  dataInicioAtividade: string | null;
  atualizadoEm: string | null;
  inscricoesEstaduais: InscricaoEstadualFornecedor[];
  fonte: string;
  fonteDadosCnpj: string;
  fonteIe: string | null;
  statusIe: string;
  aviso: string | null;
  consultaOficial: {
    tentou: boolean;
    ok: boolean;
    mensagem: string | null;
  };
};

async function consultarDadosPublicosCnpj(cnpj: string): Promise<CnpjWsResposta> {
  const baseUrl = process.env.CNPJ_WS_PUBLICA_URL || 'https://publica.cnpj.ws/cnpj';
  const resposta = await fetch(`${baseUrl.replace(/\/+$/, '')}/${cnpj}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 * 60 * 24 },
  });

  if (resposta.status === 404) {
    throw new Error('CNPJ nao encontrado na base publica.');
  }
  if (resposta.status === 429) {
    throw new Error('Consulta publica em limite de uso. Tente novamente em alguns minutos.');
  }
  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`Consulta publica falhou HTTP ${resposta.status}: ${corpo.slice(0, 180) || resposta.statusText}`);
  }

  return (await resposta.json()) as CnpjWsResposta;
}

type CnpjWsIe = {
  inscricao_estadual?: unknown;
  ativo?: unknown;
  atualizado_em?: unknown;
  estado?: {
    nome?: unknown;
    sigla?: unknown;
  };
};

type CnpjWsResposta = {
  razao_social?: unknown;
  atualizado_em?: unknown;
  estabelecimento?: {
    cnpj?: unknown;
    nome_fantasia?: unknown;
    situacao_cadastral?: unknown;
    data_inicio_atividade?: unknown;
    tipo_logradouro?: unknown;
    logradouro?: unknown;
    numero?: unknown;
    complemento?: unknown;
    bairro?: unknown;
    cep?: unknown;
    atividade_principal?: {
      id?: unknown;
      descricao?: unknown;
    };
    estado?: {
      sigla?: unknown;
      nome?: unknown;
    };
    cidade?: {
      nome?: unknown;
    };
    inscricoes_estaduais?: CnpjWsIe[];
  };
};

type RetornoOficialIe = Awaited<ReturnType<typeof consultarCadastroContribuinteSefaz>>;

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const limpo = String(valor).trim();
  return limpo || null;
}

export function limparCnpjFornecedor(valor: string): string {
  return valor.replace(/\D/g, '');
}

export function validarCnpjFornecedor(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcularDigito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((acc, dig, i) => acc + Number(dig) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const dig1 = calcularDigito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dig2 = calcularDigito(cnpj.slice(0, 12) + dig1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return cnpj[12] === String(dig1) && cnpj[13] === String(dig2);
}

async function consultarOficialIe(uf: string, cnpj: string): Promise<RetornoOficialIe> {
  if (usarProxyFiscal()) {
    return chamarFiscalWorker<RetornoOficialIe>('consultarIeFornecedorOficial', { uf, cnpj });
  }
  return consultarCadastroContribuinteSefaz(uf, cnpj);
}

function ufValida(uf: string): boolean {
  return UFS_BRASIL.includes(uf as (typeof UFS_BRASIL)[number]);
}

function montarEndereco(estabelecimento: NonNullable<CnpjWsResposta['estabelecimento']>): string | null {
  const partes = [
    texto(estabelecimento.tipo_logradouro),
    texto(estabelecimento.logradouro),
    texto(estabelecimento.numero),
    texto(estabelecimento.complemento),
    texto(estabelecimento.bairro),
  ].filter(Boolean);
  return partes.join(', ') || null;
}

function retornoNaoContribuinte(retorno: RetornoOficialIe | null): boolean {
  return retorno?.cStat === 259 || /nao cadastrado como contribuinte/i.test(retorno?.xMotivo ?? '');
}

function statusIeFornecedor(
  retorno: RetornoOficialIe | null,
  inscricoesEstaduais: InscricaoEstadualFornecedor[],
  tentouConsultaOficial: boolean,
): string {
  if (inscricoesEstaduais.length > 0) return 'Contribuinte';
  if (retornoNaoContribuinte(retorno)) return 'Nao contribuinte';
  if (retorno?.cStat === 410) return 'UF nao atendida pelo WebService';
  if (tentouConsultaOficial) return 'Sem IE retornada';
  return 'Nao consultado';
}

export async function consultarIeFornecedor(cnpj: string, ufFiltro?: string): Promise<ConsultaIeFornecedor> {
  const cnpjLimpo = limparCnpjFornecedor(cnpj);
  if (!validarCnpjFornecedor(cnpjLimpo)) {
    throw new Error('CNPJ invalido. Verifique os digitos.');
  }

  const uf = ufFiltro?.trim().toUpperCase();
  if (uf && !ufValida(uf)) {
    throw new Error('UF invalida.');
  }

  let retornoOficial: RetornoOficialIe | null = null;
  let erroOficial: string | null = null;
  let dados: CnpjWsResposta | null = null;
  let erroDadosPublicos: string | null = null;

  try {
    dados = await consultarDadosPublicosCnpj(cnpjLimpo);
  } catch (error: unknown) {
    erroDadosPublicos = (error as Error).message || 'Falha na consulta publica do CNPJ.';
  }

  const estabelecimento = dados?.estabelecimento ?? {};
  const ufConsultaOficial = uf || texto(estabelecimento.estado?.sigla) || '';

  if (ufConsultaOficial && ufValida(ufConsultaOficial)) {
    try {
      retornoOficial = await consultarOficialIe(ufConsultaOficial, cnpjLimpo);
    } catch (error: unknown) {
      erroOficial = (error as Error).message || 'Falha na consulta oficial SEFAZ.';
    }
  }

  if (!dados && !retornoOficial?.cadastros.length) {
    throw new Error(
      [
        erroDadosPublicos,
        erroOficial,
        retornoOficial?.xMotivo ? `SEFAZ: ${retornoOficial.xMotivo}` : null,
      ].filter(Boolean).join(' | ') || 'Nenhuma consulta retornou dados.'
    );
  }

  const inscricoes = Array.isArray(estabelecimento.inscricoes_estaduais)
    ? estabelecimento.inscricoes_estaduais
    : [];

  const inscricoesPublicas = inscricoes
    .map((ie) => ({
      inscricao: texto(ie.inscricao_estadual) ?? '',
      uf: texto(ie.estado?.sigla) ?? '',
      estado: texto(ie.estado?.nome) ?? '',
      ativo: Boolean(ie.ativo),
      atualizadoEm: texto(ie.atualizado_em),
    }))
    .filter((ie) => ie.inscricao && (!uf || ie.uf === uf));

  const inscricoesOficiais = (retornoOficial?.cadastros ?? []).map((cad) => ({
    inscricao: cad.ie,
    uf: cad.uf,
    estado: cad.uf,
    ativo: cad.situacao === 'Habilitado',
    atualizadoEm: cad.dataUltimaSituacao ?? retornoOficial?.consultadoEm ?? null,
    situacao: cad.situacao,
    regimeApuracao: cad.regimeApuracao,
  }));
  const inscricoesEstaduais = inscricoesOficiais.length > 0 ? inscricoesOficiais : inscricoesPublicas;

  const cadastroOficial = retornoOficial?.cadastros[0] ?? null;
  const cnaeId = cadastroOficial?.cnae ?? texto(estabelecimento.atividade_principal?.id);
  const cnaeDescricao = cadastroOficial?.cnae ? null : texto(estabelecimento.atividade_principal?.descricao);
  const fonte = inscricoesOficiais.length > 0
    ? 'SEFAZ NFeConsultaCadastro'
    : retornoOficial?.cStat
      ? `SEFAZ sem IE (${retornoOficial.cStat}) + CNPJ.ws publica`
      : 'CNPJ.ws publica';
  const tentouConsultaOficial = Boolean(ufConsultaOficial && ufValida(ufConsultaOficial));
  const statusIe = statusIeFornecedor(retornoOficial, inscricoesEstaduais, tentouConsultaOficial);

  return {
    cnpj: texto(estabelecimento.cnpj) ?? cnpjLimpo,
    razaoSocial: cadastroOficial?.razaoSocial ?? texto(dados?.razao_social) ?? 'Razao social nao informada',
    nomeFantasia: cadastroOficial?.nomeFantasia ?? texto(estabelecimento.nome_fantasia),
    situacaoCadastral: texto(estabelecimento.situacao_cadastral),
    uf: texto(estabelecimento.estado?.sigla) ?? cadastroOficial?.uf ?? (ufConsultaOficial || null),
    cidade: texto(estabelecimento.cidade?.nome),
    cep: texto(estabelecimento.cep),
    endereco: cadastroOficial?.endereco ?? montarEndereco(estabelecimento),
    cnaePrincipal: [cnaeId, cnaeDescricao].filter(Boolean).join(' - ') || null,
    dataInicioAtividade: cadastroOficial?.dataInicioAtividade ?? texto(estabelecimento.data_inicio_atividade),
    atualizadoEm: retornoOficial?.consultadoEm ?? texto(dados?.atualizado_em),
    inscricoesEstaduais,
    fonte,
    fonteDadosCnpj: dados ? 'CNPJ.ws publica' : 'nao retornou',
    fonteIe: inscricoesOficiais.length > 0
      ? 'SEFAZ NFeConsultaCadastro'
      : inscricoesPublicas.length > 0
        ? 'CNPJ.ws publica'
        : null,
    statusIe,
    aviso: inscricoesEstaduais.length === 0
      ? (retornoNaoContribuinte(retornoOficial)
          ? 'Nao contribuinte: CNPJ nao cadastrado como contribuinte na UF consultada.'
          : retornoOficial
          ? `${retornoOficial.xMotivo || 'SEFAZ nao retornou IE para este CNPJ/UF.'} Confirme no CCC/portal oficial se a operacao exigir validacao fiscal.`
          : `A base publica nao retornou IE para este CNPJ/UF.${erroOficial ? ` Consulta oficial nao concluida: ${erroOficial}` : ''}`)
      : (erroOficial || erroDadosPublicos
          ? [
              erroDadosPublicos ? `Dados do CNPJ nao concluidos: ${erroDadosPublicos}` : null,
              erroOficial ? `Consulta oficial de IE nao concluiu: ${erroOficial}` : null,
            ].filter(Boolean).join(' ')
          : null),
    consultaOficial: {
      tentou: tentouConsultaOficial,
      ok: Boolean(retornoOficial && inscricoesOficiais.length > 0),
      mensagem: retornoOficial?.xMotivo ?? erroOficial ?? (!tentouConsultaOficial ? 'UF nao informada pela base publica.' : null),
    },
  };
}

export const consultarIeFornecedorPublica = consultarIeFornecedor;
