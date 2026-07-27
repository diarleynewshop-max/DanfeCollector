import { redirect } from 'next/navigation';
import {
  listarCnpjs,
  listarTodasNotas,
  listarNotasAlertaDae,
  listarAnosDisponiveis,
  contarNotasTotal,
  obterResumoInicio,
} from '@/lib/actions';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');
  await searchParams;
  const paginaAtual = 1;
  const porPagina = 0;

  const [cnpjs, notas, notasAlerta, anosDisponiveis, totalNotas, resumoInicio] = await Promise.all([
    listarCnpjs(),
    listarTodasNotas(),
    listarNotasAlertaDae(),
    listarAnosDisponiveis(),
    contarNotasTotal(),
    obterResumoInicio(),
  ]);
  return (
    <Dashboard
      usuario={usuario}
      cnpjs={cnpjs}
      notas={notas}
      notasAlerta={notasAlerta}
      anosDisponiveis={anosDisponiveis}
      totalNotas={totalNotas}
      paginaAtual={paginaAtual}
      porPagina={porPagina}
      resumoInicio={resumoInicio}
    />
  );
}
