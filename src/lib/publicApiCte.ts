import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { lerXmlComFallback } from './xmlpath';
import { parseDacte } from './sefaz/dacteDetalhe';

type Resultado<T> = { status: number; body: T };

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;
const STATUS_VALIDOS = ['RESUMO', 'COMPLETO'];
const SITUACOES_VALIDAS = ['AUTORIZADO', 'CANCELADO', 'DENEGADO'];

function urlAbsoluta(req: Request, caminho: string): string {
  return new URL(caminho, req.url).toString();
}

function erro(status: number, message: string) {
  return { status, body: { success: false as const, message } };
}

function normalizarChave(chaveInformada: string): string | null {
  const chave = chaveInformada.replace(/\D/g, '');
  return chave.length === 44 ? chave : null;
}

// Retorna undefined (nao informado), null (invalido) ou o CNPJ com 14 digitos.
function lerCnpj(params: URLSearchParams, nome: string): string | null | undefined {
  const bruto = params.get(nome)?.trim();
  if (!bruto) return undefined;
  const cnpj = bruto.replace(/\D/g, '');
  return cnpj.length === 14 ? cnpj : null;
}

function lerData(valor: string | null, fimDoDia: boolean): Date | null | undefined {
  if (!valor) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const data = new Date(`${valor}T${fimDoDia ? '23:59:59.999' : '00:00:00.000'}-03:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

function lerInteiro(valor: string | null, padrao: number): number | null {
  if (!valor) return padrao;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

function xmlDisponivel(cte: { status: string; xmlStorageKey: string | null; xmlPath: string | null }): boolean {
  return cte.status === 'COMPLETO' && (!!cte.xmlStorageKey || !!cte.xmlPath);
}

function links(req: Request, chave: string, completo: boolean) {
  return {
    consulta: urlAbsoluta(req, `/api/v1/ctes/${chave}`),
    xml: completo ? urlAbsoluta(req, `/api/v1/ctes/${chave}/xml`) : null,
    dacte: completo ? urlAbsoluta(req, `/api/v1/ctes/${chave}/dacte`) : null,
    dacteImpressao: completo ? urlAbsoluta(req, `/dacte/${chave}`) : null,
  };
}

const includeCte = {
  cnpj: { select: { cnpj: true, razaoSocial: true } },
  notasVinculadas: { select: { chaveNfe: true } },
} satisfies Prisma.ConhecimentoTransporteInclude;

type CteComRelacoes = Prisma.ConhecimentoTransporteGetPayload<{ include: typeof includeCte }>;

async function carregarNotas(ctes: CteComRelacoes[]) {
  const chaves = [...new Set(ctes.flatMap((cte) => cte.notasVinculadas.map((v) => v.chaveNfe)))];
  if (chaves.length === 0) return new Map();
  const notas = await prisma.notaFiscal.findMany({
    where: { chave: { in: chaves } },
    select: { chave: true, numero: true, serie: true, emitenteNome: true, emitenteCnpj: true, situacaoSefaz: true, valorTotal: true },
  });
  return new Map(notas.map((nota) => [nota.chave, nota]));
}

function montarCte(req: Request, cte: CteComRelacoes, notasPorChave: Awaited<ReturnType<typeof carregarNotas>>) {
  const completo = xmlDisponivel(cte);
  return {
    chave: cte.chave,
    numero: cte.numero,
    serie: cte.serie,
    status: cte.status,
    situacaoSefaz: cte.situacaoSefaz,
    emitidaEm: cte.emitidaEm,
    entradaEm: cte.createdAt,
    naturezaOp: cte.naturezaOp,
    cfop: cte.cfop,
    empresa: cte.cnpj,
    emitente: { nome: cte.emitenteNome, cnpj: cte.emitenteCnpj, ie: cte.emitenteIe, uf: cte.emitenteUf },
    tomador: { nome: cte.tomadorNome, cnpj: cte.tomadorCnpj },
    remetente: { nome: cte.remetenteNome, cnpj: cte.remetenteCnpj },
    destinatario: { nome: cte.destinatarioNome, cnpj: cte.destinatarioCnpj },
    valores: { total: cte.valorTotal, prestacao: cte.valorPrestacao, carga: cte.valorCarga },
    notasVinculadas: cte.notasVinculadas.map((vinculo) => {
      const nota = notasPorChave.get(vinculo.chaveNfe);
      return {
        chave: vinculo.chaveNfe,
        numero: nota?.numero ?? null,
        serie: nota?.serie ?? null,
        emitenteNome: nota?.emitenteNome ?? null,
        emitenteCnpj: nota?.emitenteCnpj ?? null,
        situacaoSefaz: nota?.situacaoSefaz ?? null,
        valorTotal: nota?.valorTotal ?? null,
        encontrada: Boolean(nota),
      };
    }),
    xmlDisponivel: completo,
    links: links(req, cte.chave, completo),
  };
}

export async function listarCtesApi(req: Request) {
  const params = new URL(req.url).searchParams;
  const filtros: Prisma.ConhecimentoTransporteWhereInput[] = [];

  const cnpj = lerCnpj(params, 'cnpj');
  if (cnpj === null) return erro(400, 'Parametro cnpj invalido. Informe 14 digitos.');
  if (cnpj) {
    const empresa = await prisma.cnpj.findUnique({ where: { cnpj }, select: { id: true } });
    if (!empresa) return erro(404, 'CNPJ nao cadastrado no Proton-e.');
    filtros.push({ cnpjId: empresa.id });
  }

  const partes = [
    ['emitenteCnpj', 'emitenteCnpj'],
    ['tomadorCnpj', 'tomadorCnpj'],
    ['remetenteCnpj', 'remetenteCnpj'],
    ['destinatarioCnpj', 'destinatarioCnpj'],
  ] as const;
  for (const [parametro, campo] of partes) {
    const valor = lerCnpj(params, parametro);
    if (valor === null) return erro(400, `Parametro ${parametro} invalido. Informe 14 digitos.`);
    if (valor) filtros.push({ [campo]: valor });
  }

  const inicio = lerData(params.get('inicio'), false);
  const fim = lerData(params.get('fim'), true);
  if (inicio === null) return erro(400, 'Data inicial invalida. Use AAAA-MM-DD.');
  if (fim === null) return erro(400, 'Data final invalida. Use AAAA-MM-DD.');
  if (inicio || fim) filtros.push({ emitidaEm: { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) } });

  const status = params.get('status')?.trim().toUpperCase();
  if (status) {
    if (!STATUS_VALIDOS.includes(status)) return erro(400, 'Status invalido. Use RESUMO ou COMPLETO.');
    filtros.push({ status });
  }

  const situacao = params.get('situacao')?.trim().toUpperCase();
  if (situacao) {
    if (!SITUACOES_VALIDAS.includes(situacao)) return erro(400, 'Situacao invalida. Use AUTORIZADO, CANCELADO ou DENEGADO.');
    filtros.push({ situacaoSefaz: situacao });
  }

  const nfeInformada = params.get('nfe');
  if (nfeInformada) {
    const nfe = normalizarChave(nfeInformada);
    if (!nfe) return erro(400, 'Chave da NF-e invalida. Informe 44 digitos.');
    filtros.push({ notasVinculadas: { some: { chaveNfe: nfe } } });
  }

  const pagina = lerInteiro(params.get('pagina'), 1);
  const limite = lerInteiro(params.get('limite'), LIMITE_PADRAO);
  if (pagina === null) return erro(400, 'Parametro pagina invalido.');
  if (limite === null || limite > LIMITE_MAXIMO) return erro(400, `Parametro limite invalido. Maximo ${LIMITE_MAXIMO}.`);

  const where: Prisma.ConhecimentoTransporteWhereInput = { AND: filtros };
  const [total, ctes] = await Promise.all([
    prisma.conhecimentoTransporte.count({ where }),
    prisma.conhecimentoTransporte.findMany({
      where,
      orderBy: [{ emitidaEm: 'desc' }, { id: 'desc' }],
      skip: (pagina - 1) * limite,
      take: limite,
      include: includeCte,
    }),
  ]);
  const notasPorChave = await carregarNotas(ctes);

  return {
    status: 200,
    body: {
      success: true,
      paginacao: { pagina, limite, total, totalPaginas: Math.ceil(total / limite) },
      data: ctes.map((cte) => montarCte(req, cte, notasPorChave)),
    },
  };
}

export async function consultarCteApi(chaveInformada: string, req: Request, incluirXml = false) {
  const chave = normalizarChave(chaveInformada);
  if (!chave) return erro(400, 'Chave de acesso invalida. Informe 44 digitos.');

  const cte = await prisma.conhecimentoTransporte.findUnique({ where: { chave }, include: includeCte });
  if (!cte) return erro(404, 'CT-e nao encontrado.');

  const notasPorChave = await carregarNotas([cte]);
  const xml = incluirXml && xmlDisponivel(cte) ? await lerXmlComFallback(cte.xmlStorageKey, cte.xmlPath) : null;

  return {
    status: 200,
    body: {
      success: true,
      data: { ...montarCte(req, cte, notasPorChave), xml: incluirXml ? xml : undefined },
    },
  };
}

async function lerXmlCte(chaveInformada: string): Promise<Resultado<string> & { xml?: string }> {
  const chave = normalizarChave(chaveInformada);
  if (!chave) return { status: 400, body: 'Chave de acesso invalida. Informe 44 digitos.' };

  const cte = await prisma.conhecimentoTransporte.findUnique({
    where: { chave },
    select: { status: true, xmlStorageKey: true, xmlPath: true },
  });
  if (!cte) return { status: 404, body: 'CT-e nao encontrado.' };
  if (cte.status !== 'COMPLETO') return { status: 409, body: 'XML completo ainda nao disponivel para este CT-e.' };

  const xml = await lerXmlComFallback(cte.xmlStorageKey, cte.xmlPath);
  if (!xml) return { status: 404, body: 'XML nao encontrado no storage.' };
  return { status: 200, body: xml, xml };
}

export async function consultarXmlCteApi(chaveInformada: string): Promise<Resultado<string>> {
  const { status, body } = await lerXmlCte(chaveInformada);
  return { status, body };
}

export async function consultarDacteApi(chaveInformada: string, req: Request) {
  const resultado = await lerXmlCte(chaveInformada);
  if (!resultado.xml) return erro(resultado.status, resultado.body);

  const dacte = parseDacte(resultado.xml);
  if (!dacte) return erro(422, 'Nao foi possivel interpretar o XML do CT-e.');

  return {
    status: 200,
    body: {
      success: true,
      data: { ...dacte, links: links(req, dacte.chave || chaveInformada.replace(/\D/g, ''), true) },
    },
  };
}
