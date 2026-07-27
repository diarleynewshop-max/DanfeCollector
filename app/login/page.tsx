import { redirect } from 'next/navigation';
import Image from 'next/image';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const usuario = await obterUsuarioAtual();
  if (usuario) redirect('/');

  return (
    <main className="min-h-screen bg-[var(--ground)] grid place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-6">
          <Image
            src="/brand/danfe-collect-logo-tagline.svg"
            alt="Danfe Collect"
            width={720}
            height={205}
            priority
            className="h-auto w-full"
          />
          <h1 className="sr-only">Danfe Collect</h1>
          <p className="mt-4 text-sm text-[var(--ink-mut)]">Acesse com seu usuario.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
