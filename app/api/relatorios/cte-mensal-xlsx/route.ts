import { NextResponse } from 'next/server';
import { gerarRelatorioCteMensalExcel } from '@/lib/relatorios/cteMensalExcel';
import { exigirUsuario } from '@/lib/usuarios/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parametroTexto(url: URL, chave: string): string | undefined {
  const valor = url.searchParams.get(chave)?.trim();
  return valor || undefined;
}

function parametroCnpjId(url: URL): number | undefined {
  const valor = parametroTexto(url, 'cnpjId');
  if (!valor || valor === 'todos') return undefined;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('Empresa invalida.');
  }
  return numero;
}

export async function GET(req: Request) {
  try {
    const usuario = await exigirUsuario();
    const url = new URL(req.url);
    const arquivo = await gerarRelatorioCteMensalExcel({
      usuario,
      inicio: parametroTexto(url, 'inicio'),
      fim: parametroTexto(url, 'fim'),
      cnpjId: parametroCnpjId(url),
    });
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
