import { prisma } from '@/lib/prisma';
import { lerXmlComFallback } from '@/lib/xmlpath';
import { obterUsuarioAtual, usuarioPodeAcessarCnpj } from '@/lib/usuarios/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chave: string }> },
) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) return new Response('Nao autenticado.', { status: 401 });

  const { chave } = await params;
  const nota = await prisma.notaFiscal.findUnique({
    where: { chave },
    select: {
      chave: true,
      cnpjId: true,
      status: true,
      xmlStorageKey: true,
      xmlPath: true,
    },
  });

  if (!nota) return new Response('Nota fiscal nao encontrada.', { status: 404 });
  if (!usuarioPodeAcessarCnpj(usuario, nota.cnpjId)) {
    return new Response('Acesso negado.', { status: 403 });
  }
  if (nota.status !== 'COMPLETA') {
    return new Response('XML completo ainda nao disponivel para esta nota.', { status: 409 });
  }

  let xml: string | null;
  try {
    xml = await lerXmlComFallback(nota.xmlStorageKey, nota.xmlPath);
  } catch (erro) {
    console.error(`Falha ao preparar XML para download da NF-e ${nota.chave}:`, erro);
    return new Response('Nao foi possivel acessar o XML no storage. Tente novamente em instantes.', { status: 503 });
  }
  if (!xml) return new Response('XML nao encontrado no storage.', { status: 404 });

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="NFe-${nota.chave}.xml"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
