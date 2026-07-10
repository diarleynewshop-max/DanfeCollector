import { prisma } from '@/lib/prisma';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import { lerArquivo } from '@/lib/anexos/storage';

// Serve um anexo de forma autenticada. Valida sessão e confere que o anexo
// pertence à nota informada na URL (impede acesso por id avulso).
// ?download=1 força "salvar como"; sem ele, abre inline (PDF/imagem no navegador).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ chave: string; anexoId: string }> }
) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) return new Response('Não autenticado.', { status: 401 });

  const { chave, anexoId } = await params;
  const id = Number(anexoId);
  if (!Number.isInteger(id)) return new Response('Anexo inválido.', { status: 400 });

  const anexo = await prisma.anexo.findUnique({
    where: { id },
    include: { nota: { select: { chave: true } } },
  });
  if (!anexo || anexo.nota.chave !== chave) {
    return new Response('Anexo não encontrado.', { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = lerArquivo(anexo.caminho);
  } catch {
    return new Response('Arquivo do anexo não está mais no disco.', { status: 404 });
  }

  const baixar = new URL(req.url).searchParams.get('download') === '1';
  const disposicao = baixar ? 'attachment' : 'inline';
  // Nome de download: usa o nome original, sanitizado para o header.
  const nomeArquivo = anexo.arquivoNome.replace(/[\r\n"]/g, '_');

  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': anexo.mime || 'application/octet-stream',
      'Content-Disposition': `${disposicao}; filename="${nomeArquivo}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
    },
  });
}
