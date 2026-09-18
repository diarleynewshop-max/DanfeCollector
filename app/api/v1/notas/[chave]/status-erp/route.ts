import { NextResponse } from 'next/server';
import { validarApiKey, type ApiKeyResumo } from '@/lib/apiKeys';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import { consultarStatusNotaErpApi } from '@/lib/erp/statusNfeErp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function autenticarRequisicao(req: Request): Promise<{ ok: boolean; apiKey?: ApiKeyResumo | null }> {
  const apiKey = await validarApiKey(req);
  if (apiKey) return { ok: true, apiKey };

  try {
    const usuario = await obterUsuarioAtual();
    if (usuario) return { ok: true, apiKey: null };
  } catch {
    // Falha silenciosa na leitura do cookie em ambiente sem cookies
  }

  return { ok: false };
}

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const auth = await autenticarRequisicao(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        success: false,
        codigo: 'NAO_AUTORIZADO',
        message: 'Nao autorizado. Forneca uma API Key valida via header Authorization (Bearer <token>) ou X-API-Key.',
      },
      { status: 401 }
    );
  }

  const { chave } = await params;
  const url = new URL(req.url);
  const empresa = url.searchParams.get('empresa');
  const forcar = ['1', 'true', 'sim'].includes((url.searchParams.get('forcar') ?? url.searchParams.get('force') ?? '').toLowerCase());

  const resultado = await consultarStatusNotaErpApi({
    chave,
    empresa,
    forcar,
    req,
    apiKey: auth.apiKey,
  });

  return NextResponse.json(resultado.body, {
    status: resultado.status,
    headers: resultado.headers,
  });
}
