// src/oauth/oauth.service.ts — gera state, persiste e troca code por tokens
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import { getSocialProvider, isValidProvider } from '../integrations/integration.manager.js';
import * as integrationRepo from '../integrations/integration.repository.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const STATE_TTL_MIN = 15;

/**
 * Inicia o fluxo OAuth: gera state, retorna URL para redirect.
 */
export async function startOAuth(params: {
  tenantId: string;
  providerIdentifier: string;
  redirectAfter?: string;
}): Promise<{ url: string; state: string }> {
  if (!isValidProvider(params.providerIdentifier)) {
    throw new Error(`Provider inválido: ${params.providerIdentifier}`);
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const provider = getSocialProvider(params.providerIdentifier);
  const authUrlData = await provider.generateAuthUrl(state);

  const expiresAt = new Date(Date.now() + STATE_TTL_MIN * 60 * 1000);

  await pool.query(
    `INSERT INTO oauth_states (state, tenant_id, provider_identifier, redirect_after, code_verifier, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      state,
      params.tenantId,
      params.providerIdentifier,
      params.redirectAfter ?? null,
      authUrlData.codeVerifier ?? null,
      expiresAt,
    ],
  );

  return { url: authUrlData.url, state };
}

/**
 * Processa o callback do provider: troca code por tokens e persiste integration.
 */
export async function completeOAuth(params: {
  providerIdentifier: string;
  code: string;
  state: string;
}): Promise<{ integrationId: string; redirectAfter: string | null }> {
  // 1. Buscar state no DB
  const { rows } = await pool.query<{
    tenant_id: string;
    provider_identifier: string;
    redirect_after: string | null;
    code_verifier: string | null;
  }>(
    `SELECT tenant_id, provider_identifier, redirect_after, code_verifier
     FROM oauth_states
     WHERE state = $1 AND expires_at > NOW()
     LIMIT 1`,
    [params.state],
  );
  const oauthState = rows[0];

  if (!oauthState) {
    throw new Error('State inválido ou expirado');
  }
  if (oauthState.provider_identifier !== params.providerIdentifier) {
    throw new Error('State não corresponde ao provider');
  }

  // 2. Limpar state (uso único)
  await pool.query(`DELETE FROM oauth_states WHERE state = $1`, [params.state]);

  // 3. Trocar code por tokens via provider
  const provider = getSocialProvider(params.providerIdentifier);
  const redirectUri = getRedirectUri(params.providerIdentifier);
  const tokens = await provider.authenticate({
    code: params.code,
    codeVerifier: oauthState.code_verifier ?? undefined,
    redirectUri,
  });

  // 4. Persistir integração
  const expiresInMs = tokens.expiresIn ? tokens.expiresIn * 1000 : null;
  const tokenExpiresAt = expiresInMs ? new Date(Date.now() + expiresInMs) : null;

  const integration = await integrationRepo.create({
    tenant_id: oauthState.tenant_id,
    provider_identifier: params.providerIdentifier,
    internal_id: tokens.id,
    name: tokens.name,
    username: tokens.username,
    picture: tokens.picture,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken ?? null,
    token_expires_at: tokenExpiresAt,
  });

  logger.info(
    { integrationId: integration.id, tenantId: oauthState.tenant_id, provider: params.providerIdentifier },
    'OAuth concluído',
  );

  return {
    integrationId: integration.id,
    redirectAfter: oauthState.redirect_after,
  };
}

function getRedirectUri(providerIdentifier: string): string {
  switch (providerIdentifier) {
    case 'instagram':
      return config.META_REDIRECT_URI ?? '';
    case 'tiktok':
      return config.TIKTOK_REDIRECT_URI ?? '';
    case 'linkedin':
      return config.LINKEDIN_REDIRECT_URI ?? '';
    default:
      throw new Error(`Redirect URI não configurado para ${providerIdentifier}`);
  }
}