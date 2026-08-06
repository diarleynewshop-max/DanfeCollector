import { NextResponse } from 'next/server';
import { exigirUsuario } from '@/lib/usuarios/auth';
import { gerarRelatorioDaeVencidasExcel } from '@/lib/relatorios/daeVencidasExcel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parametroTexto(url: URL, chave: string): string | undefined {
  const valor = url.searchParams.get(chave)?.trim();
  return valor || undefined;
}

function parametroNumero(url: URL, chave: string): number | undefined {
  const valor = parametroTexto(url, chave);
  if (!valor || valor === 'todas') return undefined;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('Empresa invalida.');
  }
  return numero;
}

function parametrosLista(url: URL, chave: string): string[] | undefined {
  const valores = url.searchParams
    .getAll(chave)
    .flatMap((valor) => valor.split(','))
    .map((valor) => valor.trim())
    .filter(Boolean);

  return valores.length > 0 ? [...new Set(valores)] : undefined;
}

function parametrosRaizesCnpj(url: URL): string[] | undefined {
  const valores = parametrosLista(url, 'raizCnpj');
  if (!valores) return undefined;

  const raizes = valores.map((valor) => {
    if (valor === '__none__') return valor;
    const raiz = valor.replace(/\D/g, '').slice(0, 8);
    if (raiz.length !== 8) {
      throw new Error('Empresa invalida.');
    }
    return raiz;
  });

  return [...new Set(raizes)];
}

export async function GET(req: Request) {
  try {
    const usuario = await exigirUsuario();
    const url = new URL(req.url);
    const arquivo = await gerarRelatorioDaeVencidasExcel({
      usuario,
      inicio: parametroTexto(url, 'inicio'),
      fim: parametroTexto(url, 'fim'),
      cnpjId: parametroNumero(url, 'cnpjId'),
      raizesCnpj: parametrosRaizesCnpj(url),
      tipo: parametroTexto(url, 'tipo'),
      situacoes: parametrosLista(url, 'situacao'),
      daeFiltros: parametrosLista(url, 'dae'),
      fornecedores: parametrosLista(url, 'fornecedor'),
      risco: parametroTexto(url, 'risco'),
      busca: parametroTexto(url, 'busca'),
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
