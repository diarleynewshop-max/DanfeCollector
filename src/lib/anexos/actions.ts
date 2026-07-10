'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '../prisma';
import { exigirUsuario } from '../usuarios/auth';
import {
  MIMES_ACEITOS,
  TAMANHO_MAX,
  mimeAceito,
  salvarArquivo,
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
}

export interface ListaAnexos {
  ok: boolean;
  message?: string;
  anexos: AnexoInfo[];
  viewer: { login: string; admin: boolean };
}

export interface ResultadoAnexo {
  success: boolean;
  message: string;
}

function paraInfo(a: {
  id: number;
  nome: string;
  arquivoNome: string;
  mime: string;
  tamanho: number;
  criadoPor: string | null;
  createdAt: Date;
}): AnexoInfo {
  return {
    id: a.id,
    nome: a.nome,
    arquivoNome: a.arquivoNome,
    mime: a.mime,
    tamanho: a.tamanho,
    criadoPor: a.criadoPor,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listarAnexos(notaId: number): Promise<ListaAnexos> {
  const usuario = await exigirUsuario();
  const anexos = await prisma.anexo.findMany({
    where: { notaId },
    orderBy: { createdAt: 'desc' },
  });
  return {
    ok: true,
    anexos: anexos.map(paraInfo),
    viewer: { login: usuario.login, admin: usuario.admin },
  };
}

export async function enviarAnexo(
  notaId: number,
  formData: FormData
): Promise<ResultadoAnexo> {
  const usuario = await exigirUsuario();

  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
  if (!nota) return { success: false, message: 'Nota não encontrada.' };

  const arquivo = formData.get('arquivo');
  const nomeInformado = String(formData.get('nome') ?? '').trim();

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

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  const caminho = await salvarArquivo(notaId, arquivo.type, bytes);

  await prisma.anexo.create({
    data: {
      notaId,
      nome: nomeInformado || arquivo.name,
      arquivoNome: arquivo.name,
      mime: arquivo.type,
      tamanho: arquivo.size,
      caminho,
      criadoPor: usuario.login,
    },
  });

  revalidatePath('/');
  return { success: true, message: 'Anexo enviado.' };
}

export async function excluirAnexo(anexoId: number): Promise<ResultadoAnexo> {
  const usuario = await exigirUsuario();

  const anexo = await prisma.anexo.findUnique({ where: { id: anexoId } });
  if (!anexo) return { success: false, message: 'Anexo não encontrado.' };

  // Exclui com permissão: admin ou quem enviou o anexo.
  const podeExcluir = usuario.admin || anexo.criadoPor === usuario.login;
  if (!podeExcluir) {
    return { success: false, message: 'Sem permissão para excluir este anexo.' };
  }

  await apagarArquivo(anexo.caminho);
  await prisma.anexo.delete({ where: { id: anexoId } });

  revalidatePath('/');
  return { success: true, message: 'Anexo excluído.' };
}

// Exportado para o cliente montar o `accept` do input.
export async function tiposAceitos(): Promise<string[]> {
  return Object.keys(MIMES_ACEITOS);
}
