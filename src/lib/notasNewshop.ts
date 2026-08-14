export const RAIZ_CNPJ_NEWSHOP = '45998339';

export type FiltroTransferenciaNewshop = 'ocultar' | 'mostrar' | 'somente';

export type NotaFluxoNewshop = {
  emitenteCnpj?: string | null;
  destCnpj?: string | null;
  cnpj?: { cnpj?: string | null } | null;
};

export function raizCnpjTexto(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '').slice(0, 8);
}

export function notaNewshopParaNewshop(nota: NotaFluxoNewshop): boolean {
  const emitenteRaiz = raizCnpjTexto(nota.emitenteCnpj);
  const destinatarioRaiz = raizCnpjTexto(nota.destCnpj);
  const empresaRaiz = raizCnpjTexto(nota.cnpj?.cnpj);
  return emitenteRaiz === RAIZ_CNPJ_NEWSHOP && (destinatarioRaiz === RAIZ_CNPJ_NEWSHOP || (!destinatarioRaiz && empresaRaiz === RAIZ_CNPJ_NEWSHOP));
}

export function notaPassaFiltroTransferenciaNewshop(
  nota: NotaFluxoNewshop,
  filtro: FiltroTransferenciaNewshop = 'ocultar'
): boolean {
  const interna = notaNewshopParaNewshop(nota);
  if (filtro === 'somente') return interna;
  if (filtro === 'ocultar') return !interna;
  return true;
}

export function normalizarFiltroTransferenciaNewshop(valor: string | null | undefined): FiltroTransferenciaNewshop | undefined {
  const texto = String(valor ?? '').trim().toLowerCase();
  if (!texto) return undefined;
  if (['ocultar', 'padrao', 'hide'].includes(texto)) return 'ocultar';
  if (['mostrar', 'todos', 'incluir', 'show'].includes(texto)) return 'mostrar';
  if (['somente', 'so', 'only'].includes(texto)) return 'somente';
  return undefined;
}
