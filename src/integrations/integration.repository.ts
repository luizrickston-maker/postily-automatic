// src/integrations/integration.repository.ts
import { pool } from '../db/pool.js';

export interface Integration {
  id: string;
  tenant_id: string;
  provider_identifier: string;
  internal_id: string;
  name: string;
  username: string | null;
  picture: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | null;
  additional_settings: Record<string, any>;
  disabled: boolean;
  refresh_needed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIntegrationInput {
  tenant_id: string;
  provider_identifier: string;
  internal_id: string;
  name: string;
  username?: string | null;
  picture?: string | null;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: Date | null;
  additional_settings?: Record<string, any>;
}

export async function create(input: CreateIntegrationInput): Promise<Integration> {
  const { rows } = await pool.query<Integration>(
    `INSERT INTO integrations (
      tenant_id, provider_identifier, internal_id, name, username, picture,
      access_token, refresh_token, token_expires_at, additional_settings
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (tenant_id, provider_identifier, internal_id)
    DO UPDATE SET
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      picture = EXCLUDED.picture,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      additional_settings = EXCLUDED.additional_settings,
      refresh_needed = FALSE,
      updated_at = NOW()
    RETURNING *`,
    [
      input.tenant_id,
      input.provider_identifier,
      input.internal_id,
      input.name,
      input.username ?? null,
      input.picture ?? null,
      input.access_token,
      input.refresh_token ?? null,
      input.token_expires_at ?? null,
      JSON.stringify(input.additional_settings ?? {}),
    ],
  );
  return rows[0]!;
}

export async function findById(id: string): Promise<Integration | null> {
  const { rows } = await pool.query<Integration>(
    `SELECT * FROM integrations WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string): Promise<Integration[]> {
  const { rows } = await pool.query<Integration>(
    `SELECT id, tenant_id, provider_identifier, internal_id, name, username, picture,
            token_expires_at, additional_settings, disabled, refresh_needed,
            created_at, updated_at
     FROM integrations
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}

export async function updateTokens(
  id: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
): Promise<Integration | null> {
  const { rows } = await pool.query<Integration>(
    `UPDATE integrations
     SET access_token = $1, refresh_token = $2, token_expires_at = $3,
         refresh_needed = FALSE, updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [accessToken, refreshToken, expiresAt, id],
  );
  return rows[0] ?? null;
}

export async function markRefreshNeeded(id: string): Promise<void> {
  await pool.query(
    `UPDATE integrations SET refresh_needed = TRUE, updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function remove(id: string, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM integrations WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function setDisabled(
  id: string,
  tenantId: string,
  disabled: boolean,
): Promise<Integration | null> {
  const { rows } = await pool.query<Integration>(
    `UPDATE integrations SET disabled = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3
     RETURNING *`,
    [disabled, id, tenantId],
  );
  return rows[0] ?? null;
}