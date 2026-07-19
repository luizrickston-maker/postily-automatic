// src/integrations/social.abstract.ts — classe base para todos os providers de rede social
// Port de gitroomhq/postiz-app (social.abstract.ts) sem decorators NestJS.
// Fornece: fetch wrapper, retry, classificação de erros, validação de escopos.

import { httpFetch, sleep, safeStringify } from '../http.js';
import { BadBodyError, NotEnoughScopesError } from './errors.js';
import type {
  AuthTokenDetails,
  GenerateAuthUrlResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from './types.js';

export type ErrorAction =
  | { type: 'refresh-token'; value: string }
  | { type: 'retry'; value: string }
  | { type: 'bad-body'; value: string };

export abstract class SocialAbstract implements SocialProvider {
  abstract identifier: string;
  abstract name: string;
  abstract scopes: string[];
  abstract maxLength(): number;
  abstract editorType: 'normal' | 'markdown' | 'none';

  abstract generateAuthUrl(state: string): Promise<GenerateAuthUrlResponse>;
  abstract authenticate(params: {
    code: string;
    codeVerifier?: string;
    redirectUri?: string;
  }): Promise<AuthTokenDetails>;
  abstract refreshToken(refreshToken: string): Promise<AuthTokenDetails>;
  abstract post(
    integration: { internalId: string; accessToken: string },
    posts: PostDetails[],
  ): Promise<PostResponse[]>;

  /**
   * Override para classificar erros HTTP do provider.
   * Retorne undefined para usar o comportamento padrão (retry em 429/500, refresh em 401).
   */
  public handleErrors(
    body: string,
    status: number,
  ): ErrorAction | undefined {
    return undefined;
  }

  /**
   * Override para validação de mídia customizada por provider.
   * Default: aceita qualquer coisa.
   */
  async checkValidity(
    media: Array<Array<{ path: string; thumbnail?: string }>>,
    settings: any,
  ): Promise<string | true> {
    return true;
  }

  /**
   * Fetch wrapper com retry automático + classificação de erros.
   * Subclasses devem usar este método em vez de fetch() direto.
   */
  protected async fetch(
    url: string,
    options: RequestInit & { identifier?: string; message?: string } = {},
  ): Promise<Response> {
    const { identifier = this.identifier, message = '', ...fetchOpts } = options;

    const response = await httpFetch(url, {
      ...fetchOpts,
      identifier,
      message,
      handleErrors: (body, status) => this.handleErrors(body, status),
    });

    return response;
  }

  /**
   * Lê JSON da response (helper comum)
   */
  protected async fetchJson<T = any>(
    url: string,
    options: RequestInit & { identifier?: string; message?: string } = {},
  ): Promise<T> {
    const response = await this.fetch(url, options);
    return (await response.json()) as T;
  }

  /**
   * Valida escopos OAuth. Lança NotEnoughScopesError se faltar algum.
   */
  protected checkScopes(
    required: string[],
    got: string | string[],
  ): boolean {
    const gotArray = Array.isArray(got)
      ? got
      : decodeURIComponent(got)
          .split(got.indexOf(',') > -1 ? ',' : ' ')
          .filter(Boolean);

    const missing = required.filter((scope) => !gotArray.includes(scope));
    if (missing.length > 0) {
      throw new NotEnoughScopesError(
        `Missing scopes: ${missing.join(', ')}`,
        missing,
      );
    }
    return true;
  }

  /**
   * Helper: converte string em boolean (campos adicionais de integração)
   */
  protected asBool(value: boolean | string | undefined): boolean {
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return value ?? false;
  }

  /**
   * Helper: delay em ms
   */
  protected delay(ms: number): Promise<void> {
    return sleep(ms);
  }

  /**
   * Helper: converte erro genérico em BadBodyError
   */
  protected wrapError(err: unknown, context = ''): BadBodyError {
    const message = err instanceof Error ? err.message : String(err);
    return new BadBodyError(
      `${context}: ${message}`,
      this.identifier,
      undefined,
      safeStringify(err),
    );
  }
}