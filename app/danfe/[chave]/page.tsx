import { notFound } from 'next/navigation';
import * as fs from 'fs';
import { prisma } from '@/lib/prisma';
import { parseDanfe } from '@/lib/sefaz/detalhe';
import DanfeView from '../../components/DanfeView';
import BotaoImprimir from './BotaoImprimir';

export const dynamic = 'force-dynamic';

export default async function DanfePage({ params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  const nota = await prisma.notaFiscal.findUnique({ where: { chave } });
  if (!nota || nota.status !== 'COMPLETA' || !nota.xmlPath || !fs.existsSync(nota.xmlPath)) {
    notFound();
  }

  const danfe = parseDanfe(fs.readFileSync(nota.xmlPath, 'utf8'));
  if (!danfe) notFound();

  return (
    <div className="min-h-screen bg-gray-200 py-6">
      <div className="max-w-[210mm] mx-auto mb-4 flex justify-between items-center px-4 no-print">
        <a href="/" className="text-blue-600 text-sm hover:underline">
          ← Voltar
        </a>
        <BotaoImprimir />
      </div>
      <div className="bg-white shadow-lg mx-auto p-6 print-area" style={{ maxWidth: '210mm' }}>
        <DanfeView danfe={danfe} />
      </div>
    </div>
  );
}
