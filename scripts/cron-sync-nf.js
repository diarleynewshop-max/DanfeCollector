const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const linha of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const segredo = (process.env.CRON_SYNC_SECRET || '').trim();
const porta = (process.env.PORT || '3100').trim();
const url = (process.env.CRON_SYNC_URL || `http://127.0.0.1:${porta}/api/internal/sync-nf`).trim();

if (!segredo) {
  console.error('CRON_SYNC_SECRET nao configurado.');
  process.exit(1);
}

(async () => {
  const inicio = new Date();
  console.log(`[${inicio.toISOString()}] Iniciando sincronizacao NF: ${url}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${segredo}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });

  const texto = await resp.text();
  console.log(`[${new Date().toISOString()}] HTTP ${resp.status} ${resp.statusText}`);
  console.log(texto);

  if (!resp.ok) process.exit(1);
})().catch((error) => {
  console.error(`[${new Date().toISOString()}] Falha no cron NF: ${error.message}`);
  process.exit(1);
});
