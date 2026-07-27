import { NextResponse } from 'next/server';
import { sincronizarCnpjsAtivosInterno } from '@/lib/actions';

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

  try {
    const resultado = await sincronizarCnpjsAtivosInterno();
    return NextResponse.json(resultado, { status: resultado.success ? 200 : 500 });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, message: (error as Error).message || 'Erro interno na sincronizacao.' },
      { status: 500 }
    );
  }
}
