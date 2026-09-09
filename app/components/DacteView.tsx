import type { DacteData } from '@/lib/sefaz/dacteDetalhe';

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function Bloco({ titulo, children, center = false }: { titulo: string; children: React.ReactNode; center?: boolean }) {
  return (
    <div className={`border border-gray-400 p-2 ${center ? 'text-center' : ''}`}>
      <p className="mb-0.5 text-[8px] uppercase leading-none text-gray-500">{titulo}</p>
      <div className={`text-[11px] leading-tight ${center ? 'flex min-h-[3rem] items-center justify-center text-center' : ''}`}>
        {children}
      </div>
    </div>
  );
}

function BlocoPessoa({ titulo, dados }: { titulo: string; dados: DacteData['emit'] | DacteData['rem'] | DacteData['dest'] }) {
  const fantasia = 'fantasia' in dados ? dados.fantasia : '';
  return (
    <Bloco titulo={titulo}>
      <div>
        <p className="font-bold">{dados.nome || '-'}</p>
        {fantasia && fantasia !== dados.nome ? <p>{fantasia}</p> : null}
        <p className="mt-0.5">{cnpjFmt(dados.cnpjCpf)}{dados.ie ? ` · IE ${dados.ie}` : ''}</p>
        <p className="mt-0.5">
          {dados.endereco.logradouro ? `${dados.endereco.logradouro}, ${dados.endereco.numero}` : '-'}
          {dados.endereco.bairro ? ` - ${dados.endereco.bairro}` : ''}
        </p>
        <p>{dados.endereco.municipio ? `${dados.endereco.municipio}/${dados.endereco.uf}` : '-'} {dados.endereco.cep ? `- CEP ${dados.endereco.cep}` : ''}</p>
      </div>
    </Bloco>
  );
}

