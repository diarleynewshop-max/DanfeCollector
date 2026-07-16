'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '../prisma';
import { criarSessao, exigirAdmin, hashSenha, limparSessao, validarUsuario } from './auth';

export interface LoginState {
  erro?: string;
}

export async function entrarUsuario(_state: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get('login') ?? '');
  const senha = String(formData.get('senha') ?? '');

  const usuario = await validarUsuario(login, senha);
  if (!usuario) {
    return { erro: 'Login ou senha invalido.' };
  }

  await criarSessao(usuario);
  redirect('/');
}

export async function sairUsuario(): Promise<void> {
  await limparSessao();
  redirect('/login');
}

export interface UsuarioAdminResumo {
  id: number;
  login: string;
  nome: string;
  perfil: string;
  ativo: boolean;
  acessoTodosCnpjs: boolean;
  cnpjIds: number[];
}

export async function listarUsuariosAdmin(): Promise<UsuarioAdminResumo[]> {
  await exigirAdmin();
  const usuarios = await prisma.usuario.findMany({
    orderBy: [{ perfil: 'asc' }, { nome: 'asc' }],
    include: { cnpjs: { select: { cnpjId: true } } },
  });

  return usuarios.map((usuario) => ({
    id: usuario.id,
    login: usuario.login,
    nome: usuario.nome,
    perfil: usuario.perfil,
    ativo: usuario.ativo,
    acessoTodosCnpjs: usuario.acessoTodosCnpjs,
    cnpjIds: usuario.cnpjs.map((item) => item.cnpjId),
  }));
}

function perfilSeguro(perfil: string) {
  return perfil === 'admin' ? 'admin' : 'operador';
}

function idsCnpjs(formData: FormData): number[] {
  return formData
    .getAll('cnpjIds')
    .map((valor) => Number(valor))
    .filter((valor) => Number.isInteger(valor) && valor > 0);
}

export async function salvarUsuarioAdmin(formData: FormData): Promise<{ success: boolean; message: string }> {
  await exigirAdmin();

  const id = Number(formData.get('id') || 0);
  const login = String(formData.get('login') ?? '').trim();
  const nome = String(formData.get('nome') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  const perfil = perfilSeguro(String(formData.get('perfil') ?? 'operador'));
  const ativo = formData.get('ativo') === 'on';
  const acessoTodosCnpjs = perfil === 'admin' || formData.get('acessoTodosCnpjs') === 'on';
  const cnpjIds = acessoTodosCnpjs ? [] : idsCnpjs(formData);

  if (!login || !nome) return { success: false, message: 'Informe login e nome.' };
  if (!id && senha.length < 4) return { success: false, message: 'Informe uma senha com pelo menos 4 caracteres.' };
  if (!acessoTodosCnpjs && cnpjIds.length === 0) return { success: false, message: 'Selecione ao menos uma loja para o usuario.' };

  try {
    if (id) {
      const data: {
        login: string;
        nome: string;
        perfil: string;
        ativo: boolean;
        acessoTodosCnpjs: boolean;
        senhaHash?: string;
      } = { login, nome, perfil, ativo, acessoTodosCnpjs };
      if (senha.trim()) data.senhaHash = hashSenha(senha);

      await prisma.usuario.update({
        where: { id },
        data: {
          ...data,
          cnpjs: {
            deleteMany: {},
            create: cnpjIds.map((cnpjId) => ({ cnpjId })),
          },
        },
      });
    } else {
      await prisma.usuario.create({
        data: {
          login,
          nome,
          perfil,
          ativo,
          acessoTodosCnpjs,
          senhaHash: hashSenha(senha),
          cnpjs: { create: cnpjIds.map((cnpjId) => ({ cnpjId })) },
        },
      });
    }
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2002') {
      return { success: false, message: 'Ja existe usuario com esse login.' };
    }
    return { success: false, message: `Erro ao salvar usuario: ${(error as Error).message}` };
  }

  revalidatePath('/');
  return { success: true, message: id ? 'Usuario atualizado.' : 'Usuario criado.' };
}
