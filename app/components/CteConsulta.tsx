'use client';

import { Fragment, FormEvent, useState } from 'react';

export interface CnpjOpcaoCte {
  id: number;
  cnpj: string;
  razaoSocial: string | null;
}

interface NotaVinculadaCte {
  chave: string;
  numero: string | null;
  serie: string | null;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  situacaoSefaz: string | null;
  valorTotal: number | null;
  encontrada: boolean;
}

interface CteResultado {
  id: number;
  chave: string;
  numero: string | null;
  serie: string | null;
  emitidaEm: string;
  status: string;
  situacaoSefaz: string;
  cnpjInteressado: string;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  tomadorNome: string | null;
  tomadorCnpj: string | null;
  remetenteNome: string | null;
  remetenteCnpj: string | null;
  destinatarioNome: string | null;
  destinatarioCnpj: string | null;
  valorTotal: number | null;
  valorPrestacao: number | null;
  valorCarga: number | null;
  notasVinculadas: NotaVinculadaCte[];
}

type ApiResposta =
  | { success: true; ctes: CteResultado[]; total: number; limite: number }
  | { success: false; message: string };

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor || '-';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatarData(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR');
}

function formatarValor(valor: number | null): string {
  if (valor === null || valor === undefined) return '-';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function chaveResumida(chave: string): string {
  return `${chave.slice(0, 4)}...${chave.slice(-6)}`;
}

export default function CteConsulta({ cnpjs }: { cnpjs: CnpjOpcaoCte[] }) {
  const [busca, setBusca] = useState('');
  const [cnpjId, setCnpjId] = useState('todos');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<CteResultado[] | null>(null);
  const [limiteAtingido, setLimiteAtingido] = useState(false);
  const [expandido, setExpandido] = useState<number | null>(null);

  async function buscar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCarregando(true);
    setErro(null);

    try {
      const params = new URLSearchParams();
      if (busca.trim()) params.set('busca', busca.trim());
      if (cnpjId !== 'todos') params.set('cnpjId', cnpjId);
      if (inicio) params.set('inicio', inicio);
      if (fim) params.set('fim', fim);

      const resposta = await fetch(`/api/cte?${params.toString()}`, { cache: 'no-store' });
      const json = (await resposta.json()) as ApiResposta;
      if (!json.success) throw new Error(json.message);

      setResultados(json.ctes);
      setLimiteAtingido(json.total >= json.limite);
    } catch (error: unknown) {
      setErro((error as Error).message || 'Erro ao consultar CT-e.');
      setResultados(null);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="mb-4 border-b border-[var(--border)] pb-4">
          <h2 className="text-base font-black text-[var(--ink)]">CT-e vinculados as NF-e</h2>
          <p className="mt-1 text-xs text-[var(--ink-mut)]">
            Busque os Conhecimentos de Transporte recebidos da SEFAZ para os CNPJs cadastrados e veja quais NF-e cada CT-e transporta.
          </p>
        </div>

        <form onSubmit={buscar} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_150px_150px_auto]">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Busca</label>
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Chave CT-e, chave NF-e, numero, CNPJ ou nome"
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">CNPJ</label>
            <select
              value={cnpjId}
              onChange={(event) => setCnpjId(event.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            >
              <option value="todos">Todos</option>
              {cnpjs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.razaoSocial || formatarCnpj(item.cnpj)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">De</label>
            <input
              type="date"
              value={inicio}
              onChange={(event) => setInicio(event.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Ate</label>
            <input
              type="date"
              value={fim}
              onChange={(event) => setFim(event.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            />
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="h-10 self-end rounded-lg bg-[var(--accent)] px-5 text-sm font-bold text-white hover:brightness-125 disabled:opacity-50"
          >
            {carregando ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {erro && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {erro}
          </div>
        )}
      </div>

      {resultados && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <h3 className="text-sm font-black text-[var(--ink)]">
              {resultados.length} CT-e encontrado{resultados.length === 1 ? '' : 's'}
            </h3>
            {limiteAtingido && (
              <p className="text-[11px] font-semibold text-amber-700">
                Mostrando os mais recentes. Refine a busca para ver todos.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-2)] text-xs uppercase text-[var(--ink-mut)]">
                <tr>
                  <th className="px-3 py-2 font-bold">Emissao</th>
                  <th className="px-3 py-2 font-bold">CT-e</th>
                  <th className="px-3 py-2 font-bold">Transportadora</th>
                  <th className="px-3 py-2 font-bold">Tomador</th>
                  <th className="px-3 py-2 font-bold">Valor</th>
                  <th className="px-3 py-2 font-bold">Situacao</th>
                  <th className="px-3 py-2 font-bold">NF-e</th>
                  <th className="px-3 py-2 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {resultados.map((cte) => (
                  <Fragment key={cte.id}>
                    <tr>
                      <td className="px-3 py-2 text-[var(--ink)]">{formatarData(cte.emitidaEm)}</td>
                      <td className="px-3 py-2">
                        <p className="font-bold text-[var(--ink)]">{cte.numero || '-'}{cte.serie ? `/${cte.serie}` : ''}</p>
                        <p className="font-mono text-[11px] text-[var(--ink-mut)]" title={cte.chave}>{chaveResumida(cte.chave)}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[var(--ink)]">{cte.emitenteNome || '-'}</p>
                        <p className="text-[11px] text-[var(--ink-mut)]">{formatarCnpj(cte.emitenteCnpj)}</p>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-semibold text-[var(--ink)]">{cte.tomadorNome || '-'}</p>
                        <p className="text-[11px] text-[var(--ink-mut)]">{formatarCnpj(cte.tomadorCnpj)}</p>
                      </td>
                      <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                        {formatarValor(cte.valorPrestacao ?? cte.valorTotal)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            cte.situacaoSefaz === 'CANCELADO' || cte.situacaoSefaz === 'DENEGADO'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {cte.situacaoSefaz}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[var(--ink)]">
                        {cte.notasVinculadas.length}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {cte.notasVinculadas.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandido(expandido === cte.id ? null : cte.id)}
                            className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                          >
                            {expandido === cte.id ? 'Ocultar' : 'Ver NF-e'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandido === cte.id && cte.notasVinculadas.length > 0 && (
                      <tr>
                        <td colSpan={8} className="bg-[var(--surface-2)] px-4 py-3">
                          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-mut)]">
                            NF-e transportadas por este CT-e
                          </p>
                          <div className="space-y-1.5">
                            {cte.notasVinculadas.map((nfe) => (
                              <div
                                key={nfe.chave}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                              >
                                <div>
                                  <p className="font-mono text-[11px] text-[var(--ink-mut)]" title={nfe.chave}>
                                    {chaveResumida(nfe.chave)}
                                  </p>
                                  {nfe.encontrada ? (
                                    <p className="text-sm font-semibold text-[var(--ink)]">
                                      NF {nfe.numero || '-'}{nfe.serie ? `/${nfe.serie}` : ''} - {nfe.emitenteNome || formatarCnpj(nfe.emitenteCnpj)}
                                    </p>
                                  ) : (
                                    <p className="text-sm font-semibold text-amber-700">
                                      NF-e nao encontrada nesta base (fora do CNPJ ou ainda nao sincronizada)
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  {nfe.valorTotal !== null && (
                                    <span className="text-sm font-bold text-[var(--ink)]">{formatarValor(nfe.valorTotal)}</span>
                                  )}
                                  {nfe.situacaoSefaz && (
                                    <span className="rounded-full bg-[var(--surface-2)] px-2 py-1 text-xs font-bold text-[var(--ink-mut)]">
                                      {nfe.situacaoSefaz}
                                    </span>
                                  )}
                                  {nfe.encontrada && (
                                    <a
                                      href={`/danfe/${nfe.chave}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                                    >
                                      Abrir NF-e
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {resultados.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-sm text-[var(--ink-mut)]">
                      Nenhum CT-e encontrado para os filtros informados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
