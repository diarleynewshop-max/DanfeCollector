import { NextResponse } from 'next/server';
import { exigirUsuario } from '@/lib/usuarios/auth';
import { gerarRelatorioDaeVencidasExcel } from '@/lib/relatorios/daeVencidasExcel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const usuario = await exigirUsuario();
    const arquivo = await gerarRelatorioDaeVencidasExcel(usuario);
    const filename = encodeURIComponent(arquivo.filename);

    return new Response(new Uint8Array(arquivo.buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${arquivo.filename}"; filename*=UTF-8''${filename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    const message = (error as Error).message || 'Erro ao gerar Excel.';
    const status = /sessao|login/i.test(message) ? 401 : /inval/i.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
