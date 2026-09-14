'use client';

import { useMemo, useState } from 'react';
import { regraCatalogo, type GrupoRegra } from '@/lib/sped/confronto/catalogo';

export type Severidade = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'INFO';

export interface DivergenciaItem {
  id?: number | null;
  codigoRegra: string;
  tipo: string;
  severidade: Severidade;
  registroSped: string;
  linhaSped: number;
  campo: string;
  valorSped: string;
  valorDanfe: string;
  descricao: string;
  chaveNfe?: string;
  participanteCod?: string;
  produtoCod?: string;
  fornecedorNome?: string;
  fornecedorCnpj?: string;
}

export interface ResultadoConfrontoPayload {
  periodo: string;
  cnpjEmpresa: string;
  nomeEmpresa: string;
  divergencias: DivergenciaItem[];
  totalNotasSped: number;
  totalNotasDanfe: number;
  notasSpedEncontradas: number;
  notasEntradaSped: number;
  notasSaidaSped: number;
  apuracao: {
    debitos: number;
    creditos: number;
    icmsRecolher: number;
    saldoCredorTransportar: number;
  } | null;
  executadoEm: string;
}

const PESO: Record<Severidade, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3, INFO: 4 };

const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  CRITICA: 'Crítico',
  ALTA: 'Importante',
  MEDIA: 'Revisar',
  BAIXA: 'Baixo',
  INFO: 'Informativo',
};

const ESTILO_SEVERIDADE: Record<Severidade, string> = {
  CRITICA: 'bg-[var(--crit)] text-white',
  ALTA: 'bg-[var(--crit-soft)] text-[var(--crit)]',
  MEDIA: 'bg-[var(--warn-soft)] text-[var(--warn)]',
  BAIXA: 'bg-[var(--surface-2)] text-[var(--ink-mut)]',
  INFO: 'bg-[var(--surface-2)] text-[var(--ink-mut)]',
};

const GRUPOS: Array<{ id: 'todos' | GrupoRegra; rotulo: string }> = [
  { id: 'todos', rotulo: 'Tudo' },
  { id: 'notas', rotulo: 'Notas' },
  { id: 'itens', rotulo: 'Itens e impostos' },
  { id: 'cadastro', rotulo: 'Cadastros' },
  { id: 'apuracao', rotulo: 'Apuração' },
];

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor || '';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function numeroDaChave(chave?: string): string {
  if (!chave || chave.length !== 44) return '';
  return String(Number(chave.slice(25, 34)));
}

function chaveLocal(d: DivergenciaItem, idx: number): string {
  return d.id ? `id-${d.id}` : `${d.codigoRegra}-${d.linhaSped}-${d.campo}-${idx}`;
}

