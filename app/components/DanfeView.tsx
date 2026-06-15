import type { DanfeData } from '@/lib/sefaz/detalhe';

function moeda(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function qtd(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function cnpjFmt(v: string): string {
  if (v.length === 14) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (v.length === 11) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v || '—';
}
function chaveFmt(v: string): string {
  return v.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}
function dataFmt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-400 p-2">
      <p className="text-[8px] uppercase text-gray-500 leading-none mb-0.5">{titulo}</p>
      <div className="text-[11px] leading-tight">{children}</div>
    </div>
  );
}

/** Layout simplificado da DANFE, fiel ao essencial e pronto para impressão/PDF. */
export default function DanfeView({ danfe }: { danfe: DanfeData }) {
  const e = danfe.emit;
  const d = danfe.dest;
  const t = danfe.total;

  return (
    <div className="danfe bg-white text-black mx-auto" style={{ maxWidth: '210mm' }}>
      {/* Cabeçalho */}
      <div className="flex border border-gray-400">
        <div className="flex-1 p-3 border-r border-gray-400">
          <p className="font-bold text-sm">{e.nome}</p>
          {e.fantasia && e.fantasia !== e.nome && <p className="text-[11px]">{e.fantasia}</p>}
          <p className="text-[11px] mt-1">
            {e.endereco.logradouro}, {e.endereco.numero} — {e.endereco.bairro}
          </p>
          <p className="text-[11px]">
            {e.endereco.municipio}/{e.endereco.uf} — CEP {e.endereco.cep}
          </p>
        </div>
        <div className="w-28 p-3 text-center border-r border-gray-400">
          <p className="font-bold text-lg leading-none">DANFE</p>
          <p className="text-[8px] mt-1 leading-tight">Documento Auxiliar da Nota Fiscal Eletrônica</p>
          <div className="mt-2 flex items-center justify-center gap-2 text-sm font-bold">
            <span>{danfe.tpNF}</span>
            <span className="text-[8px] font-normal text-left leading-none">
              0 - ENTRADA<br />1 - SAÍDA
            </span>
          </div>
          <p className="text-[11px] mt-2">Nº {danfe.numero}</p>
          <p className="text-[11px]">Série {danfe.serie}</p>
        </div>
        <div className="flex-1 p-3">
          <p className="text-[8px] uppercase text-gray-500">Chave de Acesso</p>
          <p className="font-mono text-[11px] break-all leading-tight">{chaveFmt(danfe.chave)}</p>
          <p className="text-[9px] mt-2 text-gray-600">
            Consulta em portalfiscal.inf.br/nfe
          </p>
          {danfe.protocolo && (
            <p className="text-[10px] mt-2">
              <span className="text-gray-500">Protocolo: </span>
              {danfe.protocolo} — {dataFmt(danfe.dhProt)}
            </p>
          )}
        </div>
      </div>

      {/* Natureza / IE */}
      <div className="grid grid-cols-2 -mt-px">
        <Bloco titulo="Natureza da Operação">{danfe.natOp || '—'}</Bloco>
        <Bloco titulo="Inscrição Estadual / CNPJ Emitente">
          IE {e.ie || '—'} · {cnpjFmt(e.cnpj)}
        </Bloco>
      </div>

      {/* Destinatário */}
      <p className="text-[8px] uppercase text-gray-500 mt-2 mb-0.5">Destinatário / Remetente</p>
      <div className="grid grid-cols-3 -mt-px">
        <Bloco titulo="Nome / Razão Social">{d.nome || '—'}</Bloco>
        <Bloco titulo="CNPJ / CPF">{cnpjFmt(d.cnpjCpf)}</Bloco>
        <Bloco titulo="Inscrição Estadual">{d.ie || '—'}</Bloco>
        <Bloco titulo="Endereço">
          {d.endereco.logradouro
            ? `${d.endereco.logradouro}, ${d.endereco.numero} — ${d.endereco.bairro}`
            : '—'}
        </Bloco>
        <Bloco titulo="Município / UF">
          {d.endereco.municipio ? `${d.endereco.municipio}/${d.endereco.uf}` : '—'}
        </Bloco>
        <Bloco titulo="Data de Emissão">{dataFmt(danfe.dhEmi)}</Bloco>
      </div>

      {/* Totais */}
      <p className="text-[8px] uppercase text-gray-500 mt-2 mb-0.5">Cálculo do Imposto</p>
      <div className="grid grid-cols-4 -mt-px">
        <Bloco titulo="Base de Cálculo ICMS">{moeda(t.vBC)}</Bloco>
        <Bloco titulo="Valor do ICMS">{moeda(t.vICMS)}</Bloco>
        <Bloco titulo="Valor Total dos Produtos">{moeda(t.vProd)}</Bloco>
        <Bloco titulo="Valor Total da Nota">
          <span className="font-bold">{moeda(t.vNF)}</span>
        </Bloco>
        <Bloco titulo="Valor do Frete">{moeda(t.vFrete)}</Bloco>
        <Bloco titulo="Valor do Seguro">{moeda(t.vSeg)}</Bloco>
        <Bloco titulo="Desconto">{moeda(t.vDesc)}</Bloco>
        <Bloco titulo="Outras Despesas">{moeda(t.vOutro)}</Bloco>
      </div>

      {/* Transporte */}
      <p className="text-[8px] uppercase text-gray-500 mt-2 mb-0.5">Transporte</p>
      <div className="grid grid-cols-2 -mt-px">
        <Bloco titulo="Modalidade do Frete">{danfe.transp.modFrete || '—'}</Bloco>
        <Bloco titulo="Transportadora">{danfe.transp.transportadora || '—'}</Bloco>
      </div>

      {/* Itens */}
      <p className="text-[8px] uppercase text-gray-500 mt-2 mb-0.5">Dados dos Produtos / Serviços</p>
      <table className="w-full border border-gray-400 text-[10px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-1 py-0.5">Cód.</th>
            <th className="border border-gray-300 px-1 py-0.5">Descrição</th>
            <th className="border border-gray-300 px-1 py-0.5">NCM</th>
            <th className="border border-gray-300 px-1 py-0.5">CFOP</th>
            <th className="border border-gray-300 px-1 py-0.5">Un.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Qtd.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Unit.</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">V. Total</th>
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
            </tr>
          ))}
        </tbody>
      </table>

      {danfe.infAdic && (
        <div className="mt-2">
          <p className="text-[8px] uppercase text-gray-500 mb-0.5">Informações Complementares</p>
          <div className="border border-gray-400 p-2 text-[10px] whitespace-pre-wrap">{danfe.infAdic}</div>
        </div>
      )}
    </div>
  );
}
