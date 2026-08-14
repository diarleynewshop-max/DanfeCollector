'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SitramEspelhoData } from '@/lib/sitram/espelho';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numero(v: number | null | undefined, casas = 4): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

function percentual(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function fecopItem(item: SitramEspelhoData['itens'][number]): string {
  if (!item.temFecop && !(item.fecop !== null && item.fecop !== undefined && item.fecop > 0)) return '-';
  if (item.fecop !== null && item.fecop !== undefined) return moeda(item.fecop);
  return item.temFecop ? 'Sim' : '-';
}

function tributoItem(item: SitramEspelhoData['itens'][number]): string {
  if (item.temSt) return 'ST 1031';
  if (item.temAntecipacao) return 'ANT 1023';
  return item.temCalculadoraSitram ? 'Sem ST/ANT' : '-';
}

function cnpjFmt(v: string | null | undefined): string {
  const limpo = (v ?? '').replace(/\D/g, '');
  if (limpo.length === 14) return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (limpo.length === 11) return limpo.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v || '-';
}

function chaveFmt(v: string): string {
  return v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function dataFmt(valor: string | null | undefined): string {
  if (!valor) return '-';
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? valor : data.toLocaleString('pt-BR');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Bloco({
  titulo,
  children,
  center = false,
}: {
  titulo: string;
  children: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`border border-gray-400 p-2 ${center ? 'text-center' : ''}`}>
      <p className="mb-0.5 text-[8px] uppercase leading-none text-gray-500">{titulo}</p>
      <div className={`text-[11px] leading-tight ${center ? 'flex min-h-[2.8rem] items-center justify-center text-center' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function Resizer({
  left,
  onStart,
}: {
  left: string;
  onStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Redimensionar coluna"
      className="no-print absolute top-0 z-10 h-full w-4 -translate-x-1/2 cursor-col-resize bg-transparent"
      style={{ left }}
      onPointerDown={onStart}
    >
      <span className="mx-auto block h-full w-px bg-slate-300" />
    </button>
  );
}

export default function SitramEspelhoView({ espelho }: { espelho: SitramEspelhoData }) {
  const [widths, setWidths] = useState<[number, number, number]>([33, 34, 33]);
  const dragRef = useRef<{ divider: 0 | 1; startX: number; snapshot: [number, number, number] } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;

      const deltaPct = ((event.clientX - drag.startX) / container.offsetWidth) * 100;
      const [a, b, c] = drag.snapshot;

      if (drag.divider === 0) {
        const nextA = clamp(a + deltaPct, 18, 64);
        const nextB = clamp(b - (nextA - a), 18, 64);
        setWidths([nextA, nextB, 100 - nextA - nextB]);
        return;
      }

      const nextB = clamp(b + deltaPct, 18, 64);
      const nextC = clamp(c - (nextB - b), 18, 64);
      setWidths([100 - nextB - nextC, nextB, nextC]);
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  function startDrag(divider: 0 | 1) {
    return (event: React.PointerEvent<HTMLButtonElement>) => {
      dragRef.current = {
        divider,
        startX: event.clientX,
        snapshot: widths,
      };
    };
  }

  const dividerA = `${widths[0]}%`;
  const dividerB = `${widths[0] + widths[1]}%`;

  return (
    <div className="danfe mx-auto bg-white text-black" style={{ maxWidth: '210mm' }}>
      <div className="mb-2 border border-amber-500 bg-amber-50 p-2 text-[10px] font-semibold text-amber-950">
        Espelho operacional gerado com dados do SITRAM. Nao substitui o DANFE oficial/XML autorizado.
      </div>

      <div className="flex border border-gray-400">
        <div className="flex-1 border-r border-gray-400 p-3">
          <p className="text-sm font-bold">{espelho.emitente.nome || '-'}</p>
          <p className="mt-1 text-[11px]">{cnpjFmt(espelho.emitente.cnpj)}</p>
          <p className="text-[11px]">UF {espelho.emitente.uf || '-'}</p>
        </div>
        <div className="w-36 border-r border-gray-400 p-3 text-center">
          <p className="text-lg font-bold leading-none">ESPELHO</p>
          <p className="mt-1 text-[8px] leading-tight">Dados da NF-e retornados pelo SITRAM</p>
          <p className="mt-2 text-[11px]">No {espelho.numero || '-'}</p>
          <p className="text-[11px]">Serie {espelho.serie || '-'}</p>
        </div>
        <div className="flex-1 p-3">
          <p className="text-[8px] uppercase text-gray-500">Chave de Acesso</p>
          <p className="font-mono text-[11px] leading-tight break-all">{chaveFmt(espelho.chave)}</p>
          <p className="mt-2 text-[10px]">
            <span className="text-gray-500">Emissao: </span>
            {dataFmt(espelho.emitidaEm)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 -mt-px">
        <Bloco titulo="Natureza da Operacao" center>
          {espelho.naturezaOp || '-'}
        </Bloco>
        <Bloco titulo="Situacao / DAE" center>
          {espelho.dae.classificacao}
          {espelho.dae.situacaoImposto ? ` - ${espelho.dae.situacaoImposto}` : ''}
        </Bloco>
      </div>

      <div className="mt-2">
        <p className="mb-0.5 text-center text-[8px] uppercase text-gray-500">Emitente | Destinatario | Valores</p>
        <div ref={containerRef} className="relative overflow-hidden border border-gray-400">
          <Resizer left={dividerA} onStart={startDrag(0)} />
          <Resizer left={dividerB} onStart={startDrag(1)} />
          <div className="grid" style={{ gridTemplateColumns: `${widths[0]}% ${widths[1]}% ${widths[2]}%` }}>
            <section className="border-r border-gray-400">
              <Bloco titulo="Emitente" center>
                <div>
                  <p className="font-bold">{espelho.emitente.nome || '-'}</p>
                  <p className="mt-1">{cnpjFmt(espelho.emitente.cnpj)}</p>
                  <p>UF {espelho.emitente.uf || '-'}</p>
                </div>
              </Bloco>
            </section>

            <section className="border-r border-gray-400">
              <Bloco titulo="Destinatario" center>
                <div>
                  <p className="font-bold">{espelho.destinatario.nome || '-'}</p>
                  <p className="mt-1">{cnpjFmt(espelho.destinatario.cnpj)}</p>
                  <p>UF {espelho.destinatario.uf || '-'}</p>
                  <p className="mt-1">Emissao: {dataFmt(espelho.emitidaEm)}</p>
                </div>
              </Bloco>
            </section>

            <section>
              <Bloco titulo="Valores SITRAM" center>
                <div className="w-full space-y-1">
                  <p>Base ICMS: <strong>{moeda(espelho.totais.baseCalculo)}</strong></p>
                  <p>ICMS SITRAM: <strong>{moeda(espelho.totais.icms)}</strong></p>
                  <p>Base ICMS ST: <strong>{moeda(espelho.totais.baseCalculoSt)}</strong></p>
                  <p>ICMS ST: <strong>{moeda(espelho.totais.icmsSt)}</strong></p>
                  <p>Base antecipacao: <strong>{moeda(espelho.totais.baseCalculoAntecipacao)}</strong></p>
                  <p>ICMS antecipacao: <strong>{moeda(espelho.totais.icmsAntecipacao)}</strong></p>
                  <p>Receita ST 1031: <strong>{moeda(espelho.totais.valorLancamentoSt)}</strong></p>
                  <p>Receita Ant. 1023: <strong>{moeda(espelho.totais.valorLancamentoAntecipacao)}</strong></p>
                  <p>ICMS destacado: <strong>{moeda(espelho.totais.icmsDestacado)}</strong></p>
                  <p>Produtos: <strong>{moeda(espelho.totais.produtos)}</strong></p>
                  <p>Frete NF: <strong>{moeda(espelho.totais.frete)}</strong></p>
                  <p>IPI: <strong>{moeda(espelho.totais.ipi)}</strong></p>
                  <p>FECOP: <strong>{moeda(espelho.totais.fecop)}</strong></p>
                  <p className="text-[12px] font-bold">Valor Total: {moeda(espelho.totais.nota)}</p>
                </div>
              </Bloco>
            </section>
          </div>
        </div>
      </div>

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Dados dos Produtos / Servicos - SITRAM</p>
      <table className="w-full border border-gray-400 text-[8px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-1 py-0.5">No</th>
            <th className="border border-gray-300 px-1 py-0.5">Cod.</th>
            <th className="border border-gray-300 px-1 py-0.5">Descricao</th>
            <th className="border border-gray-300 px-1 py-0.5">NCM</th>
            <th className="border border-gray-300 px-1 py-0.5">CFOP</th>
            <th className="border border-gray-300 px-1 py-0.5">CST</th>
            <th className="border border-gray-300 px-1 py-0.5">Trib.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Qtd.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Unit.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Total</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Aliq.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Base</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">ICMS</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">BC ST</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">ICMS ST</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">BC Ant.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">ICMS Ant.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">FECOP</th>
          </tr>
        </thead>
        <tbody>
          {espelho.itens.map((item, indice) => (
            <tr key={`${item.nItem}-${item.codigo ?? indice}`}>
              <td className="border border-gray-300 px-1 py-0.5">{item.nItem}</td>
              <td className="border border-gray-300 px-1 py-0.5">{item.codigo || '-'}</td>
              <td className="border border-gray-300 px-1 py-0.5">{item.produto}</td>
              <td className="border border-gray-300 px-1 py-0.5">{item.ncm || '-'}</td>
              <td className="border border-gray-300 px-1 py-0.5">{item.cfop || '-'}</td>
              <td className="border border-gray-300 px-1 py-0.5">{item.cst || '-'}</td>
              <td className="border border-gray-300 px-1 py-0.5">{tributoItem(item)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{numero(item.quantidade)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.valorUnitario)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.valorTotal)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{percentual(item.aliquota)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.baseCalculo)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.icms ?? item.icmsDestacado)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.baseCalculoSt)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.icmsSt)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.baseCalculoAntecipacao)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(item.icmsAntecipacao)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{fecopItem(item)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {espelho.dae.lancamentos.length > 0 && (
        <div className="mt-2">
          <p className="mb-0.5 text-[8px] uppercase text-gray-500">Receitas / DAE SITRAM</p>
          <table className="w-full border border-gray-400 text-[9px]">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="border border-gray-300 px-1 py-0.5">Receita</th>
                <th className="border border-gray-300 px-1 py-0.5">Descricao</th>
                <th className="border border-gray-300 px-1 py-0.5 text-right">Valor</th>
                <th className="border border-gray-300 px-1 py-0.5 text-right">Aberto</th>
                <th className="border border-gray-300 px-1 py-0.5">Vencimento</th>
                <th className="border border-gray-300 px-1 py-0.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {espelho.dae.lancamentos.map((lancamento, indice) => (
                <tr key={`${lancamento.codigo ?? 'dae'}-${indice}`}>
                  <td className="border border-gray-300 px-1 py-0.5">{lancamento.codigo || '-'}</td>
                  <td className="border border-gray-300 px-1 py-0.5">{lancamento.descricao}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(lancamento.valor)}</td>
                  <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(lancamento.valorAberto)}</td>
                  <td className="border border-gray-300 px-1 py-0.5">{dataFmt(lancamento.vencimento)}</td>
                  <td className="border border-gray-300 px-1 py-0.5">{lancamento.pago ? 'Pago' : 'A pagar'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
