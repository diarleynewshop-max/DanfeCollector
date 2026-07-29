// Teste de sincronizaÃ§Ã£o real (produÃ§Ã£o) para um CNPJ â€” mesmo fluxo da action.
// Uso: node scripts/sync-teste.js <cnpj-somente-digitos>
const fs = require('fs');
const path = require('path');

// Carrega .env manualmente (sem dependÃªncia de dotenv)
const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sefazDir = path.join(__dirname, '_sefaz-build');
const { consultarDistribuicaoDFe } = require(path.join(sefazDir, 'distribuicao.js'));
const { processarDocumento } = require(path.join(sefazDir, 'documentos.js'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const cnpjAlvo = process.argv[2];
  if (!cnpjAlvo) {
    console.error('Informe o CNPJ (somente dÃ­gitos).');
    process.exit(1);
  }

  const registro = await prisma.cnpj.findUnique({ where: { cnpj: cnpjAlvo } });
  if (!registro) {
    console.error('CNPJ nÃ£o cadastrado no banco.');
    process.exit(1);
  }
  if (registro.bloqueadoAte && registro.bloqueadoAte > new Date()) {
    console.error('CNPJ bloqueado atÃ©', registro.bloqueadoAte.toLocaleString('pt-BR'));
    process.exit(1);
  }

  let ultNSU = registro.ultimoNSU;
  let novas = 0;
  let lotes = 0;

  while (lotes < 20) {
    lotes++;
    const ret = await consultarDistribuicaoDFe(registro.cnpj, registro.uf, ultNSU);
    console.log(`Lote ${lotes}: cStat=${ret.cStat} (${ret.xMotivo}) | ultNSU=${ret.ultNSU} | maxNSU=${ret.maxNSU} | docs=${ret.documentos.length}`);

    if (ret.cStat === 656) {
      const bloqueadoAte = new Date(Date.now() + 65 * 60 * 1000);
      const nsuRetornado = /^\d+$/.test(ret.ultNSU) ? ret.ultNSU : ultNSU;
      const novoNSU = BigInt(nsuRetornado) > BigInt(ultNSU) ? nsuRetornado : ultNSU;
      await prisma.cnpj.update({
        where: { id: registro.id },
        data: { situacao: `SEFAZ: ${ret.xMotivo}`, bloqueadoAte, ultimaBusca: new Date(), ultimoNSU: novoNSU },
      });
      console.log('NSU ajustado para', novoNSU);
      console.log('Bloqueado atÃ©', bloqueadoAte.toLocaleString('pt-BR'));
      await prisma.$disconnect();
      return; // nÃ£o executa o update final de sucesso
    }

    if (ret.cStat === 138) {
      for (const doc of ret.documentos) {
        const nota = await processarDocumento(doc, registro.cnpj);
        if (!nota) continue;
        const existente = await prisma.notaFiscal.findUnique({ where: { chave: nota.chave } });
        if (!existente) {
          await prisma.notaFiscal.create({ data: { ...nota, cnpjId: registro.id } });
          novas++;
        } else if (existente.status === 'RESUMO' && nota.status === 'COMPLETA') {
          await prisma.notaFiscal.update({
            where: { chave: nota.chave },
            data: {
              status: 'COMPLETA',
              numero: nota.numero,
              serie: nota.serie,
              xmlPath: nota.xmlPath,
              xmlStorageKey: nota.xmlStorageKey,
              nsu: nota.nsu,
            },
          });
        }
      }
      ultNSU = ret.ultNSU;
      if (BigInt(ret.ultNSU) >= BigInt(ret.maxNSU)) break;
      continue;
    }

    if (ret.cStat === 137) {
      ultNSU = ret.ultNSU;
      break;
    }

    console.log('cStat nÃ£o tratado â€” parando.');
    break;
  }

  await prisma.cnpj.update({
    where: { id: registro.id },
    data: { ultimoNSU: ultNSU, situacao: 'OK', ultimaBusca: new Date(), bloqueadoAte: null },
  });
  console.log(`FIM: ${novas} nota(s) nova(s). NSU final: ${ultNSU}`);
  console.log('Total de notas no banco:', await prisma.notaFiscal.count());
  await prisma.$disconnect();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
