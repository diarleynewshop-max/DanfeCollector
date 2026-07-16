import { prisma } from '@/lib/prisma';
import { lerArquivo } from '@/lib/anexos/storage';
import { opcoesCompartilhadasDae } from '@/lib/sitram/dae';
import { obterUsuarioAtual, usuarioPodeAcessarCnpj } from '@/lib/usuarios/auth';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chave: string; anexoId: string }> }
) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) return new Response('Nao autenticado.', { status: 401 });

  const { chave, anexoId } = await params;
  const id = Number(anexoId);
  if (!Number.isInteger(id)) return new Response('Anexo invalido.', { status: 400 });

  const [anexo, nota] = await Promise.all([
    prisma.anexo.findUnique({
      where: { id },
      include: {
        nota: { select: { chave: true } },
        daeCompartilhado: { select: { chave: true } },
      },
    }),
    prisma.notaFiscal.findUnique({
      where: { chave },
      select: {
        cnpjId: true,
        sitramDaeStatus: true,
        sitramDaeResumo: true,
        sitramDetalhe: true,
      },
    }),
  ]);

  if (nota && !usuarioPodeAcessarCnpj(usuario, nota.cnpjId)) {
    return new Response('Acesso negado.', { status: 403 });
  }

  const chavesDae = nota
    ? new Set(opcoesCompartilhadasDae(nota).map((item) => item.chave))
    : new Set<string>();
  const pertenceNota = anexo?.nota?.chave === chave;
  const pertenceDae = !!anexo?.daeCompartilhado?.chave && chavesDae.has(anexo.daeCompartilhado.chave);

  if (!anexo || (!pertenceNota && !pertenceDae)) {
    return new Response('Anexo nao encontrado.', { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = lerArquivo(anexo.caminho);
  } catch {
    return new Response('Arquivo do anexo nao esta mais no disco.', { status: 404 });
  }

  const baixar = new URL(req.url).searchParams.get('download') === '1';
  const disposicao = baixar ? 'attachment' : 'inline';
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
