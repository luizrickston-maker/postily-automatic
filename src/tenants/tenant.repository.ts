// src/tenants/tenant.repository.ts — queries SQL da tabela tenants
import { pool } from '../db/pool.js';

export interface Tenant {
  id: string;
  type: 'agency' | 'client';
  name: string;
  slug: string;
  external_id: string | null;
  parent_id: string | null;
  settings: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTenantInput {
  type: 'agency' | 'client';
  name: string;
  slug: string;
  external_id?: string;
  parent_id?: string;
  settings?: Record<string, any>;
}

export async function create(input: CreateTenantInput): Promise<Tenant> {
  const { rows } = await pool.query<Tenant>(
    `INSERT INTO tenants (type, name, slug, external_id, parent_id, settings)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.type,
      input.name,
      input.slug,
      input.external_id ?? null,
      input.parent_id ?? null,
      JSON.stringify(input.settings ?? {}),
    ],
  );
  return rows[0]!;
}

export async function findById(id: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Tenant>(
    `SELECT * FROM tenants WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findBySlug(slug: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Tenant>(
    `SELECT * FROM tenants WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function findByExternalId(externalId: string): Promise<Tenant | null> {
  const { rows } = await pool.query<Tenant>(
    `SELECT * FROM tenants WHERE external_id = $1 LIMIT 1`,
    [externalId],
  );
  return rows[0] ?? null;
}

export async function listByParent(parentId: string): Promise<Tenant[]> {
  const { rows } = await pool.query<Tenant>(
    `SELECT * FROM tenants WHERE parent_id = $1 ORDER BY created_at DESC`,
    [parentId],
  );
  return rows;
}

export async function update(
  id: string,
  updates: Partial<CreateTenantInput>,
): Promise<Tenant | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(updates.name);
  }
  if (updates.slug !== undefined) {
    fields.push(`slug = $${i++}`);
    values.push(updates.slug);
  }
  if (updates.external_id !== undefined) {
    fields.push(`external_id = $${i++}`);
    values.push(updates.external_id);
  }
  if (updates.parent_id !== undefined) {
    fields.push(`parent_id = $${i++}`);
    values.push(updates.parent_id);
  }
  if (updates.settings !== undefined) {
    fields.push(`settings = $${i++}`);
    values.push(JSON.stringify(updates.settings));
  }

  if (fields.length === 0) return findById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query<Tenant>(
    `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function remove(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}