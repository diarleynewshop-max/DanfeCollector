import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { listarCtesApi } from '@/lib/publicApiCte';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const resultado = await listarCtesApi(req);
  return NextResponse.json(resultado.body, { status: resultado.status });
}
