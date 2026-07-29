import { NextResponse } from 'next/server';
import {
  atualizarSitramPorChavesInterno,
  atualizarSitramPorManifestosInterno,
  importarChavesLoteInterno,
  manifestarNotaInterno,
  manifestarNotasLoteInterno,
  sincronizarCnpjsAtivosInterno,
  sincronizarNotasInterno,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type FiscalPayload = Record<string, unknown>;

function segredoFiscal(): string {
  return (
    process.env.DANFE_FISCAL_WORKER_SECRET?.trim() ||
    process.env.CRON_SYNC_SECRET?.trim() ||
    ''
  );
}

function autorizado(req: Request): boolean {
  const segredo = segredoFiscal();
  if (!segredo) return false;

  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers.get('x-cron-secret')?.trim();
  return bearer === segredo || header === segredo;
}

function numeroObrigatorio(payload: FiscalPayload, campo: string): number {
  const valor = Number(payload[campo]);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`Campo ${campo} invalido.`);
  }
  return valor;
}

function strings(payload: FiscalPayload, campo: string): string[] {
  const valor = payload[campo];
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => String(item));
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { action?: unknown; payload?: unknown };
    const action = typeof body.action === 'string' ? body.action : '';
    const payload = body.payload && typeof body.payload === 'object' ? (body.payload as FiscalPayload) : {};

    switch (action) {
      case 'sincronizarNotas':
        return NextResponse.json(await sincronizarNotasInterno(numeroObrigatorio(payload, 'cnpjId')));

      case 'sincronizarCnpjsAtivos':
        return NextResponse.json(await sincronizarCnpjsAtivosInterno());

      case 'manifestarNota':
        return NextResponse.json(await manifestarNotaInterno(numeroObrigatorio(payload, 'notaId')));

      case 'manifestarNotasLote':
        return NextResponse.json(await manifestarNotasLoteInterno(strings(payload, 'notaIds').map(Number)));

      case 'importarChavesLote':
        return NextResponse.json(
          await importarChavesLoteInterno(
            numeroObrigatorio(payload, 'cnpjId'),
            strings(payload, 'chaves'),
            Boolean(payload.manifestarResumos)
          )
        );

      case 'atualizarSitramPorManifestos':
        return NextResponse.json(await atualizarSitramPorManifestosInterno(strings(payload, 'chavesMdfe')));

      case 'atualizarSitramPorChaves':
        return NextResponse.json(
          await atualizarSitramPorChavesInterno(strings(payload, 'chavesEntrada'), payload.revalidarPagina !== false)
        );

      default:
        return NextResponse.json({ success: false, message: 'Acao fiscal desconhecida.' }, { status: 400 });
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, message: (error as Error).message || 'Erro interno no worker fiscal.' },
      { status: 500 }
    );
  }
}
