import { NextResponse } from 'next/server';
import { validarApiKey } from '@/lib/apiKeys';
import { HEXON_MAX_NOTAS_POR_LOTE, processarStatusHexon } from '@/lib/hexonStatusNf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 1024 * 1024;

function erro(status: number, codigo: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, codigo, message, ...extra }, { status });
}

export async function POST(req: Request) {
  const apiKey = await validarApiKey(req);
  if (!apiKey) return erro(401, 'NAO_AUTORIZADO', 'Nao autorizado.');

  const tamanho = Number(req.headers.get('content-length') ?? 0);
  if (tamanho > MAX_BYTES) return erro(413, 'PAYLOAD_GRANDE', 'Payload excede 1 MB.');

  let body: unknown;
  try {
    const texto = await req.text();
    if (texto.length > MAX_BYTES) return erro(413, 'PAYLOAD_GRANDE', 'Payload excede 1 MB.');
    body = JSON.parse(texto);
  } catch {
    return erro(400, 'JSON_INVALIDO', 'Corpo da requisicao deve ser JSON valido.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return erro(400, 'JSON_INVALIDO', 'Envie um objeto JSON (nota unica) ou { "notas": [...] } (lote).');
  }

  const lote = 'notas' in body;
  const itens = lote ? (body as { notas: unknown }).notas : [body];

  if (!Array.isArray(itens) || itens.length === 0) {
    return erro(400, 'LOTE_VAZIO', 'O campo notas deve ser uma lista com pelo menos 1 item.');
  }
  if (itens.length > HEXON_MAX_NOTAS_POR_LOTE) {
    return erro(413, 'LOTE_GRANDE', `Maximo de ${HEXON_MAX_NOTAS_POR_LOTE} notas por requisicao.`);
  }

  let resultados;
  try {
    resultados = await processarStatusHexon(itens);
  } catch {
    return erro(500, 'ERRO_INTERNO', 'Erro interno ao gravar status. Reenvie a requisicao.');
  }

  if (!lote) {
    const r = resultados[0];
    const httpStatus = r.resultado === 'INVALIDO' ? 400 : r.resultado === 'NOTA_NAO_ENCONTRADA' ? 404 : 200;
    return NextResponse.json(
      {
        success: r.ok,
        codigo: r.resultado,
        chave: r.chave,
        status: r.status,
        message: r.message,
        ...(r.erros ? { erros: r.erros } : {}),
      },
      { status: httpStatus }
    );
  }

  const contar = (resultado: string) => resultados.filter((r) => r.resultado === resultado).length;
  return NextResponse.json(
    {
      success: resultados.every((r) => r.ok),
      resumo: {
        recebidas: resultados.length,
        atualizadas: contar('ATUALIZADO'),
        semAlteracao: contar('SEM_ALTERACAO'),
        ignoradasDesatualizadas: contar('IGNORADO_DESATUALIZADO'),
        naoEncontradas: contar('NOTA_NAO_ENCONTRADA'),
        invalidas: contar('INVALIDO'),
      },
      resultados,
    },
    { status: 200 }
  );
}
