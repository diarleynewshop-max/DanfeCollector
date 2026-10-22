import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { exigirUsuario, whereNotaPermitida } from '@/lib/usuarios/auth';
import { gerarDaeSitram } from '@/lib/sitram/client';
import { extrairResumoDae, lancamentosVisiveisDae, statusDaeEfetivo } from '@/lib/sitram/dae';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CategoriaDae = 'vencidos' | 'proximos';

const LIMITE_NOTAS = 800;
const LIMITE_MINIMO_DAE = 10;
const DIAS_MS = 86_400_000;

function chaveDataLocal(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const data = valor.match(/^(\d{4}-\d{2}-\d{2})/);
  if (data) return data[1];

  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const componente = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value;
  const ano = componente('year');
  const mes = componente('month');
  const dia = componente('day');
  return ano && mes && dia ? `${ano}-${mes}-${dia}` : null;
}

function diferencaDias(data: string, hoje: string): number {
  return Math.round((Date.parse(`${data}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / DIAS_MS);
}

function nomeSeguro(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'DAE';
}

function hojeSaoPaulo(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const componente = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value;
  return `${componente('year')}-${componente('month')}-${componente('day')}`;
}

export async function POST(req: Request) {
  try {
    const usuario = await exigirUsuario();
    const body = await req.json() as { categoria?: unknown; notaIds?: unknown };
    const categoria = body.categoria;
    const idsBrutos = Array.isArray(body.notaIds) ? body.notaIds : [];

    if (categoria !== 'vencidos' && categoria !== 'proximos') {
      return NextResponse.json({ success: false, message: 'Categoria de DAE invalida.' }, { status: 400 });
    }

    const notaIds = [...new Set(idsBrutos.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
    if (notaIds.length === 0 || notaIds.length > LIMITE_NOTAS) {
      return NextResponse.json({ success: false, message: `Selecione de 1 a ${LIMITE_NOTAS} notas para gerar o ZIP.` }, { status: 400 });
    }

    const notas = await prisma.notaFiscal.findMany({
      where: {
        AND: [whereNotaPermitida(usuario), { id: { in: notaIds } }],
        situacaoSefaz: { notIn: ['CANCELADA', 'DENEGADA'] },
      },
      select: {
        id: true,
        chave: true,
        numero: true,
        cnpj: { select: { cnpj: true } },
        sitramDaeStatus: true,
        sitramDaeResumo: true,
        sitramSituacao: true,
        sitramDetalhe: true,
        pagamentoManualEm: true,
      },
    });

    const hoje = hojeSaoPaulo();
    const notasElegiveis = notas.filter((nota) => {
      if (!['EM_ABERTO', 'LIBERADA_PARA_GERAR'].includes(statusDaeEfetivo(nota))) return false;
      return lancamentosVisiveisDae(extrairResumoDae(nota).lancamentos).some((lancamento) => {
        if (lancamento.pago) return false;
        if (lancamento.valorAberto !== null && lancamento.valorAberto > 0 && lancamento.valorAberto < LIMITE_MINIMO_DAE) return false;
        const dataVencimento = chaveDataLocal(lancamento.vencimento);
        if (!dataVencimento) return false;
        const dias = diferencaDias(dataVencimento, hoje);
        return categoria === 'vencidos' ? dias < 0 : dias > 0 && dias <= 7;
      });
    });

    if (notasElegiveis.length === 0) {
      return NextResponse.json({ success: false, message: 'Nenhum DAE pendente e pagavel desta categoria foi encontrado. Atualize a lista e tente novamente.' }, { status: 404 });
    }

    const arquivos: Array<{ nome: string; conteudo: Buffer }> = [];
    const falhas: string[] = [];
    let proxima = 0;
    const trabalhadores = Array.from({ length: Math.min(3, notasElegiveis.length) }, async () => {
      while (proxima < notasElegiveis.length) {
        const indice = proxima++;
        const nota = notasElegiveis[indice];
        try {
          const pdf = await gerarDaeSitram(nota.chave);
          const assinatura = pdf.subarray(0, 1024).toString('latin1');
          if (!assinatura.includes('%PDF-')) throw new Error('O SITRAM nao retornou um PDF.');
          const cnpj = nomeSeguro(nota.cnpj.cnpj.slice(0, 8));
          const numero = nomeSeguro(nota.numero || String(nota.id));
          arquivos.push({ nome: `DAE_${cnpj}_NF_${numero}_${nota.chave.slice(-6)}.pdf`, conteudo: pdf });
        } catch {
          falhas.push(nota.numero || String(nota.id));
        }
      }
    });
    await Promise.all(trabalhadores);

    if (falhas.length > 0) {
      const lista = [...new Set(falhas)].slice(0, 12).join(', ');
      const restante = falhas.length > 12 ? ` e mais ${falhas.length - 12}` : '';
      return NextResponse.json({
        success: false,
        message: `O SITRAM nao retornou todos os boletos (${falhas.length} falha(s): NF ${lista}${restante}). Nenhum ZIP parcial foi baixado.`,
      }, { status: 502 });
    }

    const zip = new JSZip();
    for (const arquivo of arquivos) zip.file(arquivo.nome, arquivo.conteudo, { binary: true });
    const conteudo = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    const dataArquivo = hoje.replace(/-/g, '');
    const nomeArquivo = `DAEs-${categoria}-${dataArquivo}.zip`;

    return new Response(new Uint8Array(conteudo), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
        'Cache-Control': 'no-store',
        'X-DAE-Count': String(arquivos.length),
      },
    });
  } catch (error: unknown) {
    const message = (error as Error).message || 'Nao foi possivel gerar o ZIP de DAEs.';
    const status = /sessao|login/i.test(message) ? 401 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
