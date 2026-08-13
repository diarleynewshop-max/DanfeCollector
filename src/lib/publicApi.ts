import { prisma } from './prisma';
import { lerXmlComFallback } from './xmlpath';
import { parseDanfe } from './sefaz/detalhe';
import {
  extrairPagamentoIcmsSitram,
  extrairResumoDae,
  lancamentosVisiveisDae,
  statusDaeEfetivo,
} from './sitram/dae';
import { consultarIeFornecedor, limparCnpjFornecedor } from './ieFornecedor';

function soma(valores: Array<number | null | undefined>): number {
  return valores.reduce<number>((total, valor) => total + (valor ?? 0), 0);
}

function urlAbsoluta(req: Request, caminho: string): string {
  return new URL(caminho, req.url).toString();
}

export async function consultarNotaFiscalApi(chaveInformada: string, req: Request, incluirXml = false) {
  const chave = chaveInformada.replace(/\D/g, '');
  if (chave.length !== 44) {
    return { status: 400, body: { success: false, message: 'Chave de acesso invalida. Informe 44 digitos.' } };
  }

  const nota = await prisma.notaFiscal.findUnique({
    where: { chave },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });

  if (!nota) {
    return { status: 404, body: { success: false, message: 'Nota fiscal nao encontrada.' } };
  }

  const resumoDae = extrairResumoDae(nota);
  const lancamentos = lancamentosVisiveisDae(resumoDae.lancamentos);
  const pagamentoIcms = extrairPagamentoIcmsSitram(nota);
  const statusDae = statusDaeEfetivo(nota);
  const daeValorTotal = soma(lancamentos.map((lancamento) => lancamento.valor));
  const daeValorPago = nota.pagamentoManualEm
    ? (nota.pagamentoManualValor ?? daeValorTotal)
    : soma(lancamentos.map((lancamento) => lancamento.valorPago));
  const daeValorAberto = soma(lancamentos.map((lancamento) => lancamento.valorAberto));
  const xml = incluirXml ? await lerXmlComFallback(nota.xmlStorageKey, nota.xmlPath) : null;
  const danfe = xml ? parseDanfe(xml) : null;

  return {
    status: 200,
    body: {
      success: true,
      data: {
        chave: nota.chave,
        numero: nota.numero,
        serie: nota.serie,
        status: nota.status,
        situacaoSefaz: nota.situacaoSefaz,
        emitidaEm: nota.emitidaEm,
        entradaEm: nota.createdAt,
        empresa: nota.cnpj,
        emitente: {
          nome: nota.emitenteNome,
          cnpj: nota.emitenteCnpj,
          ie: nota.emitenteIe,
          uf: nota.emitenteUf,
        },
        destinatario: {
          nome: nota.destNome,
          cnpj: nota.destCnpj,
        },
        valores: {
          totalNota: nota.valorTotal,
          produtos: nota.valorProdutos,
          frete: nota.valorFrete,
          desconto: nota.valorDesconto,
        },
        impostos: {
          icms: nota.valorIcms,
          totalTributosXml: danfe?.total.vTotTrib ?? null,
        },
        dae: {
          status: statusDae || null,
          classificacao: resumoDae.classificacao,
          situacaoImposto: resumoDae.situacaoImposto,
          consultadaEm: nota.sitramConsultadaEm,
          resumo: nota.sitramDaeResumo,
          url: nota.sitramDaeUrl,
          valorTotal: daeValorTotal || null,
          valorPago: daeValorPago || null,
          valorAberto: daeValorAberto || null,
          pagamentoManualEm: nota.pagamentoManualEm,
          pagamentoManualRef: nota.pagamentoManualRef,
          pagamentoIcmsConsultadoEm: pagamentoIcms.consultadoEm,
          lancamentos,
        },
        recebimento: {
          status: nota.recebimentoStatus,
          kanbanStatus: nota.recebimentoKanbanStatus,
          statusOperacional: nota.recebimentoStatusOperacional,
          statusOperacionalCodigo: nota.recebimentoStatusOperacionalCodigo,
          atualizadoEm: nota.recebimentoAtualizadoEm,
          atualizadoPor: nota.recebimentoAtualizadoPor,
          consultadoEm: nota.recebimentoConsultadoEm,
          erro: nota.recebimentoErro,
        },
        links: {
          consulta: urlAbsoluta(req, `/api/v1/notas/${nota.chave}`),
          xml: nota.status === 'COMPLETA' ? urlAbsoluta(req, `/api/v1/notas/${nota.chave}/xml`) : null,
          danfe: urlAbsoluta(req, `/danfe/${nota.chave}`),
        },
        xmlDisponivel: nota.status === 'COMPLETA' && (!!nota.xmlStorageKey || !!nota.xmlPath),
        xml: incluirXml ? xml : undefined,
      },
    },
  };
}

export async function consultarXmlNotaFiscalApi(chaveInformada: string) {
  const chave = chaveInformada.replace(/\D/g, '');
  if (chave.length !== 44) {
    return { status: 400, body: 'Chave de acesso invalida. Informe 44 digitos.' };
  }

  const nota = await prisma.notaFiscal.findUnique({
    where: { chave },
    select: { status: true, xmlStorageKey: true, xmlPath: true },
  });

  if (!nota) return { status: 404, body: 'Nota fiscal nao encontrada.' };
  if (nota.status !== 'COMPLETA') return { status: 409, body: 'XML completo ainda nao disponivel para esta nota.' };

  const xml = await lerXmlComFallback(nota.xmlStorageKey, nota.xmlPath);
  if (!xml) return { status: 404, body: 'XML nao encontrado no storage.' };

  return { status: 200, body: xml };
}

export async function consultarFornecedorIeApi(cnpjInformado: string, ufInformada?: string) {
  const cnpj = limparCnpjFornecedor(cnpjInformado);
  const uf = ufInformada?.trim().toUpperCase() || undefined;

  if (cnpj.length !== 14) {
    return { status: 400, body: { success: false, message: 'CNPJ invalido. Informe 14 digitos.' } };
  }

  try {
    const consulta = await consultarIeFornecedor(cnpj, uf);
    return {
      status: 200,
      body: {
        success: true,
        data: {
          cnpj: consulta.cnpj,
          razaoSocial: consulta.razaoSocial,
          nomeFantasia: consulta.nomeFantasia,
          situacaoCadastral: consulta.situacaoCadastral,
          uf: consulta.uf,
          cidade: consulta.cidade,
          cep: consulta.cep,
          endereco: consulta.endereco,
          cnaePrincipal: consulta.cnaePrincipal,
          dataInicioAtividade: consulta.dataInicioAtividade,
          atualizadoEm: consulta.atualizadoEm,
          ie: {
            status: consulta.statusIe,
            fonte: consulta.fonteIe,
            inscricoes: consulta.inscricoesEstaduais,
            consultaOficial: consulta.consultaOficial,
          },
          fontes: {
            dadosCnpj: consulta.fonteDadosCnpj,
            ie: consulta.fonteIe,
            resumo: consulta.fonte,
          },
          aviso: consulta.aviso,
        },
      },
    };
  } catch (error: unknown) {
    return {
      status: 400,
      body: { success: false, message: (error as Error).message || 'Erro ao consultar IE do fornecedor.' },
    };
  }
}
