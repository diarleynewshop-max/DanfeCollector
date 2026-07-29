'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../prisma';
import { exigirUsuario } from '../usuarios/auth';
import {
  opcoesCompartilhadasDae,
  type DaeCompartilhadoInfo,
  type NotaComDadosDae,
} from '../sitram/dae';
import {
  MIMES_ACEITOS,
  TAMANHO_MAX,
  mimeAceito,
  salvarArquivoComFallback,
  apagarArquivo,
} from './storage';

export interface AnexoInfo {
  id: number;
  nome: string;
  arquivoNome: string;
  mime: string;
  tamanho: number;
  criadoPor: string | null;
  createdAt: string;
  escopo: 'nota' | 'dae';
  dae: { id: number; chave: string; titulo: string } | null;
}

export interface ListaAnexos {
  ok: boolean;
  message?: string;
  anexos: AnexoInfo[];
  opcoesDae: DaeCompartilhadoInfo[];
  viewer: { login: string; admin: boolean };
}

export interface ResultadoAnexo {
  success: boolean;
  message: string;
}

type NotaParaDae = NotaComDadosDae & { id: number };

function paraInfo(a: {
  id: number;
  nome: string;
  arquivoNome: string;
  mime: string;
  tamanho: number;
  criadoPor: string | null;
  createdAt: Date;
  daeCompartilhado: { id: number; chave: string; titulo: string } | null;
}): AnexoInfo {
  return {
    id: a.id,
    nome: a.nome,
    arquivoNome: a.arquivoNome,
    mime: a.mime,
    tamanho: a.tamanho,
    criadoPor: a.criadoPor,
    createdAt: a.createdAt.toISOString(),
    escopo: a.daeCompartilhado ? 'dae' : 'nota',
    dae: a.daeCompartilhado,
  };
}

async function carregarNotaParaDae(notaId: number): Promise<NotaParaDae | null> {
  return prisma.notaFiscal.findUnique({
    where: { id: notaId },
    select: {
      id: true,
      sitramDaeStatus: true,
      sitramDaeResumo: true,
      sitramDetalhe: true,
    },
  });
}

function opcoesDaeDaNota(nota: NotaParaDae | null): DaeCompartilhadoInfo[] {
  if (!nota) return [];
  return opcoesCompartilhadasDae(nota);
}

