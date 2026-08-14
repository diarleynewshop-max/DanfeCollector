export const EMPRESA_RELATORIO_TODAS = 'todas';
export const EMPRESA_RELATORIO_NENHUMA = 'nenhuma';
export const EMPRESA_RELATORIO_PERSONALIZADO = 'personalizado';

export type ValorEmpresaRelatoriosProntos =
  | typeof EMPRESA_RELATORIO_TODAS
  | typeof EMPRESA_RELATORIO_NENHUMA
  | typeof EMPRESA_RELATORIO_PERSONALIZADO
  | string;

export function alternarValorFiltro(atuais: string[], valor: string): string[] {
  return atuais.includes(valor) ? atuais.filter((item) => item !== valor) : [...atuais, valor];
}

export function mesmosValoresFiltro(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((valor) => set.has(valor));
}

export function resolverValorEmpresaRelatoriosProntos(
  raizesSelecionadas: string[],
  raizesTodas: string[]
): ValorEmpresaRelatoriosProntos {
  if (raizesSelecionadas.length === 0) return EMPRESA_RELATORIO_NENHUMA;
  if (mesmosValoresFiltro(raizesSelecionadas, raizesTodas)) return EMPRESA_RELATORIO_TODAS;
  if (raizesSelecionadas.length === 1) return raizesSelecionadas[0];
  return EMPRESA_RELATORIO_PERSONALIZADO;
}

export function resolverRaizesEmpresaRelatoriosProntos(valor: string, raizesTodas: string[]): string[] | null {
  if (valor === EMPRESA_RELATORIO_PERSONALIZADO) return null;
  if (valor === EMPRESA_RELATORIO_TODAS) return [...raizesTodas];
  if (valor === EMPRESA_RELATORIO_NENHUMA) return [];
  return [valor];
}
