import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { consultarNotaFiscalApi } from '@/lib/publicApi';
import { normalizarTipoTributoItemSitram } from '@/lib/sitram/espelho';

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
  const tributoItemRaw = url.searchParams.get('tributoItem');
  const tributoItem = normalizarTipoTributoItemSitram(tributoItemRaw);
  if (tributoItemRaw && !tributoItem && tributoItemRaw.toLowerCase() !== 'todos') {
    return NextResponse.json({ success: false, message: 'Tributo por item invalido.' }, { status: 400 });
  }
  const resultado = await consultarNotaFiscalApi(chave, req, incluirXml, tributoItem);

  return NextResponse.json(resultado.body, { status: resultado.status });
}
