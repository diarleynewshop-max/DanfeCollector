// Reseta o NSU de um CNPJ para 0 e limpa o bloqueio, para um re-pull limpo.
// Uso: node scripts/reset-nsu.js <cnpj-somente-digitos>
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const cnpj = process.argv[2];
  if (!cnpj) { console.error('Informe o CNPJ.'); process.exit(1); }
  // Protege com 1h05 de bloqueio: a SEFAZ exige ~1h sem consultas antes de
  // aceitar um re-pull do NSU 0. Qualquer consulta nesse meio reinicia o relógio.
  const liberaEm = new Date(Date.now() + 65 * 60 * 1000);
  await prisma.cnpj.update({
    where: { cnpj },
    data: {
      ultimoNSU: '0',
      bloqueadoAte: liberaEm,
      situacao: `NSU resetado — re-pull liberado às ${liberaEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    },
  });
  console.log(`NSU de ${cnpj} resetado para 0. NÃO consultar até ${liberaEm.toLocaleTimeString('pt-BR')}.`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
