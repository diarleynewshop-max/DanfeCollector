import { redirect } from 'next/navigation';
import { listarCnpjs, listarNotas, listarAnosDisponiveis, contarNotasTotal } from '@/lib/actions';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');

  const [cnpjs, notas, anosDisponiveis, totalNotas] = await Promise.all([
    listarCnpjs(),
    listarNotas(),
    listarAnosDisponiveis(),
    contarNotasTotal(),
  ]);
  return (
    <Dashboard
      usuario={usuario}
      cnpjs={cnpjs}
      notas={notas}
      anosDisponiveis={anosDisponiveis}
      totalNotas={totalNotas}
    />
  );
}
