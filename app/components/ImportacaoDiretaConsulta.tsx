'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { listarNotasImportacaoDireta, type NotaImportacaoDireta } from '@/lib/actions';

export interface CnpjOpcaoImportacao {
  id: number;
  cnpj: string;
  razaoSocial: string | null;
}

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor || '-';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatarData(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? '-' : data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function formatarValor(valor: number | null): string {
  if (valor === null || valor === undefined) return '-';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function chaveResumida(chave: string): string {
  return `${chave.slice(0, 4)}...${chave.slice(-6)}`;
}

export default function ImportacaoDiretaConsulta({ cnpjs }: { cnpjs: CnpjOpcaoImportacao[] }) {
  const [busca, setBusca] = useState('');
  const [cnpjId, setCnpjId] = useState('todos');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaImportacaoDireta[] | null>(null);
  const [limiteAtingido, setLimiteAtingido] = useState(false);

  const consultar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await listarNotasImportacaoDireta({
        busca,
        cnpjId: cnpjId === 'todos' ? null : Number(cnpjId),
        inicio,
        fim,
      });
      if (!res.success) throw new Error(res.message);
      setNotas(res.notas);
      setLimiteAtingido(res.limiteAtingido);
    } catch (error: unknown) {
      setErro((error as Error).message || 'Erro ao consultar notas de importacao direta.');
      setNotas(null);
    } finally {
      setCarregando(false);
    }
    // Os filtros só valem ao clicar em Buscar; a carga inicial roda uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, cnpjId, inicio, fim]);

  useEffect(() => {
    void consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buscar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void consultar();
  }

  const valorTotal = (notas ?? []).reduce((soma, nota) => soma + (nota.valorTotal ?? 0), 0);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="mb-4 border-b border-[var(--border)] pb-4">
          <h2 className="text-base font-black text-[var(--ink)]">Notas de importação direta</h2>
          <p className="mt-1 text-xs text-[var(--ink-mut)]">
            Notas de entrada com tipo IMPORTAÇÃO DIRETA: as marcadas na nota e as que ainda não foram classificadas mas
            trazem &quot;importação&quot; na natureza da operação ou emitente no exterior.
          </p>
        </div>

        <form onSubmit={buscar} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_150px_150px_auto]">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Busca</label>
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Numero, chave, CNPJ, fornecedor ou natureza"
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Empresa</label>
            <select
              value={cnpjId}
              onChange={(event) => setCnpjId(event.target.value)}
              className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
            >
              <option value="todos">Todas</option>
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

      {notas && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
            <h3 className="text-sm font-black text-[var(--ink)]">
              {notas.length} nota{notas.length === 1 ? '' : 's'} · {formatarValor(valorTotal)}
            </h3>
            {limiteAtingido && (
              <p className="text-[11px] font-semibold text-amber-700">
                Mostrando as mais recentes. Refine a busca para ver todas.
              </p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-2)] text-xs uppercase text-[var(--ink-mut)]">
                <tr>
                  <th className="px-3 py-2 font-bold">Emissao</th>
                  <th className="px-3 py-2 font-bold">NF-e</th>
                  <th className="px-3 py-2 font-bold">Fornecedor</th>
                  <th className="px-3 py-2 font-bold">Natureza da operacao</th>
                  <th className="px-3 py-2 font-bold">Destinatario</th>
                  <th className="px-3 py-2 font-bold">Valor</th>
                  <th className="px-3 py-2 font-bold">Situacao</th>
                  <th className="px-3 py-2 font-bold" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {notas.map((nota) => (
                  <tr key={nota.id}>
                    <td className="px-3 py-2 text-[var(--ink)]">{formatarData(nota.emitidaEm)}</td>
                    <td className="px-3 py-2">
                      <p className="font-bold text-[var(--ink)]">
                        {nota.numero || '-'}
                        {nota.serie ? `/${nota.serie}` : ''}
                      </p>
                      <p className="font-mono text-[11px] text-[var(--ink-mut)]" title={nota.chave}>
                        {chaveResumida(nota.chave)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-[var(--ink)]">
                        {nota.emitenteNome || '-'}
                        {nota.emitenteUf ? ` (${nota.emitenteUf})` : ''}
                      </p>
                      <p className="text-[11px] text-[var(--ink-mut)]">{formatarCnpj(nota.emitenteCnpj)}</p>
                    </td>
                    <td className="px-3 py-2 text-[var(--ink)]">
                      {nota.naturezaOp || '-'}
                      {nota.tipoNotaEntradaOrigem === 'MANUAL' && (
                        <span className="ml-2 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[10px] font-bold text-[var(--ink-mut)]">
                          marcada manualmente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-[var(--ink)]">{nota.destinatarioNome || '-'}</p>
                      <p className="text-[11px] text-[var(--ink-mut)]">{formatarCnpj(nota.destinatarioCnpj)}</p>
                    </td>
                    <td className="px-3 py-2 font-semibold text-[var(--ink)]">{formatarValor(nota.valorTotal)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {nota.situacaoSefaz}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`/danfe/${nota.chave}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                      >
                        Abrir NF-e
                      </a>
                    </td>
                  </tr>
                ))}
                {notas.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-sm text-[var(--ink-mut)]">
                      Nenhuma nota de importação direta encontrada para os filtros informados.
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
