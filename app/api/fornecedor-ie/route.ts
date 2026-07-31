import { NextResponse } from 'next/server';
import {
  consultarIeFornecedorPublica,
  LINKS_SEFAZ_IE,
  limparCnpjFornecedor,
} from '@/lib/ieFornecedor';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const cnpj = limparCnpjFornecedor(url.searchParams.get('cnpj') ?? '');
  const uf = url.searchParams.get('uf')?.trim().toUpperCase() || '';

  try {
    const consulta = await consultarIeFornecedorPublica(cnpj, uf || undefined);
    const ufLink = uf || consulta.inscricoesEstaduais[0]?.uf || consulta.uf || '';

    return NextResponse.json({
      success: true,
      consulta,
      portalOficial: ufLink ? LINKS_SEFAZ_IE[ufLink] ?? null : null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { success: false, message: (error as Error).message || 'Erro ao consultar IE do fornecedor.' },
      { status: 400 }
    );
  }
}
