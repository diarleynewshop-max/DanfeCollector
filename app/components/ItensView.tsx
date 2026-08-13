import type { DanfeData, DanfeItem } from '@/lib/sefaz/detalhe';
import type { SitramEspelhoData, SitramEspelhoItem } from '@/lib/sitram/espelho';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function qtd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function normalizarTexto(v: string | number | null | undefined): string {
  return String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

function itemSitramCorrespondente(
  item: DanfeItem,
  espelho: SitramEspelhoData | null | undefined
): SitramEspelhoItem | null {
  if (!espelho?.itens?.length) return null;

  const nItem = normalizarTexto(item.nItem);
  const codigo = normalizarTexto(item.codigo);
  const ncm = normalizarTexto(item.ncm);
  const cfop = normalizarTexto(item.cfop);

  return espelho.itens.find((sitramItem) => normalizarTexto(sitramItem.nItem) === nItem)
    ?? espelho.itens.find((sitramItem) => codigo && normalizarTexto(sitramItem.codigo) === codigo)
    ?? espelho.itens.find((sitramItem) =>
      ncm && cfop && normalizarTexto(sitramItem.ncm) === ncm && normalizarTexto(sitramItem.cfop) === cfop
    )
    ?? null;
}

function valorFecopXml(item: DanfeItem): number {
  return (item.vFCP ?? 0) + (item.vFCPST ?? 0) + (item.vFCPSTRet ?? 0);
}

function infoFiscalItem(
  item: DanfeItem,
  espelho: SitramEspelhoData | null | undefined
): {
  tributo: { label: string; classe: string } | null;
  temFecop: boolean;
  fecop: number | null;
} {
  const itemSitram = itemSitramCorrespondente(item, espelho);
  const fecopXml = valorFecopXml(item);
  const fecop = itemSitram?.fecop ?? (fecopXml > 0 ? fecopXml : null);
  const temFecop = itemSitram?.temFecop === true || (fecop !== null && fecop > 0);

  if (itemSitram?.temSt || item.vBCST > 0 || item.vICMSST > 0) {
    return {
      tributo: { label: '1031 - SUBT', classe: 'bg-red-100 text-red-700' },
      temFecop,
      fecop,
    };
  }

  if (itemSitram?.temAntecipacao) {
    return {
      tributo: { label: '1023 - ANTC', classe: 'bg-amber-100 text-amber-800' },
      temFecop,
      fecop,
    };
  }

  return { tributo: null, temFecop, fecop };
}

export default function ItensView({
  danfe,
  espelho,
}: {
  danfe: DanfeData;
  espelho?: SitramEspelhoData | null;
}) {
  if (danfe.itens.length === 0) {
    return <p className="py-4 text-sm text-gray-400">Nenhum item nesta nota.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between px-1 text-xs text-gray-500">
        <span>{danfe.itens.length} item(ns)</span>
        <span>
          Total dos produtos: <strong className="text-gray-700">{moeda(danfe.total.vProd)}</strong>
        </span>
      </div>

      {danfe.itens.map((it) => {
        const fiscal = infoFiscalItem(it, espelho);

        return (
          <div key={it.nItem} className="rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-white">
                {it.nItem}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-gray-800">{it.descricao}</p>
                  {fiscal.tributo && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${fiscal.tributo.classe}`}>
                      {fiscal.tributo.label}
                    </span>
                  )}
                  {fiscal.temFecop && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                      {fiscal.fecop !== null && fiscal.fecop > 0 ? `FECOP ${moeda(fiscal.fecop)}` : 'FECOP'}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Cod. {it.codigo || '-'}
                  {it.ean && it.ean !== 'SEM GTIN' ? ` | EAN ${it.ean}` : ''} | NCM {it.ncm || '-'} | CFOP {it.cfop || '-'}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4 lg:grid-cols-7">
                  <span className="text-gray-500">
                    Qtd: <strong className="text-gray-700">{qtd(it.quantidade)} {it.unidade}</strong>
                  </span>
                  <span className="text-gray-500">
                    Unitario: <strong className="text-gray-700">{moeda(it.valorUnitario)}</strong>
                  </span>
                  <span className="text-gray-500">
                    Total: <strong className="text-gray-800">{moeda(it.valorTotal)}</strong>
                  </span>
                  <span className="text-gray-500">
                    Base ICMS: <strong className="text-gray-700">{moeda(it.vBC)}</strong>
                  </span>
                  <span className="text-gray-500">
                    ICMS: <strong className="text-gray-700">{moeda(it.vICMS)}</strong>
                  </span>
                  <span className="text-gray-500">
                    Base ICMS ST: <strong className="text-gray-700">{moeda(it.vBCST)}</strong>
                  </span>
                  <span className="text-gray-500">
                    ICMS ST: <strong className="text-gray-700">{moeda(it.vICMSST)}</strong>
                  </span>
                  {fiscal.temFecop && (
                    <span className="text-gray-500">
                      FECOP: <strong className="text-gray-700">{fiscal.fecop !== null ? moeda(fiscal.fecop) : 'Sim'}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
