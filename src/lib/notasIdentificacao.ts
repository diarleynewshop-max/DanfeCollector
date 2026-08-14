import { RAIZ_CNPJ_NEWSHOP, raizCnpjTexto } from './notasNewshop';

export type NotaComIdentificacao = {
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  emitenteCnpj?: string | null;
  cnpj: {
    cnpj: string;
    razaoSocial?: string | null;
  };
};

export function raizCnpj(valor: string | null | undefined): string {
  return raizCnpjTexto(valor);
}

export function nomeEmpresaRelatorioPorRaiz(raiz: string, fallback?: string | null): string {
  if (raiz === RAIZ_CNPJ_NEWSHOP) return 'Newshop';
  if (raiz === '50767035') return 'Facil';
  if (raiz === '62803717') return 'Soye';
  return fallback || raiz || 'Empresa';
}

export function nomeGrupoEmpresa(cnpj: string | null | undefined): string {
  const raiz = raizCnpj(cnpj);
  if (raiz === '50767035' || raiz === '62803717') return 'GRUPO SF';
  if (raiz === RAIZ_CNPJ_NEWSHOP) return 'GRUPO NEWSHOP';
  return 'OUTROS';
}

function formatarCnpjBasico(cnpj: string): string {
  const digitos = cnpj.replace(/\D/g, '');
  if (digitos.length !== 14) return cnpj;
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function nomeEmpresaCurta(nota: NotaComIdentificacao): string {
  const cnpj = nota.cnpj.cnpj.replace(/\D/g, '');
  if (cnpj === '50767035000129') return 'Facil';
  if (cnpj === '50767035000200') return 'Facil Filial';
  if (cnpj === '62803717000129') return 'Soye';
  if (cnpj.startsWith(RAIZ_CNPJ_NEWSHOP)) return nota.cnpj.razaoSocial || 'Newshop';
  return nota.cnpj.razaoSocial || formatarCnpjBasico(nota.cnpj.cnpj);
}

export function numeroNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const numero = normalizada.slice(25, 34);
  return numero.replace(/^0+/, '') || numero;
}

export function serieNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const serie = normalizada.slice(22, 25);
  return serie.replace(/^0+/, '') || serie;
}

export function numeroNotaSistema(nota: Pick<NotaComIdentificacao, 'numero' | 'chave'>): string {
  return nota.numero || numeroNotaDaChave(nota.chave) || '';
}

export function serieNotaSistema(nota: Pick<NotaComIdentificacao, 'serie' | 'chave'>): string {
  return nota.serie || serieNotaDaChave(nota.chave) || '';
}

export function numeroNotaBusca(nota: Pick<NotaComIdentificacao, 'numero' | 'chave'>): string {
  const numero = numeroNotaSistema(nota);
  return String(Number(numero) || numero.replace(/^0+/, '') || '');
}
