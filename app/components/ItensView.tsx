import type { DanfeData } from '@/lib/sefaz/detalhe';

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function qtd(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function ItensView({ danfe }: { danfe: DanfeData }) {
  if (danfe.itens.length === 0) {
    return <p className="text-sm text-gray-400 py-4">Nenhum item nesta nota.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500 px-1">
        <span>{danfe.itens.length} item(ns)</span>
        <span>
          Total dos produtos: <strong className="text-gray-700">{moeda(danfe.total.vProd)}</strong>
        </span>
      </div>

      {danfe.itens.map((it) => (
        <div key={it.nItem} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-7 h-7 rounded-full bg-gray-800 text-white text-xs font-bold flex items-center justify-center">
              {it.nItem}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm text-gray-800">{it.descricao}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cód. {it.codigo}
                {it.ean && it.ean !== 'SEM GTIN' ? ` · EAN ${it.ean}` : ''} · NCM {it.ncm} · CFOP {it.cfop}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs">
                <span className="text-gray-500">
                  Qtd: <strong className="text-gray-700">{qtd(it.quantidade)} {it.unidade}</strong>
                </span>
                <span className="text-gray-500">
                  Unitário: <strong className="text-gray-700">{moeda(it.valorUnitario)}</strong>
                </span>
                <span className="text-gray-500">
                  Total: <strong className="text-gray-800">{moeda(it.valorTotal)}</strong>
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
