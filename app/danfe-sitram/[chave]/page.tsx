import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { extrairEspelhoSitram } from '@/lib/sitram/espelho';
import { obterUsuarioAtual, usuarioPodeAcessarCnpj } from '@/lib/usuarios/auth';
import SitramEspelhoView from '../../components/SitramEspelhoView';
import BotaoImprimir from '../../danfe/[chave]/BotaoImprimir';

export const dynamic = 'force-dynamic';

export default async function DanfeSitramPage({ params }: { params: Promise<{ chave: string }> }) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');

  const { chave } = await params;
  const chaveLimpa = chave.replace(/\D/g, '');
  const nota = await prisma.notaFiscal.findUnique({
    where: { chave: chaveLimpa },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });

  if (!nota || !usuarioPodeAcessarCnpj(usuario, nota.cnpjId)) notFound();

  const espelho = extrairEspelhoSitram(nota);
  if (!espelho) notFound();

  return (
    <div className="min-h-screen bg-gray-200 py-6">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4">
        <a href="/" className="text-sm text-blue-600 hover:underline">
          Voltar
        </a>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Espelho SITRAM pronto para impressao. Use Ctrl+P para salvar em PDF.
          </span>
          <BotaoImprimir />
        </div>
      </div>
      <div className="print-area mx-auto bg-white p-6 shadow-lg" style={{ maxWidth: '210mm' }}>
        <SitramEspelhoView espelho={espelho} />
      </div>
    </div>
  );
}
