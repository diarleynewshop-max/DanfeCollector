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
const intervaloConfigurado = Number(process.env.CRON_SYNC_INTERVAL_MINUTES || 15);
const intervaloMinutos = Number.isFinite(intervaloConfigurado) ? Math.max(5, intervaloConfigurado) : 15;
const intervaloMs = intervaloMinutos * 60 * 1000;

if (!segredo) {
  console.error('CRON_SYNC_SECRET nao configurado.');
  process.exit(1);
}

let executando = false;
let proximoTimer = null;

async function executar() {
  if (executando) {
    console.warn(`[${new Date().toISOString()}] Ciclo anterior ainda executando; mantendo apenas um ciclo ativo.`);
    return;
  }

  executando = true;
  const inicio = new Date();
  console.log(`[${inicio.toISOString()}] Iniciando sincronizacao NF: ${url}`);

  const controlador = new AbortController();
  const timeout = setTimeout(() => controlador.abort(), Math.max(5 * 60 * 1000, intervaloMs - 60 * 1000));

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${segredo}`,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controlador.signal,
    });

    const texto = await resp.text();
    console.log(`[${new Date().toISOString()}] HTTP ${resp.status} ${resp.statusText}`);
    console.log(texto);

    if (!resp.ok) {
      // Nao encerra o processo: um CNPJ ou uma falha transitoria nao pode
      // desligar a rotina dos demais CNPJs.
      console.error(`[${new Date().toISOString()}] Ciclo NF com alerta HTTP ${resp.status}; proxima tentativa sera mantida.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Falha no ciclo NF: ${error.message}`);
  } finally {
    clearTimeout(timeout);
    executando = false;
  }
}

async function ciclo() {
  await executar();
  proximoTimer = setTimeout(ciclo, intervaloMs);
  console.log(`[${new Date().toISOString()}] Proxima sincronizacao NF em ${intervaloMinutos} minuto(s).`);
}

process.on('SIGTERM', () => {
  if (proximoTimer) clearTimeout(proximoTimer);
  console.log(`[${new Date().toISOString()}] Worker NF encerrado pelo PM2.`);
  process.exit(0);
});

process.on('SIGINT', () => {
  if (proximoTimer) clearTimeout(proximoTimer);
  process.exit(0);
});

void ciclo();
