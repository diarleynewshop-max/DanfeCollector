'use server';

import { revalidatePath } from 'next/cache';
import * as tls from 'tls';
import * as fs from 'fs';
import { prisma } from './prisma';
import { carregarCertificado } from './sefaz/certificado';
import { consultarDistribuicaoDFe, consultarPorChave } from './sefaz/distribuicao';
import { processarDocumento, interpretarEventoCiencia } from './sefaz/documentos';
import { parseDanfe, type DanfeData } from './sefaz/detalhe';
import { manifestar } from './sefaz/manifestacao';
import { listarCertificadosWindows, type CertificadoWindows } from './sefaz/certstore';

export interface ActionResult {
  success: boolean;
  message: string;
  data?: string;
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
  try {
    const { pfx, passphrase } = carregarCertificado();
    // createSecureContext valida o PFX e a senha sem precisar de conexão
    tls.createSecureContext({ pfx, passphrase });
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

// ---------------------------------------------------------------------------
// CRUD de CNPJs
// ---------------------------------------------------------------------------

export async function listarCnpjs() {
  return prisma.cnpj.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { notas: true } } },
  });
}

export async function adicionarCnpj(formData: FormData): Promise<ActionResult> {
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
    await prisma.cnpj.create({ data: { cnpj, razaoSocial, uf } });
    revalidatePath('/');
    return { success: true, message: `CNPJ ${formatarCnpj(cnpj)} cadastrado com sucesso.` };
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2002') {
      return { success: false, message: `O CNPJ ${formatarCnpj(cnpj)} já está cadastrado.` };
    }
    return { success: false, message: `Erro ao salvar CNPJ: ${(error as Error).message}` };
  }
}

export async function alternarAtivoCnpj(id: number): Promise<ActionResult> {
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
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export async function sincronizarNotas(cnpjId: number): Promise<ActionResult> {
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

          const nota = processarDocumento(doc, registro.cnpj);
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
  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId } });
  if (!nota) return { ok: false, message: 'Nota não encontrada.' };
  if (nota.status !== 'COMPLETA') {
    return {
      ok: false,
      message: 'Esta nota ainda é um RESUMO. Faça a manifestação (Ciência da Operação) para liberar o XML completo com itens e DANFE.',
    };
  }
  if (!nota.xmlPath || !fs.existsSync(nota.xmlPath)) {
    return { ok: false, message: 'Arquivo XML da nota não encontrado no disco.' };
  }

  const danfe = parseDanfe(fs.readFileSync(nota.xmlPath, 'utf8'));
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
  const nota = processarDocumento(doc, cnpjInteressado);
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
  return {
    success: true,
    message: `${arquivos.length} XML(s) lidos: ${novas} nota(s) importada(s), ${cont.jaTinha} já existia(m), ${cont.semEmpresa} sem empresa cadastrada.`,
    contagem: cont,
  };
}

export async function listarNotas() {
  return prisma.notaFiscal.findMany({
    orderBy: { emitidaEm: 'desc' },
    take: 2000,
    include: { cnpj: { select: { cnpj: true, razaoSocial: true } } },
  });
}
