'use server';

import { revalidatePath } from 'next/cache';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import {
  carregarCertificado,
  inspecionarCertificadoPfx,
  limparCacheCertificados,
} from './sefaz/certificado';
import { limparCachePemCertificado, obterPemDePfx } from './sefaz/assinatura';
import { consultarDistribuicaoDFe, consultarPorChave } from './sefaz/distribuicao';
import {
  processarDocumento,
  interpretarEventoCiencia,
  interpretarEventoCancelamento,
  extrairTransporteXml,
} from './sefaz/documentos';
import { parseDanfe, type DanfeData } from './sefaz/detalhe';
import { resolverXmlPath } from './xmlpath';
import { manifestar } from './sefaz/manifestacao';
import { listarCertificadosWindows, type CertificadoWindows } from './sefaz/certstore';
import { exigirAdmin, exigirUsuario, usuarioPodeAcessarCnpj, whereCnpjPermitido, whereNotaPermitida } from './usuarios/auth';
import {
  consultarManifestoCarga,
  type SitramLancamento,
  type SitramManifestoCarga,
  type SitramNotaFiscal,
} from './sitram/client';
import {
  consultarLancamentosNotaFiscalSitram,
  consultarNotaFiscalSitramPorChave,
  consultarTodosItensNotaFiscalSitram,
  type SitramPortalLancamento,
  type SitramPortalNotaFiscal,
} from './sitram/portal';
import {
  classificarStatusDaePortal,
  detectarSuspeitasPagamentoDuplicadoIcms,
  extrairResumoDae,
  lancamentosVisiveisDae,
  statusDaeEfetivo,
} from './sitram/dae';
import { parseRelacaoPagamentoSitram, chaveCruzamento, extrairDaChave } from './sitram/pagamento';
import {
  consultarDaePorCodigo,
  consultarDocumentosDaeBatch,
  simularDaeNotaFiscal,
  type SitramDocumentoPagamento,
} from './sitram/pagamento-icms-portal';
import { salvarArquivoComFallback, apagarArquivo, mimeAceito, TAMANHO_MAX } from './anexos/storage';

export interface ActionResult {
  success: boolean;
  message: string;
  data?: string;
}

export type NotaRelatorio = {
  id: number;
  cnpjId: number;
  chave: string;
  numero: string | null;
  serie: string | null;
  emitidaEm: Date;
  tipoOperacao: string | null;
  naturezaOp: string | null;
  emitenteUf: string | null;
  emitenteNome: string | null;
  emitenteCnpj: string | null;
  destNome: string | null;
  destCnpj: string | null;
  valorTotal: number | null;
  valorProdutos: number | null;
  valorFrete: number | null;
  valorDesconto: number | null;
  valorIcms: number | null;
  qtdItens: number | null;
  status: string;
  situacaoSefaz: string;
  manifestadaEm: Date | null;
  sitramConsultadaEm: Date | null;
  sitramDaeStatus: string | null;
  sitramDaeResumo: string | null;
  pagamentoManualEm: Date | null;
  pagamentoManualRef: string | null;
  pagamentoManualValor: number | null;
  daeVencimento: string | null;
  daeValor: number | null;
  daeValorAberto: number | null;
  daeValorPago: number | null;
  daeCodigo: string | null;
  daeDescricao: string | null;
  daeTipo: string | null;
  daeClassificacao: string | null;
  cnpj: { cnpj: string; razaoSocial: string | null };
};

export type PaginaNotasRelatorio = {
  notas: NotaRelatorio[];
  pagina: number;
  porPagina: number;
  total: number;
  temMais: boolean;
};

async function checarAdminAction(): Promise<ActionResult | null> {
  try {
    await exigirAdmin();
    return null;
  } catch (error: unknown) {
    return { success: false, message: (error as Error).message };
  }
}

async function checarUsuarioAction(): Promise<ActionResult | null> {
  try {
    await exigirUsuario();
    return null;
  } catch (error: unknown) {
    return { success: false, message: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Validação de CNPJ
// ---------------------------------------------------------------------------

function limparCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

function validarCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const calcularDigito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((acc, dig, i) => acc + Number(dig) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const dig1 = calcularDigito(cnpj.slice(0, 12), pesos1);
  const dig2 = calcularDigito(cnpj.slice(0, 12) + dig1, pesos2);

  return cnpj[12] === String(dig1) && cnpj[13] === String(dig2);
}

const UFS_VALIDAS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// ---------------------------------------------------------------------------
// Certificado digital
// ---------------------------------------------------------------------------

export async function verificarCertificado(): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  try {
    const { pfx, passphrase } = carregarCertificado();
    // createSecureContext valida o PFX e a senha sem precisar de conexão
    const { privateKeyPem, certificatePem } = obterPemDePfx(pfx, passphrase);
    tls.createSecureContext({ key: privateKeyPem, cert: certificatePem });
    return {
      success: true,
      message: 'Certificado A1 carregado e senha validada com sucesso.',
    };
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (/mac verify failure|invalid password|pkcs12/i.test(msg)) {
      return { success: false, message: 'Senha do certificado incorreta (CERT_PFX_PASSWORD).' };
    }
    return { success: false, message: `Erro no certificado: ${msg}` };
  }
}

function valorEnv(valor: string): string {
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(valor)) return valor;
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertEnv(arquivoEnv: string, chave: string, valor: string) {
  const linhas = fs.existsSync(arquivoEnv)
    ? fs.readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)
    : [];
  let atualizou = false;
  const novas = linhas.map((linha) => {
    if (linha.startsWith(`${chave}=`)) {
      atualizou = true;
      return `${chave}=${valorEnv(valor)}`;
    }
    return linha;
  });

  if (!atualizou) novas.push(`${chave}=${valorEnv(valor)}`);
  fs.writeFileSync(arquivoEnv, `${novas.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  fs.chmodSync(arquivoEnv, 0o600);
}

function nomeArquivoCertificado(escopo: string, alvo: string): string {
  return `cert-${escopo}-${alvo}.pfx`.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function dadosCertificadoParaCnpj(cnpj: string): {
  razaoSocial?: string | null;
  certSerial?: string | null;
  certVencimento?: Date;
} | null {
  try {
    const cert = carregarCertificado(cnpj);
    const info = inspecionarCertificadoPfx(cert.pfx, cert.passphrase);
    if (info.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) return null;

    return {
      razaoSocial: info.cnpj === cnpj ? info.razaoSocial : undefined,
      certSerial: info.serial,
      certVencimento: info.vencimento,
    };
  } catch {
    return null;
  }
}

export async function enviarCertificadoVps(formData: FormData): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  const arquivo = formData.get('certificado');
  const senha = String(formData.get('senha') ?? '');
  const escopo = String(formData.get('escopo') ?? 'raiz');
  const alvoInformado = limparCnpj(String(formData.get('alvo') ?? ''));

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { success: false, message: 'Selecione um arquivo .pfx.' };
  }
  if (!arquivo.name.toLowerCase().endsWith('.pfx')) {
    return { success: false, message: 'Envie o certificado A1 original em formato .pfx.' };
  }
  if (arquivo.size > 10 * 1024 * 1024) {
    return { success: false, message: 'Certificado maior que 10 MB. Verifique o arquivo enviado.' };
  }
  if (!senha) {
    return { success: false, message: 'Informe a senha do certificado.' };
  }
  if (!['raiz', 'cnpj', 'padrao'].includes(escopo)) {
    return { success: false, message: 'Escopo do certificado invalido.' };
  }

  try {
    const pfx = Buffer.from(await arquivo.arrayBuffer());
    const { privateKeyPem, certificatePem } = obterPemDePfx(pfx, senha);
    tls.createSecureContext({ key: privateKeyPem, cert: certificatePem });
    const info = inspecionarCertificadoPfx(pfx, senha);
    const raizCert = info.cnpj.slice(0, 8);

    let pathKey = 'CERT_PFX_PATH';
    let passKey = 'CERT_PFX_PASSWORD';
    let alvo = 'padrao';
    let whereCnpj: Parameters<typeof prisma.cnpj.updateMany>[0]['where'] = { cnpj: info.cnpj };

    if (escopo === 'raiz') {
      const raiz = alvoInformado || raizCert;
      if (raiz.length !== 8) return { success: false, message: 'Informe uma raiz de CNPJ com 8 digitos.' };
      if (raiz !== raizCert) {
        return {
          success: false,
          message: `Este PFX e da raiz ${raizCert}. Nao vou vincular na raiz ${raiz}.`,
        };
      }
      alvo = raiz;
      pathKey = `CERT_PFX_PATH_RAIZ_${raiz}`;
      passKey = `CERT_PFX_PASSWORD_RAIZ_${raiz}`;
      whereCnpj = { cnpj: { startsWith: raiz } };
    } else if (escopo === 'cnpj') {
      const cnpj = alvoInformado || info.cnpj;
      if (!validarCnpj(cnpj)) return { success: false, message: 'Informe um CNPJ valido para vincular.' };
      if (cnpj.slice(0, 8) !== raizCert) {
        return {
          success: false,
          message: `Este PFX e da raiz ${raizCert}. Nao vou vincular no CNPJ ${formatarCnpj(cnpj)}.`,
        };
      }
      alvo = cnpj;
      pathKey = `CERT_PFX_PATH_${cnpj}`;
      passKey = `CERT_PFX_PASSWORD_${cnpj}`;
      whereCnpj = { cnpj };
    }

    const certDir = path.resolve(process.cwd(), 'certs');
    fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });
    const nomeArquivo = nomeArquivoCertificado(escopo, alvo);
    const caminhoAbsoluto = path.join(certDir, nomeArquivo);
    const caminhoRelativo = `./certs/${nomeArquivo}`;

    fs.writeFileSync(caminhoAbsoluto, pfx, { mode: 0o600 });
    fs.chmodSync(caminhoAbsoluto, 0o600);

    const envPath = path.resolve(process.cwd(), '.env');
    upsertEnv(envPath, pathKey, caminhoRelativo);
    upsertEnv(envPath, passKey, senha);
    process.env[pathKey] = caminhoRelativo;
    process.env[passKey] = senha;

    const atualizadas = await prisma.cnpj.updateMany({
      where: whereCnpj,
      data: {
        certSerial: info.serial,
        certVencimento: info.vencimento,
      },
    });

    const existenteCert = await prisma.cnpj.findUnique({ where: { cnpj: info.cnpj } });
    if (existenteCert) {
      await prisma.cnpj.update({
        where: { cnpj: info.cnpj },
        data: {
          razaoSocial: existenteCert.razaoSocial || info.razaoSocial,
          certSerial: info.serial,
          certVencimento: info.vencimento,
        },
      });
    } else {
      await prisma.cnpj.create({
        data: {
          cnpj: info.cnpj,
          razaoSocial: info.razaoSocial,
          uf: 'CE',
          certSerial: info.serial,
          certVencimento: info.vencimento,
        },
      });
    }

    limparCacheCertificados();
    limparCachePemCertificado();
    revalidatePath('/');

    return {
      success: true,
      message:
        `Certificado atualizado na VPS: ${formatarCnpj(info.cnpj)}, vence em ${info.vencimento.toLocaleDateString('pt-BR')}. ` +
        `${atualizadas.count} empresa(s) da raiz atualizada(s).`,
    };
  } catch (error: unknown) {
    const msg = (error as Error).message;
    if (/mac verify failure|invalid password|pkcs12/i.test(msg)) {
      return { success: false, message: 'Senha do certificado incorreta.' };
    }
    return { success: false, message: `Erro ao atualizar certificado: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// CRUD de CNPJs
// ---------------------------------------------------------------------------

export async function listarCnpjs() {
  const usuario = await exigirUsuario();
  return prisma.cnpj.findMany({
    where: whereCnpjPermitido(usuario),
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { notas: true } } },
  });
}

export async function adicionarCnpj(formData: FormData): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  const cnpj = limparCnpj(String(formData.get('cnpj') ?? ''));
  const razaoSocial = String(formData.get('razaoSocial') ?? '').trim() || null;
  const uf = String(formData.get('uf') ?? '').trim().toUpperCase();

  if (!validarCnpj(cnpj)) {
    return { success: false, message: 'CNPJ inválido. Verifique os dígitos informados.' };
  }
  if (!UFS_VALIDAS.has(uf)) {
    return { success: false, message: `UF inválida: "${uf}".` };
  }

  try {
    const dadosCert = dadosCertificadoParaCnpj(cnpj);
    await prisma.cnpj.create({
      data: {
        cnpj,
        razaoSocial: razaoSocial || dadosCert?.razaoSocial || null,
        uf,
        certSerial: dadosCert?.certSerial,
        certVencimento: dadosCert?.certVencimento,
      },
    });
    revalidatePath('/');
    return {
      success: true,
      message: dadosCert
        ? `CNPJ ${formatarCnpj(cnpj)} cadastrado e vinculado ao certificado da raiz.`
        : `CNPJ ${formatarCnpj(cnpj)} cadastrado com sucesso.`,
    };
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2002') {
      return { success: false, message: `O CNPJ ${formatarCnpj(cnpj)} já está cadastrado.` };
    }
    return { success: false, message: `Erro ao salvar CNPJ: ${(error as Error).message}` };
  }
}

export async function alternarAtivoCnpj(id: number): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  try {
    const registro = await prisma.cnpj.findUnique({ where: { id } });
    if (!registro) return { success: false, message: 'CNPJ não encontrado.' };

    await prisma.cnpj.update({ where: { id }, data: { ativo: !registro.ativo } });
    revalidatePath('/');
    return {
      success: true,
      message: `CNPJ ${formatarCnpj(registro.cnpj)} ${registro.ativo ? 'desativado' : 'ativado'}.`,
    };
  } catch (error: unknown) {
    return { success: false, message: `Erro ao atualizar CNPJ: ${(error as Error).message}` };
  }
}

