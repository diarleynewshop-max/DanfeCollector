import 'server-only';

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { prisma } from '../prisma';

export type PerfilUsuario = 'admin' | 'operador';

export interface UsuarioLogado {
  id: number;
  login: string;
  nome: string;
  perfil: PerfilUsuario;
  admin: boolean;
  acessoTodosCnpjs: boolean;
  cnpjIds: number[];
}

const COOKIE_USUARIO = 'danfe_usuario';

const USUARIOS_INICIAIS = [
  { login: 'Diarley', senha: '1212', nome: 'Diarley', perfil: 'admin' as PerfilUsuario, acessoTodosCnpjs: true },
  { login: 'Clara', senha: '2004', nome: 'Clara', perfil: 'operador' as PerfilUsuario, acessoTodosCnpjs: true },
  { login: 'Rafa', senha: '1316', nome: 'Rafa', perfil: 'operador' as PerfilUsuario, acessoTodosCnpjs: true },
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

export function hashSenha(senha: string): string {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(senha, salt, 64).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

function senhaValida(senha: string, senhaHash: string): boolean {
  const [alg, salt, hash] = senhaHash.split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calculado = crypto.scryptSync(senha, salt, 64);
  const esperado = Buffer.from(hash, 'base64url');
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

async function garantirUsuariosIniciais() {
  const total = await prisma.usuario.count();
  if (total > 0) return;

  for (const usuario of USUARIOS_INICIAIS) {
    await prisma.usuario.create({
      data: {
        login: usuario.login,
        nome: usuario.nome,
        perfil: usuario.perfil,
        senhaHash: hashSenha(usuario.senha),
        acessoTodosCnpjs: usuario.acessoTodosCnpjs,
      },
    });
  }
}

function perfilSeguro(perfil: string): PerfilUsuario {
  return perfil === 'admin' ? 'admin' : 'operador';
}

async function usuarioPublico(id: number): Promise<UsuarioLogado | null> {
  const usuario = await prisma.usuario.findUnique({
    where: { id },
    include: { cnpjs: { select: { cnpjId: true } } },
  });
  if (!usuario || !usuario.ativo) return null;

  const perfil = perfilSeguro(usuario.perfil);
  return {
    id: usuario.id,
    login: usuario.login,
    nome: usuario.nome,
    perfil,
    admin: perfil === 'admin',
    acessoTodosCnpjs: usuario.acessoTodosCnpjs || perfil === 'admin',
    cnpjIds: usuario.cnpjs.map((item) => item.cnpjId),
  };
}

function tokenUsuario(usuario: UsuarioLogado): string {
  const payload = Buffer.from(
    JSON.stringify({ id: usuario.id, login: usuario.login }),
    'utf8'
  ).toString('base64url');
  return `${payload}.${assinar(payload)}`;
}

export async function validarUsuario(login: string, senha: string): Promise<UsuarioLogado | null> {
  await garantirUsuariosIniciais();

  const usuario = await prisma.usuario.findFirst({
    where: { login: { equals: login.trim(), mode: 'insensitive' }, ativo: true },
  });
  if (!usuario || !senhaValida(senha, usuario.senhaHash)) return null;
  return usuarioPublico(usuario.id);
}

export async function criarSessao(usuario: UsuarioLogado): Promise<void> {
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
      id?: number;
      login?: string;
    };
    if (!dados.id) return null;
    const usuario = await usuarioPublico(dados.id);
    return usuario && usuario.login === dados.login ? usuario : null;
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
  if (!usuario.admin) throw new Error('Acesso negado. Funcao exclusiva de admin.');
  return usuario;
}

export function whereCnpjPermitido(usuario: UsuarioLogado) {
  return usuario.acessoTodosCnpjs ? {} : { id: { in: usuario.cnpjIds } };
}

export function whereNotaPermitida(usuario: UsuarioLogado) {
  return usuario.acessoTodosCnpjs ? {} : { cnpjId: { in: usuario.cnpjIds } };
}

export function usuarioPodeAcessarCnpj(usuario: UsuarioLogado, cnpjId: number): boolean {
  return usuario.acessoTodosCnpjs || usuario.cnpjIds.includes(cnpjId);
}
