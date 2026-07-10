'use server';

import { redirect } from 'next/navigation';
import { criarSessao, limparSessao, validarUsuario } from './auth';

export interface LoginState {
  erro?: string;
}

export async function entrarUsuario(_state: LoginState, formData: FormData): Promise<LoginState> {
  const login = String(formData.get('login') ?? '');
  const senha = String(formData.get('senha') ?? '');

  const usuario = validarUsuario(login, senha);
  if (!usuario) {
    return { erro: 'Login ou senha invalido.' };
  }

  await criarSessao(usuario.login);
  redirect('/');
}

export async function sairUsuario(): Promise<void> {
  await limparSessao();
  redirect('/login');
}
