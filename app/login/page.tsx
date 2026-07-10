import { redirect } from 'next/navigation';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) redirect('/');

  return (
    <main className="min-h-screen bg-[var(--ground)] grid place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] grid place-items-center text-white text-lg font-bold"
            style={{ background: 'linear-gradient(140deg,#2a251c,#4a4234)' }}>
            D
          </div>
          <div>
            <h1 className="text-xl font-bold text-[var(--ink)]">DanfeCollector</h1>
            <p className="text-sm text-[var(--ink-mut)]">Acesse com seu usuário.</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
