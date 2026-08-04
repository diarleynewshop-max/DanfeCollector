import { redirect } from 'next/navigation';
import {
  listarCnpjs,
  listarNotas,
  listarNotasAlertaDae,
  listarAnosDisponiveis,
  contarNotasTotal,
  obterResumoInicio,
  obterSaudeSincronizacao,
  listarApiKeys,
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
  const params = await searchParams;
  const paginaAtual = Math.max(1, Math.trunc(Number(params.page) || 1));
  const porPagina = 100;

  const apiKeysPromise = usuario.admin ? listarApiKeys() : Promise.resolve([]);
  const [cnpjs, notas, notasAlerta, anosDisponiveis, totalNotas, resumoInicio, saudeSincronizacao, apiKeys] = await Promise.all([
    listarCnpjs(),
    listarNotas(paginaAtual, porPagina),
    listarNotasAlertaDae(),
    listarAnosDisponiveis(),
    contarNotasTotal(),
    obterResumoInicio(),
    obterSaudeSincronizacao(),
    apiKeysPromise,
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
      saudeSincronizacao={saudeSincronizacao}
      apiKeys={apiKeys}
    />
  );
}
