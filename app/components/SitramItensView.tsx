'use client';

import type { SitramEspelhoData } from '@/lib/sitram/espelho';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function qtd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function percentual(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function tipoTributo(item: SitramEspelhoData['itens'][number]): string {
  if (item.temSt) return '1031 - SUBT';
  if (item.temAntecipacao) return '1023 - ANTC';
  if (item.temCalculadoraSitram) return 'Sem ST/ANT';
  return 'Nao identificado por item';
}

function textoFecop(item: SitramEspelhoData['itens'][number]): string {
  if (!item.temFecop && !(item.fecop !== null && item.fecop !== undefined && item.fecop > 0)) return '-';
  if (item.fecop !== null && item.fecop !== undefined) return moeda(item.fecop);
  return item.temFecop ? 'Sim' : '-';
}

function classeDestaque(tipo: 'ST' | 'ANTECIPACAO'): string {
  return tipo === 'ST'
    ? 'border-red-300 bg-red-50 ring-2 ring-red-100'
    : 'border-amber-300 bg-amber-50 ring-2 ring-amber-100';
}

function itemEhDestaque(item: SitramEspelhoData['itens'][number], tipo: 'ST' | 'ANTECIPACAO' | null | undefined): boolean {
  if (tipo === 'ST') return item.temSt;
  if (tipo === 'ANTECIPACAO') return item.temAntecipacao;
  return false;
}

export default function SitramItensView({
  espelho,
  destaqueTributo,
}: {
  espelho: SitramEspelhoData;
  destaqueTributo?: 'ST' | 'ANTECIPACAO' | null;
}) {
  const totalDestaque = destaqueTributo
    ? espelho.itens.filter((item) => itemEhDestaque(item, destaqueTributo)).length
    : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>{espelho.itens.length} item(ns) retornado(s) pelo SITRAM</span>
        <span>
          Total dos produtos: <strong>{moeda(espelho.totais.produtos)}</strong>
        </span>
        <span>
          ICMS SITRAM: <strong>{moeda(espelho.totais.icms)}</strong>
        </span>
        <span>
          Base ST: <strong>{moeda(espelho.totais.baseCalculoSt)}</strong>
        </span>
        <span>
          Base Ant.: <strong>{moeda(espelho.totais.baseCalculoAntecipacao)}</strong>
        </span>
      </div>
      {destaqueTributo && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${destaqueTributo === 'ST' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          Destaque: {totalDestaque} item(ns) com {destaqueTributo === 'ST' ? '1031 - SUBT' : '1023 - ANTC'} nesta nota.
        </div>
      )}

      {espelho.itens.map((item, indice) => {
        const destacado = itemEhDestaque(item, destaqueTributo);
        return (
        <div key={`${item.nItem}-${item.codigo ?? indice}`} className={`rounded-lg border p-3 ${destacado && destaqueTributo ? classeDestaque(destaqueTributo) : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'}`}>
          <div className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-bold text-white">
              {item.nItem}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-medium text-[var(--ink)]">{item.produto}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${item.temSt ? 'bg-red-100 text-red-700' : item.temAntecipacao ? 'bg-amber-100 text-amber-800' : 'bg-[var(--surface-2)] text-[var(--ink-mut)]'}`}>
                  {tipoTributo(item)}
                </span>
                {item.temFecop && (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                    FECOP
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--ink-mut)]">
                Cod. {item.codigo || '-'} | NCM {item.ncm || '-'} | CFOP {item.cfop || '-'} | CST {item.cst || '-'}
                {item.regimeDescricao ? ` | ${item.regimeDescricao}` : ''}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 lg:grid-cols-7">
                <span className="text-[var(--ink-mut)]">
                  Qtd: <strong className="text-[var(--ink)]">{qtd(item.quantidade)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  Unitario: <strong className="text-[var(--ink)]">{moeda(item.valorUnitario)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  Total: <strong className="text-[var(--ink)]">{moeda(item.valorTotal)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  Aliq.: <strong className="text-[var(--ink)]">{percentual(item.aliquota)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  Base: <strong className="text-[var(--ink)]">{moeda(item.baseCalculo)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  ICMS: <strong className="text-[var(--ink)]">{moeda(item.icms ?? item.icmsDestacado)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  FECOP: <strong className="text-[var(--ink)]">{textoFecop(item)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  BC ST: <strong className="text-[var(--ink)]">{moeda(item.baseCalculoSt)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  ICMS ST: <strong className="text-[var(--ink)]">{moeda(item.icmsSt)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  BC Ant.: <strong className="text-[var(--ink)]">{moeda(item.baseCalculoAntecipacao)}</strong>
                </span>
                <span className="text-[var(--ink-mut)]">
                  ICMS Ant.: <strong className="text-[var(--ink)]">{moeda(item.icmsAntecipacao)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
