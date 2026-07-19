// src/api-keys/api-key.service.ts — geração, validação e revogação
import crypto from 'node:crypto';
import { config } from '../config.js';
import * as repo from './api-key.repository.js';
import { logger } from '../logger.js';

const KEY_PREFIX_PUBLIC = 'pl_live_';
const KEY_LENGTH_BYTES = 32; // 256 bits de entropia

export interface CreateApiKeyOptions {
  tenant_id: string;
  name: string;
  scopes?: string[];
  expires_at?: Date | null;
}

/**
 * Gera um novo API key.
 * Retorna: { apiKey (record no DB, SEM o token puro), token (texto puro — MOSTRAR APENAS UMA VEZ) }
 */
export async function createApiKey(
  options: CreateApiKeyOptions,
): Promise<{ apiKey: repo.ApiKey; token: string }> {
  // Gera token: pl_live_ + base64url(32 bytes) = ~51 chars
  const random = crypto.randomBytes(KEY_LENGTH_BYTES).toString('base64url');
  const token = `${KEY_PREFIX_PUBLIC}${random}`;

  const hash = sha256(token);
  const prefix = `pl_live_...${token.slice(-8)}`;

  const apiKey = await repo.create({
    tenant_id: options.tenant_id,
    name: options.name,
    key_hash: hash,
    key_prefix: prefix,
    scopes: options.scopes,
    expires_at: options.expires_at ?? null,
  });

  return { apiKey, token };
}

/**
 * Valida um token puro. Retorna o registro se válido, null se inválido.
 */
export async function validateToken(token: string): Promise<repo.ApiKey | null> {
  if (!token.startsWith(KEY_PREFIX_PUBLIC)) return null;
  const hash = sha256(token);
  return repo.findByHash(hash);
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const ok = await repo.revoke(id);
  if (ok) logger.info({ apiKeyId: id }, 'API key revogada');
  return ok;
}

export async function listByTenant(tenantId: string): Promise<repo.ApiKey[]> {
  return repo.listByTenant(tenantId);
}

export async function touchApiKey(id: string): Promise<void> {
  // Fire-and-forget — não bloqueia a request
  repo.touchLastUsed(id).catch((err) => logger.warn({ err }, 'touchLastUsed falhou'));
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}