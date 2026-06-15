// Varre os eventos (procEventoNFe) já salvos em downloads/ e marca como
// manifestadaEm as notas que já tiveram Ciência da Operação (210210) pelo
// nosso próprio CNPJ. Evita declarar Ciência de novo.
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { interpretarEventoCiencia } = require(path.join(__dirname, '_sefaz-build', 'documentos.js'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.includes('procEventoNFe')) yield full;
  }
}

(async () => {
  const base = path.resolve(__dirname, '..', process.env.DOWNLOAD_PATH || './downloads');
  let marcadas = 0;
  let eventos = 0;

  for (const arquivo of walk(base)) {
    const ev = interpretarEventoCiencia(fs.readFileSync(arquivo, 'utf8'));
    if (!ev || !ev.chave) continue;
    eventos++;

    // Marca a nota dessa chave SE o autor do evento for o mesmo CNPJ interessado
    const nota = await prisma.notaFiscal.findFirst({
      where: { chave: ev.chave },
      include: { cnpj: { select: { cnpj: true } } },
    });
    if (nota && nota.cnpj.cnpj === ev.cnpjAutor && !nota.manifestadaEm) {
      await prisma.notaFiscal.update({
        where: { id: nota.id },
        data: { manifestadaEm: ev.dhEvento ? new Date(ev.dhEvento) : new Date() },
      });
      marcadas++;
    }
  }

  console.log(`Eventos 210210 encontrados: ${eventos} | notas marcadas como manifestadas: ${marcadas}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
