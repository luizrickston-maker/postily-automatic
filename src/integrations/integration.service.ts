// src/integrations/integration.service.ts — refresh token automático + validação
import * as repo from './integration.repository.js';
import { getSocialProvider } from './integration.manager.js';
import { RefreshTokenError } from './errors.js';
import { logger } from '../logger.js';

export async function listForTenant(tenantId: string) {
  return repo.listByTenant(tenantId);
}

export async function findById(id: string, tenantId: string) {
  const integration = await repo.findById(id);
  if (!integration || integration.tenant_id !== tenantId) return null;
  return integration;
}

/**
 * Se o token estiver expirado (ou próximo de expirar), renova automaticamente.
 * Retorna o access_token válido.
 */
export async function ensureValidToken(
  integration: repo.Integration,
): Promise<string> {
  // Se não tem expires_at, assume que é permanente (TikTok long-lived, Meta 60d)
  if (!integration.token_expires_at) {
    return integration.access_token;
  }

  const expiresAt = new Date(integration.token_expires_at);
  const now = new Date();
  const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Se expira em menos de 24h, renova
  if (hoursLeft > 24) {
    return integration.access_token;
  }

  if (!integration.refresh_token) {
    throw new RefreshTokenError(
      'Token expirado e sem refresh_token — usuário precisa reconectar',
      integration.provider_identifier,
    );
  }

  logger.info(
    { integrationId: integration.id, provider: integration.provider_identifier },
    'Renovando token',
  );

  const provider = getSocialProvider(integration.provider_identifier);
  const refreshed = await provider.refreshToken(integration.refresh_token);

  const expiresInMs = refreshed.expiresIn ? refreshed.expiresIn * 1000 : null;
  const newExpiresAt = expiresInMs ? new Date(Date.now() + expiresInMs) : null;

  const updated = await repo.updateTokens(
    integration.id,
    refreshed.accessToken,
    refreshed.refreshToken ?? integration.refresh_token,
    newExpiresAt,
  );

  return updated?.access_token ?? integration.access_token;
}