export async function listarAnexos(notaId: number): Promise<ListaAnexos> {
  const usuario = await exigirUsuario();
  const nota = await carregarNotaParaDae(notaId);
  if (!nota) {
    return {
      ok: false,
      message: 'Nota não encontrada.',
      anexos: [],
      opcoesDae: [],
      viewer: { login: usuario.login, admin: usuario.admin },
    };
  }

  const opcoesDae = opcoesDaeDaNota(nota);
  const chavesDae = opcoesDae.map((item) => item.chave);

  const anexos = await prisma.anexo.findMany({
    where: {
      OR: [
        { notaId },
        ...(chavesDae.length > 0
          ? [{ daeCompartilhado: { chave: { in: chavesDae } } }]
          : []),
      ],
    },
    include: {
      daeCompartilhado: { select: { id: true, chave: true, titulo: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    ok: true,
    anexos: anexos.map(paraInfo),
    opcoesDae,
    viewer: { login: usuario.login, admin: usuario.admin },
  };
}

export async function enviarAnexo(
  notaId: number,
  formData: FormData
): Promise<ResultadoAnexo> {
  const usuario = await exigirUsuario();

  const nota = await carregarNotaParaDae(notaId);
  if (!nota) return { success: false, message: 'Nota não encontrada.' };

  const arquivo = formData.get('arquivo');
  const nomeInformado = String(formData.get('nome') ?? '').trim();
  const escopo = String(formData.get('escopo') ?? 'nota') === 'dae' ? 'dae' : 'nota';

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { success: false, message: 'Selecione um arquivo.' };
  }
  if (arquivo.size > TAMANHO_MAX) {
    return {
      success: false,
      message: `Arquivo muito grande (máx. ${Math.round(TAMANHO_MAX / 1024 / 1024)} MB).`,
    };
  }
  if (!mimeAceito(arquivo.type)) {
    return {
      success: false,
      message: `Tipo não aceito (${arquivo.type || 'desconhecido'}). Envie PDF, imagem ou planilha.`,
    };
  }

  const daeSelecionado = escopo === 'dae'
    ? opcoesDaeDaNota(nota).find((item) => item.chave === String(formData.get('daeChave') ?? '').trim())
    : null;

  if (escopo === 'dae' && !daeSelecionado) {
    return { success: false, message: 'Selecione um DAE válido para compartilhar o anexo.' };
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const arquivoSalvo = await salvarArquivoComFallback(notaId, arquivo.type, bytes);

  if (escopo === 'dae') {
    const daeInfo = daeSelecionado;
    if (!daeInfo) {
      await apagarArquivo(arquivoSalvo.caminho, arquivoSalvo.storageKey);
      return { success: false, message: 'Selecione um DAE válido para compartilhar o anexo.' };
    }

    const dae = await prisma.daeCompartilhado.upsert({
      where: { chave: daeInfo.chave },
      update: {
        titulo: daeInfo.titulo,
        identificadorExterno: daeInfo.identificador,
        codigo: daeInfo.codigo,
        descricao: daeInfo.descricao,
        vencimento: daeInfo.vencimento,
        valor: daeInfo.valor,
      },
      create: {
        chave: daeInfo.chave,
        titulo: daeInfo.titulo,
        identificadorExterno: daeInfo.identificador,
        codigo: daeInfo.codigo,
        descricao: daeInfo.descricao,
        vencimento: daeInfo.vencimento,
        valor: daeInfo.valor,
      },
    });

    await prisma.anexo.create({
      data: {
        nome: nomeInformado || arquivo.name,
        arquivoNome: arquivo.name,
        mime: arquivo.type,
        tamanho: arquivo.size,
        caminho: arquivoSalvo.caminho,
        storageKey: arquivoSalvo.storageKey,
        criadoPor: usuario.login,
        daeCompartilhadoId: dae.id,
      },
    });

    revalidatePath('/');
    return { success: true, message: 'Anexo enviado para o DAE compartilhado.' };
  }

  await prisma.anexo.create({
    data: {
      notaId,
      nome: nomeInformado || arquivo.name,
      arquivoNome: arquivo.name,
      mime: arquivo.type,
      tamanho: arquivo.size,
      caminho: arquivoSalvo.caminho,
      storageKey: arquivoSalvo.storageKey,
      criadoPor: usuario.login,
    },
  });

  revalidatePath('/');
  return { success: true, message: 'Anexo enviado para esta NF.' };
}

export async function excluirAnexo(anexoId: number): Promise<ResultadoAnexo> {
  const usuario = await exigirUsuario();

  const anexo = await prisma.anexo.findUnique({
    where: { id: anexoId },
    include: { daeCompartilhado: { select: { titulo: true } } },
  });
  if (!anexo) return { success: false, message: 'Anexo não encontrado.' };

  const podeExcluir = usuario.admin || anexo.criadoPor === usuario.login;
  if (!podeExcluir) {
    return { success: false, message: 'Sem permissão para excluir este anexo.' };
  }

  await apagarArquivo(anexo.caminho, anexo.storageKey);
  await prisma.anexo.delete({ where: { id: anexoId } });

  revalidatePath('/');
  return {
    success: true,
    message: anexo.daeCompartilhado
      ? `Anexo compartilhado removido do DAE "${anexo.daeCompartilhado.titulo}".`
      : 'Anexo excluído.',
  };
}

export async function tiposAceitos(): Promise<string[]> {
  return Object.keys(MIMES_ACEITOS);
}
