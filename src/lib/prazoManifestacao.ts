// Prazo prático de manifestação (Ciência da Operação) usado só para exibição
// e para decidir quais notas ainda vale tentar manifestar: passado esse
// número de dias desde a emissão, a SEFAZ para de aceitar a manifestação
// dessa NF-e (na prática, o contexto de distribuição/DFe também já saiu da
// janela de consulta). Compartilhado entre o dashboard (client) e as actions
// (server) — este arquivo não tem 'use server', então pode exportar uma
// constante simples.
export const PRAZO_MANIFESTACAO_DIAS = 90;

export function dentroPrazoManifestacao(emitidaEm: Date | string, referencia = new Date()): boolean {
  const limite = new Date(referencia);
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - PRAZO_MANIFESTACAO_DIAS);
  return new Date(emitidaEm).getTime() >= limite.getTime();
}
