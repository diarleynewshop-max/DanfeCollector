import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseDanfe } from '@/lib/sefaz/detalhe';
import { extrairEspelhoSitram } from '@/lib/sitram/espelho';
import { lerXmlComFallback } from '@/lib/xmlpath';
import { obterUsuarioAtual, usuarioPodeAcessarCnpj } from '@/lib/usuarios/auth';
import DanfeView from '../../components/DanfeViewResizable';
import BotaoImprimir from './BotaoImprimir';

export const dynamic = 'force-dynamic';

export default async function DanfePage({ params }: { params: Promise<{ chave: string }> }) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');

  const { chave } = await params;
  const nota = await prisma.notaFiscal.findUnique({ where: { chave } });
  if (nota && !usuarioPodeAcessarCnpj(usuario, nota.cnpjId)) notFound();
  const xml = nota && nota.status === 'COMPLETA'
    ? await lerXmlComFallback(nota.xmlStorageKey, nota.xmlPath)
    : null;
  if (!xml) {
    notFound();
  }

  const danfe = parseDanfe(xml);
  if (!danfe) notFound();
  const espelho = nota ? extrairEspelhoSitram(nota) : null;

  return (
    <div className="min-h-screen bg-gray-200 py-6">
      <div className="max-w-[210mm] mx-auto mb-4 flex justify-between items-center px-4 no-print">
        <a href="/" className="text-blue-600 text-sm hover:underline">
          ← Voltar
        </a>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Visualizacao pronta para impressao. Use Ctrl+P para salvar em PDF.</span>
          <BotaoImprimir />
        </div>
      </div>
      <div className="bg-white shadow-lg mx-auto p-6 print-area" style={{ maxWidth: '210mm' }}>
        <DanfeView danfe={danfe} espelho={espelho} />
      </div>
    </div>
  );
}
