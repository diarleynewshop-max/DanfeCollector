// Cadastra os CNPJs da NEWSHOP (extraídos do estudo do FSist Monitor de Notas)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const empresas = [
  { cnpj: '45998339000167', razaoSocial: 'NEWSHOP COMERCIO LTDA (Matriz)', uf: 'CE' },
  { cnpj: '45998339000248', razaoSocial: 'NEWSHOP COMERCIO LTDA (Filial 02)', uf: 'CE' },
  { cnpj: '45998339000329', razaoSocial: 'NEWSHOP COMERCIO LTDA (Filial 03)', uf: 'CE' },
  { cnpj: '45998339000400', razaoSocial: 'NEWSHOP COMERCIO LTDA (Filial 04)', uf: 'CE' },
];

(async () => {
  for (const e of empresas) {
    await prisma.cnpj.upsert({
      where: { cnpj: e.cnpj },
      update: { razaoSocial: e.razaoSocial, uf: e.uf },
      create: e,
    });
    console.log('OK:', e.cnpj, '-', e.razaoSocial);
  }
  console.log('Total no banco:', await prisma.cnpj.count());
  await prisma.$disconnect();
})();
