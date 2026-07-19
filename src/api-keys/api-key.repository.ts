// src/api-keys/api-key.repository.ts
import { pool } from '../db/pool.js';

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export interface CreateApiKeyInput {
  tenant_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes?: string[];
  expires_at?: Date | null;
}

export async function create(input: CreateApiKeyInput): Promise<ApiKey> {
  const { rows } = await pool.query<ApiKey>(
    `INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.tenant_id,
      input.name,
      input.key_hash,
      input.key_prefix,
      input.scopes ?? ['posts:read', 'posts:write', 'integrations:read', 'integrations:write'],
      input.expires_at ?? null,
    ],
  );
  return rows[0]!;
}

export async function findByHash(keyHash: string): Promise<ApiKey | null> {
  const { rows } = await pool.query<ApiKey>(
    `SELECT * FROM api_keys
     WHERE key_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [keyHash],
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<ApiKey | null> {
  const { rows } = await pool.query<ApiKey>(
    `SELECT * FROM api_keys WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string): Promise<ApiKey[]> {
  const { rows } = await pool.query<ApiKey>(
    `SELECT id, tenant_id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at
     FROM api_keys
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

export async function touchLastUsed(id: string): Promise<void> {
  await pool.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [id]);
}

export async function revoke(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}