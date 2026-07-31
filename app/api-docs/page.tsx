export const dynamic = 'force-dynamic';

const exemploJson = `{
  "success": true,
  "data": {
    "chave": "23260700000000000000550010000000011000000010",
    "numero": "1",
    "status": "COMPLETA",
    "emitente": {
      "nome": "FORNECEDOR LTDA",
      "cnpj": "00000000000000",
      "ie": "000000000",
      "uf": "CE"
    },
    "valores": {
      "totalNota": 1500.9
    },
    "dae": {
      "status": "PAGO",
      "valorAberto": null
    },
    "links": {
      "consulta": "https://seu-dominio.com/api/v1/notas/CHAVE_NFE",
      "xml": "https://seu-dominio.com/api/v1/notas/CHAVE_NFE/xml",
      "danfe": "https://seu-dominio.com/danfe/CHAVE_NFE"
    }
  }
}`;

function BlocoCodigo({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[#1c1813] p-4 text-xs leading-relaxed text-white">
      <code>{children}</code>
    </pre>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <h2 className="text-base font-black text-[var(--ink)]">{titulo}</h2>
      <div className="mt-3 space-y-3 text-sm text-[var(--ink)]">{children}</div>
    </section>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-[var(--ground)] px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">DanfeCollector</p>
          <h1 className="mt-1 text-2xl font-black text-[var(--ink)]">Documentacao da API</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--ink-mut)]">
            Use esta API para consultar nota fiscal, status, XML, ICMS/SITRAM e DAE por chave de acesso.
          </p>
        </header>

        <Secao titulo="Autenticacao">
          <p>Envie a chave criada no painel de configuracao em um dos headers abaixo.</p>
          <BlocoCodigo>{`Authorization: Bearer SUA_CHAVE_API
x-api-key: SUA_CHAVE_API`}</BlocoCodigo>
        </Secao>

        <Secao titulo="Consultar nota em JSON">
          <p>Retorna dados principais da NF-e, emitente, destinatario, valores, status fiscal, DAE e links uteis.</p>
          <BlocoCodigo>{`GET /api/v1/notas/{chave}`}</BlocoCodigo>
          <p>Para incluir o XML dentro do JSON, use:</p>
          <BlocoCodigo>{`GET /api/v1/notas/{chave}?xml=1`}</BlocoCodigo>
        </Secao>

        <Secao titulo="Baixar XML direto">
          <p>Retorna o XML autorizado quando a nota estiver completa no DanfeCollector.</p>
          <BlocoCodigo>{`GET /api/v1/notas/{chave}/xml`}</BlocoCodigo>
        </Secao>

        <Secao titulo="Codigos HTTP">
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-2)] text-xs uppercase text-[var(--ink-mut)]">
                <tr>
                  <th className="px-3 py-2 font-bold">Codigo</th>
                  <th className="px-3 py-2 font-bold">Quando ocorre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                <tr><td className="px-3 py-2 font-mono font-bold">200</td><td className="px-3 py-2">Consulta encontrada.</td></tr>
                <tr><td className="px-3 py-2 font-mono font-bold">400</td><td className="px-3 py-2">Chave invalida. Informe 44 digitos.</td></tr>
                <tr><td className="px-3 py-2 font-mono font-bold">401</td><td className="px-3 py-2">Chave de API ausente ou invalida.</td></tr>
                <tr><td className="px-3 py-2 font-mono font-bold">404</td><td className="px-3 py-2">Nota ou XML nao encontrado.</td></tr>
                <tr><td className="px-3 py-2 font-mono font-bold">409</td><td className="px-3 py-2">XML completo ainda nao disponivel.</td></tr>
              </tbody>
            </table>
          </div>
        </Secao>

        <Secao titulo="Exemplo de resposta">
          <BlocoCodigo>{exemploJson}</BlocoCodigo>
        </Secao>
      </div>
    </main>
  );
}
