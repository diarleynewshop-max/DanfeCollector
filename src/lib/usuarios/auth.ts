import 'server-only';

import crypto from 'crypto';
import { cookies } from 'next/headers';

export type PerfilUsuario = 'admin' | 'operador';

export interface UsuarioLogado {
  login: string;
  nome: string;
  perfil: PerfilUsuario;
  admin: boolean;
}

interface UsuarioConfig {
  login: string;
  senha: string;
  nome: string;
  perfil: PerfilUsuario;
}

const COOKIE_USUARIO = 'danfe_usuario';

const USUARIOS: UsuarioConfig[] = [
  { login: 'Diarley', senha: '1212', nome: 'Diarley', perfil: 'admin' },
  { login: 'Clara', senha: '2004', nome: 'Clara', perfil: 'operador' },
  { login: 'Rafa', senha: '1316', nome: 'Rafa', perfil: 'operador' },
];

function segredoSessao(): string {
  return process.env.AUTH_SECRET || 'danfe-collector-local-auth-v1';
}

function normalizarLogin(login: string): string {
  return login.trim().toLowerCase();
}

function assinar(payload: string): string {
  return crypto.createHmac('sha256', segredoSessao()).update(payload).digest('base64url');
}

function tokenUsuario(usuario: UsuarioConfig): string {
  const payload = Buffer.from(
    JSON.stringify({ login: usuario.login, perfil: usuario.perfil }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${assinar(payload)}`;
}

function usuarioPublico(usuario: UsuarioConfig): UsuarioLogado {
  return {
    login: usuario.login,
    nome: usuario.nome,
    perfil: usuario.perfil,
    admin: usuario.perfil === 'admin',
  };
}

export function validarUsuario(login: string, senha: string): UsuarioLogado | null {
  const usuario = USUARIOS.find((u) => normalizarLogin(u.login) === normalizarLogin(login));
  if (!usuario || usuario.senha !== senha) return null;
  return usuarioPublico(usuario);
}

export async function criarSessao(login: string): Promise<void> {
  const usuario = USUARIOS.find((u) => normalizarLogin(u.login) === normalizarLogin(login));
  if (!usuario) throw new Error('Usuario invalido.');

  const store = await cookies();
  store.set(COOKIE_USUARIO, tokenUsuario(usuario), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function limparSessao(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_USUARIO);
}

export async function obterUsuarioAtual(): Promise<UsuarioLogado | null> {
  const store = await cookies();
  const token = store.get(COOKIE_USUARIO)?.value;
  if (!token) return null;

  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura || assinar(payload) !== assinatura) return null;

  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      login?: string;
      perfil?: PerfilUsuario;
    };
    const usuario = USUARIOS.find(
      (u) => u.login === dados.login && u.perfil === dados.perfil
    );
    return usuario ? usuarioPublico(usuario) : null;
  } catch {
    return null;
  }
}

export async function exigirUsuario(): Promise<UsuarioLogado> {
  const usuario = await obterUsuarioAtual();
  if (!usuario) throw new Error('Sessao expirada. Faca login novamente.');
  return usuario;
}

export async function exigirAdmin(): Promise<UsuarioLogado> {
  const usuario = await exigirUsuario();
  if (!usuario.admin) throw new Error('Acesso negado. Funcao exclusiva do Diarley.');
  return usuario;
}
