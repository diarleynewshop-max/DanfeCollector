const TRAMITA_PROCESSO_URL =
  process.env.TRAMITA_PROCESSO_URL || 'https://api.sefaz.ce.gov.br/tramita/processo/';
const TRAMITA_CADASTRO_URL =
  process.env.TRAMITA_CADASTRO_URL || 'https://api.sefaz.ce.gov.br/tramita/cadastro/';

export type TramitaApiResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
};

export type TramitaProcessoPorChave = {
  encontrado: boolean;
  raw: unknown;
  message: string | null;
};

function normalizarBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function authorizationHeader(): string | null {
  const token = process.env.TRAMITA_AUTH_TOKEN?.trim();
  if (!token) return null;
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

export function tramitaAuthConfigurado(): boolean {
  return !!authorizationHeader();
}

export function tramitaEscritaHabilitada(): boolean {
  return process.env.TRAMITA_ENABLE_WRITE === 'true';
}

function textoErro(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const registro = data as Record<string, unknown>;
  return String(
    registro.userMessage ??
    registro.message ??
    registro.localizedMessage ??
    registro.error ??
    fallback,
  );
}

async function tramitaRequest<T>(
  path: string,
  init: RequestInit = {},
  usarAuth = true,
  base = TRAMITA_PROCESSO_URL,
): Promise<TramitaApiResult<T>> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json, text/plain, */*');

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  const authorization = authorizationHeader();
  if (usarAuth && authorization) headers.set('Authorization', authorization);

  const resp = await fetch(new URL(path.replace(/^\//, ''), normalizarBaseUrl(base)), {
    ...init,
    headers,
    cache: 'no-store',
  });

  const contentType = resp.headers.get('content-type') || '';
  const raw = await resp.text();
  let data: unknown = raw;
  if (contentType.includes('application/json') || /^[\[{]/.test(raw.trim())) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  return {
    ok: resp.ok,
    status: resp.status,
    data: (data || null) as T | null,
    message: resp.ok ? 'OK' : textoErro(data, `TRAMITA HTTP ${resp.status}`),
  };
}

export async function consultarProcessoTramitaPorChave(
  chave: string,
): Promise<TramitaApiResult<TramitaProcessoPorChave>> {
  const res = await tramitaRequest<unknown>(
    `/sitram/consulta-processo-por-chave-nfe/${encodeURIComponent(chave)}`,
    { method: 'GET' },
    false,
  );

  if (res.ok) {
    return {
      ...res,
      data: { encontrado: true, raw: res.data, message: null },
    };
  }

  if (res.status === 400 && /Chave NFe n(?:ã|a)o localizada/i.test(res.message)) {
    return {
      ok: true,
      status: res.status,
      data: { encontrado: false, raw: res.data, message: res.message },
      message: 'Nenhum processo TRAMITA/SANFIT localizado para esta chave.',
    };
  }

  return {
    ok: false,
    status: res.status,
    data: { encontrado: false, raw: res.data, message: res.message },
    message: res.message,
  };
}

export async function validarNotaSelagemTramita(chave: string, assuntoId: number) {
  return tramitaRequest<unknown>(
    `/pedido/validar-nota/${encodeURIComponent(chave)}/${assuntoId}`,
    { method: 'GET' },
  );
}

export async function consultarAssuntoTramita(assuntoId: number) {
  return tramitaRequest<Record<string, unknown>>(`/assunto/${assuntoId}`, { method: 'GET' });
}

export async function consultarAssuntoSanfit(assuntoSanfitId: number) {
  return tramitaRequest<Record<string, unknown>>(`/assunto-sanfit/${assuntoSanfitId}`, { method: 'GET' });
}

export async function consultarContribuinteSanfit(documento: string) {
  return tramitaRequest<Record<string, unknown>>(
    `/contribuinte/sanfit/${encodeURIComponent(documento.replace(/\D/g, ''))}`,
    { method: 'GET' },
    true,
    TRAMITA_CADASTRO_URL,
  );
}

export async function criarPedidoSanfitTramita(payload: Record<string, unknown>) {
  if (!tramitaEscritaHabilitada()) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: 'TRAMITA_ENABLE_WRITE nao esta habilitado.',
    };
  }

  return tramitaRequest<Record<string, unknown>>('/pedido', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function analisarSelagemAutomaticamenteTramita(pedidoId: number | string) {
  if (!tramitaEscritaHabilitada()) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: 'TRAMITA_ENABLE_WRITE nao esta habilitado.',
    };
  }

  return tramitaRequest<unknown>(`/pedido/analisar-selagem-automaticamente/${pedidoId}`, {
    method: 'GET',
  });
}