export async function removerCnpj(id: number): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  try {
    const registro = await prisma.cnpj.findUnique({
      where: { id },
      include: { _count: { select: { notas: true } } },
    });
    if (!registro) return { success: false, message: 'CNPJ não encontrado.' };
    if (registro._count.notas > 0) {
      return {
        success: false,
        message: `O CNPJ ${formatarCnpj(registro.cnpj)} possui ${registro._count.notas} nota(s) vinculada(s). Desative-o em vez de remover.`,
      };
    }

    await prisma.cnpj.delete({ where: { id } });
    revalidatePath('/');
    return { success: true, message: `CNPJ ${formatarCnpj(registro.cnpj)} removido.` };
  } catch (error: unknown) {
    return { success: false, message: `Erro ao remover CNPJ: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Sincronização direta com a SEFAZ (Distribuição DFe — Ambiente Nacional)
// ---------------------------------------------------------------------------

// Cada lote traz até ~50 documentos; 50 lotes cobrem ~2500 docs por sync,
// suficiente para o pull inicial de CNPJs grandes (ex.: CD com >1000 notas).
const MAX_LOTES_POR_SYNC = 50;

// A SEFAZ permite no máximo 1 consulta por hora quando não há documentos novos.
// Impomos esse intervalo por conta própria para nunca disparar o cStat 656.
const INTERVALO_MIN = 60;

function hhmm(d: Date): string {
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

export async function sincronizarNotas(cnpjId: number): Promise<ActionResult> {
  const usuario = await exigirUsuario().catch(() => null);
  if (!usuario) return { success: false, message: 'Sessao expirada. Faca login novamente.' };
  if (!usuarioPodeAcessarCnpj(usuario, cnpjId)) return { success: false, message: 'Acesso negado para esta loja.' };
  return sincronizarNotasInterno(cnpjId);
}

export async function sincronizarNotasInterno(cnpjId: number): Promise<ActionResult> {
  const registro = await prisma.cnpj.findUnique({ where: { id: cnpjId } });
  if (!registro) return { success: false, message: 'CNPJ não encontrado.' };
  if (!registro.ativo) return { success: false, message: 'CNPJ está desativado.' };

  // Respeita o intervalo mínimo entre consultas (próprio ou imposto pela SEFAZ)
  if (registro.bloqueadoAte && registro.bloqueadoAte > new Date()) {
    return {
      success: false,
      message: `${formatarCnpj(registro.cnpj)} está em dia. A SEFAZ limita a 1 consulta por hora — próxima liberada às ${hhmm(registro.bloqueadoAte)}.`,
    };
  }

  let ultNSU = registro.ultimoNSU;
  let novasNotas = 0;
  let atualizadas = 0;
  let lotes = 0;

  try {
    while (lotes < MAX_LOTES_POR_SYNC) {
      lotes++;
      const ret = await consultarDistribuicaoDFe(registro.cnpj, registro.uf, ultNSU);

      // 656 = consumo indevido: SEFAZ exige ~1h de espera.
      // A resposta 656 carrega o ultNSU real ("Deve ser utilizado o ultNSU nas
      // solicitações subsequentes") — persistimos para não reconsultar do NSU 0,
      // o que perpetuaria o bloqueio.
      if (ret.cStat === 656) {
        const bloqueadoAte = new Date(Date.now() + 65 * 60 * 1000);
        const nsuRetornado = /^\d+$/.test(ret.ultNSU) ? ret.ultNSU : ultNSU;
        const novoNSU = BigInt(nsuRetornado) > BigInt(ultNSU) ? nsuRetornado : ultNSU;

        // "caso não existam mais documentos" = já estava em dia, só consultou cedo demais.
        // É o caso normal de rate-limit, não um erro de uso.
        const emDia = /existam mais documentos|aguardado 1 hora/i.test(ret.xMotivo);
        const situacao = emDia
          ? `Em dia. Próxima consulta às ${hhmm(bloqueadoAte)}`
          : `SEFAZ: ${ret.xMotivo}`;

        await prisma.cnpj.update({
          where: { id: cnpjId },
          data: { situacao, bloqueadoAte, ultimaBusca: new Date(), ultimoNSU: novoNSU },
        });
        revalidatePath('/');
        return {
          success: emDia,
          message: emDia
            ? `${formatarCnpj(registro.cnpj)} já está em dia (sem documentos novos). A SEFAZ libera nova consulta às ${hhmm(bloqueadoAte)}.`
            : `SEFAZ retornou consumo indevido (656). Novas consultas após ${hhmm(bloqueadoAte)}. NSU ajustado para ${novoNSU}.`,
        };
      }

      // 137 = nenhum documento novo
      if (ret.cStat === 137) {
        ultNSU = ret.ultNSU;
        break;
      }

      // 138 = documentos localizados
      if (ret.cStat === 138) {
        for (const doc of ret.documentos) {
          // Evento de Ciência (210210) emitido por nós (mesmo CNPJ) → marca a nota
          const ev = interpretarEventoCiencia(doc.xml);
          if (ev && ev.cnpjAutor === registro.cnpj && ev.chave) {
            await prisma.notaFiscal.updateMany({
              where: { chave: ev.chave, cnpjId, manifestadaEm: null },
              data: { manifestadaEm: ev.dhEvento ? new Date(ev.dhEvento) : new Date() },
            });
          }

          // Evento de cancelamento (110111) → marca nota como CANCELADA
          const evCanc = interpretarEventoCancelamento(doc.xml);
          if (evCanc?.chave) {
            await prisma.notaFiscal.updateMany({
              where: { chave: evCanc.chave, cnpjId },
              data: { situacaoSefaz: 'CANCELADA' },
            });
          }

          const nota = await processarDocumento(doc, registro.cnpj);
          if (!nota) continue;

          const existente = await prisma.notaFiscal.findUnique({ where: { chave: nota.chave } });
          if (!existente) {
            await prisma.notaFiscal.create({
              data: { ...nota, cnpjId },
            });
            novasNotas++;
          } else if (existente.status === 'RESUMO' && nota.status === 'COMPLETA') {
            // XML completo chegou depois da manifestação — promove o registro
            const { status, chave, ...campos } = nota;
            void chave;
            await prisma.notaFiscal.update({
              where: { chave: nota.chave },
              data: { ...campos, status },
            });
            atualizadas++;
          }
        }

        ultNSU = ret.ultNSU;
        // Continua até alcançar o maxNSU
        if (BigInt(ret.ultNSU) >= BigInt(ret.maxNSU)) break;
        continue;
      }

      // Qualquer outro cStat é erro
      await prisma.cnpj.update({
        where: { id: cnpjId },
        data: { situacao: `SEFAZ ${ret.cStat}: ${ret.xMotivo}`, ultimaBusca: new Date(), ultimoNSU: ultNSU },
      });
      revalidatePath('/');
      return { success: false, message: `SEFAZ ${ret.cStat}: ${ret.xMotivo}` };
    }

    // Chegou ao fim da fila (em dia). Impomos o intervalo de 1h antes da próxima
    // consulta para respeitar o limite da SEFAZ e não disparar o 656.
    const proxima = new Date(Date.now() + INTERVALO_MIN * 60 * 1000);
    await prisma.cnpj.update({
      where: { id: cnpjId },
      data: {
        ultimoNSU: ultNSU,
        situacao: `Em dia · ${novasNotas} nova(s). Próxima consulta às ${hhmm(proxima)}`,
        ultimaBusca: new Date(),
        bloqueadoAte: proxima,
      },
    });
    revalidatePath('/');

    return {
      success: true,
      message:
        `${formatarCnpj(registro.cnpj)}: ${novasNotas} nova(s), ${atualizadas} atualizada(s). ` +
        `Em dia — próxima consulta liberada às ${hhmm(proxima)} (SEFAZ limita a 1/hora sem novidades).`,
    };
  } catch (error: unknown) {
    const msg = (error as Error).message;
    await prisma.cnpj.update({
      where: { id: cnpjId },
      data: { situacao: `Erro: ${msg.slice(0, 200)}`, ultimaBusca: new Date(), ultimoNSU: ultNSU },
    });
    revalidatePath('/');
    return { success: false, message: msg };
  }
}

// ---------------------------------------------------------------------------
// Certificados do Windows → cadastro/vínculo de empresas
// ---------------------------------------------------------------------------

export interface CertificadoComStatus extends CertificadoWindows {
  jaCadastrado: boolean;
}

export async function lerCertificados(): Promise<
  { ok: true; certificados: CertificadoComStatus[] } | { ok: false; message: string }
> {
  try {
    await exigirAdmin();
  } catch (error: unknown) {
    return { ok: false, message: (error as Error).message };
  }

  try {
    const certs = await listarCertificadosWindows();
    const cadastrados = new Set((await prisma.cnpj.findMany({ select: { cnpj: true } })).map((c) => c.cnpj));
    return {
      ok: true,
      certificados: certs.map((c) => ({ ...c, jaCadastrado: cadastrados.has(c.cnpj) })),
    };
  } catch (error: unknown) {
    return { ok: false, message: `Não foi possível ler os certificados: ${(error as Error).message}` };
  }
}

/**
 * Cadastra empresas a partir dos certificados ainda não registrados e vincula
 * os dados do certificado (serial/thumbprint/validade) às empresas existentes.
 */
export async function vincularCertificados(): Promise<ActionResult> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  try {
    const certs = await listarCertificadosWindows();
    if (certs.length === 0) {
      return { success: false, message: 'Nenhum certificado e-CNPJ encontrado no Windows.' };
    }

    let cadastradas = 0;
    let vinculadas = 0;

    for (const c of certs) {
      const dadosCert = {
        certSerial: c.serial,
        certThumbprint: c.thumbprint,
        certVencimento: new Date(c.vencimento),
      };
      const existente = await prisma.cnpj.findUnique({ where: { cnpj: c.cnpj } });
      if (existente) {
        await prisma.cnpj.update({ where: { cnpj: c.cnpj }, data: dadosCert });
        vinculadas++;
      } else {
        await prisma.cnpj.create({
          data: { cnpj: c.cnpj, razaoSocial: c.razaoSocial, uf: c.uf, ...dadosCert },
        });
        cadastradas++;
      }
    }

    revalidatePath('/');
    return {
      success: true,
      message: `Certificados processados: ${cadastradas} empresa(s) cadastrada(s), ${vinculadas} vinculada(s).`,
    };
  } catch (error: unknown) {
    return { success: false, message: `Erro ao vincular certificados: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Manifestação do Destinatário (Ciência da Operação — evento 210210)
// ---------------------------------------------------------------------------

export async function manifestarNota(notaId: number): Promise<ActionResult> {
  const negado = await checarUsuarioAction();
  if (negado) return negado;

  const nota = await prisma.notaFiscal.findUnique({
    where: { id: notaId },
    include: { cnpj: true },
  });
  if (!nota) return { success: false, message: 'Nota não encontrada.' };
  if (nota.status === 'COMPLETA') {
    return { success: true, message: 'Esta nota já está completa.' };
  }
  // Ciência só pode ser dada 1x — se já registrada, não declara de novo
  if (nota.manifestadaEm) {
    return {
      success: true,
      message: `Esta nota já teve Ciência da Operação registrada em ${nota.manifestadaEm.toLocaleDateString('pt-BR')}. Sincronize o CNPJ para baixar o XML completo.`,
    };
  }

  try {
    const r = await manifestar(nota.cnpj.cnpj, nota.chave);
    if (!r.ok) {
      return { success: false, message: `Manifestação rejeitada (cStat ${r.cStat}): ${r.xMotivo}` };
    }

    // Registra a Ciência localmente (573 = já estava registrada na SEFAZ)
    await prisma.notaFiscal.update({ where: { id: notaId }, data: { manifestadaEm: new Date() } });

    // A manifestação gera novos documentos no DFe — libera a consulta imediata
    await prisma.cnpj.update({ where: { id: nota.cnpjId }, data: { bloqueadoAte: null } });
    await sincronizarNotas(nota.cnpjId);

    const atual = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
    revalidatePath('/');

    if (atual?.status === 'COMPLETA') {
      return {
        success: true,
        message: `Manifestação aceita (${r.cStat}) e XML completo baixado! DANFE e itens já disponíveis.`,
      };
    }

    // Ainda não veio o XML completo: a SEFAZ leva alguns minutos. Agenda janela curta.
    await prisma.cnpj.update({
      where: { id: nota.cnpjId },
      data: {
        bloqueadoAte: new Date(Date.now() + 6 * 60 * 1000),
        situacao: 'Manifestada — aguardando XML completo (sincronize em ~5 min)',
      },
    });
    return {
      success: true,
      message: `Manifestação aceita (cStat ${r.cStat}). A SEFAZ leva alguns minutos para liberar o XML completo — sincronize novamente em ~5 minutos.`,
    };
  } catch (error: unknown) {
    return { success: false, message: `Erro na manifestação: ${(error as Error).message}` };
  }
}

export async function obterDetalheNota(
  notaId: number
): Promise<{ ok: true; danfe: DanfeData } | { ok: false; message: string }> {
  try {
    await exigirUsuario();
  } catch (error: unknown) {
    return { ok: false, message: (error as Error).message };
  }

  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
  if (!nota) return { ok: false, message: 'Nota não encontrada.' };
  if (nota.status !== 'COMPLETA') {
    return {
      ok: false,
      message: 'Esta nota ainda é um RESUMO. Faça a manifestação (Ciência da Operação) para liberar o XML completo com itens e DANFE.',
    };
  }
  const xmlFisico = resolverXmlPath(nota.xmlPath);
  if (!xmlFisico) {
    return { ok: false, message: 'Arquivo XML da nota não encontrado no disco.' };
  }

  const danfe = parseDanfe(fs.readFileSync(xmlFisico, 'utf8'));
  if (!danfe) return { ok: false, message: 'Não foi possível interpretar o XML desta nota.' };
  return { ok: true, danfe };
}

// ---------------------------------------------------------------------------
// Importação por chave de acesso (Excel) — consulta direta consChNFe
// ---------------------------------------------------------------------------

export type StatusImport =
  | 'completa'
  | 'resumo'
  | 'manifestada'
  | 'ja-tinha'
  | 'nao-encontrada'
  | 'fora-de-prazo'
  | 'erro';

export interface ResultadoImportChave {
  chave: string;
  status: StatusImport;
  detalhe?: string;
}

async function guardarDocumento(
  cnpjId: number,
  cnpjInteressado: string,
  doc: { nsu: string; schema: string; xml: string }
): Promise<'completa' | 'resumo' | null> {
  const nota = await processarDocumento(doc, cnpjInteressado);
  if (!nota) return null;
  const existente = await prisma.notaFiscal.findUnique({ where: { chave: nota.chave } });
  if (!existente) {
    await prisma.notaFiscal.create({ data: { ...nota, cnpjId } });
  } else if (existente.status === 'RESUMO' && nota.status === 'COMPLETA') {
    const { status, chave, ...campos } = nota;
    void chave;
    await prisma.notaFiscal.update({ where: { chave: nota.chave }, data: { ...campos, status } });
  }
  return nota.status === 'COMPLETA' ? 'completa' : 'resumo';
}

/**
 * Importa um lote de chaves para um CNPJ via consulta direta (consChNFe).
 * Se `manifestarResumos` e a nota vier como resumo, manifesta e re-consulta
 * para tentar baixar o XML completo.
 */
export async function importarChavesLote(
  cnpjId: number,
  chaves: string[],
  manifestarResumos: boolean
): Promise<ResultadoImportChave[]> {
  try {
    await exigirUsuario();
  } catch (error: unknown) {
    return chaves.map((chave) => ({ chave, status: 'erro', detalhe: (error as Error).message }));
  }

  const registro = await prisma.cnpj.findUnique({ where: { id: cnpjId } });
  if (!registro) return chaves.map((chave) => ({ chave, status: 'erro', detalhe: 'CNPJ não encontrado' }));

  const resultados: ResultadoImportChave[] = [];

  for (const chave of chaves) {
    if (!/^\d{44}$/.test(chave)) {
      resultados.push({ chave, status: 'erro', detalhe: 'Chave inválida' });
      continue;
    }
    try {
      const existente = await prisma.notaFiscal.findUnique({ where: { chave } });
      if (existente?.status === 'COMPLETA') {
        resultados.push({ chave, status: 'ja-tinha' });
        continue;
      }

      const ret = await consultarPorChave(registro.cnpj, registro.uf, chave);
      if (ret.cStat !== 138 || ret.documentos.length === 0) {
        // 632 = nota antiga (>~90 dias), fora do prazo de download da SEFAZ
        const status = ret.cStat === 632 ? 'fora-de-prazo' : 'nao-encontrada';
        resultados.push({ chave, status, detalhe: `${ret.cStat}: ${ret.xMotivo}` });
        continue;
      }

      let tipo = await guardarDocumento(cnpjId, registro.cnpj, ret.documentos[0]);

      // Resumo + opção de manifestar → manifesta e re-consulta o XML completo
      if (tipo === 'resumo' && manifestarResumos) {
        const notaAtual = await prisma.notaFiscal.findUnique({ where: { chave } });
        if (!notaAtual?.manifestadaEm) {
          const r = await manifestar(registro.cnpj, chave);
          if (r.ok) {
            await prisma.notaFiscal.update({ where: { chave }, data: { manifestadaEm: new Date() } });
            const ret2 = await consultarPorChave(registro.cnpj, registro.uf, chave);
            if (ret2.cStat === 138 && ret2.documentos.length > 0) {
              const t2 = await guardarDocumento(cnpjId, registro.cnpj, ret2.documentos[0]);
              if (t2) tipo = t2;
            }
            if (tipo !== 'completa') {
              resultados.push({ chave, status: 'manifestada', detalhe: 'XML completo em alguns minutos' });
              continue;
            }
          } else {
            resultados.push({ chave, status: 'resumo', detalhe: `manifestação: ${r.xMotivo}` });
            continue;
          }
        }
      }

      resultados.push({ chave, status: tipo === 'completa' ? 'completa' : 'resumo' });
    } catch (error: unknown) {
      resultados.push({ chave, status: 'erro', detalhe: (error as Error).message });
    }
  }

  revalidatePath('/');
  return resultados;
}

/**
 * Importa todos os XMLs de NF-e de uma pasta do computador (recursivo), sem
 * consultar a SEFAZ. É a única forma de trazer notas antigas (>90 dias), cujos
 * XMLs o contador/ERP guarda. Associa cada nota à empresa (destinatário ou
 * emitente) já cadastrada.
 */
export async function importarXmlsDaPasta(
  pasta: string
): Promise<ActionResult & { contagem?: Record<string, number> }> {
  const negado = await checarAdminAction();
  if (negado) return negado;

  if (!pasta || !fs.existsSync(pasta)) {
    return { success: false, message: `Pasta não encontrada: ${pasta}` };
  }

  const empresas = await prisma.cnpj.findMany();
  const porCnpj = new Map(empresas.map((e) => [e.cnpj, e]));

  // Lista recursiva de .xml
  function listarXmls(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}\\${e.name}`;
      if (e.isDirectory()) out.push(...listarXmls(full));
      else if (e.isFile() && e.name.toLowerCase().endsWith('.xml')) out.push(full);
    }
    return out;
  }

  const arquivos = listarXmls(pasta);
  const cont: Record<string, number> = { completa: 0, resumo: 0, jaTinha: 0, semEmpresa: 0, ignorado: 0, erro: 0 };

  for (const arq of arquivos) {
    try {
      const xml = fs.readFileSync(arq, 'utf8');
      const ehProc = xml.includes('<nfeProc') || xml.includes('<procNFe');
      const ehRes = xml.includes('<resNFe');
      if (!ehProc && !ehRes) { cont.ignorado++; continue; }

      // Descobre a empresa: destinatário ou emitente que esteja cadastrado
      const cnpjsNoXml = (xml.match(/<CNPJ>(\d{14})<\/CNPJ>/g) ?? []).map((m) => m.replace(/\D/g, ''));
      const empresa = cnpjsNoXml.map((c) => porCnpj.get(c)).find(Boolean);
      if (!empresa) { cont.semEmpresa++; continue; }

      const schema = ehProc ? 'procNFe_v4.00' : 'resNFe_v1.01';
      const chaveMatch = xml.match(/Id="NFe(\d{44})"/) ?? xml.match(/<chNFe>(\d{44})<\/chNFe>/);
      const chave = chaveMatch?.[1] ?? '';
      const existente = chave ? await prisma.notaFiscal.findUnique({ where: { chave } }) : null;
      const eraResumo = existente?.status === 'RESUMO';

      const tipo = await guardarDocumento(empresa.id, empresa.cnpj, { nsu: '', schema, xml });
      if (!tipo) { cont.ignorado++; continue; }

      if (existente && !(eraResumo && tipo === 'completa')) cont.jaTinha++;
      else if (tipo === 'completa') cont.completa++;
      else cont.resumo++;
    } catch {
      cont.erro++;
    }
  }

  revalidatePath('/');
  const novas = cont.completa + cont.resumo;
  const extras: string[] = [];
  if (cont.semEmpresa) extras.push(`${cont.semEmpresa} sem empresa cadastrada`);
  if (cont.ignorado) extras.push(`${cont.ignorado} ignorado(s) (não é NF-e válida)`);
  if (cont.erro) extras.push(`${cont.erro} com erro de leitura`);
  const detalhe = extras.length ? `, ${extras.join(', ')}` : '';
  return {
    success: true,
    message: `${arquivos.length} XML(s) lidos: ${novas} nota(s) importada(s), ${cont.jaTinha} já existia(m)${detalhe}.`,
    contagem: cont,
  };
}

export async function listarNotas(pagina = 1, porPagina = 50) {
  const usuario = await exigirUsuario();
  const include = { cnpj: { select: { cnpj: true, razaoSocial: true } } } as const;
  const paginaSegura = Math.max(1, Math.trunc(Number(pagina) || 1));
  const limiteSeguro = Math.max(1, Math.min(100, Math.trunc(Number(porPagina) || 50)));
  const where = {
    ...whereNotaPermitida(usuario),
    situacaoSefaz: { not: 'CANCELADA' as const },
  };

  // Mantém as 2000 recentes e inclui qualquer DAE antigo, para nenhum
  // vencimento desaparecer do painel de alertas.
  return prisma.notaFiscal.findMany({
    where,
    orderBy: { emitidaEm: 'desc' },
    skip: (paginaSegura - 1) * limiteSeguro,
    take: limiteSeguro,
    include,
  });
}

/**
 * Todas as notas (sem paginação), para busca/filtro no cliente.
 * O volume é pequeno (poucos milhares) e a tela é interna.
 */
export async function listarTodasNotas() {
  const usuario = await exigirUsuario();
  return prisma.notaFiscal.findMany({
    where: {
      ...whereNotaPermitida(usuario),
      situacaoSefaz: { not: 'CANCELADA' },
    },
    orderBy: { emitidaEm: 'desc' },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });
}

/**
 * Base leve e paginada para relatórios. Evita carregar o histórico inteiro,
 * XML/SITRAM detalhado e anexos de uma vez na tela de BI.
 */
export async function listarNotasRelatorio(pagina = 1, porPagina = 120): Promise<PaginaNotasRelatorio> {
  const usuario = await exigirUsuario();
  const paginaSegura = Math.max(1, Math.floor(pagina));
  const limiteSeguro = Math.min(200, Math.max(20, Math.floor(porPagina)));
  const where = whereNotaPermitida(usuario);
  const [total, notas] = await Promise.all([
    prisma.notaFiscal.count({ where }),
    prisma.notaFiscal.findMany({
    where,
    orderBy: { emitidaEm: 'desc' },
    skip: (paginaSegura - 1) * limiteSeguro,
    take: limiteSeguro,
    select: {
      id: true,
      cnpjId: true,
      chave: true,
      numero: true,
      serie: true,
      emitidaEm: true,
      tipoOperacao: true,
      naturezaOp: true,
      emitenteUf: true,
      emitenteNome: true,
      emitenteCnpj: true,
      destNome: true,
      destCnpj: true,
      valorTotal: true,
      valorProdutos: true,
      valorFrete: true,
      valorDesconto: true,
      valorIcms: true,
      qtdItens: true,
      status: true,
      situacaoSefaz: true,
      manifestadaEm: true,
      sitramConsultadaEm: true,
      sitramDaeStatus: true,
      sitramDaeResumo: true,
      sitramDetalhe: true,
      pagamentoManualEm: true,
      pagamentoManualRef: true,
      pagamentoManualValor: true,
      cnpj: { select: { cnpj: true, razaoSocial: true } },
    },
  }),
  ]);

  const resultado = notas.map((nota) => {
    const resumo = extrairResumoDae(nota);
    const lancamento = lancamentosVisiveisDae(resumo.lancamentos).find((item) => !item.pago)
      ?? lancamentosVisiveisDae(resumo.lancamentos)[0]
      ?? null;
    const { sitramDetalhe: _sitramDetalhe, ...base } = nota;

    return {
      ...base,
      daeVencimento: lancamento?.vencimento ?? null,
      daeValor: lancamento?.valor ?? null,
      daeValorAberto: lancamento?.valorAberto ?? null,
      daeValorPago: nota.pagamentoManualValor ?? lancamento?.valorPago ?? null,
      daeCodigo: lancamento?.codigo ?? null,
      daeDescricao: lancamento?.descricao ?? null,
      daeTipo: lancamento?.tipo ?? null,
      daeClassificacao: resumo.classificacao ?? null,
    };
  });

  return {
    notas: resultado,
    pagina: paginaSegura,
    porPagina: limiteSeguro,
    total,
    temMais: paginaSegura * limiteSeguro < total,
  };
}

export async function listarNotasAlertaDae() {
  const usuario = await exigirUsuario();
  return prisma.notaFiscal.findMany({
    where: {
      ...whereNotaPermitida(usuario),
      sitramConsultadaEm: { not: null },
      sitramDaeStatus: { in: ['EM_ABERTO', 'LIBERADA_PARA_GERAR'] },
    },
    orderBy: { emitidaEm: 'desc' },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });
}

/**
 * Carrega todas as notas de um ano específico (server-side).
 * Usado quando o usuário filtra por ano para garantir que notas fora das
 * 2000 mais recentes também sejam encontradas.
 */
export async function listarNotasPorAno(ano: number) {
  const usuario = await exigirUsuario();
  return prisma.notaFiscal.findMany({
    where: {
      ...whereNotaPermitida(usuario),
      emitidaEm: {
        gte: new Date(`${ano}-01-01T00:00:00`),
        lt: new Date(`${ano + 1}-01-01T00:00:00`),
      },
    },
    orderBy: { emitidaEm: 'desc' },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });
}

/**
 * Retorna os anos distintos em que há notas no banco, para popular o seletor.
 */
export async function listarAnosDisponiveis(): Promise<number[]> {
  const usuario = await exigirUsuario();
  if (!usuario.acessoTodosCnpjs && usuario.cnpjIds.length === 0) return [];

  const linhas = usuario.acessoTodosCnpjs
    ? await prisma.$queryRaw<Array<{ ano: number }>>`
        SELECT DISTINCT EXTRACT(YEAR FROM "emitidaEm")::int AS ano
        FROM "NotaFiscal"
        ORDER BY ano DESC
      `
    : await prisma.$queryRaw<Array<{ ano: number }>>`
        SELECT DISTINCT EXTRACT(YEAR FROM "emitidaEm")::int AS ano
        FROM "NotaFiscal"
        WHERE "cnpjId" IN (${Prisma.join(usuario.cnpjIds)})
        ORDER BY ano DESC
      `;

  return linhas.map((linha) => linha.ano);
}

/** Retorna o total de notas no banco (rápido — só COUNT). */
export async function contarNotasTotal(): Promise<number> {
  const usuario = await exigirUsuario();
  return prisma.notaFiscal.count({
    where: {
      ...whereNotaPermitida(usuario),
      situacaoSefaz: { not: 'CANCELADA' },
    },
  });
}

export type ResumoInicio = {
  totalNotas: number;
  notasCompletas: number;
  pendentesManifestacao: number;
  emitidasHoje: number;
  emitidasUltimos7Dias: number;
  valorTotal: number;
};

export async function obterResumoInicio(): Promise<ResumoInicio> {
  const usuario = await exigirUsuario();
  const where = whereNotaPermitida(usuario);
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const inicio7Dias = new Date(inicioHoje);
  inicio7Dias.setDate(inicio7Dias.getDate() - 6);
  const inicioPrazoManifestacao = new Date(inicioHoje);
  inicioPrazoManifestacao.setDate(inicioPrazoManifestacao.getDate() - 10);

  const [totalNotas, notasCompletas, pendentesManifestacao, emitidasHoje, emitidasUltimos7Dias, valores] = await Promise.all([
    prisma.notaFiscal.count({ where }),
    prisma.notaFiscal.count({ where: { ...where, status: 'COMPLETA' } }),
    prisma.notaFiscal.count({
      where: {
        ...where,
        status: 'RESUMO',
        manifestadaEm: null,
        situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
        emitidaEm: { gte: inicioPrazoManifestacao },
      },
    }),
    prisma.notaFiscal.count({ where: { ...where, emitidaEm: { gte: inicioHoje } } }),
    prisma.notaFiscal.count({ where: { ...where, emitidaEm: { gte: inicio7Dias } } }),
    prisma.notaFiscal.aggregate({ where, _sum: { valorTotal: true } }),
  ]);

  return {
    totalNotas,
    notasCompletas,
    pendentesManifestacao,
    emitidasHoje,
    emitidasUltimos7Dias,
    valorTotal: valores._sum.valorTotal ?? 0,
  };
}

export async function sincronizarCnpjsAtivos(): Promise<ActionResult> {
  const negado = await checarUsuarioAction();
  if (negado) return negado;
  return sincronizarCnpjsAtivosInterno();
}

export async function sincronizarCnpjsAtivosInterno(): Promise<ActionResult> {
  const cnpjs = await prisma.cnpj.findMany({
    where: { ativo: true },
    orderBy: { createdAt: 'asc' },
  });

  if (cnpjs.length === 0) {
    return { success: true, message: 'Nenhum CNPJ ativo para sincronizar.' };
  }

  let sucesso = 0;
  let pulados = 0;
  let erros = 0;
  const detalhes: string[] = [];

  for (const cnpj of cnpjs) {
    if (cnpj.bloqueadoAte && cnpj.bloqueadoAte > new Date()) {
      pulados++;
      detalhes.push(`${formatarCnpj(cnpj.cnpj)} em dia ate ${hhmm(cnpj.bloqueadoAte)}`);
      continue;
    }

    const res = await sincronizarNotasInterno(cnpj.id);
    if (res.success) sucesso++;
    else erros++;
    detalhes.push(`${formatarCnpj(cnpj.cnpj)}: ${res.message}`);
  }

  revalidatePath('/');
  return {
    success: erros === 0,
    message:
      `NF: ${sucesso} CNPJ(s) sincronizado(s), ${pulados} em intervalo, ${erros} erro(s). ` +
      detalhes.slice(0, 3).join(' | '),
  };
}

export async function atualizarTransporteNotasExistentes(limite = 10000): Promise<ActionResult> {
  const negado = await checarUsuarioAction();
  if (negado) return negado;

  const take = Math.max(1, Math.min(20000, Math.trunc(Number(limite) || 10000)));
  const notas = await prisma.notaFiscal.findMany({
    where: {
      status: 'COMPLETA',
      xmlPath: { not: null },
      OR: [{ modalidadeFrete: null }, { valorFrete: null }],
    },
    select: { id: true, xmlPath: true },
    orderBy: { emitidaEm: 'desc' },
    take,
  });

  let atualizadas = 0;
  let semXml = 0;
  let erro = 0;

  for (const nota of notas) {
    try {
      const xmlFisico = resolverXmlPath(nota.xmlPath);
      if (!xmlFisico) {
        semXml++;
        continue;
      }

      const transporte = extrairTransporteXml(fs.readFileSync(xmlFisico, 'utf8'));
      if (!transporte) {
        erro++;
        continue;
      }

      await prisma.notaFiscal.update({
        where: { id: nota.id },
        data: {
          valorFrete: transporte.valorFrete ?? null,
          modalidadeFrete: transporte.modalidadeFrete ?? null,
          transportadoraNome: transporte.transportadoraNome ?? null,
          transportadoraCnpj: transporte.transportadoraCnpj ?? null,
          transportadoraIe: transporte.transportadoraIe ?? null,
          transportadoraUf: transporte.transportadoraUf ?? null,
          transportadoraMunicipio: transporte.transportadoraMunicipio ?? null,
        },
      });
      atualizadas++;
    } catch {
      erro++;
    }
  }

  revalidatePath('/');
  return {
    success: true,
    message: `Transporte/frete: ${atualizadas} nota(s) atualizada(s), ${semXml} sem XML, ${erro} erro(s).`,
  };
}

// ---------------------------------------------------------------------------
// SITRAM / SEFAZ-CE (status de posto fiscal e DAE via MDF-e)
// ---------------------------------------------------------------------------

export type StatusSitramManifesto = 'atualizado' | 'erro';

export interface ResultadoSitramManifesto {
  chave: string;
  status: StatusSitramManifesto;
  notasNoManifesto: number;
  notasAtualizadas: number;
  notasNaoEncontradas: number;
  detalhe?: string;
}

export interface ResultadoSitramLote extends ActionResult {
  resultados: ResultadoSitramManifesto[];
}

export interface ChavesSitramPendentes extends ActionResult {
  chaves: string[];
}

function inicioDoDiaLocal(): Date {
  const data = new Date();
  data.setHours(0, 0, 0, 0);
  return data;
}

function textoCampoSitram(objeto: unknown, ...campos: string[]): string | null {
  const registro = objeto && typeof objeto === 'object' && !Array.isArray(objeto)
    ? objeto as Record<string, unknown>
    : {};

  for (const campo of campos) {
    const valor = registro[campo];
    if (typeof valor === 'string' && valor.trim()) return valor.trim();
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  }

  return null;
}

function numeroNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const numero = normalizada.slice(25, 34);
  return numero.replace(/^0+/, '') || numero;
}

function serieNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const serie = normalizada.slice(22, 25);
  return serie.replace(/^0+/, '') || serie;
}

function numeroNotaSitram(nota: SitramNotaFiscal | SitramPortalNotaFiscal, chave: string): string | null {
  return textoCampoSitram(nota, 'numero', 'numeroNotaFiscal', 'numeroNota', 'nNF')
    ?? numeroNotaDaChave(chave);
}

function serieNotaSitram(nota: SitramNotaFiscal | SitramPortalNotaFiscal, chave: string): string | null {
  return textoCampoSitram(nota, 'serie', 'serieNotaFiscal', 'serieNota', 'nSerie')
    ?? serieNotaDaChave(chave);
}

function textoSitramNota(nota: SitramNotaFiscal): string | null {
  return nota.descricaoStatusNF || nota.descricaoSituacao || (nota.situacao != null ? `Situacao ${nota.situacao}` : null);
}

function inferirSitramSelada(nota: SitramNotaFiscal): boolean | null {
  if (typeof nota.notaLiberada === 'number') return nota.notaLiberada === 1;

  const texto = `${nota.descricaoStatusNF ?? ''} ${nota.descricaoSituacao ?? ''}`.toLowerCase();
  if (/liberad|selad|desembarac|desembara/.test(texto)) return true;
  if (/pendente|bloquead|nao liberad|não liberad/.test(texto)) return false;
  return null;
}

function lancamentoPago(lancamento: SitramLancamento): boolean {
  return /pago|quitad|baixad|recolhid/.test((lancamento.situacao ?? '').toLowerCase());
}

function statusDae(nota: SitramNotaFiscal): string {
  const lancamentos = nota.lancamentos ?? [];
  if (lancamentos.length === 0) {
    return nota.liberadaParaPagamento ? 'LIBERADA_PARA_GERAR' : 'SEM_DAE';
  }

  return lancamentos.every(lancamentoPago) ? 'PAGO' : 'EM_ABERTO';
}

function resumoDae(nota: SitramNotaFiscal): string | null {
  const lancamentos = nota.lancamentos ?? [];
  if (lancamentos.length === 0) return null;

  return lancamentos
    .map((l) => {
      const receita = [l.codReceita, l.descricaoRec].filter(Boolean).join(' - ');
      const valor = typeof l.icmsDevido === 'number' ? `R$ ${l.icmsDevido.toFixed(2)}` : '';
      return [receita || 'Receita', l.situacao || 'sem situacao', valor].filter(Boolean).join(': ');
    })
    .join(' | ');
}

function primeiraUrlDae(nota: SitramNotaFiscal): string | null {
  return nota.lancamentos?.map((l) => l.urlGerarDae).find(Boolean) ?? null;
}

function textoPortalNota(nota: SitramPortalNotaFiscal): string | null {
  return nota.situacaoDescricao || nota.situacaoTransitoLivre || null;
}

function inferirPortalSelada(nota: SitramPortalNotaFiscal): boolean | null {
  const texto = `${nota.situacaoTransitoLivre ?? ''} ${nota.situacaoDescricao ?? ''}`.toLowerCase();
  if (/liberad|selad|desembarac|desembara|transito livre|trânsito livre/.test(texto)) return true;
  if (/pendente|bloquead|retid|nao liberad|não liberad/.test(texto)) return false;
  return null;
}

function statusDaePortal(nota: SitramPortalNotaFiscal, lancamentos: SitramPortalLancamento[]): string {
  return classificarStatusDaePortal(nota, lancamentos);
}

function dataSitram(dataIso: string | undefined): string | null {
  if (!dataIso) return null;
  const data = new Date(dataIso);
  if (Number.isNaN(data.getTime())) return dataIso;
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resumoTransitoPortal(nota: SitramPortalNotaFiscal): string[] {
  const dados: string[] = [];
  const gerado = dataSitram(nota.dataInclusao);
  const passagem = dataSitram(nota.dataFatoGerador);
  const posto =
    nota.descricaoOrgaoLocal ||
    nota.orgaoLocalEventoDescricao ||
    nota.orgaoLocalEventoSigla ||
    null;

  if (gerado) dados.push(`Gerado/incluido SITRAM: ${gerado}`);
  if (passagem) dados.push(`Passou/fato gerador: ${passagem}`);
  if (posto) dados.push(`Posto fiscal: ${posto}`);
  if (nota.acaoFiscalSituacaoDescricao) dados.push(`Acao fiscal: ${nota.acaoFiscalSituacaoDescricao}`);
  return dados;
}

function resumoDaePortal(nota: SitramPortalNotaFiscal, lancamentos: SitramPortalLancamento[]): string | null {
  const transito = resumoTransitoPortal(nota);
  if (lancamentos.length === 0) {
    return [nota.situacaoDoImposto || null, ...transito].filter(Boolean).join(' | ') || null;
  }

  const resumoLancamentos = lancamentos
    .map((l) => {
      const receita = [l.codigo, l.descricaoAbreviada, l.descricao].filter(Boolean).join(' - ');
      const situacao = l.siuacaoDescricao || l.situacaoDescricao || l.situacao || 'sem situacao';
      const valor = typeof l.valor === 'number' ? `R$ ${l.valor.toFixed(2)}` : '';
      const valorPago = typeof l.valorPago === 'number' ? `pago R$ ${l.valorPago.toFixed(2)}` : '';
      const vencimento = dataSitram(l.vencimento);
      return [receita || 'Lancamento', situacao, valor, valorPago, vencimento ? `venc. ${vencimento}` : '']
        .filter(Boolean)
        .join(': ');
    })
    .join(' | ');

  return [resumoLancamentos, ...transito].filter(Boolean).join(' | ');
}

function erroSitramNfeNaoEncontrada(error: unknown): boolean {
  return /NF-e nao encontrada no SITRAM/i.test((error as Error).message);
}

async function marcarSitramNfeNaoEncontrada(chaveNfe: string): Promise<ResultadoSitramManifesto> {
  const detalhe = 'NF-e nao encontrada no SITRAM.';
  const ret = await prisma.notaFiscal.updateMany({
    where: { chave: chaveNfe },
    data: {
      sitramConsultadaEm: new Date(),
      sitramChaveManifesto: null,
      sitramAcaoFiscal: null,
      sitramSelada: null,
      sitramSituacao: detalhe,
      sitramDaeStatus: 'NAO_ENCONTRADA',
      sitramDaeResumo: null,
      sitramDaeUrl: null,
      sitramDetalhe: JSON.stringify({ origem: 'portal-nfe', erro: detalhe }),
      numero: numeroNotaDaChave(chaveNfe),
      serie: serieNotaDaChave(chaveNfe),
    },
  });

  return {
    chave: chaveNfe,
    status: 'atualizado',
    notasNoManifesto: 1,
    notasAtualizadas: ret.count,
    notasNaoEncontradas: ret.count > 0 ? 0 : 1,
    detalhe,
  };
}

async function salvarRetornoSitram(
  manifesto: SitramManifestoCarga,
  chaveConsultada: string
): Promise<ResultadoSitramManifesto> {
  const notas = manifesto.notasFiscais ?? [];
  let notasAtualizadas = 0;
  let notasNaoEncontradas = 0;

  for (const notaSitram of notas) {
    const chaveNfe = notaSitram.chaveAcesso?.replace(/\D/g, '');
    if (!chaveNfe || chaveNfe.length !== 44) continue;

    const detalhe = {
      manifesto: {
        chaveAcesso: manifesto.chaveAcesso ?? chaveConsultada,
        acaoFiscal: manifesto.acaoFiscal,
        situacaoAcaoFiscal: manifesto.situacaoAcaoFiscal,
        descricaoSituacao: manifesto.descricaoSituacao,
      },
      notaFiscal: notaSitram,
    };

    const ret = await prisma.notaFiscal.updateMany({
      where: { chave: chaveNfe },
      data: {
        sitramConsultadaEm: new Date(),
        sitramChaveManifesto: manifesto.chaveAcesso ?? chaveConsultada,
        sitramAcaoFiscal: manifesto.acaoFiscal != null ? String(manifesto.acaoFiscal) : null,
        sitramSelada: inferirSitramSelada(notaSitram),
        sitramSituacao: textoSitramNota(notaSitram),
        sitramDaeStatus: statusDae(notaSitram),
        sitramDaeResumo: resumoDae(notaSitram),
        sitramDaeUrl: primeiraUrlDae(notaSitram),
        sitramDetalhe: JSON.stringify(detalhe),
        numero: numeroNotaSitram(notaSitram, chaveNfe),
        serie: serieNotaSitram(notaSitram, chaveNfe),
      },
    });

    if (ret.count > 0) notasAtualizadas += ret.count;
    else notasNaoEncontradas++;
  }

  return {
    chave: manifesto.chaveAcesso ?? chaveConsultada,
    status: 'atualizado',
    notasNoManifesto: notas.length,
    notasAtualizadas,
    notasNaoEncontradas,
  };
}

function timestampPortalNota(n: SitramPortalNotaFiscal): number {
  const d = n.dataInclusao || n.dataFatoGerador || n.dataEmissao;
  const t = d ? Date.parse(d) : NaN;
  if (!Number.isNaN(t)) return t;
  return Number(n.id ?? 0);
}

// Ordena registros do portal do SITRAM do mais recente para o mais antigo.
function compararPortalMaisRecente(a: SitramPortalNotaFiscal, b: SitramPortalNotaFiscal): number {
  return timestampPortalNota(b) - timestampPortalNota(a);
}

async function salvarRetornoSitramPorNfe(chaveNfe: string): Promise<ResultadoSitramManifesto> {
  let pagina: Awaited<ReturnType<typeof consultarNotaFiscalSitramPorChave>>;
  try {
    pagina = await consultarNotaFiscalSitramPorChave(chaveNfe);
  } catch (error: unknown) {
    if (erroSitramNfeNaoEncontrada(error)) return marcarSitramNfeNaoEncontrada(chaveNfe);
    throw error;
  }

  const notas = pagina.content ?? [];
  if (notas.length === 0) return marcarSitramNfeNaoEncontrada(chaveNfe);

  // O SITRAM pode retornar vários registros para a mesma NF-e (várias passagens
  // em postos fiscais). Como cada registro sobrescreveria os mesmos campos no
  // banco, processamos apenas o mais recente — evita chamadas duplicadas à API
  // e o desperdício do limite do lote com a mesma nota.
  const notaSitram = [...notas].sort(compararPortalMaisRecente)[0];

  const [lancamentos, itens] = notaSitram.id
    ? await Promise.all([
        consultarLancamentosNotaFiscalSitram(notaSitram.id).catch(() => []),
        consultarTodosItensNotaFiscalSitram(notaSitram.id).catch(() => []),
      ])
    : [[], []];

  const ret = await prisma.notaFiscal.updateMany({
    where: { chave: chaveNfe },
    data: {
      sitramConsultadaEm: new Date(),
      sitramChaveManifesto: null,
      sitramAcaoFiscal: notaSitram.id != null ? String(notaSitram.id) : null,
      sitramSelada: inferirPortalSelada(notaSitram),
      sitramSituacao: textoPortalNota(notaSitram),
      sitramDaeStatus: statusDaePortal(notaSitram, lancamentos),
      sitramDaeResumo: resumoDaePortal(notaSitram, lancamentos),
      sitramDaeUrl: null,
      sitramDetalhe: JSON.stringify({
        origem: 'portal-nfe',
        notaFiscal: notaSitram,
        lancamentos,
        itens,
        registrosSitram: notas.length,
      }),
      numero: numeroNotaSitram(notaSitram, chaveNfe),
      serie: serieNotaSitram(notaSitram, chaveNfe),
    },
  });

  return {
    chave: chaveNfe,
    status: 'atualizado',
    notasNoManifesto: notas.length,
    notasAtualizadas: ret.count,
    notasNaoEncontradas: ret.count > 0 ? 0 : 1,
    detalhe: notas.length > 1 ? `${notas.length} registros no SITRAM; usado o mais recente` : undefined,
  };
}

export async function listarChavesSitramParaAtualizacao(
  ano: number,
  cnpjId?: number
): Promise<ChavesSitramPendentes> {
  const negado = await checarUsuarioAction();
  if (negado) return { ...negado, chaves: [] };

  const anoSeguro = Math.trunc(Number(ano));
  if (!Number.isFinite(anoSeguro) || anoSeguro < 2000 || anoSeguro > 2200) {
    return { success: false, message: 'Ano inválido para consulta SITRAM.', chaves: [] };
  }

  const notas = await prisma.notaFiscal.findMany({
    where: {
      status: 'COMPLETA',
      situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
      OR: [
        { sitramConsultadaEm: null },
        { sitramConsultadaEm: { lt: inicioDoDiaLocal() } },
      ],
      ...(cnpjId ? { cnpjId } : {}),
      emitidaEm: {
        gte: new Date(`${anoSeguro}-01-01T00:00:00-03:00`),
        lt: new Date(`${anoSeguro + 1}-01-01T00:00:00-03:00`),
      },
      NOT: [{ emitenteUf: 'CE' }, { emitenteUf: null }],
    },
    select: { chave: true },
    orderBy: [
      { sitramConsultadaEm: 'asc' },
      { emitidaEm: 'desc' },
    ],
  });

  const chaves = notas
    .map((nota) => nota.chave.replace(/\D/g, ''))
    .filter((chave) => chave.length === 44 && chave.slice(20, 22) === '55');

  return {
    success: true,
    message: chaves.length
      ? `${chaves.length} NF-e para atualizar no SITRAM em ${anoSeguro}.`
      : `SITRAM ja foi atualizado hoje para as NF-e elegiveis de ${anoSeguro}.`,
    chaves,
  };
}

export async function listarChavesSitramSemConsulta(
  ano: number,
  cnpjId?: number
): Promise<ChavesSitramPendentes> {
  return listarChavesSitramParaAtualizacao(ano, cnpjId);
}

export async function consultarSitramNotasForaDoCe(
  cnpjId?: number,
  somenteSemConsulta = true,
  limite = 100
): Promise<ResultadoSitramLote> {
  const negado = await checarUsuarioAction();
  if (negado) return { ...negado, resultados: [] };

  const take = Math.max(1, Math.min(500, Math.trunc(Number(limite) || 100)));
  const notas = await prisma.notaFiscal.findMany({
    where: {
      status: 'COMPLETA',
      ...(cnpjId ? { cnpjId } : {}),
      ...(somenteSemConsulta ? { sitramConsultadaEm: null } : {}),
      NOT: [{ emitenteUf: 'CE' }, { emitenteUf: null }],
    },
    select: { chave: true },
    orderBy: { emitidaEm: 'desc' },
    take,
  });

  const chaves = notas.map((n) => n.chave).filter((chave) => chave.length === 44 && chave.slice(20, 22) === '55');
  if (chaves.length === 0) {
    return {
      success: true,
      message: 'Nenhuma NF-e fora do CE para consultar no SITRAM.',
      resultados: [],
    };
  }

  const resultados: ResultadoSitramManifesto[] = [];
  for (const chave of chaves) {
    try {
      resultados.push(await salvarRetornoSitramPorNfe(chave));
    } catch (error: unknown) {
      resultados.push({
        chave,
        status: 'erro',
        notasNoManifesto: 0,
        notasAtualizadas: 0,
        notasNaoEncontradas: 0,
        detalhe: (error as Error).message,
      });
    }
  }

  const atualizadas = resultados.reduce((acc, r) => acc + r.notasAtualizadas, 0);
  const erros = resultados.filter((r) => r.status === 'erro').length;

  revalidatePath('/');

  return {
    success: erros < resultados.length,
    message: `SITRAM fora do CE: ${chaves.length} NF-e processada(s), ${atualizadas} registro(s) atualizado(s), ${erros} erro(s).`,
    resultados,
  };
}

export async function atualizarSitramPorManifestos(chavesMdfe: string[]): Promise<ResultadoSitramLote> {
  const negado = await checarUsuarioAction();
  if (negado) return { ...negado, resultados: [] };

  const chaves = [...new Set(chavesMdfe.map((c) => c.replace(/\D/g, '')).filter(Boolean))];
  if (chaves.length === 0) {
    return { success: false, message: 'Informe ao menos uma chave de MDF-e com 44 digitos.', resultados: [] };
  }

  const resultados: ResultadoSitramManifesto[] = [];

  for (const chave of chaves) {
    if (chave.length !== 44) {
      resultados.push({
        chave,
        status: 'erro',
        notasNoManifesto: 0,
        notasAtualizadas: 0,
        notasNaoEncontradas: 0,
        detalhe: 'Chave de MDF-e invalida.',
      });
      continue;
    }

    try {
      const manifesto = await consultarManifestoCarga(chave);
      resultados.push(await salvarRetornoSitram(manifesto, chave));
    } catch (error: unknown) {
      resultados.push({
        chave,
        status: 'erro',
        notasNoManifesto: 0,
        notasAtualizadas: 0,
        notasNaoEncontradas: 0,
        detalhe: (error as Error).message,
      });
    }
  }

  const atualizadas = resultados.reduce((acc, r) => acc + r.notasAtualizadas, 0);
  const foraBanco = resultados.reduce((acc, r) => acc + r.notasNaoEncontradas, 0);
  const erros = resultados.filter((r) => r.status === 'erro').length;

  revalidatePath('/');

  return {
    success: atualizadas > 0 || erros === 0,
    message:
      `SITRAM: ${chaves.length} MDF-e processado(s), ${atualizadas} nota(s) atualizada(s)` +
      `${foraBanco ? `, ${foraBanco} nota(s) do manifesto fora do banco` : ''}` +
      `${erros ? `, ${erros} erro(s)` : ''}.`,
    resultados,
  };
}

export async function atualizarSitramPorChaves(
  chavesEntrada: string[],
  revalidarPagina = true
): Promise<ResultadoSitramLote> {
  const negado = await checarUsuarioAction();
  if (negado) return { ...negado, resultados: [] };

  const chaves = [...new Set(chavesEntrada.map((c) => c.replace(/\D/g, '')).filter(Boolean))];
  if (chaves.length === 0) {
    return { success: false, message: 'Informe ao menos uma chave NF-e ou MDF-e com 44 digitos.', resultados: [] };
  }

  const resultados: ResultadoSitramManifesto[] = [];

  for (const chave of chaves) {
    if (chave.length !== 44) {
      resultados.push({
        chave,
        status: 'erro',
        notasNoManifesto: 0,
        notasAtualizadas: 0,
        notasNaoEncontradas: 0,
        detalhe: 'Chave invalida.',
      });
      continue;
    }

    const modelo = chave.slice(20, 22);
    try {
      if (modelo === '55') {
        resultados.push(await salvarRetornoSitramPorNfe(chave));
      } else if (modelo === '58') {
        const manifesto = await consultarManifestoCarga(chave);
        resultados.push(await salvarRetornoSitram(manifesto, chave));
      } else {
        resultados.push({
          chave,
          status: 'erro',
          notasNoManifesto: 0,
          notasAtualizadas: 0,
          notasNaoEncontradas: 0,
          detalhe: `Modelo ${modelo || '--'} nao suportado. Use NF-e modelo 55 ou MDF-e modelo 58.`,
        });
      }
    } catch (error: unknown) {
      resultados.push({
        chave,
        status: 'erro',
        notasNoManifesto: 0,
        notasAtualizadas: 0,
        notasNaoEncontradas: 0,
        detalhe: (error as Error).message,
      });
    }
  }

  const atualizadas = resultados.reduce((acc, r) => acc + r.notasAtualizadas, 0);
  const foraBanco = resultados.reduce((acc, r) => acc + r.notasNaoEncontradas, 0);
  const erros = resultados.filter((r) => r.status === 'erro').length;

  if (revalidarPagina) revalidatePath('/');

  return {
    success: atualizadas > 0 || erros === 0,
    message:
      `SITRAM: ${chaves.length} chave(s) processada(s), ${atualizadas} nota(s) atualizada(s)` +
      `${foraBanco ? `, ${foraBanco} nao atualizada(s)` : ''}` +
      `${erros ? `, ${erros} erro(s)` : ''}.`,
    resultados,
  };
}

// ---------------------------------------------------------------------------
// Etiquetas (organização livre das notas, múltiplas por nota — armazenadas
// separadas por vírgula no campo `etiqueta`)
// ---------------------------------------------------------------------------

type RegistroJson = Record<string, unknown>;

export interface DocumentoPagamentoIcms {
  idLancamentoFront: string;
  tipo: string;
  situacao: string | null;
  codigoDocumento: string | null;
  valor: string | null;
  pago: boolean;
  dataValidade: string | null;
  codigoBarras: string | null;
  total: number | null;
  valorPago: number | null;
  dataPagamento: string | null;
  detalheDae?: unknown;
}

export interface ResultadoPagamentoIcms extends ActionResult {
  statusDae?: string;
  documentos: DocumentoPagamentoIcms[];
  simulacoes: unknown[];
  anexosCriados?: number;
  suspeitasDuplicidade?: number;
}

export interface ConsultaPagamentoIcmsLoteInput {
  notaIds?: number[];
  cnpjId?: number;
  ano?: number;
  limite?: number;
}

export interface ResultadoPagamentoIcmsLoteDetalhe {
  notaId: number;
  chave: string;
  numero: string | null;
  status: 'pago' | 'duplicado' | 'em-aberto' | 'consultado' | 'sem-lancamento' | 'erro';
  detalhe?: string;
}

export interface ResultadoPagamentoIcmsLote extends ActionResult {
  totalElegiveis: number;
  processadas: number;
  atualizadas: number;
  pagas: number;
  emAberto: number;
  consultadas: number;
  semLancamento: number;
  erros: number;
  limiteAplicado: boolean;
  detalhes: ResultadoPagamentoIcmsLoteDetalhe[];
  anexosCriados?: number;
  suspeitasDuplicidade?: number;
  notasComSuspeitaDuplicidade?: number;
}

function registroJson(valor: unknown): RegistroJson {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as RegistroJson : {};
}

function textoJson(valor: unknown): string | null {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function numeroJson(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

function numeroMoedaJson(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor !== 'string' || !valor.trim()) return null;
  const texto = valor.replace(/\s/g, '').replace(/^R\$/i, '');
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function totalDaeDetalheJson(detalheDae: RegistroJson, valorFallback?: unknown): number | null {
  const total = numeroJson(detalheDae.total);
  if (total !== null) return total;

  const principal = numeroJson(detalheDae.valorPrincipal);
  if (principal !== null) {
    return principal +
      (numeroJson(detalheDae.valorMulta) ?? 0) +
      (numeroJson(detalheDae.valorJuros) ?? 0) -
      (numeroJson(detalheDae.valorDesconto) ?? 0);
  }

  return numeroMoedaJson(valorFallback);
}

function idLancamentoPagamento(lancamento: RegistroJson): string | null {
  return textoJson(lancamento.idLancamentoFront) ?? textoJson(lancamento.id);
}

function extrairLancamentosPagamento(detalhe: RegistroJson): RegistroJson[] {
  if (Array.isArray(detalhe.lancamentos)) return detalhe.lancamentos.map(registroJson);
  const notaFiscal = registroJson(detalhe.notaFiscal);
  if (Array.isArray(notaFiscal.lancamentos)) return notaFiscal.lancamentos.map(registroJson);
  return [];
}

function idsDaSimulacaoPagamento(simulacao: unknown): string[] {
  const ids = new Set<string>();
  const raiz = registroJson(simulacao);
  const idRaiz = textoJson(raiz.idLancamento)?.replace(/\D/g, '');
  if (idRaiz) ids.add(idRaiz);

  if (Array.isArray(raiz.lancamento)) {
    for (const item of raiz.lancamento) {
      const id = textoJson(registroJson(item).idLancamento)?.replace(/\D/g, '');
      if (id) ids.add(id);
    }
  }

  return [...ids];
}

const DIAS_RECONSULTA_DAE_NOVO = 30;

function pagamentoIcmsJaConsultado(detalhe: RegistroJson): boolean {
  return !!textoJson(registroJson(detalhe.pagamentoIcms).consultadoEm);
}

function dentroJanelaReconsultaDaeNovo(
  emitidaEm: Date,
  lancamentos: Array<{ vencimento: string | null }>
): boolean {
  const corte = new Date();
  corte.setHours(0, 0, 0, 0);
  corte.setDate(corte.getDate() - DIAS_RECONSULTA_DAE_NOVO);

  const datas = lancamentos
    .map((lancamento) => lancamento.vencimento ? new Date(lancamento.vencimento) : null)
    .filter((data): data is Date => !!data && !Number.isNaN(data.getTime()));

  const referencia = datas.length > 0
    ? new Date(Math.max(...datas.map((data) => data.getTime())))
    : new Date(emitidaEm);

  return !Number.isNaN(referencia.getTime()) && referencia.getTime() >= corte.getTime();
}

function lotesDe<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

function lancamentoAparentementePago(lancamento: RegistroJson, documentos: SitramDocumentoPagamento[]): boolean {
  if (documentos.some((documento) => documento.pago === true || /pago|quitad|baixad|recolhid/i.test(`${documento.tipo ?? ''} ${documento.situacao ?? ''}`))) {
    return true;
  }

  const valor = numeroJson(lancamento.valor) ?? numeroJson(lancamento.icmsDevido) ?? numeroJson(lancamento.icmsCalculado);
  const valorPago = numeroJson(lancamento.valorPago);
  if (valor !== null && valorPago !== null && valor > 0) return valorPago + 0.005 >= valor;
  return /pago|quitad|baixad|recolhid/i.test(`${textoJson(lancamento.siuacaoDescricao) ?? ''} ${textoJson(lancamento.situacaoDescricao) ?? ''} ${textoJson(lancamento.situacao) ?? ''}`);
}

async function enriquecerDocumentosPagamento(
  idLancamentoFront: string,
  documentos: SitramDocumentoPagamento[],
  cacheDetalhes: Map<string, unknown> = new Map()
): Promise<DocumentoPagamentoIcms[]> {
  const codigosParaDetalhar = new Set<string>();

  for (const documento of documentos) {
    const codigo = textoJson(documento.codigoDocumento)?.replace(/\D/g, '');
    if (!codigo) continue;
    if (documento.pago === true || /pago|emitido/i.test(`${documento.tipo ?? ''} ${documento.situacao ?? ''}`)) {
      codigosParaDetalhar.add(codigo);
    }
    if (codigosParaDetalhar.size >= 8) break;
  }

  const detalhes = new Map<string, unknown>();
  for (const codigo of codigosParaDetalhar) {
    try {
      if (!cacheDetalhes.has(codigo)) cacheDetalhes.set(codigo, await consultarDaePorCodigo(codigo));
      detalhes.set(codigo, cacheDetalhes.get(codigo));
    } catch {
      // O documento continua util mesmo sem detalhe/codigo de barras.
    }
  }

  const resultado = documentos.map((documento) => {
    const codigo = textoJson(documento.codigoDocumento)?.replace(/\D/g, '') ?? null;
    const detalheDae = codigo ? detalhes.get(codigo) : undefined;
    const detalhe = registroJson(detalheDae);
    const situacao = textoJson(documento.situacao) ?? textoJson(detalhe.descricaoSituacaoDebito);
    const dataPagamento = textoJson(detalhe.dataPagamento);
    const pago = documento.pago === true || !!dataPagamento || /pago|quitad|baixad|recolhid/i.test(`${documento.tipo ?? ''} ${situacao ?? ''}`);
    const valorDocumento = textoJson(documento.valor);
    const valorNormalizado = numeroMoedaJson(valorDocumento);
    return {
      idLancamentoFront,
      tipo: textoJson(documento.tipo) ?? 'DAE',
      situacao,
      codigoDocumento: codigo,
      valor: valorDocumento,
      pago,
      dataValidade: textoJson(documento.dataValidade) ?? textoJson(detalhe.dataVencimento),
      codigoBarras: textoJson(detalhe.numeracaoCodigoBarras),
      total: valorNormalizado ?? (valorDocumento ? null : totalDaeDetalheJson(detalhe, documento.valor)),
      valorPago: pago ? valorNormalizado ?? numeroJson(detalhe.valorPago) : null,
      dataPagamento,
      detalheDae,
    };
  });
  const mapa = new Map<string, DocumentoPagamentoIcms>();
  for (const documento of resultado) {
    const chave = [
      documento.idLancamentoFront,
      documento.codigoDocumento ?? '',
      documento.tipo,
      documento.valor ?? '',
    ].join('|');
    if (!mapa.has(chave)) mapa.set(chave, documento);
  }
  return [...mapa.values()];
}

function escaparHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatarMoedaHtml(valor: unknown): string {
  const numero = numeroJson(valor);
  if (numero !== null) {
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  return textoJson(valor) ?? '-';
}

function apenasDigitos(valor: unknown): string {
  return String(valor ?? '').replace(/\D/g, '');
}

function formatarDataHtml(valor: string | null | undefined): string {
  if (!valor) return '-';
  const dataIso = valor.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dataIso) return `${dataIso[3]}/${dataIso[2]}/${dataIso[1]}`;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatarLinhaDigitavelDae(valor: unknown): string {
  const digitos = apenasDigitos(valor);
  if (digitos.length === 48) {
    return (digitos.match(/.{1,12}/g) ?? [digitos]).join(' ');
  }
  if (digitos.length === 44) {
    return (digitos.match(/.{1,11}/g) ?? [digitos]).join(' ');
  }
  return textoJson(valor) ?? '';
}

function codigoBarrasDae(valor: unknown): string {
  const digitos = apenasDigitos(valor);
  if (digitos.length === 44) return digitos;
  if (digitos.length === 48) {
    const blocos = digitos.match(/.{12}/g);
    if (blocos?.length === 4) return blocos.map((bloco) => bloco.slice(0, 11)).join('');
  }
  return '';
}

const I25_PATTERNS: Record<string, string> = {
  '0': 'nnwwn',
  '1': 'wnnnw',
  '2': 'nwnnw',
  '3': 'wwnnn',
  '4': 'nnwnw',
  '5': 'wnwnn',
  '6': 'nwwnn',
  '7': 'nnnww',
  '8': 'wnnwn',
  '9': 'nwnwn',
};

function svgCodigoBarrasI25(codigo: string): string {
  const digitos = apenasDigitos(codigo);
  if (!digitos || digitos.length % 2 !== 0) return '';

  const fino = 2;
  const largo = 5;
  const altura = 68;
  let x = 10;
  let barras = '';

  const largura = (marcador: string) => marcador === 'w' ? largo : fino;
  const add = (preto: boolean, w: number) => {
    if (preto) barras += `<rect x="${x}" y="0" width="${w}" height="${altura}" />`;
    x += w;
  };

  add(true, fino);
  add(false, fino);
  add(true, fino);
  add(false, fino);

  for (let i = 0; i < digitos.length; i += 2) {
    const barrasDigito = I25_PATTERNS[digitos[i]];
    const espacosDigito = I25_PATTERNS[digitos[i + 1]];
    if (!barrasDigito || !espacosDigito) return '';
    for (let p = 0; p < 5; p++) {
      add(true, largura(barrasDigito[p]));
      add(false, largura(espacosDigito[p]));
    }
  }

  add(true, largo);
  add(false, fino);
  add(true, fino);
  const larguraTotal = x + 10;

  return `<svg class="barcode-svg" viewBox="0 0 ${larguraTotal} ${altura}" preserveAspectRatio="none" aria-label="Codigo de barras"><rect x="0" y="0" width="${larguraTotal}" height="${altura}" fill="#fff"/>${barras}</svg>`;
}

function montarHtmlDaeEmitido(
  nota: { chave: string; numero: string | null },
  documento: DocumentoPagamentoIcms
): Buffer {
  const detalhe = registroJson(documento.detalheDae);
  const codigo = documento.codigoDocumento ?? textoJson(detalhe.codigoIdentificadorUnico) ?? '-';
  const codigoBarrasBruto = documento.codigoBarras ?? textoJson(detalhe.numeracaoCodigoBarras) ?? '';
  const linhaDigitavel = formatarLinhaDigitavelDae(codigoBarrasBruto);
  const codigoBarras = codigoBarrasDae(codigoBarrasBruto);
  const barcodeSvg = svgCodigoBarrasI25(codigoBarras);
  const receita = [
    textoJson(detalhe.codigoReceitaCodigo),
    textoJson(detalhe.codigoReceitaDescricao),
  ].filter(Boolean).join(' - ') || documento.tipo || 'DAE';
  const status = documento.situacao ?? textoJson(detalhe.descricaoSituacaoDebito) ?? '-';
  const vencimento = documento.dataValidade ?? textoJson(detalhe.dataVencimento);
  const pagamento = textoJson(detalhe.dataPagamento);
  const total = totalDaeDetalheJson(detalhe, documento.valor) ?? documento.total ?? documento.valor;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>DAE SITRAM ${escaparHtml(codigo)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f3f4f6;color:#111827}
    .page{width:860px;max-width:100%;margin:24px auto;background:#fff;border:1px solid #111827}
    .top{display:grid;grid-template-columns:1fr 180px;border-bottom:2px solid #111827}
    .brand{padding:14px 16px}
    .brand h1{font-size:18px;margin:0;text-transform:uppercase;letter-spacing:.04em}
    .brand p{margin:4px 0 0;color:#4b5563;font-size:12px}
    .doc-code{border-left:1px solid #111827;padding:10px 12px;text-align:center}
    .doc-code .label{font-size:10px;color:#4b5563;text-transform:uppercase}
    .doc-code .value{font-size:18px;font-weight:800;margin-top:4px}
    .notice{padding:8px 16px;border-bottom:1px solid #111827;background:#fef3c7;font-size:11px;color:#78350f}
    .section-title{background:#111827;color:#fff;font-size:11px;font-weight:800;text-transform:uppercase;padding:6px 10px}
    .grid{display:grid;grid-template-columns:150px 1fr 140px 1fr;border-bottom:1px solid #111827}
    .cell{min-height:46px;padding:7px 9px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db}
    .cell:nth-child(4n){border-right:0}
    .label{font-size:9px;text-transform:uppercase;color:#6b7280;margin-bottom:3px}
    .value{font-size:13px;font-weight:700;word-break:break-word}
    .wide{grid-column:span 3}
    .full{grid-column:1/-1}
    .money{font-size:18px}
    .barcode-box{padding:14px 16px 16px;border-bottom:1px dashed #111827}
    .linha{font-family:"Courier New",monospace;font-size:17px;font-weight:800;letter-spacing:.02em;text-align:center;word-break:break-all;margin:4px 0 12px}
    .barcode-svg{width:100%;height:78px;display:block;border:1px solid #d1d5db;background:#fff}
    .barcode-num{font-family:"Courier New",monospace;font-size:12px;text-align:center;margin-top:7px;word-break:break-all}
    .receipt{display:grid;grid-template-columns:1fr 220px;border-top:1px solid #111827}
    .receipt .left{padding:14px 16px}
    .receipt .right{border-left:1px solid #111827;padding:14px 16px;min-height:82px}
    .small{font-size:11px;color:#4b5563;margin:0}
    @media print{body{background:#fff}.page{margin:0;border-color:#000;width:100%}.notice{background:#fff;border-bottom:1px solid #000;color:#111827}}
  </style>
</head>
<body>
  <section class="page">
    <div class="top">
      <div class="brand">
        <h1>Documento de Arrecadacao Estadual - DAE SITRAM</h1>
        <p>Espelho operacional gerado pelo DanfeCollector a partir dos dados retornados pelo SITRAM.</p>
      </div>
      <div class="doc-code">
        <div class="label">Codigo DAE</div>
        <div class="value">${escaparHtml(codigo)}</div>
      </div>
    </div>
    <div class="notice">Este HTML nao substitui o DAE oficial da SEFAZ/SITRAM. Use para conferencia interna, impressao e leitura do codigo informado pelo SITRAM.</div>

    <div class="section-title">Recibo do contribuinte</div>
    <div class="grid">
      <div class="cell"><div class="label">Nota fiscal</div><div class="value">${escaparHtml(nota.numero ?? '-')}</div></div>
      <div class="cell wide"><div class="label">Chave NF-e</div><div class="value">${escaparHtml(nota.chave)}</div></div>
      <div class="cell"><div class="label">Receita</div><div class="value">${escaparHtml(receita)}</div></div>
      <div class="cell"><div class="label">Situacao</div><div class="value">${escaparHtml(status)}</div></div>
      <div class="cell"><div class="label">Vencimento</div><div class="value">${escaparHtml(formatarDataHtml(vencimento))}</div></div>
      <div class="cell"><div class="label">Valor</div><div class="value money">${escaparHtml(formatarMoedaHtml(total))}</div></div>
      <div class="cell"><div class="label">Pagamento</div><div class="value">${escaparHtml(formatarDataHtml(pagamento))}</div></div>
      <div class="cell wide"><div class="label">Identificacao</div><div class="value">${escaparHtml(textoJson(detalhe.descricaoIdentificacaoContribuinte) ?? '-')}</div></div>
    </div>

    <div class="section-title">Ficha de pagamento</div>
    <div class="barcode-box">
      <div class="label">Linha digitavel</div>
      <div class="linha">${escaparHtml(linhaDigitavel || '-')}</div>
      ${barcodeSvg || '<p class="small">Codigo de barras visual indisponivel para a numeracao retornada.</p>'}
      ${codigoBarras ? `<div class="barcode-num">${escaparHtml(codigoBarras)}</div>` : ''}
    </div>
    <div class="receipt">
      <div class="left">
        <p class="small">Autenticacao mecanica</p>
      </div>
      <div class="right">
        <p class="small">Uso interno / controle</p>
      </div>
    </div>
  </section>
</body>
</html>`;

  return Buffer.from(html, 'utf8');
}

async function anexarDaesEmitidosSeNovo(
  nota: { id: number; chave: string; numero: string | null },
  documentos: DocumentoPagamentoIcms[],
  criadoPor: string
): Promise<number> {
  let criados = 0;
  for (const documento of documentos) {
    const codigo = documento.codigoDocumento?.replace(/\D/g, '');
    if (!codigo) continue;

    const arquivoNome = `dae-sitram-${codigo}.html`;
    const jaExiste = await prisma.anexo.findFirst({
      where: { notaId: nota.id, arquivoNome },
      select: { id: true, caminho: true, storageKey: true },
    });

    const bytes = montarHtmlDaeEmitido(nota, documento);
    const arquivoSalvo = await salvarArquivoComFallback(nota.id, 'text/html', bytes);
    if (jaExiste) {
      await prisma.anexo.update({
        where: { id: jaExiste.id },
        data: {
          tamanho: bytes.length,
          caminho: arquivoSalvo.caminho,
          storageKey: arquivoSalvo.storageKey,
        },
      });
      await apagarArquivo(jaExiste.caminho, jaExiste.storageKey);
      continue;
    }

    await prisma.anexo.create({
      data: {
        notaId: nota.id,
        nome: `DAE SITRAM emitido ${codigo}`,
        arquivoNome,
        mime: 'text/html',
        tamanho: bytes.length,
        caminho: arquivoSalvo.caminho,
        storageKey: arquivoSalvo.storageKey,
        criadoPor,
      },
    });
    criados++;
  }
  return criados;
}

export async function consultarPagamentoIcmsNota(notaId: number): Promise<ResultadoPagamentoIcms> {
  let usuario;
  try {
    usuario = await exigirUsuario();
  } catch (error: unknown) {
    return { success: false, message: (error as Error).message, documentos: [], simulacoes: [] };
  }

  let nota = await prisma.notaFiscal.findUnique({
    where: { id: notaId },
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });
  if (!nota) return { success: false, message: 'Nota nao encontrada.', documentos: [], simulacoes: [] };
  if (!usuarioPodeAcessarCnpj(usuario, nota.cnpjId)) {
    return { success: false, message: 'Acesso negado para esta nota.', documentos: [], simulacoes: [] };
  }

  let detalhe = registroJson(nota.sitramDetalhe ? JSON.parse(nota.sitramDetalhe) : {});
  let lancamentos = Array.isArray(detalhe.lancamentos) ? detalhe.lancamentos.map(registroJson) : [];

  if (lancamentos.length === 0) {
    await salvarRetornoSitramPorNfe(nota.chave);
    nota = await prisma.notaFiscal.findUnique({
      where: { id: notaId },
      include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
    });
    if (!nota) return { success: false, message: 'Nota nao encontrada apos reconsulta SITRAM.', documentos: [], simulacoes: [] };
    detalhe = registroJson(nota?.sitramDetalhe ? JSON.parse(nota.sitramDetalhe) : {});
    lancamentos = Array.isArray(detalhe.lancamentos) ? detalhe.lancamentos.map(registroJson) : [];
  }

  const idsLancamento = [...new Set(lancamentos.map(idLancamentoPagamento).filter((id): id is string => !!id))];
  if (idsLancamento.length === 0) {
    return { success: false, message: 'A NF nao tem lancamento SITRAM com id para consultar pagamento.', documentos: [], simulacoes: [] };
  }

  const documentosPorLancamento = await consultarDocumentosDaeBatch(idsLancamento);
  const documentosEnriquecidos: DocumentoPagamentoIcms[] = [];
  const idsEmAberto: string[] = [];

  for (const lancamento of lancamentos) {
    const id = idLancamentoPagamento(lancamento);
    if (!id) continue;
    const documentos = documentosPorLancamento[id] ?? [];
    const enriquecidos = await enriquecerDocumentosPagamento(id, documentos);
    documentosEnriquecidos.push(...enriquecidos);
    if (!lancamentoAparentementePago(lancamento, documentos)) idsEmAberto.push(id);
  }

  const simulacoes = idsEmAberto.length > 0 ? await simularDaeNotaFiscal(idsEmAberto).catch(() => []) : [];
  const suspeitasDuplicidade = detectarSuspeitasPagamentoDuplicadoIcms(documentosEnriquecidos);
  const lancamentosAtualizados = lancamentos.map((lancamento) => {
    const id = idLancamentoPagamento(lancamento);
    const documentos = id ? documentosEnriquecidos.filter((documento) => documento.idLancamentoFront === id) : [];
    return {
      ...lancamento,
      documentosPagamento: documentos,
      documentosPagamentoConsultadosEm: new Date().toISOString(),
    };
  });

  const detalheAtualizado = {
    ...detalhe,
    lancamentos: lancamentosAtualizados,
    pagamentoIcms: {
      consultadoEm: new Date().toISOString(),
      status: '',
      documentos: documentosEnriquecidos,
      simulacoes,
      suspeitasDuplicidade,
      origem: 'api-pagamento',
    },
  };
  const statusAtualizado = statusDaeEfetivo({
    sitramDetalhe: JSON.stringify(detalheAtualizado),
    sitramDaeStatus: nota.sitramDaeStatus,
    sitramDaeResumo: nota.sitramDaeResumo,
    pagamentoManualEm: nota.pagamentoManualEm,
  }) || (simulacoes.length > 0 ? 'EM_ABERTO' : 'CONSULTADO');
  detalheAtualizado.pagamentoIcms.status = statusAtualizado;

  await prisma.notaFiscal.update({
    where: { id: notaId },
    data: {
      sitramConsultadaEm: new Date(),
      sitramDaeStatus: statusAtualizado,
      sitramDetalhe: JSON.stringify(detalheAtualizado),
    },
  });
  const anexosCriados = await anexarDaesEmitidosSeNovo(nota, documentosEnriquecidos, usuario.login);

  revalidatePath('/');

  const pagos = documentosEnriquecidos.filter((documento) => documento.pago).length;
  const emitidos = documentosEnriquecidos.filter((documento) => /emitido/i.test(documento.tipo)).length;
  const resumoDocs = documentosEnriquecidos.length
    ? `${pagos} pago(s), ${emitidos} emitido(s)`
    : 'nenhum DAE emitido ainda';
  const resumoAnexos = anexosCriados > 0 ? `, ${anexosCriados} anexo(s) DAE criado(s)` : '';
  const resumoDuplicidade = suspeitasDuplicidade.length > 0
    ? `, ${suspeitasDuplicidade.length} suspeita(s) de pagamento duplicado`
    : '';

  return {
    success: true,
    message: `Pagamento ICMS consultado: ${textoDaeSitramInterno(statusAtualizado)} (${resumoDocs}${resumoAnexos}${resumoDuplicidade}).`,
    statusDae: statusAtualizado,
    documentos: documentosEnriquecidos,
    simulacoes,
    anexosCriados,
    suspeitasDuplicidade: suspeitasDuplicidade.length,
  };
}

export async function consultarPagamentoIcmsLote(input: ConsultaPagamentoIcmsLoteInput = {}): Promise<ResultadoPagamentoIcmsLote> {
  let usuario;
  try {
    usuario = await exigirUsuario();
  } catch (error: unknown) {
    return {
      success: false,
      message: (error as Error).message,
      totalElegiveis: 0,
      processadas: 0,
      atualizadas: 0,
      pagas: 0,
      emAberto: 0,
      consultadas: 0,
      semLancamento: 0,
      erros: 0,
      limiteAplicado: false,
      detalhes: [],
    };
  }

  const idsFiltro = [...new Set((input.notaIds ?? []).filter((id) => Number.isInteger(id) && id > 0))];
  const limite = input.limite === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.min(Math.max(Math.floor(input.limite), 1), 5000);
  const where: Prisma.NotaFiscalWhereInput = {
    ...whereNotaPermitida(usuario),
    sitramDetalhe: { not: null },
    situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
    OR: [
      { sitramDaeStatus: null },
      { sitramDaeStatus: { notIn: ['SEM_DAE', 'NAO_ENCONTRADA'] } },
    ],
  };

  if (idsFiltro.length > 0) where.id = { in: idsFiltro };
  if (input.cnpjId && Number.isInteger(input.cnpjId)) {
    if (!usuarioPodeAcessarCnpj(usuario, input.cnpjId)) {
      return {
        success: false,
        message: 'Acesso negado para esta empresa.',
        totalElegiveis: 0,
        processadas: 0,
        atualizadas: 0,
        pagas: 0,
        emAberto: 0,
        consultadas: 0,
        semLancamento: 0,
        erros: 0,
        limiteAplicado: false,
        detalhes: [],
      };
    }
    where.cnpjId = input.cnpjId;
  }
  if (input.ano && Number.isInteger(input.ano)) {
    where.emitidaEm = {
      gte: new Date(input.ano, 0, 1),
      lt: new Date(input.ano + 1, 0, 1),
    };
  }

  const notas = await prisma.notaFiscal.findMany({
    where,
    orderBy: { emitidaEm: 'desc' },
    select: {
      id: true,
      chave: true,
      numero: true,
      emitidaEm: true,
      sitramDaeStatus: true,
      sitramDaeResumo: true,
      sitramDetalhe: true,
      pagamentoManualEm: true,
    },
  });

  const elegiveis = notas.flatMap((nota) => {
    let detalhe: RegistroJson;
    try {
      detalhe = registroJson(nota.sitramDetalhe ? JSON.parse(nota.sitramDetalhe) : {});
    } catch {
      return [];
    }

    const lancamentos = extrairLancamentosPagamento(detalhe);
    if (lancamentos.length === 0) return [];

    const resumo = extrairResumoDae(nota);
    const lancamentosComId: Array<{
      id: string;
      normalizado: ReturnType<typeof extrairResumoDae>['lancamentos'][number] | undefined;
    }> = [];

    for (let indice = 0; indice < lancamentos.length; indice++) {
      const lancamento = lancamentos[indice];
      const id = idLancamentoPagamento(lancamento)?.replace(/\D/g, '') ?? null;
      if (!id) continue;
      const normalizado = resumo.lancamentos[indice];
      if (normalizado && lancamentosVisiveisDae([normalizado]).length === 0) continue;
      lancamentosComId.push({ id, normalizado });
    }

    if (lancamentosComId.length === 0) return [];
    const lancamentosNormalizados = lancamentosComId
      .map((item) => item.normalizado)
      .filter((lancamento): lancamento is ReturnType<typeof extrairResumoDae>['lancamentos'][number] => !!lancamento);
    const ids = lancamentosComId.map((item) => item.id);
    const daePago = statusDaeEfetivo(nota) === 'PAGO' ||
      !!nota.pagamentoManualEm ||
      (lancamentosNormalizados.length > 0 && lancamentosNormalizados.every((lancamento) => lancamento.pago));
    const consultado = pagamentoIcmsJaConsultado(detalhe);
    const podeReconsultarDaeNovo = dentroJanelaReconsultaDaeNovo(nota.emitidaEm, lancamentosNormalizados);

    if (daePago && consultado && !podeReconsultarDaeNovo) return [];

    const primeiroVencimento = lancamentosNormalizados
      .map((lancamento) => lancamento.vencimento)
      .filter((vencimento): vencimento is string => !!vencimento)
      .sort()[0] ?? '9999-12-31';

    return [{ nota, detalhe, lancamentos, ids: [...new Set(ids)], primeiroVencimento, daePago }];
  }).sort((a, b) => {
    if (a.daePago !== b.daePago) return a.daePago ? 1 : -1;
    return a.primeiroVencimento.localeCompare(b.primeiroVencimento);
  });

  const totalElegiveis = elegiveis.length;
  const selecionadas = elegiveis.slice(0, limite);
  const limiteAplicado = input.limite !== undefined && totalElegiveis > selecionadas.length;

  if (selecionadas.length === 0) {
    return {
      success: true,
      message: 'Nenhuma NF com DAE pendente de consulta de pagamento.',
      totalElegiveis,
      processadas: 0,
      atualizadas: 0,
      pagas: 0,
      emAberto: 0,
      consultadas: 0,
      semLancamento: notas.length,
      erros: 0,
      limiteAplicado: false,
      detalhes: [],
    };
  }

  const idsLancamento = [...new Set(selecionadas.flatMap((item) => item.ids))];
  const documentosPorLancamento: Record<string, SitramDocumentoPagamento[]> = {};

  for (const lote of lotesDe(idsLancamento, 80)) {
    const documentos = await consultarDocumentosDaeBatch(lote);
    Object.assign(documentosPorLancamento, documentos);
  }

  const documentosEnriquecidosPorId = new Map<string, DocumentoPagamentoIcms[]>();
  const cacheDetalhesDae = new Map<string, unknown>();
  for (const id of idsLancamento) {
    documentosEnriquecidosPorId.set(
      id,
      await enriquecerDocumentosPagamento(id, documentosPorLancamento[id] ?? [], cacheDetalhesDae)
    );
  }

  const idsEmAberto = [...new Set(selecionadas.flatMap((item) =>
    item.lancamentos
      .map((lancamento) => {
        const id = idLancamentoPagamento(lancamento)?.replace(/\D/g, '') ?? null;
        if (!id || !item.ids.includes(id)) return null;
        return lancamentoAparentementePago(lancamento, documentosPorLancamento[id] ?? []) ? null : id;
      })
      .filter((id): id is string => !!id)
  ))];

  const simulacoesTodas: unknown[] = [];
  for (const lote of lotesDe(idsEmAberto, 30)) {
    try {
      simulacoesTodas.push(...await simularDaeNotaFiscal(lote));
    } catch {
      // A simulacao ajuda o boleto futuro, mas a consulta de documentos continua valida sem ela.
    }
  }

  const idsPorSimulacao = new Map<unknown, string[]>();
  for (const simulacao of simulacoesTodas) idsPorSimulacao.set(simulacao, idsDaSimulacaoPagamento(simulacao));

  const detalhes: ResultadoPagamentoIcmsLoteDetalhe[] = [];
  let atualizadas = 0;
  let pagas = 0;
  let emAberto = 0;
  let consultadas = 0;
  let erros = 0;
  let anexosCriados = 0;
  let suspeitasDuplicidadeTotal = 0;
  let notasComSuspeitaDuplicidade = 0;

  for (const item of selecionadas) {
    try {
      const documentosEnriquecidos = item.ids.flatMap((id) => documentosEnriquecidosPorId.get(id) ?? []);
      const simulacoes = simulacoesTodas.filter((simulacao) => {
        const ids = idsPorSimulacao.get(simulacao) ?? [];
        return ids.some((id) => item.ids.includes(id));
      });
      const suspeitasDuplicidade = detectarSuspeitasPagamentoDuplicadoIcms(documentosEnriquecidos);
      if (suspeitasDuplicidade.length > 0) {
        suspeitasDuplicidadeTotal += suspeitasDuplicidade.length;
        notasComSuspeitaDuplicidade++;
      }
      const agoraIso = new Date().toISOString();
      const lancamentosAtualizados = item.lancamentos.map((lancamento) => {
        const id = idLancamentoPagamento(lancamento)?.replace(/\D/g, '') ?? null;
        const documentos = id ? documentosEnriquecidos.filter((documento) => documento.idLancamentoFront === id) : [];
        return {
          ...lancamento,
          documentosPagamento: documentos,
          documentosPagamentoConsultadosEm: agoraIso,
        };
      });

      const detalheAtualizado = {
        ...item.detalhe,
        lancamentos: lancamentosAtualizados,
        pagamentoIcms: {
          consultadoEm: agoraIso,
          status: '',
          documentos: documentosEnriquecidos,
          simulacoes,
          suspeitasDuplicidade,
          origem: 'api-pagamento-lote',
        },
      };
      const statusAtualizado = statusDaeEfetivo({
        sitramDetalhe: JSON.stringify(detalheAtualizado),
        sitramDaeStatus: item.nota.sitramDaeStatus,
        sitramDaeResumo: item.nota.sitramDaeResumo,
        pagamentoManualEm: item.nota.pagamentoManualEm,
      }) || (simulacoes.length > 0 ? 'EM_ABERTO' : 'CONSULTADO');
      detalheAtualizado.pagamentoIcms.status = statusAtualizado;

      await prisma.notaFiscal.update({
        where: { id: item.nota.id },
        data: {
          sitramConsultadaEm: new Date(),
          sitramDaeStatus: statusAtualizado,
          sitramDetalhe: JSON.stringify(detalheAtualizado),
        },
      });
      anexosCriados += await anexarDaesEmitidosSeNovo(item.nota, documentosEnriquecidos, usuario.login);

      atualizadas++;
      if (statusAtualizado === 'PAGO') pagas++;
      else if (statusAtualizado === 'EM_ABERTO') emAberto++;
      else consultadas++;

      detalhes.push({
        notaId: item.nota.id,
        chave: item.nota.chave,
        numero: item.nota.numero,
        status: suspeitasDuplicidade.length > 0
          ? 'duplicado'
          : statusAtualizado === 'PAGO'
            ? 'pago'
            : statusAtualizado === 'EM_ABERTO'
              ? 'em-aberto'
              : 'consultado',
        detalhe: suspeitasDuplicidade.length > 0
          ? `${textoDaeSitramInterno(statusAtualizado)} - ${suspeitasDuplicidade.length} suspeita(s) de duplicidade`
          : textoDaeSitramInterno(statusAtualizado),
      });
    } catch (error: unknown) {
      erros++;
      detalhes.push({
        notaId: item.nota.id,
        chave: item.nota.chave,
        numero: item.nota.numero,
        status: 'erro',
        detalhe: (error as Error).message,
      });
    }
  }

  revalidatePath('/');

  return {
    success: erros === 0,
    message:
      `Consulta pagamento ICMS em lote: ${selecionadas.length}/${totalElegiveis} NF(s) com DAE processada(s), ` +
      `${pagas} paga(s), ${emAberto} em aberto, ${erros} erro(s), ${anexosCriados} anexo(s) DAE` +
      `${suspeitasDuplicidadeTotal > 0 ? `, ${notasComSuspeitaDuplicidade} NF(s) com suspeita de duplicidade` : ''}` +
      `${limiteAplicado ? `. Limite desta rodada: ${limite}; execute novamente para o restante.` : '.'}`,
    totalElegiveis,
    processadas: selecionadas.length,
    atualizadas,
    pagas,
    emAberto,
    consultadas,
    semLancamento: Math.max(0, notas.length - totalElegiveis),
    erros,
    limiteAplicado,
    detalhes: detalhes.slice(0, 80),
    anexosCriados,
    suspeitasDuplicidade: suspeitasDuplicidadeTotal,
    notasComSuspeitaDuplicidade,
  };
}

function textoDaeSitramInterno(status: string): string {
  if (status === 'PAGO') return 'pago';
  if (status === 'EM_ABERTO') return 'em aberto';
  if (status === 'SEM_DAE') return 'sem DAE';
  return status.toLowerCase();
}

export async function alternarEtiqueta(notaId: number, etiqueta: string): Promise<ActionResult> {
  const negado = await checarUsuarioAction();
  if (negado) return negado;

  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
  if (!nota) return { success: false, message: 'Nota não encontrada.' };

  const atuais = (nota.etiqueta ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const idx = atuais.indexOf(etiqueta);
  if (idx >= 0) atuais.splice(idx, 1);
  else atuais.push(etiqueta);

  try {
    await prisma.notaFiscal.update({
      where: { id: notaId },
      data: { etiqueta: atuais.length > 0 ? atuais.join(',') : null },
    });
    revalidatePath('/');
    return {
      success: true,
      message: idx >= 0 ? `Etiqueta "${etiqueta}" removida.` : `Etiqueta "${etiqueta}" adicionada.`,
    };
  } catch (error: unknown) {
    return { success: false, message: `Erro ao salvar etiqueta: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Manifestação em lote (Ciência da Operação para várias notas de uma vez)
// ---------------------------------------------------------------------------

export type StatusManifestoLote = 'manifestada' | 'ja-manifestada' | 'completa' | 'erro';

export interface ResultadoManifestoLote {
  notaId: number;
  chave: string;
  status: StatusManifestoLote;
  detalhe?: string;
}

/**
 * Manifesta (Ciência da Operação) várias notas de uma vez. Antes de cada
 * manifestação, verifica se a nota já está COMPLETA ou já tem manifestadaEm
 * registrada — a SEFAZ só aceita a Ciência uma única vez por nota.
 */
export async function manifestarNotasLote(notaIds: number[]): Promise<ResultadoManifestoLote[]> {
  try {
    await exigirUsuario();
  } catch (error: unknown) {
    return notaIds.map((notaId) => ({
      notaId,
      chave: '',
      status: 'erro',
      detalhe: (error as Error).message,
    }));
  }

  const resultados: ResultadoManifestoLote[] = [];
  const cnpjsAfetados = new Set<number>();

  for (const notaId of notaIds) {
    const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId }, include: { cnpj: true } });
    if (!nota) {
      resultados.push({ notaId, chave: '', status: 'erro', detalhe: 'Nota não encontrada' });
      continue;
    }
    if (nota.status === 'COMPLETA') {
      resultados.push({ notaId, chave: nota.chave, status: 'completa' });
      continue;
    }
    if (nota.manifestadaEm) {
      resultados.push({ notaId, chave: nota.chave, status: 'ja-manifestada' });
      continue;
    }

    try {
      const r = await manifestar(nota.cnpj.cnpj, nota.chave);
      if (!r.ok) {
        resultados.push({ notaId, chave: nota.chave, status: 'erro', detalhe: `cStat ${r.cStat}: ${r.xMotivo}` });
        continue;
      }
      await prisma.notaFiscal.update({ where: { id: notaId }, data: { manifestadaEm: new Date() } });
      cnpjsAfetados.add(nota.cnpjId);
      resultados.push({ notaId, chave: nota.chave, status: 'manifestada' });
    } catch (error: unknown) {
      resultados.push({ notaId, chave: nota.chave, status: 'erro', detalhe: (error as Error).message });
    }
  }

  // Libera a consulta e sincroniza uma vez por CNPJ afetado, para tentar baixar o XML completo
  for (const cnpjId of cnpjsAfetados) {
    await prisma.cnpj.update({ where: { id: cnpjId }, data: { bloqueadoAte: null } });
    await sincronizarNotas(cnpjId);
  }

  revalidatePath('/');
  return resultados;
}

// ===== Importação da relação de pagamento SITRAM (marcar DAE pago em lote) =====

export interface NotaPagamentoPreview {
  id: number;
  numero: string | null;
  cnpj: string; // CNPJ do emitente (14 díg.)
  emitente: string | null;
  valorAberto: number;
  jaPago: boolean;
}

export interface PreviewPagamentoSitram {
  ok: boolean;
  message?: string;
  totalLancamentos: number;
  encontradas: NotaPagamentoPreview[];
  naoEncontradas: { cnpj: string; numero: string }[];
}

async function extrairTextoPdf(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const res = await parser.getText();
  return res.text ?? '';
}

function valorAbertoDae(nota: {
  sitramDaeStatus: string | null;
  sitramDaeResumo: string | null;
  sitramDetalhe: string | null;
}): number {
  const resumo = extrairResumoDae(nota);
  return resumo.lancamentos.reduce((total, l) => total + (l.pago ? 0 : (l.valorAberto ?? 0)), 0);
}

export async function previewPagamentoSitram(formData: FormData): Promise<PreviewPagamentoSitram> {
  await exigirUsuario();
  const arquivos = formData.getAll('arquivo').filter((arquivo): arquivo is File => arquivo instanceof File && arquivo.size > 0);
  if (arquivos.length === 0) {
    return { ok: false, message: 'Selecione o PDF da relação.', totalLancamentos: 0, encontradas: [], naoEncontradas: [] };
  }
  if (arquivos.some((arquivo) => arquivo.type && arquivo.type !== 'application/pdf')) {
    return { ok: false, message: 'Envie um arquivo PDF.', totalLancamentos: 0, encontradas: [], naoEncontradas: [] };
  }

  const textos: string[] = [];
  try {
    for (const arquivo of arquivos) {
      textos.push(await extrairTextoPdf(Buffer.from(await arquivo.arrayBuffer())));
    }
  } catch (e) {
    return { ok: false, message: `Falha ao ler o PDF: ${(e as Error).message}`, totalLancamentos: 0, encontradas: [], naoEncontradas: [] };
  }

  const lancamentos = textos.flatMap((texto) => parseRelacaoPagamentoSitram(texto));
  if (lancamentos.length === 0) {
    return { ok: false, message: 'Não reconheci nenhum lançamento no PDF. Use a relação SITRAM ou DAE/boleto com NOTAS FISCAIS.', totalLancamentos: 0, encontradas: [], naoEncontradas: [] };
  }

  const notas = await prisma.notaFiscal.findMany({
    select: {
      id: true, chave: true, numero: true, emitenteCnpj: true, emitenteNome: true,
      sitramDaeStatus: true, sitramDaeResumo: true, sitramDetalhe: true, pagamentoManualEm: true,
    },
  });

  // Indexa por (CNPJ emitente + número). Usa os campos gravados E os extraídos
  // da chave de acesso — notas RESUMO não têm `numero`, mas têm a chave.
  const mapa = new Map<string, typeof notas>();
  const mapaPorNumero = new Map<string, typeof notas>();
  for (const n of notas) {
    const chaves = new Set<string>();
    const numeros = new Set<string>();
    if (n.numero) {
      chaves.add(chaveCruzamento(n.emitenteCnpj, n.numero));
      numeros.add(String(Number(n.numero) || ''));
    }
    const daChave = extrairDaChave(n.chave);
    if (daChave) {
      chaves.add(`${daChave.cnpj}-${daChave.numero}`);
      numeros.add(daChave.numero);
    }
    for (const k of chaves) {
      const grupo = mapa.get(k) ?? [];
      grupo.push(n);
      mapa.set(k, grupo);
    }
    for (const numero of numeros) {
      if (!numero) continue;
      const grupo = mapaPorNumero.get(numero) ?? [];
      grupo.push(n);
      mapaPorNumero.set(numero, grupo);
    }
  }

  const encontradas: NotaPagamentoPreview[] = [];
  const naoEncontradas: { cnpj: string; numero: string }[] = [];
  const idsVistos = new Set<number>();

  for (const l of lancamentos) {
    const grupo = l.cnpjEmitente
      ? mapa.get(`${l.cnpjEmitente}-${l.numeroNota}`)
      : mapaPorNumero.get(l.numeroNota);
    if (!grupo || grupo.length === 0) {
      naoEncontradas.push({ cnpj: l.cnpjEmitente, numero: l.numeroNota });
      continue;
    }
    for (const n of grupo) {
      if (idsVistos.has(n.id)) continue;
      idsVistos.add(n.id);
      encontradas.push({
        id: n.id,
        numero: n.numero ?? l.numeroNota,
        cnpj: n.emitenteCnpj ?? l.cnpjEmitente,
        emitente: n.emitenteNome,
        valorAberto: valorAbertoDae(n),
        jaPago: !!n.pagamentoManualEm,
      });
    }
  }

  return { ok: true, totalLancamentos: lancamentos.length, encontradas, naoEncontradas };
}

export async function aplicarPagamentoSitram(
  notaIds: number[],
  referencia: string
): Promise<ActionResult> {
  await exigirUsuario();
  const ids = notaIds.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { success: false, message: 'Nenhuma nota para marcar.' };

  await prisma.notaFiscal.updateMany({
    where: { id: { in: ids } },
    data: {
      pagamentoManualEm: new Date(),
      pagamentoManualRef: referencia.trim() || null,
    },
  });

  revalidatePath('/');
  return { success: true, message: `${ids.length} nota(s) marcada(s) como pagas.` };
}

export async function anexarComprovanteLote(
  notaIds: number[],
  formData: FormData
): Promise<ActionResult> {
  const usuario = await exigirUsuario();
  const ids = notaIds.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { success: false, message: 'Nenhuma nota selecionada.' };

  const arquivo = formData.get('comprovante');
  const nome = String(formData.get('nome') ?? '').trim() || 'Comprovante de pagamento';
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { success: false, message: 'Selecione o comprovante.' };
  }
  if (arquivo.size > TAMANHO_MAX) {
    return { success: false, message: `Comprovante muito grande (máx. ${Math.round(TAMANHO_MAX / 1024 / 1024)} MB).` };
  }
  if (!mimeAceito(arquivo.type)) {
    return { success: false, message: `Tipo não aceito (${arquivo.type || 'desconhecido'}).` };
  }

  const bytes = Buffer.from(await arquivo.arrayBuffer());
  for (const notaId of ids) {
    const arquivoSalvo = await salvarArquivoComFallback(notaId, arquivo.type, bytes);
    await prisma.anexo.create({
      data: {
        notaId,
        nome,
        arquivoNome: arquivo.name,
        mime: arquivo.type,
        tamanho: arquivo.size,
        caminho: arquivoSalvo.caminho,
        storageKey: arquivoSalvo.storageKey,
        criadoPor: usuario.login,
      },
    });
  }

  revalidatePath('/');
  return { success: true, message: `Comprovante anexado a ${ids.length} nota(s).` };
}
