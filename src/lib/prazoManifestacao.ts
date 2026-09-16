// Prazo real de manifestação (Ciência da Operação): a própria SEFAZ rejeita
// o evento com cStat 596 "Evento apresentado apos o prazo permitido para o
// evento: [10 dias]" passado esse número de dias da emissão — confirmado nos
// logs de produção em 16/09/2026 (tentativa em lote de notas com 10-90 dias
// voltou 596 para todas). NÃO é 90 dias (isso é o limite de consulta da
// distribuição DFe, um limite diferente). Compartilhado entre o dashboard
// (client) e as actions (server) — este arquivo não tem 'use server', então
// pode exportar uma constante simples.
export const PRAZO_MANIFESTACAO_DIAS = 10;

export function dentroPrazoManifestacao(emitidaEm: Date | string, referencia = new Date()): boolean {
  const limite = new Date(referencia);
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - PRAZO_MANIFESTACAO_DIAS);
  return new Date(emitidaEm).getTime() >= limite.getTime();
}
