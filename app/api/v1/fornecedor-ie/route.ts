import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { consultarFornecedorIeApi } from '@/lib/publicApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const resultado = await consultarFornecedorIeApi(
    url.searchParams.get('cnpj') ?? '',
    url.searchParams.get('uf') ?? undefined,
  );

  return NextResponse.json(resultado.body, { status: resultado.status });
}
