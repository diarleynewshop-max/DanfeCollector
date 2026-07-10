// db-import.mjs — importa o dump JSON (gerado do SQLite) para o PostgreSQL.
// Uso (na VPS, dentro da pasta do app, com DATABASE_URL apontando pro Postgres):
//   node scripts/db-import.mjs /home/danfe/backups/db-export.json
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const arquivo = process.argv[2] || '/home/danfe/backups/db-export.json';
const db = new PrismaClient();

const DATAS_CNPJ = ['ultimaBusca', 'bloqueadoAte', 'certVencimento', 'createdAt', 'updatedAt'];
const DATAS_NOTA = ['emitidaEm', 'sitramConsultadaEm', 'manifestadaEm', 'createdAt', 'updatedAt'];

function converterDatas(obj, campos) {
  const out = { ...obj };
  for (const c of campos) {
    if (out[c] != null) out[c] = new Date(out[c]);
  }
  return out;
}

function chunk(arr, n) {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
}

const { cnpjs, notas } = JSON.parse(readFileSync(arquivo, 'utf8'));
console.log(`Lendo: ${cnpjs.length} cnpjs, ${notas.length} notas`);

// Segurança: só importa em banco vazio (evita duplicar se rodar 2x)
const jaTemCnpj = await db.cnpj.count();
const jaTemNota = await db.notaFiscal.count();
if (jaTemCnpj > 0 || jaTemNota > 0) {
  console.error(`ABORTADO: banco já tem dados (${jaTemCnpj} cnpjs, ${jaTemNota} notas).`);
  process.exit(1);
}

await db.cnpj.createMany({ data: cnpjs.map((c) => converterDatas(c, DATAS_CNPJ)) });
console.log(`  cnpjs inseridos: ${cnpjs.length}`);

let total = 0;
for (const lote of chunk(notas.map((n) => converterDatas(n, DATAS_NOTA)), 500)) {
  await db.notaFiscal.createMany({ data: lote });
  total += lote.length;
  console.log(`  notas inseridas: ${total}/${notas.length}`);
}

// Reajusta as sequências de autoincrement para depois do maior id importado
await db.$executeRawUnsafe(
  `SELECT setval(pg_get_serial_sequence('"Cnpj"', 'id'), COALESCE((SELECT MAX(id) FROM "Cnpj"), 1));`
);
await db.$executeRawUnsafe(
  `SELECT setval(pg_get_serial_sequence('"NotaFiscal"', 'id'), COALESCE((SELECT MAX(id) FROM "NotaFiscal"), 1));`
);

const fc = await db.cnpj.count();
const fn = await db.notaFiscal.count();
console.log(`OK. Postgres agora tem ${fc} cnpjs, ${fn} notas.`);
await db.$disconnect();
