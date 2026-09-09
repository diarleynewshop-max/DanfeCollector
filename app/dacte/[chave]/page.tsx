import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { parseDacte } from '@/lib/sefaz/dacteDetalhe';
import { lerXmlComFallback } from '@/lib/xmlpath';
import { obterUsuarioAtual, usuarioPodeAcessarCnpj } from '@/lib/usuarios/auth';
import DacteView from '../../components/DacteView';
import BotaoImprimir from './BotaoImprimir';

export const dynamic = 'force-dynamic';

export default async function DactePage({ params }: { params: Promise<{ chave: string }> }) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');

  const { chave } = await params;
  const cte = await prisma.conhecimentoTransporte.findUnique({ where: { chave } });
  if (cte && !usuarioPodeAcessarCnpj(usuario, cte.cnpjId)) notFound();
  const xml = cte && cte.status === 'COMPLETO'
    ? await lerXmlComFallback(cte.xmlStorageKey, cte.xmlPath)
    : null;
  if (!xml) {
    notFound();
  }

  const dacte = parseDacte(xml);
  if (!dacte) notFound();

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
        <DacteView dacte={dacte} />
      </div>
    </div>
  );
}
