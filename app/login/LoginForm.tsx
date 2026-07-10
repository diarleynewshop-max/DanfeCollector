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
          className="w-full rounded-lg border border-[var(--border-strong)] px-3 py-2 text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--border-strong)]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">Senha</label>
        <input
          name="senha"
          type="password"
          autoComplete="current-password"
          className="w-full rounded-lg border border-[var(--border-strong)] px-3 py-2 text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--border-strong)]"
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
        className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-ink)] hover:brightness-150 disabled:opacity-50"
      >
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
