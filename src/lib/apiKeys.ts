import 'server-only';

import crypto from 'crypto';
import { prisma } from './prisma';
import { exigirAdmin } from './usuarios/auth';

export type ApiKeyResumo = {
  id: number;
  nome: string;
  prefixo: string;
  ativo: boolean;
  ultimoUsoEm: Date | null;
  criadaPorLogin: string | null;
  createdAt: Date;
};

export type ApiKeyCriada = {
  success: boolean;
  message: string;
  token?: string;
  key?: ApiKeyResumo;
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function novoToken(): { token: string; prefixo: string; tokenHash: string } {
  const segredo = crypto.randomBytes(32).toString('base64url');
  const prefixo = `dc_${crypto.randomBytes(4).toString('hex')}`;
  const token = `${prefixo}_${segredo}`;
  return { token, prefixo, tokenHash: hashToken(token) };
}

function resumo(key: {
  id: number;
  nome: string;
  prefixo: string;
  ativo: boolean;
  ultimoUsoEm: Date | null;
  criadaPorLogin: string | null;
  createdAt: Date;
}): ApiKeyResumo {
  return {
    id: key.id,
    nome: key.nome,
    prefixo: key.prefixo,
    ativo: key.ativo,
    ultimoUsoEm: key.ultimoUsoEm,
    criadaPorLogin: key.criadaPorLogin,
    createdAt: key.createdAt,
  };
}

export async function listarApiKeys(): Promise<ApiKeyResumo[]> {
  await exigirAdmin();
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      nome: true,
      prefixo: true,
      ativo: true,
      ultimoUsoEm: true,
      criadaPorLogin: true,
      createdAt: true,
    },
  });
  return keys.map(resumo);
}

export async function gerarApiKey(nomeInformado: string): Promise<ApiKeyCriada> {
  const usuario = await exigirAdmin();
  const nome = nomeInformado.trim();
  if (nome.length < 3) {
    return { success: false, message: 'Informe um nome para identificar essa integração.' };
  }

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { token, prefixo, tokenHash } = novoToken();
    try {
      const key = await prisma.apiKey.create({
        data: {
          nome,
          prefixo,
          tokenHash,
          criadaPorId: usuario.id,
          criadaPorLogin: usuario.login,
        },
        select: {
          id: true,
          nome: true,
          prefixo: true,
          ativo: true,
          ultimoUsoEm: true,
          criadaPorLogin: true,
          createdAt: true,
        },
      });

      return {
        success: true,
        message: 'Chave criada. Copie agora: ela nao sera exibida novamente.',
        token,
        key: resumo(key),
      };
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'P2002') {
        return { success: false, message: `Erro ao gerar chave: ${(error as Error).message}` };
      }
    }
  }

  return { success: false, message: 'Nao consegui gerar uma chave unica. Tente novamente.' };
}

export async function revogarApiKey(id: number): Promise<{ success: boolean; message: string }> {
  await exigirAdmin();
  if (!Number.isInteger(id) || id <= 0) return { success: false, message: 'Chave invalida.' };

  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) return { success: false, message: 'Chave nao encontrada.' };

  await prisma.apiKey.update({ where: { id }, data: { ativo: false } });
  return { success: true, message: `Chave ${key.prefixo} revogada.` };
}

export async function validarApiKey(req: Request): Promise<ApiKeyResumo | null> {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers.get('x-api-key')?.trim();
  const token = bearer || header || '';
  if (!token) return null;

  const tokenHash = hashToken(token);
  const key = await prisma.apiKey.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      nome: true,
      prefixo: true,
      ativo: true,
      ultimoUsoEm: true,
      criadaPorLogin: true,
      createdAt: true,
    },
  });

  if (!key?.ativo) return null;

  await prisma.apiKey.update({
    where: { id: key.id },
    data: { ultimoUsoEm: new Date() },
  });

  return resumo(key);
}
