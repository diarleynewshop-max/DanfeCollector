import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { obterUsuarioAtual, whereNotaPermitida } from '@/lib/usuarios/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LIMITE = 200;

export async function GET(req: Request) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) {
    return NextResponse.json({ success: false, message: 'Nao autorizado.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const busca = url.searchParams.get('busca')?.trim() ?? '';
  const cnpjIdParam = url.searchParams.get('cnpjId');
  const inicio = url.searchParams.get('inicio');
  const fim = url.searchParams.get('fim');

  const filtros: Prisma.ConhecimentoTransporteWhereInput[] = [whereNotaPermitida(usuario)];

  if (cnpjIdParam && cnpjIdParam !== 'todos') {
    const cnpjId = Number(cnpjIdParam);
    if (!Number.isFinite(cnpjId)) {
      return NextResponse.json({ success: false, message: 'CNPJ invalido.' }, { status: 400 });
    }
    filtros.push({ cnpjId });
  }

  if (inicio && !/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
    return NextResponse.json({ success: false, message: 'Data inicial invalida.' }, { status: 400 });
  }
  if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return NextResponse.json({ success: false, message: 'Data final invalida.' }, { status: 400 });
  }
  if (inicio || fim) {
    filtros.push({
      emitidaEm: {
        ...(inicio ? { gte: new Date(`${inicio}T00:00:00.000-03:00`) } : {}),
        ...(fim ? { lte: new Date(`${fim}T23:59:59.999-03:00`) } : {}),
      },
    });
  }

  if (busca) {
    const somenteDigitos = busca.replace(/\D/g, '');
    const or: Prisma.ConhecimentoTransporteWhereInput[] = [
      { numero: { contains: busca, mode: 'insensitive' } },
      { emitenteNome: { contains: busca, mode: 'insensitive' } },
      { tomadorNome: { contains: busca, mode: 'insensitive' } },
      { remetenteNome: { contains: busca, mode: 'insensitive' } },
      { destinatarioNome: { contains: busca, mode: 'insensitive' } },
    ];
    if (somenteDigitos.length >= 8) {
      or.push({ chave: { contains: somenteDigitos } });
      or.push({ emitenteCnpj: { contains: somenteDigitos } });
      or.push({ tomadorCnpj: { contains: somenteDigitos } });
      or.push({ remetenteCnpj: { contains: somenteDigitos } });
      or.push({ destinatarioCnpj: { contains: somenteDigitos } });
      or.push({ notasVinculadas: { some: { chaveNfe: { contains: somenteDigitos } } } });
    }
    if (somenteDigitos.length > 0 && somenteDigitos.length <= 9) {
      // Numero da NF-e (ate 9 digitos): busca a chave correspondente e acha o(s) CT-e vinculado(s).
      const notasPorNumero = await prisma.notaFiscal.findMany({
        where: { AND: [whereNotaPermitida(usuario), { numero: { contains: somenteDigitos } }] },
        select: { chave: true },
        take: 50,
      });
      if (notasPorNumero.length > 0) {
        or.push({ notasVinculadas: { some: { chaveNfe: { in: notasPorNumero.map((nota) => nota.chave) } } } });
      }
    }
    filtros.push({ OR: or });
  }

  const ctes = await prisma.conhecimentoTransporte.findMany({
    where: { AND: filtros },
    orderBy: { emitidaEm: 'desc' },
    take: LIMITE,
    include: {
      cnpj: { select: { cnpj: true, razaoSocial: true } },
      notasVinculadas: { select: { chaveNfe: true } },
    },
  });

  const chavesNfe = [...new Set(ctes.flatMap((cte) => cte.notasVinculadas.map((v) => v.chaveNfe)))];
  const notas = chavesNfe.length > 0
    ? await prisma.notaFiscal.findMany({
        where: { chave: { in: chavesNfe } },
        select: {
          chave: true,
          numero: true,
          serie: true,
          emitenteNome: true,
          emitenteCnpj: true,
          situacaoSefaz: true,
          valorTotal: true,
        },
      })
    : [];
  const notasPorChave = new Map(notas.map((nota) => [nota.chave, nota]));

  const resultado = ctes.map((cte) => ({
    id: cte.id,
    chave: cte.chave,
    numero: cte.numero,
    serie: cte.serie,
    emitidaEm: cte.emitidaEm,
    status: cte.status,
    situacaoSefaz: cte.situacaoSefaz,
    cnpjInteressado: cte.cnpj.razaoSocial || cte.cnpj.cnpj,
    emitenteNome: cte.emitenteNome,
    emitenteCnpj: cte.emitenteCnpj,
    tomadorNome: cte.tomadorNome,
    tomadorCnpj: cte.tomadorCnpj,
    remetenteNome: cte.remetenteNome,
    remetenteCnpj: cte.remetenteCnpj,
    destinatarioNome: cte.destinatarioNome,
    destinatarioCnpj: cte.destinatarioCnpj,
    valorTotal: cte.valorTotal,
    valorPrestacao: cte.valorPrestacao,
    valorCarga: cte.valorCarga,
    notasVinculadas: cte.notasVinculadas.map((vinculo) => {
      const nota = notasPorChave.get(vinculo.chaveNfe);
      return {
        chave: vinculo.chaveNfe,
        numero: nota?.numero ?? null,
        serie: nota?.serie ?? null,
        emitenteNome: nota?.emitenteNome ?? null,
        emitenteCnpj: nota?.emitenteCnpj ?? null,
        situacaoSefaz: nota?.situacaoSefaz ?? null,
        valorTotal: nota?.valorTotal ?? null,
        encontrada: Boolean(nota),
      };
    }),
  }));

  return NextResponse.json({ success: true, ctes: resultado, total: resultado.length, limite: LIMITE });
}
