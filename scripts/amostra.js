const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  for (const st of ['COMPLETA', 'RESUMO']) {
    const n = await prisma.notaFiscal.findFirst({ where: { status: st } });
    console.log(`\n=== ${st} ===`);
    console.log({
      tipo: n.tipoOperacao, natOp: n.naturezaOp,
      emit: n.emitenteNome, emitIe: n.emitenteIe, emitUf: n.emitenteUf,
      dest: n.destNome, destCnpj: n.destCnpj,
      vTotal: n.valorTotal, vProd: n.valorProdutos, vFrete: n.valorFrete, vIcms: n.valorIcms,
      chave: n.chave,
    });
  }
  await prisma.$disconnect();
})();
