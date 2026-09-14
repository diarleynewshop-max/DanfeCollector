import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { consultarDacteApi } from '@/lib/publicApiCte';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const { chave } = await params;
  const resultado = await consultarDacteApi(chave, req);

  return NextResponse.json(resultado.body, { status: resultado.status });
}