export default function DacteView({ dacte }: { dacte: DacteData }) {
  return (
    <div className="dacte mx-auto bg-white text-black" style={{ maxWidth: '210mm' }}>
      <div className="flex border border-gray-400">
        <div className="flex-1 border-r border-gray-400 p-3">
          <p className="text-sm font-bold">{dacte.emit.nome}</p>
          {dacte.emit.fantasia && dacte.emit.fantasia !== dacte.emit.nome && <p className="text-[11px]">{dacte.emit.fantasia}</p>}
          <p className="mt-1 text-[11px]">
            {dacte.emit.endereco.logradouro}, {dacte.emit.endereco.numero} - {dacte.emit.endereco.bairro}
          </p>
          <p className="text-[11px]">
            {dacte.emit.endereco.municipio}/{dacte.emit.endereco.uf} - CEP {dacte.emit.endereco.cep}
          </p>
          <p className="mt-1 text-[11px]">{cnpjFmt(dacte.emit.cnpjCpf)} · IE {dacte.emit.ie || '-'}</p>
        </div>
        <div className="w-32 border-r border-gray-400 p-3 text-center">
          <p className="text-lg font-bold leading-none">DACTE</p>
          <p className="mt-1 text-[8px] leading-tight">Documento Auxiliar do Conhecimento de Transporte Eletronico</p>
          <p className="mt-2 text-[11px]">Modal: {dacte.modal || '-'}</p>
          <p className="text-[11px]">Tipo: {dacte.tpCTe || '-'}</p>
          <p className="mt-2 text-[11px]">No {dacte.numero}</p>
          <p className="text-[11px]">Serie {dacte.serie}</p>
        </div>
        <div className="flex-1 p-3">
          <p className="text-[8px] uppercase text-gray-500">Chave de Acesso</p>
          <p className="font-mono text-[11px] leading-tight break-all">{chaveFmt(dacte.chave)}</p>
          <p className="mt-2 text-[9px] text-gray-600">Consulta em dfe-portal.svrs.rs.gov.br/cte</p>
          {dacte.protocolo && (
            <p className="mt-2 text-[10px]">
              <span className="text-gray-500">Protocolo: </span>
              {dacte.protocolo} - {dataFmt(dacte.dhProt)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 -mt-px">
        <Bloco titulo="Natureza da Operacao" center>{dacte.natOp || '-'}</Bloco>
        <Bloco titulo="CFOP" center>{dacte.cfop || '-'}</Bloco>
        <Bloco titulo="Emissao" center>{dataFmt(dacte.dhEmi)}</Bloco>
      </div>

      <div className="grid grid-cols-3 -mt-px">
        <Bloco titulo="Tipo de Servico" center>{dacte.tpServico || '-'}</Bloco>
        <Bloco titulo="Inicio da Prestacao" center>{dacte.municipioIni ? `${dacte.municipioIni}/${dacte.ufIni}` : '-'}</Bloco>
        <Bloco titulo="Termino da Prestacao" center>{dacte.municipioFim ? `${dacte.municipioFim}/${dacte.ufFim}` : '-'}</Bloco>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-0">
        <BlocoPessoa titulo="Remetente" dados={dacte.rem} />
        <BlocoPessoa titulo="Destinatario" dados={dacte.dest} />
      </div>

      {(dacte.exped || dacte.receb) && (
        <div className="mt-2 grid grid-cols-2 gap-0">
          {dacte.exped ? <BlocoPessoa titulo="Expedidor" dados={dacte.exped} /> : <div />}
          {dacte.receb ? <BlocoPessoa titulo="Recebedor" dados={dacte.receb} /> : <div />}
        </div>
      )}

      <div className="mt-2">
        <Bloco titulo={`Tomador do Servico${dacte.tomador.descricao !== '-' ? ` (${dacte.tomador.descricao})` : ''}`}>
          {dacte.tomador.pessoa ? (
            <p>
              <span className="font-bold">{dacte.tomador.pessoa.nome}</span> · {cnpjFmt(dacte.tomador.pessoa.cnpjCpf)}
              {dacte.tomador.pessoa.ie ? ` · IE ${dacte.tomador.pessoa.ie}` : ''}
            </p>
          ) : '-'}
        </Bloco>
      </div>

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Componentes do Valor da Prestacao</p>
      <table className="w-full border border-gray-400 text-[10px]">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="border border-gray-300 px-1 py-0.5">Nome</th>
            <th className="border border-gray-300 px-1 py-0.5 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {dacte.vPrest.componentes.length > 0 ? (
            dacte.vPrest.componentes.map((c, indice) => (
              <tr key={`${c.nome}-${indice}`}>
                <td className="border border-gray-300 px-1 py-0.5">{c.nome}</td>
                <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(c.valor)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="border border-gray-300 px-1 py-0.5 text-gray-500" colSpan={2}>Sem componentes detalhados</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="border border-gray-300 px-1 py-1">Valor Total do Servico</td>
            <td className="border border-gray-300 px-1 py-1 text-right">{moeda(dacte.vPrest.total)}</td>
          </tr>
          <tr>
            <td className="border border-gray-300 px-1 py-0.5">Valor a Receber</td>
            <td className="border border-gray-300 px-1 py-0.5 text-right">{moeda(dacte.vPrest.receber)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Calculo do Imposto</p>
      <div className="grid grid-cols-4 -mt-px">
        <Bloco titulo="Situacao Tributaria" center>{dacte.icms.situacao}</Bloco>
        <Bloco titulo="Base de Calculo" center>{moeda(dacte.icms.vBC)}</Bloco>
        <Bloco titulo="Aliquota" center>{dacte.icms.pICMS ? `${moeda(dacte.icms.pICMS)}%` : '-'}</Bloco>
        <Bloco titulo="Valor do ICMS" center>{moeda(dacte.icms.vICMS)}</Bloco>
      </div>

      <p className="mb-0.5 mt-2 text-[8px] uppercase text-gray-500">Informacoes da Carga</p>
      <div className="grid grid-cols-3 -mt-px">
        <Bloco titulo="Produto Predominante" center>{dacte.carga.produtoPredominante || '-'}</Bloco>
        <Bloco titulo="Valor Total da Carga" center>{moeda(dacte.carga.valorCarga)}</Bloco>
        <Bloco titulo="Peso Bruto (Kg)" center>{dacte.carga.pesoBrutoKg !== null ? dacte.carga.pesoBrutoKg.toLocaleString('pt-BR') : '-'}</Bloco>
      </div>

      {dacte.modal === 'Rodoviário' && (
        <div className="grid grid-cols-1 -mt-px">
          <Bloco titulo="RNTRC" center>{dacte.rntrc || '-'}</Bloco>
        </div>
      )}

      {dacte.nfeChaves.length > 0 && (
        <div className="mt-2">
          <p className="mb-0.5 text-[8px] uppercase text-gray-500">Documentos Originarios (NF-e)</p>
          <div className="border border-gray-400 p-2 text-[10px] font-mono leading-tight">
            {dacte.nfeChaves.map((chave) => (
              <p key={chave} className="break-all">{chaveFmt(chave)}</p>
            ))}
          </div>
        </div>
      )}

      {dacte.obs && (
        <div className="mt-2">
          <p className="mb-0.5 text-[8px] uppercase text-gray-500">Observacoes</p>
          <div className="whitespace-pre-wrap border border-gray-400 p-2 text-[10px]">{dacte.obs}</div>
        </div>
      )}
    </div>
  );
}
