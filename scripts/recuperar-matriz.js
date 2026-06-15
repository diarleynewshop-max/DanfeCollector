// Robô de recuperação: espera o bloqueio da Matriz expirar, então faz UM pull
// limpo da Distribuição DFe a partir do NSU 0. Roda em background.
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { consultarDistribuicaoDFe } = require(path.join(__dirname, '_sefaz-build', 'distribuicao.js'));
const { processarDocumento } = require(path.join(__dirname, '_sefaz-build', 'documentos.js'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CNPJ = '45998339000167';
const MAX_LOTES = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString('pt-BR');

(async () => {
  // 1) Espera o bloqueio expirar (a SEFAZ exige ~1h sem consultas)
  let esperas = 0;
  for (;;) {
    const reg = await prisma.cnpj.findUnique({ where: { cnpj: CNPJ } });
    if (!reg) { console.log('CNPJ não encontrado.'); return prisma.$disconnect(); }
    if (!reg.bloqueadoAte || new Date(reg.bloqueadoAte) <= new Date()) break;
    if (esperas === 0) console.log(`[${ts()}] Aguardando liberação às ${new Date(reg.bloqueadoAte).toLocaleTimeString('pt-BR')}...`);
    esperas++;
    if (esperas > 120) { console.log('Espera longa demais — abortando.'); return prisma.$disconnect(); }
    await sleep(60000);
  }

  const reg = await prisma.cnpj.findUnique({ where: { cnpj: CNPJ } });
  console.log(`[${ts()}] Liberado. Iniciando pull da Matriz a partir do NSU 0...`);

  // 2) Garante estado limpo
  await prisma.cnpj.update({ where: { cnpj: CNPJ }, data: { ultimoNSU: '0', bloqueadoAte: null } });

  let ultNSU = '0';
  let novas = 0;
  let lotes = 0;

  while (lotes < MAX_LOTES) {
    lotes++;
    const ret = await consultarDistribuicaoDFe(reg.cnpj, reg.uf, ultNSU);
    console.log(`[${ts()}] Lote ${lotes}: cStat=${ret.cStat} ultNSU=${ret.ultNSU} maxNSU=${ret.maxNSU} docs=${ret.documentos.length}`);

    if (ret.cStat === 656) {
      // Falhou de novo: mantém NSU 0 e reagenda +65min para nova tentativa
      const proxima = new Date(Date.now() + 65 * 60 * 1000);
      await prisma.cnpj.update({
        where: { cnpj: CNPJ },
        data: { ultimoNSU: '0', bloqueadoAte: proxima, situacao: `656 no re-pull — nova tentativa após ${proxima.toLocaleTimeString('pt-BR')}` },
      });
      console.log(`RESULTADO: 656 (${ret.xMotivo}). Mantido NSU 0; pode tentar de novo após ${proxima.toLocaleTimeString('pt-BR')} ou usar importação.`);
      return prisma.$disconnect();
    }

    if (ret.cStat === 138) {
      for (const doc of ret.documentos) {
        const nota = processarDocumento(doc, reg.cnpj);
        if (!nota) continue;
        const existe = await prisma.notaFiscal.findUnique({ where: { chave: nota.chave } });
        if (!existe) { await prisma.notaFiscal.create({ data: { ...nota, cnpjId: reg.id } }); novas++; }
      }
      ultNSU = ret.ultNSU;
      if (BigInt(ret.ultNSU) >= BigInt(ret.maxNSU)) break;
      continue;
    }

    if (ret.cStat === 137) { ultNSU = ret.ultNSU; break; }
    console.log(`cStat inesperado ${ret.cStat}: ${ret.xMotivo}`);
    break;
  }

  const proxima = new Date(Date.now() + 60 * 60 * 1000);
  await prisma.cnpj.update({
    where: { cnpj: CNPJ },
    data: { ultimoNSU: ultNSU, bloqueadoAte: proxima, ultimaBusca: new Date(), situacao: `Em dia · ${novas} recuperada(s). Próxima às ${proxima.toLocaleTimeString('pt-BR')}` },
  });
  console.log(`RESULTADO: ${novas} nota(s) recuperada(s) na Matriz! NSU final: ${ultNSU}.`);
  console.log('Total de notas no banco:', await prisma.notaFiscal.count());
  await prisma.$disconnect();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
