export const DIAS_RECONSULTA_DAE_NOVO = 30;

export type LancamentoComVencimento = {
  vencimento?: string | null;
};

export function dentroJanelaReconsultaDaeNovo(
  emitidaEm: Date | string,
  lancamentos: LancamentoComVencimento[],
  referenciaAtual = new Date()
): boolean {
  const corte = new Date(referenciaAtual);
  corte.setHours(0, 0, 0, 0);
  corte.setDate(corte.getDate() - DIAS_RECONSULTA_DAE_NOVO);

  const datas = lancamentos
    .map((lancamento) => lancamento.vencimento ? new Date(lancamento.vencimento) : null)
    .filter((data): data is Date => !!data && !Number.isNaN(data.getTime()));

  const referencia = datas.length > 0
    ? new Date(Math.max(...datas.map((data) => data.getTime())))
    : new Date(emitidaEm);

  return !Number.isNaN(referencia.getTime()) && referencia.getTime() >= corte.getTime();
}
