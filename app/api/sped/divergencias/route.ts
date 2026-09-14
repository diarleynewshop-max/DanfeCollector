import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const usuario = await obterUsuarioAtual();
    if (!usuario) {
      return NextResponse.json({ success: false, message: 'Não autorizado.' }, { status: 401 });
    }

    const url = new URL(req.url);
    const importacaoIdParam = url.searchParams.get('importacaoId');
    const severidade = url.searchParams.get('severidade');
    const tipo = url.searchParams.get('tipo');
    const resolvidaParam = url.searchParams.get('resolvida');
    const busca = url.searchParams.get('busca')?.trim() || '';

    if (!importacaoIdParam) {
      // Retorna lista de importações recentes
      const importacoes = await prisma.spedFiscalImportacao.findMany({
        orderBy: { importadoEm: 'desc' },
        take: 20,
        include: {
          cnpj: {
            select: { id: true, cnpj: true, razaoSocial: true },
          },
          _count: {
            select: { divergencias: true },
          },
        },
      });

      return NextResponse.json({ success: true, importacoes });
    }

    const importacaoId = Number(importacaoIdParam);
    const where: any = { importacaoId };

    if (severidade && severidade !== 'TODAS') {
      where.severidade = severidade;
    }
    if (tipo && tipo !== 'TODOS') {
      where.tipo = tipo;
    }
    if (resolvidaParam !== null && resolvidaParam !== undefined && resolvidaParam !== 'todas') {
      where.resolvida = resolvidaParam === 'true';
    }

    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      where.OR = [
        { descricao: { contains: busca, mode: 'insensitive' } },
        { codigoRegra: { contains: busca, mode: 'insensitive' } },
        { fornecedorNome: { contains: busca, mode: 'insensitive' } },
        ...(digitos.length >= 8
          ? [
              { chaveNfe: { contains: digitos } },
              { fornecedorCnpj: { contains: digitos } },
            ]
          : []),
      ];
    }

    const divergencias = await prisma.spedDivergencia.findMany({
      where,
      orderBy: [{ severidade: 'asc' }, { id: 'asc' }],
      take: 500,
    });

    return NextResponse.json({
      success: true,
      total: divergencias.length,
      divergencias,
    });
  } catch (error: any) {
    console.error('[SPED Divergências] Erro:', error);
    return NextResponse.json(
      { success: false, message: `Erro ao buscar divergências: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const usuario = await obterUsuarioAtual();
    if (!usuario) {
      return NextResponse.json({ success: false, message: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
    const { id, resolvida, observacao } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID da divergência obrigatório.' }, { status: 400 });
    }

    const atualizada = await prisma.spedDivergencia.update({
      where: { id: Number(id) },
      data: {
        resolvida: Boolean(resolvida),
        resolvidaEm: resolvida ? new Date() : null,
        resolvidaPor: resolvida ? usuario.nome : null,
        ...(observacao !== undefined ? { observacao } : {}),
      },
    });

    return NextResponse.json({ success: true, divergencia: atualizada });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `Erro ao atualizar divergência: ${error.message || String(error)}` },
      { status: 500 }
    );
  }
}
