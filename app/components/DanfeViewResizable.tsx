'use client';

import { useEffect, useRef, useState } from 'react';
import type { DanfeData } from '@/lib/sefaz/detalhe';
import type { SitramEspelhoData } from '@/lib/sitram/espelho';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtd(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function cnpjFmt(v: string): string {
  if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v || '-';
}

function chaveFmt(v: string): string {
  return v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function dataFmt(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
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
  children: React.ReactNode;
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

export default function DanfeViewResizable({ danfe, espelho }: { danfe: DanfeData; espelho?: SitramEspelhoData | null }) {
  const e = danfe.emit;
  const d = danfe.dest;
  const t = danfe.total;
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
      <div className="flex border border-gray-400">
        <div className="flex-1 border-r border-gray-400 p-3">
          <p className="text-sm font-bold">{e.nome}</p>
          {e.fantasia && e.fantasia !== e.nome && <p className="text-[11px]">{e.fantasia}</p>}
          <p className="mt-1 text-[11px]">
            {e.endereco.logradouro}, {e.endereco.numero} - {e.endereco.bairro}
          </p>
          <p className="text-[11px]">
            {e.endereco.municipio}/{e.endereco.uf} - CEP {e.endereco.cep}
          </p>
        </div>
        <div className="w-28 border-r border-gray-400 p-3 text-center">
          <p className="text-lg font-bold leading-none">DANFE</p>
          <p className="mt-1 text-[8px] leading-tight">Documento Auxiliar da Nota Fiscal Eletronica</p>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm font-bold">
            <span>{danfe.tpNF}</span>
            <span className="text-left text-[8px] font-normal leading-none">
              0 - ENTRADA
              <br />
              1 - SAIDA
            </span>
          </div>
          <p className="mt-2 text-[11px]">No {danfe.numero}</p>
          <p className="text-[11px]">Serie {danfe.serie}</p>
        </div>
        <div className="flex-1 p-3">
          <p className="text-[8px] uppercase text-gray-500">Chave de Acesso</p>
          <p className="font-mono text-[11px] leading-tight break-all">{chaveFmt(danfe.chave)}</p>
          <p className="mt-2 text-[9px] text-gray-600">Consulta em portalfiscal.inf.br/nfe</p>
          {danfe.protocolo && (
            <p className="mt-2 text-[10px]">
              <span className="text-gray-500">Protocolo: </span>
              {danfe.protocolo} - {dataFmt(danfe.dhProt)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 -mt-px">
        <Bloco titulo="Natureza da Operacao" center>
          {danfe.natOp || '-'}
        </Bloco>
        <Bloco titulo="Inscricao Estadual / CNPJ Emitente" center>
          IE {e.ie || '-'} · {cnpjFmt(e.cnpj)}
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
                  <p className="font-bold">{e.nome || '-'}</p>
                  {e.fantasia && e.fantasia !== e.nome ? <p>{e.fantasia}</p> : null}
                  <p className="mt-1">{cnpjFmt(e.cnpj)}</p>
                  <p>IE {e.ie || '-'}</p>
                  <p className="mt-1">{e.endereco.logradouro ? `${e.endereco.logradouro}, ${e.endereco.numero}` : '-'}</p>
                  <p>{e.endereco.bairro || '-'}</p>
                  <p>{e.endereco.municipio ? `${e.endereco.municipio}/${e.endereco.uf}` : '-'}</p>
                </div>
              </Bloco>
            </section>

            <section className="border-r border-gray-400">
              <Bloco titulo="Destinatario" center>
                <div>
                  <p className="font-bold">{d.nome || '-'}</p>
                  <p className="mt-1">{cnpjFmt(d.cnpjCpf)}</p>
                  <p>IE {d.ie || '-'}</p>
                  <p className="mt-1">{d.endereco.logradouro ? `${d.endereco.logradouro}, ${d.endereco.numero}` : '-'}</p>
                  <p>{d.endereco.bairro || '-'}</p>
                  <p>{d.endereco.municipio ? `${d.endereco.municipio}/${d.endereco.uf}` : '-'}</p>
                  <p className="mt-1">Emissao: {dataFmt(danfe.dhEmi)}</p>
                </div>
              </Bloco>
            </section>

            <section>
              <Bloco titulo="Valores" center>
                <div className="w-full space-y-1">
                  <p>Base ICMS: <strong>{moeda(t.vBC)}</strong></p>
                  <p>ICMS: <strong>{moeda(t.vICMS)}</strong></p>
                  <p>Base ICMS ST: <strong>{moeda(t.vBCST)}</strong></p>
                  <p>ICMS ST: <strong>{moeda(t.vST)}</strong></p>
                  <p>Produtos: <strong>{moeda(t.vProd)}</strong></p>
                  <p>Frete: <strong>{moeda(t.vFrete)}</strong></p>
                  <p>Seguro: <strong>{moeda(t.vSeg)}</strong></p>
                  <p>Desconto: <strong>{moeda(t.vDesc)}</strong></p>
                  <p>Outras Despesas: <strong>{moeda(t.vOutro)}</strong></p>
                  <p className="text-[12px] font-bold">Valor Total: {moeda(t.vNF)}</p>
                </div>
              </Bloco>
            </section>
          </div>
        </div>
      </div>

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Transporte</p>
      <div className="grid grid-cols-2 -mt-px">
        <Bloco titulo="Modalidade do Frete" center>
          {danfe.transp.modFrete || '-'}
        </Bloco>
        <Bloco titulo="Transportadora" center>
          {danfe.transp.transportadora || '-'}
        </Bloco>
      </div>

      {espelho && (
        <div className="mt-2 border border-amber-500 bg-amber-50 p-2 text-[10px] text-amber-950">
          <p className="mb-1 text-[8px] font-bold uppercase text-amber-800">Calculo ICMS SITRAM - ST 1031 / Antecipacao 1023</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
            <span>Base ST: <strong>{moeda(espelho.totais.baseCalculoSt)}</strong></span>
            <span>ICMS ST: <strong>{moeda(espelho.totais.icmsSt)}</strong></span>
            <span>Receita ST 1031: <strong>{moeda(espelho.totais.valorLancamentoSt)}</strong></span>
            <span>Base Ant.: <strong>{moeda(espelho.totais.baseCalculoAntecipacao)}</strong></span>
            <span>ICMS Ant.: <strong>{moeda(espelho.totais.icmsAntecipacao)}</strong></span>
            <span>Receita Ant. 1023: <strong>{moeda(espelho.totais.valorLancamentoAntecipacao)}</strong></span>
          </div>
        </div>
      )}

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Dados dos Produtos / Servicos</p>
      <table className="w-full border border-gray-400 text-[8px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-1 py-0.5">Cod.</th>
            <th className="border border-gray-300 px-1 py-0.5">Descricao</th>
            <th className="border border-gray-300 px-1 py-0.5">NCM</th>
            <th className="border border-gray-300 px-1 py-0.5">CFOP</th>
            <th className="border border-gray-300 px-1 py-0.5">Un.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Qtd.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Unit.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Total</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">BC ICMS</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Aliq.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">ICMS</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">BC ST</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">ICMS ST</th>
          </tr>
        </thead>
        <tbody>
          {danfe.itens.map((it) => (
            <tr key={it.nItem}>
              <td className="border border-gray-300 px-1 py-0.5">{it.codigo}</td>
              <td className="border border-gray-300 px-1 py-0.5">{it.descricao}</td>
              <td className="border border-gray-300 px-1 py-0.5">{it.ncm}</td>
              <td className="border border-gray-300 px-1 py-0.5">{it.cfop}</td>
              <td className="border border-gray-300 px-1 py-0.5">{it.unidade}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{qtd(it.quantidade)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.valorUnitario)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.valorTotal)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.vBC)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{it.pICMS ? `${moeda(it.pICMS)}%` : '-'}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.vICMS)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.vBCST)}</td>
              <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(it.vICMSST)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {danfe.infAdic && (
        <div className="mt-2">
          <p className="mb-0.5 text-[8px] uppercase text-gray-500">Informacoes Complementares</p>
          <div className="whitespace-pre-wrap border border-gray-400 p-2 text-[10px]">{danfe.infAdic}</div>
        </div>
      )}
    </div>
  );
}
