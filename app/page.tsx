import { redirect } from 'next/navigation';
import {
  listarCnpjs,
  listarNotas,
  listarNotasAlertaDae,
  listarAnosDisponiveis,
  contarNotasTotal,
  obterResumoInicio,
} from '@/lib/actions';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const usuario = await obterUsuarioAtual();
  if (!usuario) redirect('/login');
  const paginaAtual = 1;
  const porPagina = 5000;

  const [cnpjs, notas, notasAlerta, anosDisponiveis, totalNotas, resumoInicio] = await Promise.all([
    listarCnpjs(),
    listarNotas(paginaAtual, porPagina),
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
