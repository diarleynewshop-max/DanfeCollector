// Restaura o bloqueio da filial 04 que o bug do sync-teste apagou
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  await prisma.cnpj.update({
    where: { cnpj: '45998339000400' },
    data: {
      bloqueadoAte: new Date('2026-06-12T17:43:39-03:00'),
      situacao: 'SEFAZ: Rejeicao: Consumo Indevido (tente apos 17:43)',
    },
  });
  console.log('Bloqueio da filial 04 restaurado ate 17:43.');
  await prisma.$disconnect();
})();
