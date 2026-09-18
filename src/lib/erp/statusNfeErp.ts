import { prisma } from '../prisma';
import {
  consultarNotaFiscalCompraErp,
  empresaErpCompraPorCnpj,
  etiquetaStatusErpCompra,
  extrairEtiquetaStatusErp,
  atualizarEtiquetaStatusErpCompra,
} from '../varejoFacilNotaCompra';
import {
  verificarRateLimitErp,
  executarComSemaforoErp,
  obterCacheStatusErp,
  salvarCacheStatusErp,
  extrairIdentificadorCliente,
} from './rateLimiterErp';
import { type ApiKeyResumo } from '../apiKeys';

export interface ParametrosConsultaStatusErp {
  chave: string;
  empresa?: string | null;
  forcar?: boolean;
  req: Request;
  apiKey?: ApiKeyResumo | null;
}

export interface RespostaStatusErpApi {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export async function consultarStatusNotaErpApi({
  chave,
  empresa: empresaParam,
  forcar = false,
  req,
  apiKey,
}: ParametrosConsultaStatusErp): Promise<RespostaStatusErpApi> {
  const chaveLimpa = String(chave ?? '').replace(/\D/g, '');

  if (chaveLimpa.length !== 44) {
    return {
      status: 400,
      headers: {},
      body: {
        success: false,
        codigo: 'CHAVE_INVALIDA',
        message: 'Chave de acesso invalida. A chave da NF-e deve conter exatamente 44 digitos numericos.',
      },
    };
  }

  // 1. Verificação de Rate Limit do cliente
  const clienteId = extrairIdentificadorCliente(req, apiKey?.prefixo);
  const rateLimit = verificarRateLimitErp(clienteId);

  const headersRateLimit: Record<string, string> = {
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
    'X-RateLimit-Reset': String(rateLimit.resetInSeconds),
  };

  if (!rateLimit.allowed) {
    headersRateLimit['Retry-After'] = String(rateLimit.retryAfterSeconds);
    return {
      status: 429,
      headers: headersRateLimit,
      body: {
        success: false,
        codigo: 'RATE_LIMIT_EXCEDIDO',
        message: `Limite de consultas ao ERP atingido (${rateLimit.limit} req/min). Aguarde ${rateLimit.retryAfterSeconds} segundos antes de tentar novamente.`,
        retryAfter: rateLimit.retryAfterSeconds,
      },
    };
  }

  // 2. Verificação de cache anti-flood recente (15 segundos para a mesma chave)
  if (!forcar) {
    const cached = obterCacheStatusErp<Record<string, unknown>>(chaveLimpa);
    if (cached) {
      return {
        status: 200,
        headers: headersRateLimit,
        body: {
          ...cached,
          cache: true,
        },
      };
    }
  }

  // 3. Buscar a nota no DanfeCollector para contexto (empresa, status anterior, etiqueta)
  const nota = await prisma.notaFiscal.findUnique({
    where: { chave: chaveLimpa },
    include: {
      cnpj: {
        select: {
          cnpj: true,
          razaoSocial: true,
        },
      },
    },
  });

  // Determinar empresa do ERP
  let empresaErp: 'NEWSHOP' | 'FACIL' | 'SOYE' | 'SEFULY' = 'NEWSHOP';
  if (empresaParam?.trim()) {
    const texto = empresaParam.trim().toUpperCase();
    if (texto.includes('SEFULY')) empresaErp = 'SEFULY';
    else if (texto.includes('SOYE')) empresaErp = 'SOYE';
    else if (texto.includes('FACIL')) empresaErp = 'FACIL';
    else empresaErp = 'NEWSHOP';
  } else if (nota?.cnpj?.cnpj) {
    empresaErp = empresaErpCompraPorCnpj(nota.cnpj.cnpj, nota.cnpj.razaoSocial);
  } else if (nota?.destCnpj) {
    empresaErp = empresaErpCompraPorCnpj(nota.destCnpj);
  }

  const statusAnterior = extrairEtiquetaStatusErp(nota?.etiqueta);

  // 4. Executar a consulta no ERP protegida por semáforo de concorrência
  let resultadoErp;
  try {
    resultadoErp = await executarComSemaforoErp(() =>
      consultarNotaFiscalCompraErp(chaveLimpa, empresaErp)
    );
  } catch (error: unknown) {
    const mensagemErro = (error as Error)?.message || 'Falha ao consultar ERP.';
    const isTimeoutOuFila = mensagemErro.includes('Tempo limite') || mensagemErro.includes('Muitas consultas');
    return {
      status: isTimeoutOuFila ? 503 : 502,
      headers: headersRateLimit,
      body: {
        success: false,
        codigo: 'ERRO_ERP',
        message: `Erro na integracao com o ERP: ${mensagemErro}`,
      },
    };
  }

  // 5. Tratar caso a nota não tenha sido encontrada no ERP
  if (!resultadoErp.found) {
    const respostaNaoEncontrada = {
      success: true,
      chave: chaveLimpa,
      encontradaNoErp: false,
      mudouStatus: false,
      statusAnterior,
      statusAtual: statusAnterior,
      situacaoErp: null,
      etiqueta: nota?.etiqueta ?? null,
      empresaErp,
      message: 'Nota fiscal nao encontrada no ERP (modulo de compras).',
      dadosErp: null,
      notaDanfe: nota
        ? {
            id: nota.id,
            numero: nota.numero,
            serie: nota.serie,
            status: nota.status,
            situacaoSefaz: nota.situacaoSefaz,
            emitidaEm: nota.emitidaEm,
            emitente: {
              nome: nota.emitenteNome,
              cnpj: nota.emitenteCnpj,
              uf: nota.emitenteUf,
            },
            destinatario: {
              nome: nota.destNome,
              cnpj: nota.destCnpj,
            },
            valorTotal: nota.valorTotal,
          }
        : null,
      consultadoEm: new Date().toISOString(),
    };

    salvarCacheStatusErp(chaveLimpa, respostaNaoEncontrada);

    return {
      status: 200,
      headers: headersRateLimit,
      body: respostaNaoEncontrada,
    };
  }

  // 6. Nota encontrada no ERP -> Analisar se mudou de status e atualizar DanfeCollector
  const dadosNotaErp = resultadoErp.nota;
  const situacaoErp = dadosNotaErp.situacao;
  const etiquetaErp = etiquetaStatusErpCompra(situacaoErp);
  const statusAtual = etiquetaErp || situacaoErp;
  const mudouStatus = statusAnterior !== etiquetaErp;

  let etiquetaFinal = nota?.etiqueta ?? null;

  if (nota && etiquetaErp) {
    const proximaEtiqueta = atualizarEtiquetaStatusErpCompra(nota.etiqueta, etiquetaErp);
    if (proximaEtiqueta !== (nota.etiqueta ?? '')) {
      await prisma.notaFiscal.update({
        where: { id: nota.id },
        data: { etiqueta: proximaEtiqueta },
      });
      etiquetaFinal = proximaEtiqueta;
    }
  }

  const respostaCompleta = {
    success: true,
    chave: chaveLimpa,
    encontradaNoErp: true,
    mudouStatus,
    statusAnterior,
    statusAtual,
    situacaoErp,
    etiqueta: etiquetaFinal,
    empresaErp,
    message: mudouStatus
      ? `Status atualizado no DanfeCollector: "${statusAnterior || 'Sem status'}" -> "${statusAtual}".`
      : `Status mantido: "${statusAtual}".`,
    dadosErp: {
      codigo: dadosNotaErp.codigo,
      numero: dadosNotaErp.numero,
      serie: dadosNotaErp.serie,
      situacao: dadosNotaErp.situacao,
      fornecedor: dadosNotaErp.fornecedor,
      valor: dadosNotaErp.valor,
      tipoOperacao: dadosNotaErp.tipoOperacao,
      dataEmissao: dadosNotaErp.dataEmissao,
    },
    notaDanfe: nota
      ? {
          id: nota.id,
          numero: nota.numero,
          serie: nota.serie,
          status: nota.status,
          situacaoSefaz: nota.situacaoSefaz,
          emitidaEm: nota.emitidaEm,
          emitente: {
            nome: nota.emitenteNome,
            cnpj: nota.emitenteCnpj,
            uf: nota.emitenteUf,
          },
          destinatario: {
            nome: nota.destNome,
            cnpj: nota.destCnpj,
          },
          valorTotal: nota.valorTotal,
        }
      : null,
    consultadoEm: new Date().toISOString(),
  };

  salvarCacheStatusErp(chaveLimpa, respostaCompleta);

  return {
    status: 200,
    headers: headersRateLimit,
    body: respostaCompleta,
  };
}
