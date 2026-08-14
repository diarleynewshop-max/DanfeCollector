import { extrairItensSitram } from './espelho';

export const SITRAM_BACKFILL_COOLDOWN_MS = 60 * 60 * 1000;

export type NotaBackfillSitram = {
  emitenteUf?: string | null;
  status?: string | null;
  situacaoSefaz?: string | null;
  sitramConsultadaEm?: Date | string | null;
  sitramDetalhe?: string | null;
};

export function notaPrecisaBackfillSitram(nota: NotaBackfillSitram): boolean {
  const ufEmitente = (nota.emitenteUf ?? '').trim().toUpperCase();
  if (!ufEmitente || ufEmitente === 'CE') return false;
  if (nota.status !== 'COMPLETA') return false;
  if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') return false;

  const detalhe = nota.sitramDetalhe ?? '';
  const itens = extrairItensSitram(nota);
  return (
    !nota.sitramConsultadaEm ||
    !detalhe ||
    itens.length === 0 ||
    !detalhe.includes('"itens"') ||
    !detalhe.includes('"calculadoraSitram"') ||
    detalhe.includes('"itensErro"') ||
    detalhe.includes('"calculadorasErro"')
  );
}
