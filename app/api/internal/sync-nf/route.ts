import { NextResponse } from 'next/server';
import {
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
    const resultado = await sincronizarCnpjsAtivosInterno();
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
