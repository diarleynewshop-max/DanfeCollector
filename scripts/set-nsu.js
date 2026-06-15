// Define o NSU de um CNPJ para um valor específico (marco de consumo da SEFAZ).
// Uso: node scripts/set-nsu.js <cnpj> <nsu>
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const [cnpj, nsu] = process.argv.slice(2);
  if (!cnpj || !nsu) { console.error('Uso: set-nsu.js <cnpj> <nsu>'); process.exit(1); }
  await prisma.cnpj.update({
    where: { cnpj },
    data: {
      ultimoNSU: String(nsu).padStart(15, '0'),
      bloqueadoAte: new Date(Date.now() + 60 * 60 * 1000),
      situacao: 'Em dia (histórico não recuperável via SEFAZ — só novas notas).',
    },
  });
  console.log(`NSU de ${cnpj} definido para ${nsu}.`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
