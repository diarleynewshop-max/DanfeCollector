'use client';

import { useState } from 'react';
import { BR_VIEWBOX, BR_UF_PATHS } from './mapaBrasilPaths';

export type ValorUf = { qtd: number; valor: number };

const NOMES_UF: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

export function nomeUf(uf: string): string {
  return NOMES_UF[uf] ?? uf;
}

// Escala de verde por intensidade de valor (choropleth quando nada está selecionado)
function corIntensidade(valor: number, maximo: number): string {
  if (!valor || !maximo) return '#e5e7eb';
  const pct = valor / maximo;
  if (pct >= 0.75) return '#047857';
  if (pct >= 0.45) return '#10b981';
  if (pct >= 0.15) return '#34d399';
  if (pct > 0) return '#a7f3d0';
  return '#e5e7eb';
}

function moedaCurta(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export default function MapaBrasil({
  valores,
  maxValor,
  selecionada,
  onSelect,
}: {
  valores: Map<string, ValorUf>;
  maxValor: number;
  selecionada: string | null;
  onSelect: (uf: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const ativa = hover ?? selecionada;
  const dadosAtiva = ativa ? valores.get(ativa) : null;

  return (
    <div className="relative mx-auto max-w-[410px]">
      <svg
        viewBox={BR_VIEWBOX}
        role="img"
        aria-label="Mapa do Brasil por estado"
        className="mx-auto block h-auto w-full select-none"
        style={{ overflow: 'visible' }}
      >
        {Object.entries(BR_UF_PATHS).map(([uf, d]) => {
          const item = valores.get(uf);
          const valor = item?.valor ?? 0;
          const isSel = selecionada === uf;
          const isHover = hover === uf;

          // Efeito de foco: com um estado selecionado, os demais ficam apagados.
          let fill: string;
          let opacity = 1;
          if (selecionada) {
            if (isSel) {
              fill = '#047857';
            } else {
              fill = '#d4d4d8';
              opacity = isHover ? 0.85 : 0.5;
            }
          } else {
            fill = isHover ? '#0f766e' : corIntensidade(valor, maxValor);
          }

          return (
            <path
              key={uf}
              d={d}
              fill={fill}
              fillOpacity={opacity}
              stroke={isSel ? '#064e3b' : '#ffffff'}
              strokeWidth={isSel ? 1.4 : 0.6}
              className="cursor-pointer transition-[fill,opacity] duration-200"
              tabIndex={0}
              role="button"
              aria-label={`${nomeUf(uf)}: ${item?.qtd ?? 0} nota(s)`}
              style={isSel ? { filter: 'drop-shadow(0 2px 5px rgba(4,120,87,0.45))' } : undefined}
              onClick={() => onSelect(uf)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(uf);
                }
              }}
              onMouseEnter={() => setHover(uf)}
              onMouseLeave={() => setHover((h) => (h === uf ? null : h))}
            >
              <title>{`${nomeUf(uf)} (${uf}) — ${item?.qtd ?? 0} nota(s), ${moedaCurta(valor)}`}</title>
            </path>
          );
        })}
      </svg>

      {ativa && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-center shadow-md">
          <div className="text-sm font-bold text-[var(--ink)]">{nomeUf(ativa)} <span className="text-[var(--ink-mut)]">({ativa})</span></div>
          <div className="text-xs text-[var(--ink-mut)]">
            {dadosAtiva ? `${dadosAtiva.qtd} nota(s) · ${moedaCurta(dadosAtiva.valor)}` : 'Sem notas no período'}
          </div>
        </div>
      )}
    </div>
  );
}
