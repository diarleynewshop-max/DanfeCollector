// Mostra o estado de sincronização de cada CNPJ
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const cnpjs = await prisma.cnpj.findMany({
    select: {
      cnpj: true,
      ultimoNSU: true,
      situacao: true,
      ultimaBusca: true,
      bloqueadoAte: true,
      _count: { select: { notas: true } },
    },
  });
  for (const c of cnpjs) {
    console.log(
      `${c.cnpj} | NSU ${c.ultimoNSU} | notas ${c._count.notas} | bloqueadoAte ${c.bloqueadoAte ? c.bloqueadoAte.toLocaleString('pt-BR') : '-'} | ${c.situacao}`
    );
  }
  console.log('Total de notas:', await prisma.notaFiscal.count());
  await prisma.$disconnect();
})();
