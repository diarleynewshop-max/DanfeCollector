import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '@/lib/prisma';

// API gratuita do MeuDanfe: recebe o XML (texto puro) e devolve o PDF em base64.
const MEUDANFE_URL = 'https://ws.meudanfe.com/api/v1/get/nfe/xmltodanfepdf/API';

export async function GET(_req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;

  const nota = await prisma.notaFiscal.findUnique({ where: { chave } });
  if (!nota || nota.status !== 'COMPLETA' || !nota.xmlPath || !fs.existsSync(nota.xmlPath)) {
    return new Response('Nota completa não encontrada.', { status: 404 });
  }

  // Se já geramos o PDF antes, serve do disco (evita reenviar à MeuDanfe)
  if (nota.pdfPath && fs.existsSync(nota.pdfPath)) {
    return servirPdf(fs.readFileSync(nota.pdfPath), chave);
  }

  const xml = fs.readFileSync(nota.xmlPath, 'utf8');

  let resp: Response;
  try {
    resp = await fetch(MEUDANFE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: xml,
    });
  } catch (e) {
    return new Response(`Falha ao contatar a MeuDanfe: ${(e as Error).message}`, { status: 502 });
  }

  if (!resp.ok) {
    return new Response(`MeuDanfe retornou HTTP ${resp.status}. Verifique o XML.`, { status: 502 });
  }

  let txt = (await resp.text()).trim();
  if (txt.startsWith('"') && txt.endsWith('"')) txt = txt.slice(1, -1);
  txt = txt.replace(/^data:application\/pdf;base64,/, '');

  const pdf = Buffer.from(txt, 'base64');
  if (pdf.subarray(0, 4).toString('latin1') !== '%PDF') {
    return new Response('Resposta da MeuDanfe não é um PDF válido.', { status: 502 });
  }

  // Persiste ao lado do XML para reuso
  const pdfPath = path.join(path.dirname(nota.xmlPath), `${chave}-danfe.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  await prisma.notaFiscal.update({ where: { id: nota.id }, data: { pdfPath } });

  return servirPdf(pdf, chave);
}

function servirPdf(pdf: Buffer, chave: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="DANFE-${chave}.pdf"`,
    },
  });
}
