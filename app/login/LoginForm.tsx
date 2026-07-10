'use client';

import { useActionState } from 'react';
import { entrarUsuario, type LoginState } from '@/lib/usuarios/actions';

const estadoInicial: LoginState = {};

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(entrarUsuario, estadoInicial);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">Login</label>
        <input
          name="login"
          autoFocus
          autoComplete="username"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">Senha</label>
        <input
          name="senha"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>
      {state.erro && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.erro}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
      >
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
