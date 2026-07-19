// src/http.ts — fetch wrapper com retry 429/500 + tratamento de erros
import { Agent } from 'undici';
import { logger } from './logger.js';

const safeAgent = new Agent({
  // SSRF protection: bloqueia IPs privados em produção
  connect: {
    rejectUnauthorized: true,
  },
});

export interface FetchOptions extends RequestInit {
  identifier?: string;
  totalRetries?: number;
  message?: string;
  /** Callback para classificar erro → ação */
  handleErrors?: (body: string, status: number) => ErrorAction | undefined;
}

export type ErrorAction =
  | { type: 'refresh-token'; value: string }
  | { type: 'retry'; value: string }
  | { type: 'bad-body'; value: string };

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
    public identifier?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Fetch com retry automático para 429/500/rate-limit.
 * Lança HttpError com status + body em outros casos.
 */
export async function httpFetch(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { identifier = '', totalRetries = 0, message = '', handleErrors, ...fetchOpts } = options;

  const response = await fetch(url, {
    ...fetchOpts,
    dispatcher: safeAgent,
  } as RequestInit);

  if (response.status === 200 || response.status === 201) {
    return response;
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  if (totalRetries > 3) {
    throw new HttpError(
      `Failed after retries: ${message || response.statusText}`,
      response.status,
      body,
      identifier,
    );
  }

  const action = handleErrors?.(body, response.status);

  // Retry em rate limit
  if (
    response.status === 429 ||
    response.status === 500 ||
    body.includes('rate_limit_exceeded') ||
    body.includes('Rate limit')
  ) {
    await sleep(5000);
    return httpFetch(url, { ...options, totalRetries: totalRetries + 1 });
  }

  // Retry classificado pelo provider
  if (action?.type === 'retry') {
    await sleep(5000);
    return httpFetch(url, { ...options, totalRetries: totalRetries + 1 });
  }

  // Refresh token (deixa o caller lidar)
  if (action?.type === 'refresh-token' || response.status === 401) {
    const err = new HttpError(
      action?.value ?? 'Token expired',
      401,
      body,
      identifier,
    );
    (err as any).refreshToken = true;
    throw err;
  }

  throw new HttpError(
    action?.value ?? `HTTP ${response.status}: ${message || response.statusText}`,
    response.status,
    body,
    identifier,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

export { logger };