// Reprocessa os XMLs já baixados (em downloads/) para preencher os campos novos
// do cabeçalho nas notas que já estão no banco. Não consulta a SEFAZ.
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = linha.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { processarDocumento } = require(path.join(__dirname, '_sefaz-build', 'documentos.js'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const notas = await prisma.notaFiscal.findMany({
    include: { cnpj: { select: { cnpj: true } } },
  });

  let atualizadas = 0;
  let semArquivo = 0;

  for (const nota of notas) {
    if (!nota.xmlPath || !fs.existsSync(nota.xmlPath)) {
      semArquivo++;
      continue;
    }
    const xml = fs.readFileSync(nota.xmlPath, 'utf8');
    const schema = nota.status === 'COMPLETA' ? 'procNFe_v4.00' : 'resNFe_v1.01';
    const extraida = await processarDocumento({ nsu: nota.nsu || '', schema, xml }, nota.cnpj.cnpj);
    if (!extraida) continue;

    const { chave, status, ...campos } = extraida;
    void chave;
    void status;
    await prisma.notaFiscal.update({ where: { id: nota.id }, data: campos });
    atualizadas++;
  }

  console.log(`Reprocessadas: ${atualizadas} | sem arquivo: ${semArquivo} | total: ${notas.length}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
