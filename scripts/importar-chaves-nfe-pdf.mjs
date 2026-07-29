import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { PDFParse } from 'pdf-parse';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);

function uso() {
  console.log(`Uso:
node scripts/importar-chaves-nfe-pdf.mjs <arquivo.pdf> --cnpj <CNPJ> [opcoes]

Opcoes:
  --cnpj <CNPJ>           CNPJ interessado/destinatario cadastrado no sistema
  --build-dir <pasta>     Pasta com distribuicao.js/documentos.js/manifestacao.js compilados
  --manifestar            Manifesta resumos e tenta buscar o XML completo
  --dry-run               Apenas extrai as chaves e mostra o que ja existe
  --limite <n>            Processa no maximo n chaves
  --sleep-ms <n>          Pausa entre consultas SEFAZ (padrao: 800)
`);
}

function parseArgs(argv) {
  const args = { manifestar: false, dryRun: false, sleepMs: 800, limite: 0 };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifestar') args.manifestar = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--cnpj') args.cnpj = argv[++i];
    else if (a === '--build-dir') args.buildDir = argv[++i];
    else if (a === '--sleep-ms') args.sleepMs = Number(argv[++i]);
    else if (a === '--limite') args.limite = Number(argv[++i]);
    else if (a === '-h' || a === '--help') args.help = true;
    else rest.push(a);
  }

  args.pdf = rest[0];
  return args;
}

