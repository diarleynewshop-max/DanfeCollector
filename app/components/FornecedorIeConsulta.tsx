'use client';

import { FormEvent, useMemo, useState } from 'react';
import type { ConsultaIeFornecedor } from '@/lib/ieFornecedor';
import { LINK_CCC_SEFAZ, LINKS_SEFAZ_IE, UFS_BRASIL } from '@/lib/ieFornecedorConstantes';

type ApiResposta =
  | { success: true; consulta: ConsultaIeFornecedor; portalOficial: string | null; portalCcc: string | null }
  | { success: false; message: string };

function formatarCnpj(valor: string): string {
  const cnpj = valor.replace(/\D/g, '');
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function dataCurta(valor: string | null): string {
  if (!valor) return '-';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleDateString('pt-BR');
}

function CampoResultado({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-mut)]">{rotulo}</p>
      <p className="mt-1 min-h-5 break-words text-sm font-semibold text-[var(--ink)]">{valor || '-'}</p>
    </div>
  );
}

export default function FornecedorIeConsulta() {
  const [cnpj, setCnpj] = useState('');
  const [uf, setUf] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ConsultaIeFornecedor | null>(null);
  const [portalOficial, setPortalOficial] = useState<string | null>(null);
  const [portalCcc, setPortalCcc] = useState<string | null>(null);

  const cnpjLimpo = useMemo(() => cnpj.replace(/\D/g, ''), [cnpj]);
  const linkPortal = portalOficial || (uf ? LINKS_SEFAZ_IE[uf] : null);
  const linkCcc = portalCcc || LINK_CCC_SEFAZ;

  async function consultar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCarregando(true);
    setErro(null);
    setResultado(null);
    setPortalOficial(null);
    setPortalCcc(null);

    try {
      const params = new URLSearchParams({ cnpj: cnpjLimpo });
      if (uf) params.set('uf', uf);

      const resposta = await fetch(`/api/fornecedor-ie?${params.toString()}`, { cache: 'no-store' });
      const json = (await resposta.json()) as ApiResposta;
      if (!json.success) throw new Error(json.message);

      setResultado(json.consulta);
      setPortalOficial(json.portalOficial);
      setPortalCcc(json.portalCcc);
    } catch (error: unknown) {
      setErro((error as Error).message || 'Erro ao consultar IE.');
    } finally {
      setCarregando(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border)] pb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-black text-[var(--ink)]">IE de Fornecedor</h2>
            <p className="mt-1 text-xs text-[var(--ink-mut)]">
              Consulte inscricao estadual por CNPJ e UF, com link direto para conferencia no portal oficial.
            </p>
          </div>
          {linkPortal && (
            <div className="flex flex-wrap gap-2">
              <a
                href={linkCcc}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
              >
                Abrir CCC oficial
              </a>
              <a
                href={linkPortal}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
              >
                Abrir SEFAZ/Sintegra
              </a>
            </div>
          )}
        </div>

        <form onSubmit={consultar} className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_auto]">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">UF</label>
            <select
              value={uf}
              onChange={(event) => setUf(event.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            >
              <option value="">Todos</option>
              {UFS_BRASIL.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">CNPJ do fornecedor</label>
            <input
              value={cnpj}
              onChange={(event) => setCnpj(event.target.value)}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            />
          </div>

          <button
            type="submit"
            disabled={carregando || cnpjLimpo.length !== 14}
            className="h-10 self-end rounded-lg bg-[var(--accent)] px-5 text-sm font-bold text-white hover:brightness-125 disabled:opacity-50"
          >
            {carregando ? 'Consultando...' : 'Consultar IE'}
          </button>
        </form>

        {erro && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {erro}
          </div>
        )}
      </div>

      {resultado && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-mut)]">Fornecedor</p>
              <h3 className="mt-1 text-lg font-black text-[var(--ink)]">{resultado.razaoSocial}</h3>
              <p className="mt-1 font-mono text-xs text-[var(--ink-mut)]">{formatarCnpj(resultado.cnpj)}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-right">
              <p className="text-[11px] font-bold uppercase text-[var(--ink-mut)]">Fonte</p>
              <p className="text-sm font-bold text-[var(--ink)]">{resultado.fonte}</p>
              {resultado.consultaOficial.tentou && (
                <p className="mt-1 text-[11px] text-[var(--ink-mut)]">
                  {resultado.consultaOficial.ok ? 'Oficial SEFAZ OK' : resultado.consultaOficial.mensagem || 'Oficial sem IE'}
                </p>
              )}
            </div>
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <CampoResultado rotulo="Nome fantasia" valor={resultado.nomeFantasia} />
            <CampoResultado rotulo="Situacao cadastral" valor={resultado.situacaoCadastral} />
            <CampoResultado rotulo="Cidade / UF" valor={[resultado.cidade, resultado.uf].filter(Boolean).join(' / ')} />
            <CampoResultado rotulo="CNAE principal" valor={resultado.cnaePrincipal} />
            <CampoResultado rotulo="Endereco" valor={resultado.endereco} />
            <CampoResultado rotulo="Atualizado em" valor={dataCurta(resultado.atualizadoEm)} />
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
              <h4 className="text-sm font-black text-[var(--ink)]">Inscricoes estaduais encontradas</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-2)] text-xs uppercase text-[var(--ink-mut)]">
                  <tr>
                    <th className="px-3 py-2 font-bold">IE</th>
                    <th className="px-3 py-2 font-bold">UF</th>
                    <th className="px-3 py-2 font-bold">Estado</th>
                    <th className="px-3 py-2 font-bold">Status</th>
                    <th className="px-3 py-2 font-bold">Regime</th>
                    <th className="px-3 py-2 font-bold">Atualizacao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {resultado.inscricoesEstaduais.map((ie) => (
                    <tr key={`${ie.uf}-${ie.inscricao}`}>
                      <td className="px-3 py-2 font-mono font-bold text-[var(--ink)]">{ie.inscricao}</td>
                      <td className="px-3 py-2 text-[var(--ink)]">{ie.uf}</td>
                      <td className="px-3 py-2 text-[var(--ink-mut)]">{ie.estado || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ie.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {ie.situacao || (ie.ativo ? 'Ativa' : 'Inativa')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--ink-mut)]">{ie.regimeApuracao || '-'}</td>
                      <td className="px-3 py-2 text-[var(--ink-mut)]">{dataCurta(ie.atualizadoEm)}</td>
                    </tr>
                  ))}
                  {resultado.inscricoesEstaduais.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-[var(--ink-mut)]">
                        Nenhuma inscricao estadual retornada para este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {resultado.aviso && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {resultado.aviso}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
