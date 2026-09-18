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
    // Falha silenciosa na leitura do cookie
  }

  return { ok: false };
}

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const chave = url.searchParams.get('chave') ?? '';
  const empresa = url.searchParams.get('empresa');
  const forcar = ['1', 'true', 'sim'].includes((url.searchParams.get('forcar') ?? url.searchParams.get('force') ?? '').toLowerCase());

  if (!chave.trim()) {
    return NextResponse.json(
      {
        success: false,
        codigo: 'CHAVE_OBRIGATORIA',
        message: 'Parametro "chave" obrigatorio na query string. Exemplo: /api/v1/erp/status-nfe?chave=44DIGITOS',
      },
      { status: 400 }
    );
  }

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

export async function POST(req: Request) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        codigo: 'JSON_INVALIDO',
        message: 'Corpo da requisicao deve ser um JSON valido com { "chave": "44DIGITOS" }.',
      },
      { status: 400 }
    );
  }

  const payload = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const chave = String(payload.chave ?? '').trim();
  const empresa = typeof payload.empresa === 'string' ? payload.empresa : null;
  const forcar = Boolean(payload.forcar || payload.force);

  if (!chave) {
    return NextResponse.json(
      {
        success: false,
        codigo: 'CHAVE_OBRIGATORIA',
        message: 'Campo "chave" obrigatorio no corpo da requisicao.',
      },
      { status: 400 }
    );
  }

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