function BadgeSeveridade({ severidade }: { severidade: Severidade }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${ESTILO_SEVERIDADE[severidade]}`}>
      {ROTULO_SEVERIDADE[severidade]}
    </span>
  );
}

function Cartao({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="text-xs font-semibold text-[var(--ink-mut)]">{titulo}</div>
      <div className="mt-1 text-2xl font-black text-[var(--ink)]">{valor}</div>
      <div className="mt-1 text-xs text-[var(--ink-mut)]">{detalhe}</div>
    </div>
  );
}

interface Props {
  resultado: ResultadoConfrontoPayload;
}

export default function SpedResultado({ resultado }: Props) {
  const [grupo, setGrupo] = useState<'todos' | GrupoRegra>('todos');
  const [mostrarInformativos, setMostrarInformativos] = useState(false);
  const [busca, setBusca] = useState('');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [resolvidas, setResolvidas] = useState<Set<string>>(new Set());
  const [erroResolver, setErroResolver] = useState<string | null>(null);

  const indexadas = useMemo(
    () => resultado.divergencias.map((d, idx) => ({ d, chave: chaveLocal(d, idx), regra: regraCatalogo(d.codigoRegra) })),
    [resultado],
  );

  const contagem = useMemo(() => {
    const porSeveridade: Record<Severidade, number> = { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0, INFO: 0 };
    const porGrupo: Record<string, number> = { todos: 0 };
    for (const { d, regra } of indexadas) {
      porSeveridade[d.severidade]++;
      if (d.severidade === 'INFO' && !mostrarInformativos) continue;
      porGrupo.todos++;
      porGrupo[regra.grupo] = (porGrupo[regra.grupo] ?? 0) + 1;
    }
    return { porSeveridade, porGrupo };
  }, [indexadas, mostrarInformativos]);

  const problemas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const mapa = new Map<string, { codigo: string; severidade: Severidade; itens: typeof indexadas }>();
    for (const item of indexadas) {
      const { d, regra } = item;
      if (d.severidade === 'INFO' && !mostrarInformativos) continue;
      if (grupo !== 'todos' && regra.grupo !== grupo) continue;
      if (termo) {
        const alvo = [d.descricao, d.fornecedorNome, d.fornecedorCnpj, d.chaveNfe, d.codigoRegra, regra.titulo]
          .join(' ')
          .toLowerCase();
        if (!alvo.includes(termo)) continue;
      }
      const atual = mapa.get(d.codigoRegra);
      if (atual) {
        atual.itens.push(item);
        if (PESO[d.severidade] < PESO[atual.severidade]) atual.severidade = d.severidade;
      } else {
        mapa.set(d.codigoRegra, { codigo: d.codigoRegra, severidade: d.severidade, itens: [item] });
      }
    }
    return Array.from(mapa.values()).sort(
      (a, b) => PESO[a.severidade] - PESO[b.severidade] || b.itens.length - a.itens.length,
    );
  }, [indexadas, grupo, mostrarInformativos, busca]);

  const graves = contagem.porSeveridade.CRITICA + contagem.porSeveridade.ALTA;
  const revisar = contagem.porSeveridade.MEDIA + contagem.porSeveridade.BAIXA;
  const semXml = resultado.totalNotasSped - resultado.notasSpedEncontradas;

  const alternarAberto = (codigo: string) => {
    setAbertos((prev) => {
      const novo = new Set(prev);
      if (novo.has(codigo)) novo.delete(codigo);
      else novo.add(codigo);
      return novo;
    });
  };

  const alternarResolvida = async (d: DivergenciaItem, chave: string) => {
    const resolvida = !resolvidas.has(chave);
    setResolvidas((prev) => {
      const novo = new Set(prev);
      if (resolvida) novo.add(chave);
      else novo.delete(chave);
      return novo;
    });
    if (!d.id) return;
    try {
      const res = await fetch('/api/sped/divergencias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: d.id, resolvida }),
      });
      if (!res.ok) throw new Error();
      setErroResolver(null);
    } catch {
      setErroResolver('Não foi possível salvar a marcação no servidor. Ela vale só nesta tela.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Veredito */}
      <div
        className={`rounded-2xl border p-5 ${
          graves > 0 ? 'border-[var(--crit)] bg-[var(--crit-soft)]' : 'border-[var(--good)] bg-[var(--good-soft)]'
        }`}
      >
        <div className={`text-lg font-black ${graves > 0 ? 'text-[var(--crit)]' : 'text-[var(--good)]'}`}>
          {graves > 0
            ? `${graves} ${graves === 1 ? 'problema precisa' : 'problemas precisam'} de correção`
            : 'Nenhum erro grave encontrado'}
        </div>
        <p className="mt-1 text-sm text-[var(--ink)]">
          {resultado.nomeEmpresa} · período {resultado.periodo}.{' '}
          {revisar > 0 && `${revisar} ${revisar === 1 ? 'ponto' : 'pontos'} para revisar. `}
          {semXml > 0 &&
            `${semXml} ${semXml === 1 ? 'nota do SPED não pôde ser conferida' : 'notas do SPED não puderam ser conferidas'} por falta do XML no Proton-e.`}
        </p>
      </div>

      {/* Números */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          titulo="Notas no SPED"
          valor={String(resultado.totalNotasSped)}
          detalhe={`${resultado.notasEntradaSped} entradas · ${resultado.notasSaidaSped} saídas`}
        />
        <Cartao
          titulo="Conferidas com o XML"
          valor={`${resultado.notasSpedEncontradas} de ${resultado.totalNotasSped}`}
          detalhe={semXml > 0 ? `${semXml} sem XML no Proton-e` : 'Todas encontradas'}
        />
        <Cartao
          titulo="Notas do mês no Proton-e"
          valor={String(resultado.totalNotasDanfe)}
          detalhe="Emitidas no período"
        />
        {resultado.apuracao ? (
          <Cartao
            titulo="Apuração do ICMS"
            valor={
              resultado.apuracao.icmsRecolher > 0
                ? formatarMoeda(resultado.apuracao.icmsRecolher)
                : formatarMoeda(resultado.apuracao.saldoCredorTransportar)
            }
            detalhe={
              resultado.apuracao.icmsRecolher > 0
                ? `a recolher · débitos ${formatarMoeda(resultado.apuracao.debitos)}, créditos ${formatarMoeda(resultado.apuracao.creditos)}`
                : `saldo credor para o próximo mês · créditos ${formatarMoeda(resultado.apuracao.creditos)}`
            }
          />
        ) : (
          <Cartao titulo="Apuração do ICMS" valor="—" detalhe="Arquivo sem registro E110" />
        )}
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {GRUPOS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGrupo(g.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                  grupo === g.id
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-[var(--accent-soft)] text-[var(--ink)] hover:bg-[var(--border)]'
                }`}
              >
                {g.rotulo} ({contagem.porGrupo[g.id] ?? 0})
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-mut)]">
            <input
              type="checkbox"
              checked={mostrarInformativos}
              onChange={(e) => setMostrarInformativos(e.target.checked)}
            />
            Mostrar informativos ({contagem.porSeveridade.INFO})
          </label>
        </div>
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por fornecedor, CNPJ, número ou chave da nota..."
          className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
        />
      </div>

      {erroResolver && (
        <div className="rounded-xl border border-[var(--warn)] bg-[var(--warn-soft)] p-3 text-sm text-[var(--ink)]">
          {erroResolver}
        </div>
      )}

      {/* Problemas agrupados */}
      {problemas.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] py-12 text-center text-sm text-[var(--ink-mut)]">
          Nada para mostrar com esses filtros.
        </div>
      ) : (
        <div className="space-y-3">
          {problemas.map((p) => {
            const regra = regraCatalogo(p.codigo);
            const aberto = abertos.has(p.codigo);
            const pendentes = p.itens.filter((i) => !resolvidas.has(i.chave)).length;
            return (
              <div key={p.codigo} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                <button
                  type="button"
                  onClick={() => alternarAberto(p.codigo)}
                  className="flex w-full items-start gap-3 p-4 text-left hover:bg-[var(--surface-2)] rounded-2xl"
                >
                  <BadgeSeveridade severidade={p.severidade} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-black text-[var(--ink)]">{regra.titulo}</span>
                      <span className="text-xs font-semibold text-[var(--ink-mut)]">
                        {p.itens.length} {p.itens.length === 1 ? 'ocorrência' : 'ocorrências'}
                        {pendentes !== p.itens.length && ` · ${pendentes} pendentes`}
                      </span>
                    </div>
                    {regra.significado && <p className="mt-1 text-xs text-[var(--ink-mut)]">{regra.significado}</p>}
                    {regra.comoCorrigir && (
                      <p className="mt-1 text-xs text-[var(--ink)]">
                        <span className="font-bold">O que fazer: </span>
                        {regra.comoCorrigir}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-bold text-[var(--ink-mut)]">{aberto ? 'Fechar ▲' : 'Ver ▼'}</span>
                </button>

                {aberto && (
                  <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                    {p.itens.map(({ d, chave }) => {
                      const resolvida = resolvidas.has(chave);
                      const numero = numeroDaChave(d.chaveNfe);
                      return (
                        <li key={chave} className={`flex flex-col gap-2 p-4 md:flex-row md:items-start ${resolvida ? 'opacity-50' : ''}`}>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 text-xs">
                              {numero && <span className="font-bold text-[var(--ink)]">NF {numero}</span>}
                              {d.fornecedorNome && <span className="font-semibold text-[var(--ink)]">{d.fornecedorNome}</span>}
                              {d.fornecedorCnpj && <span className="font-mono text-[var(--ink-mut)]">{formatarCnpj(d.fornecedorCnpj)}</span>}
                              {d.severidade !== p.severidade && <BadgeSeveridade severidade={d.severidade} />}
                            </div>
                            <p className="text-sm text-[var(--ink)]">{d.descricao}</p>
                            {(d.valorSped || d.valorDanfe) && (
                              <div className="flex flex-wrap gap-2 text-xs">
                                <span className="rounded-md bg-[var(--surface-2)] px-2 py-1">
                                  <span className="text-[var(--ink-mut)]">No SPED: </span>
                                  <span className="font-mono font-semibold text-[var(--ink)]">{d.valorSped || '—'}</span>
                                </span>
                                <span className="rounded-md bg-[var(--surface-2)] px-2 py-1">
                                  <span className="text-[var(--ink-mut)]">Na nota / Proton-e: </span>
                                  <span className="font-mono font-semibold text-[var(--ink)]">{d.valorDanfe || '—'}</span>
                                </span>
                              </div>
                            )}
                            <div className="text-[11px] text-[var(--ink-mut)]">
                              {d.linhaSped > 0 && `Linha ${d.linhaSped} do arquivo (registro ${d.registroSped}) · `}
                              {d.codigoRegra}
                              {d.chaveNfe && (
                                <>
                                  {' · '}
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(d.chaveNfe || '')}
                                    className="font-mono underline hover:text-[var(--ink)]"
                                    title="Copiar chave de acesso"
                                  >
                                    copiar chave
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => alternarResolvida(d, chave)}
                            className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold ${
                              resolvida
                                ? 'border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]'
                                : 'border-[var(--border-strong)] text-[var(--ink)] hover:bg-[var(--surface-2)]'
                            }`}
                          >
                            {resolvida ? '✓ Resolvida' : 'Marcar resolvida'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
