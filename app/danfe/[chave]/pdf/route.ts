import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: Promise<{ chave: string }> }) {
  const { chave } = await params;
  return NextResponse.redirect(new URL(`/danfe/${chave}`, req.url), 307);
}
