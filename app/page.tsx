import { listarCnpjs, listarNotas } from '@/lib/actions';
import Dashboard from './dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [cnpjs, notas] = await Promise.all([listarCnpjs(), listarNotas()]);
  return <Dashboard cnpjs={cnpjs} notas={notas} />;
}
