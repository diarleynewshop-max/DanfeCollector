import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { consultarXmlNotaFiscalApi } from '@/lib/publicApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const { chave } = await params;
  const resultado = await consultarXmlNotaFiscalApi(chave);

  return new NextResponse(resultado.body, {
    status: resultado.status,
    headers: {
      'content-type': resultado.status === 200 ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8',
    },
  });
}
