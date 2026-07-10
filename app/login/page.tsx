import { redirect } from 'next/navigation';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) redirect('/');

  return (
    <main className="min-h-screen bg-slate-100 grid place-items-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">DanfeCollector</h1>
          <p className="text-sm text-slate-500">Acesse com seu usuario.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
