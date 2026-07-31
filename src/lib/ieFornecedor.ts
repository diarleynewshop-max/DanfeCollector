export type InscricaoEstadualFornecedor = {
  inscricao: string;
  uf: string;
  estado: string;
  ativo: boolean;
  atualizadoEm: string | null;
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
  aviso: string | null;
};

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

export const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const LINKS_SEFAZ_IE: Record<string, string> = {
  AC: 'https://sefazonline.ac.gov.br/',
  AL: 'https://sintegra.sefaz.al.gov.br/',
  AP: 'https://www.sefaz.ap.gov.br/',
  AM: 'https://online.sefaz.am.gov.br/',
  BA: 'https://portal.sefaz.ba.gov.br/',
  CE: 'https://consultapublica.sefaz.ce.gov.br/',
  DF: 'https://agnet.fazenda.df.gov.br/',
  ES: 'https://dfe-portal.svrs.rs.gov.br/Nfe/Ccc',
  GO: 'https://appasp.sefaz.go.gov.br/',
  MA: 'https://sistemas1.sefaz.ma.gov.br/',
  MT: 'https://www.sefaz.mt.gov.br/',
  MS: 'https://servicos.efazenda.ms.gov.br/',
  MG: 'https://dfe-portal.svrs.rs.gov.br/Nfe/Ccc',
  PA: 'https://app.sefa.pa.gov.br/',
  PB: 'https://www4.sefaz.pb.gov.br/',
  PR: 'https://www.sintegra.fazenda.pr.gov.br/',
  PE: 'https://dfe-portal.svrs.rs.gov.br/Nfe/Ccc',
  PI: 'https://dfe-portal.svrs.rs.gov.br/Nfe/Ccc',
  RJ: 'https://sucief-sincad-web.fazenda.rj.gov.br/',
  RN: 'https://uvt.sefaz.rn.gov.br/',
  RS: 'https://www.sefaz.rs.gov.br/',
  RO: 'https://portalcontribuinte.sefin.ro.gov.br/',
  RR: 'https://portalweb.sefaz.rr.gov.br/',
  SC: 'https://sat.sef.sc.gov.br/',
  SP: 'https://www.cadesp.fazenda.sp.gov.br/',
  SE: 'https://security.sefaz.se.gov.br/',
  TO: 'https://sintegra.sefaz.to.gov.br/',
};

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

export async function consultarIeFornecedorPublica(cnpj: string, ufFiltro?: string): Promise<ConsultaIeFornecedor> {
  const cnpjLimpo = limparCnpjFornecedor(cnpj);
  if (!validarCnpjFornecedor(cnpjLimpo)) {
    throw new Error('CNPJ invalido. Verifique os digitos.');
  }

  const uf = ufFiltro?.trim().toUpperCase();
  if (uf && !UFS_BRASIL.includes(uf as (typeof UFS_BRASIL)[number])) {
    throw new Error('UF invalida.');
  }

  const baseUrl = process.env.CNPJ_WS_PUBLICA_URL || 'https://publica.cnpj.ws/cnpj';
  const resposta = await fetch(`${baseUrl.replace(/\/+$/, '')}/${cnpjLimpo}`, {
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

  const dados = (await resposta.json()) as CnpjWsResposta;
  const estabelecimento = dados.estabelecimento ?? {};
  const inscricoes = Array.isArray(estabelecimento.inscricoes_estaduais)
    ? estabelecimento.inscricoes_estaduais
    : [];

  const inscricoesEstaduais = inscricoes
    .map((ie) => ({
      inscricao: texto(ie.inscricao_estadual) ?? '',
      uf: texto(ie.estado?.sigla) ?? '',
      estado: texto(ie.estado?.nome) ?? '',
      ativo: Boolean(ie.ativo),
      atualizadoEm: texto(ie.atualizado_em),
    }))
    .filter((ie) => ie.inscricao && (!uf || ie.uf === uf));

  const cnaeId = texto(estabelecimento.atividade_principal?.id);
  const cnaeDescricao = texto(estabelecimento.atividade_principal?.descricao);

  return {
    cnpj: texto(estabelecimento.cnpj) ?? cnpjLimpo,
    razaoSocial: texto(dados.razao_social) ?? 'Razao social nao informada',
    nomeFantasia: texto(estabelecimento.nome_fantasia),
    situacaoCadastral: texto(estabelecimento.situacao_cadastral),
    uf: texto(estabelecimento.estado?.sigla),
    cidade: texto(estabelecimento.cidade?.nome),
    cep: texto(estabelecimento.cep),
    endereco: montarEndereco(estabelecimento),
    cnaePrincipal: [cnaeId, cnaeDescricao].filter(Boolean).join(' - ') || null,
    dataInicioAtividade: texto(estabelecimento.data_inicio_atividade),
    atualizadoEm: texto(dados.atualizado_em),
    inscricoesEstaduais,
    fonte: 'CNPJ.ws publica',
    aviso: inscricoesEstaduais.length === 0
      ? 'Nenhuma IE retornada para este CNPJ/UF. Confirme no portal oficial da SEFAZ quando a operacao exigir validacao fiscal.'
      : null,
  };
}
