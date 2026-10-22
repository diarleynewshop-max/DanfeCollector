import { NextResponse } from 'next/server';
import {
  executarBackfillFiscalAutomaticoInterno,
  executarMonitorSitramContinuoInterno,
  manifestarAutomaticamenteNotasElegiveisInterno,
  registrarFimWorker,
  registrarInicioWorker,
  sincronizarCnpjsAtivosInterno,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

function autorizado(req: Request): boolean {
  const segredo = process.env.CRON_SYNC_SECRET?.trim();
  if (!segredo) return false;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers.get('x-cron-secret')?.trim();
  return bearer === segredo || header === segredo;
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  await registrarInicioWorker();
  try {
    const sincronizacao = await sincronizarCnpjsAtivosInterno();
    const backfillFiscal = await executarBackfillFiscalAutomaticoInterno(40, 60, sincronizacao);
    const monitorSitram = await executarMonitorSitramContinuoInterno(50);
    const autoManifesto = await manifestarAutomaticamenteNotasElegiveisInterno(30);
    const manifestadasAuto = autoManifesto.resultados.filter((r) => r.status === 'manifestada').length;
    const erradasAuto = autoManifesto.resultados.filter((r) => r.status === 'erro').length;
    const resultado = {
      ...sincronizacao,
      success: sincronizacao.success && backfillFiscal.success && monitorSitram.success,
      message: `${sincronizacao.message} SITRAM backfill: ${backfillFiscal.chavesSitram} NF-e verificada(s), ${backfillFiscal.sitramAtualizadas} atualizada(s), ${backfillFiscal.sitramErros} erro(s). Monitor continuo: ${monitorSitram.message} Manifestacao automatica: ${autoManifesto.elegivel} elegivel(is), ${manifestadasAuto} manifestada(s), ${erradasAuto} erro(s).`,
      backfillFiscal,
      monitorSitram,
      autoManifesto,
    };
    await registrarFimWorker(resultado);
    // A falha de um CNPJ fica isolada no resumo. A rota permanece 200 para
    // que o worker continue vivo e tente os demais no próximo ciclo.
    return NextResponse.json(resultado, { status: 200 });
  } catch (error: unknown) {
    const resultado = {
      success: false,
      message: (error as Error).message || 'Erro interno na sincronizacao.',
    };
    await registrarFimWorker(resultado);
    return NextResponse.json(
      resultado,
      { status: 500 }
    );
  }
}
