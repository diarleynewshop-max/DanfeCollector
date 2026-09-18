/**
 * Rate Limiter e Controle de Concorrência para Consultas ao ERP (Varejo Fácil)
 *
 * Protege o ERP contra:
 * 1. Excesso de requisições por cliente (Rate Limit em janela deslizante).
 * 2. Sobrecarga de chamadas simultâneas (Semáforo de concorrência com fila).
 * 3. Requisições repetidas para a mesma chave em intervalo mínimo (Cache anti-flood de 15s).
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
  retryAfterSeconds: number;
}

// Histórico de requisições em memória: identificador -> array de timestamps (ms)
const historicoRequisicoes = new Map<string, number[]>();

// Cache anti-flood para a mesma chave: chave -> { dados: unknown, expiraEm: number }
const cacheChaveRecente = new Map<string, { dados: unknown; expiraEm: number }>();

// Configurações padrão (ajustáveis via variáveis de ambiente)
const JANELA_MS = 60 * 1000; // 1 minuto
const RPM_PADRAO = 30; // 30 requisições por minuto por cliente
const MAX_CONCORRENCIA_PADRAO = 2; // Máximo 2 consultas simultâneas ao ERP
const MAX_FILA_PADRAO = 15; // Tamanho máximo da fila de espera
const TIMEOUT_FILA_PADRAO_MS = 25000; // 25 segundos esperando na fila
const CACHE_TTL_MS = 15 * 1000; // 15 segundos de cache anti-flood por chave

function obterRpmConfigurado(): number {
  const envVal = Number(process.env.ERP_STATUS_RATE_LIMIT_RPM);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : RPM_PADRAO;
}

function obterMaxConcorrenciaConfigurado(): number {
  const envVal = Number(process.env.ERP_CONCURRENCY_LIMIT);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : MAX_CONCORRENCIA_PADRAO;
}

/**
 * Limpa periodicamente entradas antigas de histórico e cache para evitar vazamento de memória.
 */
function limparHistoricoAntigo(): void {
  const agora = Date.now();
  const cutoff = agora - JANELA_MS;

  for (const [id, timestamps] of historicoRequisicoes.entries()) {
    const recentes = timestamps.filter((t) => t > cutoff);
    if (recentes.length === 0) {
      historicoRequisicoes.delete(id);
    } else {
      historicoRequisicoes.set(id, recentes);
    }
  }

  for (const [chave, item] of cacheChaveRecente.entries()) {
    if (item.expiraEm <= agora) {
      cacheChaveRecente.delete(chave);
    }
  }
}

// Agendar limpeza leve a cada 3 minutos
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(limparHistoricoAntigo, 3 * 60 * 1000);
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

/**
 * Extrai o identificador do cliente a partir da requisição (API Key ou IP).
 */
export function extrairIdentificadorCliente(req: Request, apiKeyPrefixo?: string): string {
  if (apiKeyPrefixo) return `apikey:${apiKeyPrefixo}`;

  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const ip = xForwardedFor.split(',')[0].trim();
    if (ip) return `ip:${ip}`;
  }

  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp?.trim()) return `ip:${xRealIp.trim()}`;

  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp?.trim()) return `ip:${cfConnectingIp.trim()}`;

  return 'cliente:desconhecido';
}

/**
 * Verifica se o cliente ultrapassou o limite de requisições por minuto.
 */
export function verificarRateLimitErp(clienteId: string, customRpm?: number): RateLimitResult {
  const agora = Date.now();
  const cutoff = agora - JANELA_MS;
  const limite = customRpm ?? obterRpmConfigurado();

  let timestamps = historicoRequisicoes.get(clienteId) ?? [];
  timestamps = timestamps.filter((t) => t > cutoff);

  if (timestamps.length >= limite) {
    const maisAntigo = timestamps[0];
    const msAteReset = Math.max(1000, maisAntigo + JANELA_MS - agora);
    const retryAfterSeconds = Math.ceil(msAteReset / 1000);

    return {
      allowed: false,
      limit: limite,
      remaining: 0,
      resetInSeconds: retryAfterSeconds,
      retryAfterSeconds,
    };
  }

  timestamps.push(agora);
  historicoRequisicoes.set(clienteId, timestamps);

  const msAteReset = timestamps.length > 0 ? Math.max(1000, timestamps[0] + JANELA_MS - agora) : JANELA_MS;

  return {
    allowed: true,
    limit: limite,
    remaining: Math.max(0, limite - timestamps.length),
    resetInSeconds: Math.ceil(msAteReset / 1000),
    retryAfterSeconds: 0,
  };
}

/**
 * Cache anti-flood por chave de acesso (15s).
 */
export function obterCacheStatusErp<T>(chave: string): T | null {
  const chaveLimpa = chave.replace(/\D/g, '');
  const item = cacheChaveRecente.get(chaveLimpa);
  if (!item) return null;

  if (item.expiraEm <= Date.now()) {
    cacheChaveRecente.delete(chaveLimpa);
    return null;
  }

  return item.dados as T;
}

export function salvarCacheStatusErp(chave: string, dados: unknown, ttlMs = CACHE_TTL_MS): void {
  const chaveLimpa = chave.replace(/\D/g, '');
  cacheChaveRecente.set(chaveLimpa, {
    dados,
    expiraEm: Date.now() + ttlMs,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Semáforo de Concorrência
// ─────────────────────────────────────────────────────────────────────────────

type QueueItem = {
  executar: () => void;
  rejeitar: (erro: Error) => void;
  timeoutId: NodeJS.Timeout;
};

let requisicoesEmAndamento = 0;
const filaEspera: QueueItem[] = [];

function processarProximoDaFila(): void {
  const maxConcorrencia = obterMaxConcorrenciaConfigurado();
  while (requisicoesEmAndamento < maxConcorrencia && filaEspera.length > 0) {
    const item = filaEspera.shift();
    if (item) {
      clearTimeout(item.timeoutId);
      requisicoesEmAndamento++;
      item.executar();
    }
  }
}

/**
 * Executa uma função respeitando o limite máximo de concorrência ao ERP.
 */
export async function executarComSemaforoErp<T>(
  acao: () => Promise<T>,
  timeoutMs = TIMEOUT_FILA_PADRAO_MS
): Promise<T> {
  const maxConcorrencia = obterMaxConcorrenciaConfigurado();

  if (requisicoesEmAndamento < maxConcorrencia) {
    requisicoesEmAndamento++;
    try {
      return await acao();
    } finally {
      requisicoesEmAndamento--;
      processarProximoDaFila();
    }
  }

  if (filaEspera.length >= MAX_FILA_PADRAO) {
    throw new Error('Muitas consultas ao ERP em andamento no momento. Tente novamente em alguns instantes.');
  }

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const idx = filaEspera.findIndex((i) => i.timeoutId === timeoutId);
      if (idx >= 0) {
        filaEspera.splice(idx, 1);
        reject(new Error('Tempo limite de espera na fila de consulta ao ERP excedido.'));
      }
    }, timeoutMs);

    filaEspera.push({
      executar: async () => {
        try {
          const res = await acao();
          resolve(res);
        } catch (err) {
          reject(err);
        } finally {
          requisicoesEmAndamento--;
          processarProximoDaFila();
        }
      },
      rejeitar: (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
      timeoutId,
    });
  });
}
