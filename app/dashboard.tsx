'use client';

import { useState, useMemo, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Cnpj, NotaFiscal } from '@prisma/client';
import {
  verificarCertificado,
  sincronizarNotas,
  adicionarCnpj,
  alternarAtivoCnpj,
  removerCnpj,
  obterDetalheNota,
  manifestarNota,
  lerCertificados,
  vincularCertificados,
  importarChavesLote,
  importarXmlsDaPasta,
  type ActionResult,
  type CertificadoComStatus,
  type ResultadoImportChave,
} from '@/lib/actions';
import type { DanfeData } from '@/lib/sefaz/detalhe';
import DanfeView from './components/DanfeView';
import ItensView from './components/ItensView';

type NotaComCnpj = NotaFiscal & { cnpj: { cnpj: string; razaoSocial: string | null } };
type CnpjComContagem = Cnpj & { _count: { notas: number } };

interface DashboardProps {
  cnpjs: CnpjComContagem[];
  notas: NotaComCnpj[];
}

function formatarCnpj(cnpj: string | null): string {
  if (!cnpj) return '—';
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function moeda(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function data(d: Date | string): string {
  return new Date(d).toLocaleDateString('pt-BR');
}

export default function Dashboard({ cnpjs, notas }: DashboardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<{ success?: boolean; message: string }>({
    message: 'Pronto.',
  });
  const [mostrarForm, setMostrarForm] = useState(false);
  const [pending, startTransition] = useTransition();

  const [certs, setCerts] = useState<CertificadoComStatus[] | null>(null);
  const [carregandoCerts, setCarregandoCerts] = useState(false);

  // Importação por chave
  const [mostrarImport, setMostrarImport] = useState(false);
  const [importTexto, setImportTexto] = useState('');
  const [importCnpjId, setImportCnpjId] = useState<number | ''>('');
  const [importManifestar, setImportManifestar] = useState(true);
  const [importProgresso, setImportProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [importResumo, setImportResumo] = useState<Record<string, number> | null>(null);
  const [pastaXml, setPastaXml] = useState('');

  function handleImportarPasta() {
    startTransition(async () => {
      const res = await importarXmlsDaPasta(pastaXml);
      setStatus(res);
      if (res.success) router.refresh();
    });
  }

  async function handleImportar() {
    const chaves = [...new Set(importTexto.match(/\d{44}/g) ?? [])];
    if (chaves.length === 0) {
      setStatus({ success: false, message: 'Nenhuma chave de 44 dígitos encontrada no texto colado.' });
      return;
    }
    if (!importCnpjId) {
      setStatus({ success: false, message: 'Selecione a empresa (destinatária) das notas.' });
      return;
    }

    setImportResumo(null);
    setImportProgresso({ feito: 0, total: chaves.length });
    const tally: Record<string, number> = {};
    const LOTE = 8;

    for (let i = 0; i < chaves.length; i += LOTE) {
      const grupo = chaves.slice(i, i + LOTE);
      let res: ResultadoImportChave[];
      try {
        res = await importarChavesLote(Number(importCnpjId), grupo, importManifestar);
      } catch {
        res = grupo.map((chave) => ({ chave, status: 'erro' as const }));
      }
      for (const r of res) tally[r.status] = (tally[r.status] ?? 0) + 1;
      setImportProgresso({ feito: Math.min(i + LOTE, chaves.length), total: chaves.length });
      setImportResumo({ ...tally });
    }

    router.refresh();
    setStatus({ success: true, message: `Importação concluída: ${chaves.length} chave(s) processada(s).` });
  }

  const [filtroCnpjId, setFiltroCnpjId] = useState<number | 'todos'>('todos');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'RESUMO' | 'COMPLETA'>('todos');
  const [expandida, setExpandida] = useState<number | null>(null);

  function abrirCertificados() {
    if (certs) return setCerts(null);
    setCarregandoCerts(true);
    lerCertificados().then((res) => {
      if (res.ok) setCerts(res.certificados);
      else setStatus({ success: false, message: res.message });
      setCarregandoCerts(false);
    });
  }

  function handleVincularCerts() {
    startTransition(async () => {
      const res = await vincularCertificados();
      setStatus(res);
      if (res.success) {
        const r = await lerCertificados();
        if (r.ok) setCerts(r.certificados);
        router.refresh();
      }
    });
  }

  function executar(acao: () => Promise<ActionResult>) {
    startTransition(async () => setStatus(await acao()));
  }

  function handleAdicionarCnpj(formData: FormData) {
    startTransition(async () => {
      const res = await adicionarCnpj(formData);
      setStatus(res);
      if (res.success) setMostrarForm(false);
    });
  }

  const notasFiltradas = useMemo(
    () =>
      notas.filter((n) => {
        if (filtroCnpjId !== 'todos' && n.cnpjId !== filtroCnpjId) return false;
        if (filtroStatus !== 'todos' && n.status !== filtroStatus) return false;
        return true;
      }),
    [notas, filtroCnpjId, filtroStatus]
  );
  const totalFiltrado = useMemo(
    () => notasFiltradas.reduce((acc, n) => acc + (n.valorTotal ?? 0), 0),
    [notasFiltradas]
  );
  const valorGeral = useMemo(() => notas.reduce((a, n) => a + (n.valorTotal ?? 0), 0), [notas]);
  const pendentes = useMemo(
    () => notas.filter((n) => n.status === 'RESUMO' && !n.manifestadaEm).length,
    [notas]
  );

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 px-6 py-5 mb-6 shadow-lg shadow-indigo-200/60 flex flex-wrap gap-4 justify-between items-center">
          <div className="flex items-center gap-3 text-white">
            <div className="w-12 h-12 rounded-xl bg-white/15 grid place-items-center text-2xl backdrop-blur">
              🧾
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">DanfeCollector</h1>
              <p className="text-indigo-100 text-sm">Sincronização direta com a SEFAZ · custo zero</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMostrarImport((v) => !v)}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-lg text-sm font-medium transition backdrop-blur"
            >
              📥 Importar chaves
            </button>
            <button
              onClick={abrirCertificados}
              disabled={carregandoCerts}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 backdrop-blur"
            >
              {carregandoCerts ? 'Lendo…' : certs ? 'Fechar certificados' : '🔐 Certificados do PC'}
            </button>
            <button
              onClick={() => executar(verificarCertificado)}
              disabled={pending}
              className="bg-white text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
            >
              Verificar Certificado
            </button>
          </div>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard label="Empresas" value={String(cnpjs.length)} icon="🏢" accent="bg-indigo-100 text-indigo-700" />
          <KpiCard label="Notas fiscais" value={String(notas.length)} icon="🧾" accent="bg-sky-100 text-sky-700" />
          <KpiCard label="Valor total" value={moeda(valorGeral)} icon="💰" accent="bg-emerald-100 text-emerald-700" />
          <KpiCard label="A manifestar" value={String(pendentes)} icon="⏳" accent="bg-amber-100 text-amber-700" />
        </div>

        {/* Painel de importação por chave */}
        {mostrarImport && (
          <div className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-800">📥 Importar notas por chave de acesso</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Cole as chaves de acesso (44 dígitos) — pode colar a coluna inteira do Excel. O app
              busca cada nota na SEFAZ pela chave (consulta direta, sem depender do NSU).
            </p>
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <select
                value={importCnpjId}
                onChange={(e) => setImportCnpjId(e.target.value ? Number(e.target.value) : '')}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="">Empresa destinatária das notas…</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={importManifestar}
                  onChange={(e) => setImportManifestar(e.target.checked)}
                  className="w-4 h-4"
                />
                Manifestar (Ciência) para baixar o XML completo
              </label>
            </div>
            <textarea
              value={importTexto}
              onChange={(e) => setImportTexto(e.target.value)}
              placeholder="Cole aqui as chaves de acesso (uma por linha ou coladas do Excel)…"
              rows={5}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleImportar}
                disabled={!!importProgresso && importProgresso.feito < importProgresso.total}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {importProgresso && importProgresso.feito < importProgresso.total
                  ? `Importando… ${importProgresso.feito}/${importProgresso.total}`
                  : 'Importar'}
              </button>
              <span className="text-xs text-slate-400">
                {[...new Set(importTexto.match(/\d{44}/g) ?? [])].length} chave(s) detectada(s)
              </span>
            </div>

            {importProgresso && (
              <div className="mt-3">
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-2 transition-all"
                    style={{ width: `${(importProgresso.feito / importProgresso.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {importResumo && (
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {importResumo['completa'] ? <Badge tone="green">{importResumo['completa']} completa(s)</Badge> : null}
                {importResumo['manifestada'] ? <Badge tone="amber">{importResumo['manifestada']} manifestada(s)</Badge> : null}
                {importResumo['resumo'] ? <Badge tone="blue">{importResumo['resumo']} resumo(s)</Badge> : null}
                {importResumo['ja-tinha'] ? <Badge tone="gray">{importResumo['ja-tinha']} já tinha</Badge> : null}
                {importResumo['fora-de-prazo'] ? <Badge tone="orange">{importResumo['fora-de-prazo']} fora de prazo (&gt;90d)</Badge> : null}
                {importResumo['nao-encontrada'] ? <Badge tone="orange">{importResumo['nao-encontrada']} não encontrada(s)</Badge> : null}
                {importResumo['erro'] ? <Badge tone="orange">{importResumo['erro']} erro(s)</Badge> : null}
              </div>
            )}

            {/* Importar arquivos XML de uma pasta (notas antigas, do contador/ERP) */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-sm font-medium text-slate-700 mb-1">
                Importar XMLs de uma pasta <span className="text-slate-400 font-normal">(notas antigas / do contador — sem SEFAZ, qualquer data)</span>
              </p>
              <div className="flex gap-2">
                <input
                  value={pastaXml}
                  onChange={(e) => setPastaXml(e.target.value)}
                  placeholder="Ex.: C:\Users\diarl\Documents\XMLs-Contador"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                <button
                  onClick={handleImportarPasta}
                  disabled={pending || !pastaXml}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Importar pasta
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Cada XML é associado à empresa (emitente ou destinatário) já cadastrada. Funciona para qualquer ano.
              </p>
            </div>
          </div>
        )}

        {/* Painel de certificados */}
        {certs && (
          <div className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-800">🔐 Certificados Digitais no Windows</h2>
              <button
                onClick={handleVincularCerts}
                disabled={pending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Cadastrar / vincular todas
              </button>
            </div>
            {certs.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Nenhum e-CNPJ encontrado no repositório do Windows.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                      <th className="pb-2 font-medium">Empresa</th>
                      <th className="pb-2 font-medium">CNPJ</th>
                      <th className="pb-2 font-medium">UF</th>
                      <th className="pb-2 font-medium">Validade</th>
                      <th className="pb-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {certs.map((c) => (
                      <tr key={c.thumbprint} className="hover:bg-slate-50">
                        <td className="py-2.5 font-medium text-slate-700">{c.razaoSocial}</td>
                        <td className="py-2.5 font-mono text-xs text-slate-500">{formatarCnpj(c.cnpj)}</td>
                        <td className="py-2.5">{c.uf}</td>
                        <td className={`py-2.5 ${c.vencido ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                          {new Date(c.vencimento).toLocaleDateString('pt-BR')}
                          {c.vencido ? ' (vencido)' : ''}
                        </td>
                        <td className="py-2.5">
                          <Badge tone={c.jaCadastrado ? 'green' : 'amber'}>
                            {c.jaCadastrado ? 'CADASTRADA' : 'NOVA'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-3">
              Para sincronizar/manifestar, cada empresa precisa do arquivo .pfx (a chave no Windows não é
              exportável). Empresas da mesma raiz compartilham o mesmo .pfx.
            </p>
          </div>
        )}

        {/* Status */}
        <div
          className={`mb-6 px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${
            status.success === true
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : status.success === false
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-white border-slate-200 text-slate-600'
          }`}
        >
          <span>
            {pending ? '⏳' : status.success === true ? '✅' : status.success === false ? '⚠️' : 'ℹ️'}
          </span>
          <span>{pending ? 'Processando…' : status.message}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Empresas */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-base font-semibold text-slate-800 mb-3 pb-3 border-b border-slate-100">
              Empresas
            </h2>

            {cnpjs.length === 0 && !mostrarForm && (
              <p className="text-sm text-slate-400 py-2">Nenhum CNPJ cadastrado.</p>
            )}

            <ul className="space-y-2">
              {cnpjs.map((c) => {
                const bloqueado = c.bloqueadoAte ? new Date(c.bloqueadoAte) > new Date() : false;
                const hora = c.bloqueadoAte
                  ? new Date(c.bloqueadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <li key={c.id} className="rounded-xl border border-slate-100 p-3 hover:border-slate-200 hover:bg-slate-50/60 transition">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 truncate">{c.razaoSocial || 'Sem nome'}</p>
                        <p className="text-xs text-slate-500 font-mono">{formatarCnpj(c.cnpj)}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {c.uf} · NSU {Number(c.ultimoNSU)} · {c._count.notas} nota(s)
                        </p>
                      </div>
                      <Badge tone={c.ativo ? 'green' : 'gray'}>{c.ativo ? 'ATIVO' : 'INATIVO'}</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5 truncate" title={c.situacao}>
                      {c.situacao}
                    </p>
                    <div className="flex gap-3 mt-2 text-xs">
                      <button
                        onClick={() => executar(() => sincronizarNotas(c.id))}
                        disabled={pending || !c.ativo || bloqueado}
                        title={bloqueado ? `Em dia — próxima consulta às ${hora}` : 'Sincronizar com a SEFAZ'}
                        className="font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                      >
                        {bloqueado ? `⏱ Em dia (${hora})` : '↻ Sincronizar'}
                      </button>
                      <button
                        onClick={() => executar(() => alternarAtivoCnpj(c.id))}
                        disabled={pending}
                        className="font-medium text-amber-600 hover:text-amber-700 disabled:opacity-40"
                      >
                        {c.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                      <button
                        onClick={() => executar(() => removerCnpj(c.id))}
                        disabled={pending}
                        className="font-medium text-red-500 hover:text-red-600 disabled:opacity-40"
                      >
                        Remover
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {mostrarForm ? (
              <form action={handleAdicionarCnpj} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <input name="cnpj" placeholder="CNPJ (somente números)" required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <input name="razaoSocial" placeholder="Razão Social (opcional)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <input name="uf" placeholder="UF (ex.: CE)" required maxLength={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm uppercase bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                    Salvar
                  </button>
                  <button type="button" onClick={() => setMostrarForm(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium">
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setMostrarForm(true)}
                className="mt-4 w-full border border-dashed border-slate-300 text-indigo-600 text-sm font-medium hover:bg-indigo-50 hover:border-indigo-300 rounded-lg py-2 transition">
                + Adicionar CNPJ
              </button>
            )}
          </div>

          {/* Notas */}
          <div className="lg:col-span-3 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800 mr-auto">Notas Fiscais</h2>
              <select
                value={filtroCnpjId}
                onChange={(e) => setFiltroCnpjId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="todos">Todas as empresas</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                ))}
              </select>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="todos">Todos os status</option>
                <option value="RESUMO">Resumo</option>
                <option value="COMPLETA">Completa</option>
              </select>
            </div>

            <div className="flex justify-between text-sm text-slate-500 mb-2 px-1">
              <span>{notasFiltradas.length} nota(s)</span>
              <span>Total: <strong className="text-slate-800">{moeda(totalFiltrado)}</strong></span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                    <th className="pb-2 font-medium w-8"></th>
                    <th className="pb-2 font-medium">Data</th>
                    <th className="pb-2 font-medium">Tipo</th>
                    <th className="pb-2 font-medium">Emitente</th>
                    <th className="pb-2 font-medium text-right">Valor</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {notasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-400">
                        Nenhuma nota para o filtro selecionado.
                      </td>
                    </tr>
                  )}
                  {notasFiltradas.map((n) => (
                    <FragmentNota
                      key={n.id}
                      nota={n}
                      aberta={expandida === n.id}
                      onToggle={() => setExpandida(expandida === n.id ? null : n.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          DanfeCollector · NF-e direto da SEFAZ
        </p>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl grid place-items-center text-xl ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-lg font-bold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'gray' | 'blue' | 'sky' | 'orange'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-slate-200 text-slate-500',
    blue: 'bg-indigo-100 text-indigo-700',
    sky: 'bg-sky-100 text-sky-700',
    orange: 'bg-orange-100 text-orange-700',
  };
  return (
    <span className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-bold tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function FragmentNota({ nota, aberta, onToggle }: { nota: NotaComCnpj; aberta: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`cursor-pointer transition ${aberta ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`} onClick={onToggle}>
        <td className="py-3 text-slate-400 text-center">{aberta ? '▾' : '▸'}</td>
        <td className="py-3 whitespace-nowrap text-slate-600">{data(nota.emitidaEm)}</td>
        <td className="py-3">
          {nota.tipoOperacao && (
            <Badge tone={nota.tipoOperacao === 'Entrada' ? 'sky' : 'orange'}>{nota.tipoOperacao}</Badge>
          )}
        </td>
        <td className="py-3">
          <p className="font-medium text-slate-800 truncate max-w-[260px]">{nota.emitenteNome || '—'}</p>
          <p className="text-xs text-slate-400 font-mono">{formatarCnpj(nota.emitenteCnpj)}</p>
        </td>
        <td className="py-3 text-right whitespace-nowrap font-semibold text-slate-800">{moeda(nota.valorTotal)}</td>
        <td className="py-3">
          <Badge tone={nota.status === 'COMPLETA' ? 'green' : 'blue'}>{nota.status}</Badge>
        </td>
      </tr>
      {aberta && (
        <tr className="bg-slate-50/70">
          <td colSpan={6} className="px-4 py-4">
            <DetalheNota nota={nota} />
          </td>
        </tr>
      )}
    </>
  );
}

type Aba = 'dados' | 'danfe' | 'itens';

function DetalheNota({ nota }: { nota: NotaComCnpj }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('dados');
  const [danfe, setDanfe] = useState<DanfeData | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [manifestando, setManifestando] = useState(false);
  const [msgManifesto, setMsgManifesto] = useState<{ ok: boolean; texto: string } | null>(null);

  const ehResumo = nota.status === 'RESUMO';

  useEffect(() => {
    if (!ehResumo && (aba === 'danfe' || aba === 'itens') && !danfe && !erro && !carregando) {
      setCarregando(true);
      obterDetalheNota(nota.id).then((res) => {
        if (res.ok) setDanfe(res.danfe);
        else setErro(res.message);
        setCarregando(false);
      });
    }
  }, [aba, danfe, erro, carregando, nota.id, ehResumo]);

  async function handleManifestar() {
    setManifestando(true);
    setMsgManifesto(null);
    const res = await manifestarNota(nota.id);
    setMsgManifesto({ ok: res.success, texto: res.message });
    setManifestando(false);
    if (res.success) router.refresh();
  }

  function BannerManifestar() {
    const jaManifestada = !!nota.manifestadaEm;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        {jaManifestada ? (
          <p className="text-sm text-amber-800">
            ✓ <strong>Ciência da Operação já registrada</strong> em{' '}
            {new Date(nota.manifestadaEm!).toLocaleDateString('pt-BR')}. A nota continua como RESUMO
            até a SEFAZ liberar o XML completo — clique em <strong>Sincronizar</strong> no CNPJ para
            baixá-lo (pode levar alguns minutos após a manifestação).
          </p>
        ) : (
          <>
            <p className="text-sm text-amber-800">
              Esta nota é um <strong>RESUMO</strong> — a SEFAZ ainda não liberou o XML completo
              (itens e DANFE). Faça a <strong>Ciência da Operação</strong> para destravar.
            </p>
            <button
              onClick={handleManifestar}
              disabled={manifestando}
              className="mt-3 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {manifestando ? 'Manifestando…' : 'Manifestar (Ciência da Operação)'}
            </button>
          </>
        )}
        {msgManifesto && (
          <p className={`mt-3 text-sm ${msgManifesto.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {msgManifesto.texto}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {(['dados', 'danfe', 'itens'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
              aba === a ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {a === 'dados' ? 'Dados' : a === 'danfe' ? 'DANFE' : 'Itens'}
          </button>
        ))}
      </div>

      {aba === 'dados' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <Campo rotulo="Empresa (destinatário)" valor={nota.cnpj.razaoSocial || formatarCnpj(nota.cnpj.cnpj)} />
            <Campo rotulo="Número / Série" valor={nota.numero ? `${nota.numero} / ${nota.serie ?? '—'}` : '—'} />
            <Campo rotulo="Natureza da Operação" valor={nota.naturezaOp || '—'} />
            <Campo rotulo="Emitente" valor={nota.emitenteNome || '—'} />
            <Campo rotulo="CNPJ Emitente" valor={formatarCnpj(nota.emitenteCnpj)} />
            <Campo rotulo="IE / UF Emitente" valor={`${nota.emitenteIe || '—'} / ${nota.emitenteUf || '—'}`} />
            <Campo rotulo="Destinatário" valor={nota.destNome || (nota.status === 'RESUMO' ? '(após manifestar)' : '—')} />
            <Campo rotulo="CNPJ Destinatário" valor={formatarCnpj(nota.destCnpj)} />
            <Campo rotulo="NSU" valor={nota.nsu ? String(Number(nota.nsu)) : '—'} />
            <Campo rotulo="Valor dos Produtos" valor={moeda(nota.valorProdutos)} />
            <Campo rotulo="Frete" valor={moeda(nota.valorFrete)} />
            <Campo rotulo="Desconto" valor={moeda(nota.valorDesconto)} />
            <Campo rotulo="ICMS" valor={moeda(nota.valorIcms)} />
            <Campo rotulo="Valor Total" valor={moeda(nota.valorTotal)} />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-400 mb-1">Chave de Acesso</p>
            <p className="font-mono text-sm tracking-wide break-all select-all text-slate-700">{nota.chave}</p>
          </div>
        </div>
      )}

      {(aba === 'danfe' || aba === 'itens') && (
        <div>
          {ehResumo && <BannerManifestar />}
          {!ehResumo && carregando && (
            <p className="text-sm text-slate-400 py-6 text-center">Carregando XML…</p>
          )}
          {!ehResumo && erro && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{erro}</p>
          )}
          {danfe && aba === 'danfe' && (
            <div>
              <div className="flex justify-end gap-4 mb-2">
                <a href={`/danfe/${nota.chave}/pdf`} target="_blank" rel="noopener noreferrer"
                  className="text-emerald-600 text-sm font-medium hover:underline">
                  DANFE oficial (MeuDanfe) ↗
                </a>
                <a href={`/danfe/${nota.chave}`} target="_blank" rel="noopener noreferrer"
                  className="text-indigo-600 text-sm hover:underline">
                  Abrir / Imprimir (PDF) ↗
                </a>
              </div>
              <div className="border border-slate-200 rounded-xl p-4 bg-white overflow-x-auto">
                <DanfeView danfe={danfe} />
              </div>
            </div>
          )}
          {danfe && aba === 'itens' && <ItensView danfe={danfe} />}
        </div>
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{rotulo}</p>
      <p className="font-medium text-slate-700">{valor}</p>
    </div>
  );
}