function loadEnv(envPath = '.env') {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validarChaveNfe(chave) {
  if (!/^\d{44}$/.test(chave)) return false;
  if (chave.slice(20, 22) !== '55') return false;

  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let pesoIdx = 0;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * pesos[pesoIdx];
    pesoIdx = (pesoIdx + 1) % pesos.length;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

async function extrairChavesPdf(pdfPath) {
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  try {
    const result = await parser.getText();
    const todas = result.text.match(/\b\d{44}\b/g) ?? [];
    const unicas = [...new Set(todas)];
    const validas = unicas.filter(validarChaveNfe);
    const invalidas = unicas.filter((chave) => !validarChaveNfe(chave));
    return { validas, invalidas, totalEncontradas: todas.length };
  } finally {
    await parser.destroy();
  }
}

function carregarSefaz(buildDir) {
  const dir = path.resolve(buildDir || process.env.SEFAZ_BUILD_DIR || 'scripts/_sefaz-current');
  return {
    consultarPorChave: require(path.join(dir, 'distribuicao.js')).consultarPorChave,
    processarDocumento: require(path.join(dir, 'documentos.js')).processarDocumento,
    manifestar: require(path.join(dir, 'manifestacao.js')).manifestar,
  };
}

async function guardarDocumento(prisma, cnpjId, cnpj, doc, processarDocumento) {
  const nota = await processarDocumento(doc, cnpj);
  if (!nota) return { tipo: null, acao: 'ignorado' };

  const existente = await prisma.notaFiscal.findUnique({ where: { chave: nota.chave } });
  if (!existente) {
    await prisma.notaFiscal.create({ data: { ...nota, cnpjId } });
    return { tipo: nota.status === 'COMPLETA' ? 'completa' : 'resumo', acao: 'criada' };
  }

  if (existente.status === 'RESUMO' && nota.status === 'COMPLETA') {
    const { status, chave, ...campos } = nota;
    await prisma.notaFiscal.update({ where: { chave }, data: { ...campos, status } });
    return { tipo: 'completa', acao: 'promovida' };
  }

  return { tipo: existente.status === 'COMPLETA' ? 'completa' : 'resumo', acao: 'ja-tinha' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pdf || !args.cnpj) {
    uso();
    process.exit(args.help ? 0 : 1);
  }

  const pdfPath = path.resolve(args.pdf);
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF nao encontrado: ${pdfPath}`);

  loadEnv();

  const cnpj = onlyDigits(args.cnpj);
  if (cnpj.length !== 14) throw new Error(`CNPJ invalido: ${args.cnpj}`);

  const { validas, invalidas, totalEncontradas } = await extrairChavesPdf(pdfPath);
  const chaves = args.limite > 0 ? validas.slice(0, args.limite) : validas;

  console.log(`[inicio] pdf=${pdfPath}`);
  console.log(`[inicio] chaves encontradas=${totalEncontradas} unicas_validas=${validas.length} invalidas=${invalidas.length} processar=${chaves.length}`);

  const prisma = new PrismaClient();
  try {
    const empresa = await prisma.cnpj.findUnique({ where: { cnpj } });
    if (!empresa) throw new Error(`CNPJ ${cnpj} nao esta cadastrado no sistema.`);

    const existentes = await prisma.notaFiscal.findMany({
      where: { chave: { in: chaves } },
      select: { chave: true, status: true },
    });
    const totalEmpresa = await prisma.notaFiscal.groupBy({
      by: ['status'],
      where: { cnpjId: empresa.id },
      _count: { _all: true },
    });
    const porChave = new Map(existentes.map((n) => [n.chave, n.status]));
    const jaCompletas = chaves.filter((chave) => porChave.get(chave) === 'COMPLETA').length;
    const jaResumos = chaves.filter((chave) => porChave.get(chave) === 'RESUMO').length;

    console.log(
      `[empresa] id=${empresa.id} cnpj=${empresa.cnpj} razao=${empresa.razaoSocial ?? ''} ` +
        `uf=${empresa.uf} ultimoNSU=${empresa.ultimoNSU} maxNSU=${empresa.maxNSU} ` +
        `bloqueadoAte=${empresa.bloqueadoAte?.toISOString?.() ?? ''} situacao=${empresa.situacao ?? ''}`
    );
    console.log(
      `[empresa-notas] ` +
        totalEmpresa.map((item) => `${item.status}=${item._count._all}`).join(' ')
    );
    console.log(`[banco] ja_completas=${jaCompletas} ja_resumos=${jaResumos} faltantes=${chaves.length - jaCompletas - jaResumos}`);

    if (args.dryRun) return;

    const { consultarPorChave, processarDocumento, manifestar } = carregarSefaz(args.buildDir);
    const cont = {
      completa: 0,
      resumo: 0,
      manifestada: 0,
      jaTinha: 0,
      foraDePrazo: 0,
      naoEncontrada: 0,
      consumoIndevido: 0,
      erro: 0,
      ignorado: 0,
    };

    for (let i = 0; i < chaves.length; i++) {
      const chave = chaves[i];
      const prefixo = `[${i + 1}/${chaves.length}] ${chave}`;
      const existente = await prisma.notaFiscal.findUnique({ where: { chave } });
      if (existente?.status === 'COMPLETA') {
        cont.jaTinha++;
        console.log(`${prefixo} ja-tinha COMPLETA`);
        continue;
      }

      try {
        const ret = await consultarPorChave(empresa.cnpj, empresa.uf, chave);
        if (ret.cStat !== 138 || ret.documentos.length === 0) {
          if (ret.cStat === 656) {
            cont.consumoIndevido++;
            console.log(`${prefixo} consumo-indevido ${ret.cStat}: ${ret.xMotivo}. Interrompendo.`);
            break;
          }
          if (ret.cStat === 632) {
            cont.foraDePrazo++;
            console.log(`${prefixo} fora-de-prazo ${ret.cStat}: ${ret.xMotivo}`);
          } else {
            cont.naoEncontrada++;
            console.log(`${prefixo} nao-encontrada ${ret.cStat}: ${ret.xMotivo}`);
          }
          await sleep(args.sleepMs);
          continue;
        }

        let salvo = await guardarDocumento(prisma, empresa.id, empresa.cnpj, ret.documentos[0], processarDocumento);
        let tipo = salvo.tipo;

        if (tipo === 'resumo' && args.manifestar) {
          const notaAtual = await prisma.notaFiscal.findUnique({ where: { chave } });
          if (!notaAtual?.manifestadaEm) {
            const man = await manifestar(empresa.cnpj, chave);
            if (man.ok) {
              await prisma.notaFiscal.update({ where: { chave }, data: { manifestadaEm: new Date() } });
              const ret2 = await consultarPorChave(empresa.cnpj, empresa.uf, chave);
              if (ret2.cStat === 656) {
                cont.consumoIndevido++;
                console.log(`${prefixo} consumo-indevido apos manifestar ${ret2.cStat}: ${ret2.xMotivo}. Interrompendo.`);
                break;
              }
              if (ret2.cStat === 138 && ret2.documentos.length > 0) {
                salvo = await guardarDocumento(prisma, empresa.id, empresa.cnpj, ret2.documentos[0], processarDocumento);
                tipo = salvo.tipo;
              }
              if (tipo !== 'completa') {
                cont.manifestada++;
                console.log(`${prefixo} manifestada aguardando XML completo`);
                await sleep(args.sleepMs);
                continue;
              }
            } else {
              cont.resumo++;
              console.log(`${prefixo} resumo manifestacao=${man.cStat}: ${man.xMotivo}`);
              await sleep(args.sleepMs);
              continue;
            }
          }
        }

        if (tipo === 'completa') {
          if (salvo.acao === 'ja-tinha') cont.jaTinha++;
          else cont.completa++;
          console.log(`${prefixo} ${salvo.acao} COMPLETA`);
        } else if (tipo === 'resumo') {
          cont.resumo++;
          console.log(`${prefixo} ${salvo.acao} RESUMO`);
        } else {
          cont.ignorado++;
          console.log(`${prefixo} ignorado`);
        }
      } catch (error) {
        cont.erro++;
        console.log(`${prefixo} erro: ${error.message}`);
      }

      await sleep(args.sleepMs);
    }

    console.log(`[fim] ${JSON.stringify(cont)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[fatal] ${error.stack || error.message}`);
  process.exit(1);
});
