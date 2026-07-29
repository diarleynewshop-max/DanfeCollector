import http from 'node:http';
import https from 'node:https';

const ROTA_FISCAL = '/api/internal/fiscal';

function segredoFiscal(): string {
  return (
    process.env.DANFE_FISCAL_WORKER_SECRET?.trim() ||
    process.env.CRON_SYNC_SECRET?.trim() ||
    ''
  );
}

function endpointFiscal(): URL | null {
  const raw = process.env.DANFE_FISCAL_WORKER_URL?.trim();
  if (!raw) return null;

  const normalizado = raw.replace(/\/+$/, '');
  return new URL(normalizado.endsWith(ROTA_FISCAL) ? normalizado : `${normalizado}${ROTA_FISCAL}`);
}

export function usarProxyFiscal(): boolean {
  if (process.env.DANFE_FISCAL_WORKER_LOCAL === '1') return false;
  if (process.env.DANFE_FISCAL_WORKER_DISABLED === '1') return false;
  return Boolean(endpointFiscal() && segredoFiscal());
}

export async function chamarFiscalWorker<T>(action: string, payload?: unknown): Promise<T> {
  const url = endpointFiscal();
  const segredo = segredoFiscal();

  if (!url || !segredo) {
    throw new Error('Worker fiscal nao configurado.');
  }

  const body = JSON.stringify({ action, payload });
  const isHttps = url.protocol === 'https:';
  const hostHeader = process.env.DANFE_FISCAL_WORKER_HOST_HEADER?.trim();
  const servername = process.env.DANFE_FISCAL_WORKER_SERVERNAME?.trim() || hostHeader || url.hostname;
  const timeoutMs = Number(process.env.DANFE_FISCAL_WORKER_TIMEOUT_MS || 120000);

  const options: https.RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${segredo}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(hostHeader ? { Host: hostHeader } : {}),
    },
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
    ...(isHttps
      ? {
          servername,
          rejectUnauthorized: process.env.DANFE_FISCAL_WORKER_INSECURE_TLS !== '1',
        }
      : {}),
  };

  const client = isHttps ? https : http;

  return new Promise<T>((resolve, reject) => {
    const req = client.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json: unknown = null;

        if (raw) {
          try {
            json = JSON.parse(raw);
          } catch {
            reject(new Error(`Worker fiscal retornou resposta invalida (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`));
            return;
          }
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          const message =
            typeof json === 'object' && json && 'message' in json
              ? String((json as { message?: unknown }).message)
              : raw.slice(0, 200);
          reject(new Error(`Worker fiscal HTTP ${res.statusCode}: ${message || 'sem detalhes'}`));
          return;
        }

        resolve(json as T);
      });
    });

    req.on('timeout', () => req.destroy(new Error('Worker fiscal excedeu o tempo limite.')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
