import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { consultarNotaFiscalApi } from '@/lib/publicApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const { chave } = await params;
  const url = new URL(req.url);
  const incluirXml = ['1', 'true', 'sim'].includes((url.searchParams.get('xml') ?? '').toLowerCase());
  const resultado = await consultarNotaFiscalApi(chave, req, incluirXml);

  return NextResponse.json(resultado.body, { status: resultado.status });
}
