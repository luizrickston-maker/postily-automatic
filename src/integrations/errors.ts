// src/integrations/errors.ts — erros tipados que o scheduler sabe tratar

/**
 * Token expirado — caller deve chamar integration.refreshToken() e tentar novamente
 */
export class RefreshTokenError extends Error {
  readonly isRefreshTokenError = true;
  constructor(message: string, public identifier?: string) {
    super(message);
    this.name = 'RefreshTokenError';
  }
}

/**
 * Erro genérico do provider (resposta inesperada, mídia inválida, rate-limit permanente, etc.)
 */
export class BadBodyError extends Error {
  readonly isBadBodyError = true;
  constructor(
    message: string,
    public identifier?: string,
    public status?: number,
    public body?: string,
  ) {
    super(message);
    this.name = 'BadBodyError';
  }
}

/**
 * Faltam escopos OAuth — usuário precisa refazer o fluxo autorizando mais permissões
 */
export class NotEnoughScopesError extends Error {
  readonly isNotEnoughScopesError = true;
  constructor(
    message = 'Not enough scopes. Reconnect the integration with all required permissions.',
    public requiredScopes: string[] = [],
  ) {
    super(message);
    this.name = 'NotEnoughScopesError';
  }
}

/**
 * Helper: detecta se um erro é do tipo RefreshTokenError
 */
export function isRefreshTokenError(err: unknown): err is RefreshTokenError {
  return err instanceof RefreshTokenError ||
    (typeof err === 'object' && err !== null && (err as any).isRefreshTokenError === true);
}

/**
 * Helper: detecta se é BadBodyError
 */
export function isBadBodyError(err: unknown): err is BadBodyError {
  return err instanceof BadBodyError ||
    (typeof err === 'object' && err !== null && (err as any).isBadBodyError === true);
}