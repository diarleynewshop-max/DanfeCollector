import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { obterUsuarioAtual } from '@/lib/usuarios/auth';
import { parsearSpedFiscal, limparCnpjSped, periodoSped, dataSpedParaDate } from '@/lib/sped/parser';
import { executarConfronto, type DadosDanfeCollector } from '@/lib/sped/confronto/motor';
import type { NotaDanfeCompleta } from '@/lib/sped/confronto/documentos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Limite de tamanho configurado no Next.js para processar arquivos SPED maiores
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const usuario = await obterUsuarioAtual();
    if (!usuario) {
      return NextResponse.json({ success: false, message: 'Não autorizado.' }, { status: 401 });
    }

    let conteudoSped = '';
    let nomeArquivo = 'sped_fiscal.txt';
    let cnpjIdEscolhido: number | null = null;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      const cnpjIdParam = formData.get('cnpjId');

      if (!file) {
        return NextResponse.json(
          { success: false, message: 'Nenhum arquivo SPED (.txt) enviado.' },
          { status: 400 }
        );
      }

      nomeArquivo = file.name || 'sped_fiscal.txt';
      if (cnpjIdParam && cnpjIdParam !== 'auto' && cnpjIdParam !== '') {
        const parsed = Number(cnpjIdParam);
        if (Number.isFinite(parsed) && parsed > 0) {
          cnpjIdEscolhido = parsed;
        }
      }

      // Lê o buffer do arquivo (tratando codificação UTF-8 ou ISO-8859-1 comum em ERPs brasileiros)
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Tenta decodificar como UTF-8; se contiver sequências corrompidas de caracteres acentuados, converte de Latin1
      try {
        const utf8Text = buffer.toString('utf-8');
        // Se contiver replacement characters (), o arquivo provavelmente é Latin1 / Windows-1252
        if (utf8Text.includes('\ufffd')) {
          conteudoSped = buffer.toString('latin1');
        } else {
          conteudoSped = utf8Text;
        }
      } catch {
        conteudoSped = buffer.toString('latin1');
      }
    } else {
      const body = await req.json();
      conteudoSped = body.conteudo || '';
      nomeArquivo = body.nomeArquivo || 'sped_fiscal.txt';
      if (body.cnpjId && Number(body.cnpjId) > 0) {
        cnpjIdEscolhido = Number(body.cnpjId);
      }
    }

    if (!conteudoSped || conteudoSped.trim().length === 0) {
      return NextResponse.json(
        { success: false, message: 'Arquivo SPED está vazio.' },
        { status: 400 }
      );
    }

    // 1. Parser do SPED Fiscal
    let spedParsed;
    try {
      spedParsed = parsearSpedFiscal(conteudoSped);
    } catch (parseError: any) {
      return NextResponse.json(
        {
          success: false,
          message: `Falha ao interpretar o arquivo SPED: ${parseError.message || String(parseError)}`,
        },
        { status: 400 }
      );
    }

    const { abertura } = spedParsed;
    const cnpjSpedLimpo = limparCnpjSped(abertura.cnpj);
    const periodo = periodoSped(abertura);
    const dtInicio = dataSpedParaDate(abertura.dataInicial);
    const dtFim = dataSpedParaDate(abertura.dataFinal);

    // 2. Identificação da Empresa no Banco de Dados
    let empresaDb: { id: number; cnpj: string; razaoSocial: string | null; uf: string } | null = null;
    let todasEmpresas: Array<{ id: number; cnpj: string; razaoSocial: string | null }> = [];

    try {
      todasEmpresas = await prisma.cnpj.findMany({
        where: { ativo: true },
        select: { id: true, cnpj: true, razaoSocial: true },
      });

      if (cnpjIdEscolhido) {
        empresaDb = await prisma.cnpj.findUnique({
          where: { id: cnpjIdEscolhido },
          select: { id: true, cnpj: true, razaoSocial: true, uf: true },
        });
      } else if (cnpjSpedLimpo) {
        empresaDb = await prisma.cnpj.findFirst({
          where: { cnpj: cnpjSpedLimpo },
          select: { id: true, cnpj: true, razaoSocial: true, uf: true },
        });

        // Caso a formatação do banco tenha pontuação
        if (!empresaDb) {
          empresaDb = await prisma.cnpj.findFirst({
            where: {
              cnpj: {
                contains: cnpjSpedLimpo.slice(0, 8), // raiz do CNPJ
              },
            },
            select: { id: true, cnpj: true, razaoSocial: true, uf: true },
          });
        }
      }
    } catch (dbError) {
      console.warn('[SPED Confronto] Banco de dados não acessível no momento:', dbError);
    }

    // 3. Buscar Notas Fiscais do DanfeCollector no Período
    const notasMap = new Map<string, NotaDanfeCompleta>();
    const xmlsPorChave = new Map<string, string>();

    if (dtInicio && dtFim) {
      try {
        // Período no fuso do Ceará (UTC-3): 00:00 do 1º dia até 23:59:59.999 do último
        const inicioUtc = new Date(Date.UTC(dtInicio.getFullYear(), dtInicio.getMonth(), dtInicio.getDate(), 3, 0, 0, 0));
        const fimUtc = new Date(Date.UTC(dtFim.getFullYear(), dtFim.getMonth(), dtFim.getDate() + 1, 2, 59, 59, 999));

        const periodoWhere: any = { emitidaEm: { gte: inicioUtc, lte: fimUtc } };
        if (empresaDb) {
          periodoWhere.cnpjId = empresaDb.id;
        } else if (cnpjSpedLimpo) {
          periodoWhere.OR = [
            { destCnpj: cnpjSpedLimpo },
            { emitenteCnpj: cnpjSpedLimpo },
          ];
        }

        // O SPED escritura compras pela data de ENTRADA: uma nota emitida em abril pode
        // estar no SPED de agosto. Por isso as notas do SPED são buscadas também pela chave.
        const chavesSped = Array.from(new Set(
          spedParsed.notasFiscais
            .map((c) => (c.chaveNfe ?? '').replace(/\D/g, ''))
            .filter((c) => c.length === 44)
        ));

        const selectNota = {
          chave: true,
          numero: true,
          serie: true,
          emitidaEm: true,
          tipoOperacao: true,
          naturezaOp: true,
          emitenteNome: true,
          emitenteCnpj: true,
          emitenteIe: true,
          emitenteUf: true,
          destNome: true,
          destCnpj: true,
          valorTotal: true,
          valorProdutos: true,
          valorFrete: true,
          valorDesconto: true,
          valorIcms: true,
          status: true,
          situacaoSefaz: true,
          xmlPath: true,
        } as const;

        const [notasPeriodo, notasPorChave] = await Promise.all([
          prisma.notaFiscal.findMany({ where: periodoWhere, select: selectNota }),
          chavesSped.length > 0
            ? prisma.notaFiscal.findMany({ where: { chave: { in: chavesSped } }, select: selectNota })
            : Promise.resolve([]),
        ]);

        const chavesDoPeriodo = new Set(notasPeriodo.map((n) => n.chave));
        const chavesSpedSet = new Set(chavesSped);
        const notas = [...notasPeriodo, ...notasPorChave.filter((n) => !chavesDoPeriodo.has(n.chave))];

        for (const nf of notas) {
          notasMap.set(nf.chave, {
            emitidaNoPeriodo: chavesDoPeriodo.has(nf.chave),
            chave: nf.chave,
            numero: nf.numero,
            serie: nf.serie,
            emitidaEm: nf.emitidaEm,
            tipoOperacao: nf.tipoOperacao,
            naturezaOp: nf.naturezaOp,
            emitenteNome: nf.emitenteNome,
            emitenteCnpj: nf.emitenteCnpj,
            emitenteIe: nf.emitenteIe,
            emitenteUf: nf.emitenteUf,
            destNome: nf.destNome,
            destCnpj: nf.destCnpj,
            valorTotal: nf.valorTotal,
            valorProdutos: nf.valorProdutos,
            valorFrete: nf.valorFrete,
            valorDesconto: nf.valorDesconto,
            valorIcms: nf.valorIcms,
            status: nf.status,
            situacaoSefaz: nf.situacaoSefaz,
          });

          // XML só é necessário para conferir os itens das notas que estão no SPED
          if (chavesSpedSet.has(nf.chave) && nf.xmlPath && fs.existsSync(nf.xmlPath)) {
            try {
              const xmlContent = await fs.promises.readFile(nf.xmlPath, 'utf-8');
              xmlsPorChave.set(nf.chave, xmlContent);
            } catch (err) {
              // ignora erro de leitura de xml individual
            }
          }
        }
      } catch (queryError) {
        console.warn('[SPED Confronto] Erro ao consultar notas no banco:', queryError);
      }
    }

    // 4. Execução do Confronto com todas as regras fiscais
    const dadosDanfe: DadosDanfeCollector = {
      notas: notasMap,
      xmlsPorChave,
      ufEmpresa: abertura.uf || empresaDb?.uf || 'CE',
    };

    const resultado = executarConfronto(spedParsed, dadosDanfe);

    // 5. Persistência opcional no banco (se empresaDb estiver disponível)
    let importacaoId: number | null = null;
    const divergenciaIds: Array<number | null> = resultado.divergencias.map(() => null);
    if (empresaDb) {
      try {
        const finalidadeStr = abertura.codigoFinalidade === '1' ? 'RETIFICADORA' : 'ORIGINAL';

        // Upsert da importação
        const importacao = await prisma.spedFiscalImportacao.upsert({
          where: {
            cnpjId_periodo_finalidade: {
              cnpjId: empresaDb.id,
              periodo,
              finalidade: finalidadeStr,
            },
          },
          create: {
            cnpjId: empresaDb.id,
            periodo,
            dtInicio: dtInicio || new Date(),
            dtFim: dtFim || new Date(),
            finalidade: finalidadeStr,
            versaoLayout: abertura.codigoVersao,
            arquivoNome: nomeArquivo,
            status: 'CONFRONTADO',
            totalRegistros: spedParsed.estatisticas.totalLinhas,
            totalC100: spedParsed.estatisticas.totalC100,
            totalC170: spedParsed.estatisticas.totalC170,
            totalParticipantes: spedParsed.estatisticas.total0150,
            totalProdutos: spedParsed.estatisticas.total0200,
            resumoDivergencias: JSON.stringify(resultado.resumo),
            confrontadoEm: new Date(),
          },
          update: {
            versaoLayout: abertura.codigoVersao,
            arquivoNome: nomeArquivo,
            status: 'CONFRONTADO',
            totalRegistros: spedParsed.estatisticas.totalLinhas,
            totalC100: spedParsed.estatisticas.totalC100,
            totalC170: spedParsed.estatisticas.totalC170,
            totalParticipantes: spedParsed.estatisticas.total0150,
            totalProdutos: spedParsed.estatisticas.total0200,
            resumoDivergencias: JSON.stringify(resultado.resumo),
            confrontadoEm: new Date(),
          },
        });

        importacaoId = importacao.id;

        // Limpa divergências antigas dessa importação e insere as novas em lote
        await prisma.spedDivergencia.deleteMany({
          where: { importacaoId: importacao.id },
        });

        if (resultado.divergencias.length > 0) {
          // Lote de até 500; os IDs voltam para a tela poder marcar "resolvida" no banco
          const batchSize = 500;
          for (let i = 0; i < resultado.divergencias.length; i += batchSize) {
            const fatia = resultado.divergencias.slice(i, i + batchSize);
            const batch = fatia.map((d) => ({
              importacaoId: importacao.id,
              tipo: d.tipo,
              severidade: d.severidade,
              codigoRegra: d.codigoRegra,
              chaveNfe: d.chaveNfe || null,
              registroSped: d.registroSped || null,
              linhaSped: d.linhaSped || null,
              campo: d.campo || null,
              valorSped: d.valorSped || null,
              valorDanfe: d.valorDanfe || null,
              descricao: d.descricao,
              participanteCod: d.participanteCod || null,
              produtoCod: d.produtoCod || null,
              fornecedorNome: d.fornecedorNome || null,
              fornecedorCnpj: d.fornecedorCnpj || null,
            }));

            const criadas = await prisma.spedDivergencia.createManyAndReturn({
              data: batch,
              select: { id: true, codigoRegra: true, linhaSped: true, campo: true },
            });
            criadas.forEach((c, idx) => {
              const d = fatia[idx];
              if (d && d.codigoRegra === c.codigoRegra && (d.linhaSped || null) === c.linhaSped && (d.campo || null) === c.campo) {
                divergenciaIds[i + idx] = c.id;
              }
            });
          }
        }
      } catch (persistError) {
        console.warn('[SPED Confronto] Não foi possível persistir no banco:', persistError);
      }
    }

    return NextResponse.json({
      success: true,
      importacaoId,
      empresaDetectada: {
        cnpj: cnpjSpedLimpo,
        razaoSocial: abertura.nome,
        uf: abertura.uf,
        ie: abertura.ie,
        periodo,
        dtInicio: abertura.dataInicial,
        dtFim: abertura.dataFinal,
        layoutVersao: abertura.codigoVersao,
        finalidade: abertura.codigoFinalidade === '1' ? 'Retificadora' : 'Original',
        perfil: abertura.indicadorPerfil,
        atividade: abertura.indicadorAtividade,
      },
      empresaVinculada: empresaDb,
      todasEmpresas,
      resultado: {
        ...resultado,
        divergencias: resultado.divergencias.map((d, idx) => ({ ...d, id: divergenciaIds[idx] })),
      },
    });
  } catch (error: any) {
    console.error('[SPED Confronto] Erro geral:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Erro ao processar confronto SPED: ${error.message || String(error)}`,
      },
      { status: 500 }
    );
  }
}
