// src/posts/post.repository.ts
import { pool } from '../db/pool.js';
import type { PostDetails } from '../integrations/types.js';

export type PostState = 'DRAFT' | 'QUEUE' | 'PUBLISHING' | 'PUBLISHED' | 'ERROR' | 'CANCELLED';

export interface Post {
  id: string;
  tenant_id: string;
  integration_id: string;
  group_id: string | null;
  state: PostState;
  publish_date: Date;
  content: string;
  settings: Record<string, any>;
  media: PostDetails['media'];
  release_id: string | null;
  release_url: string | null;
  error: string | null;
  attempts: number;
  last_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreatePostInput {
  tenant_id: string;
  integration_id: string;
  group_id?: string | null;
  publish_date: Date;
  content: string;
  settings?: Record<string, any>;
  media?: PostDetails['media'];
  state?: PostState;
}

export async function create(input: CreatePostInput): Promise<Post> {
  const { rows } = await pool.query<Post>(
    `INSERT INTO posts (tenant_id, integration_id, group_id, publish_date, content, settings, media, state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.tenant_id,
      input.integration_id,
      input.group_id ?? null,
      input.publish_date,
      input.content,
      JSON.stringify(input.settings ?? {}),
      JSON.stringify(input.media ?? []),
      input.state ?? 'QUEUE',
    ],
  );
  return rows[0]!;
}

export async function findById(id: string, tenantId: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `SELECT * FROM posts WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  return rows[0] ?? null;
}

export async function list(params: {
  tenantId: string;
  state?: PostState;
  from?: Date;
  to?: Date;
  integrationId?: string;
  groupId?: string;
  limit?: number;
}): Promise<Post[]> {
  const where: string[] = ['tenant_id = $1'];
  const values: any[] = [params.tenantId];
  let i = 2;

  if (params.state) {
    where.push(`state = $${i++}`);
    values.push(params.state);
  }
  if (params.from) {
    where.push(`publish_date >= $${i++}`);
    values.push(params.from);
  }
  if (params.to) {
    where.push(`publish_date <= $${i++}`);
    values.push(params.to);
  }
  if (params.integrationId) {
    where.push(`integration_id = $${i++}`);
    values.push(params.integrationId);
  }
  if (params.groupId) {
    where.push(`group_id = $${i++}`);
    values.push(params.groupId);
  }

  values.push(params.limit ?? 100);
  const limitIdx = i;

  const { rows } = await pool.query<Post>(
    `SELECT * FROM posts
     WHERE ${where.join(' AND ')}
     ORDER BY publish_date DESC
     LIMIT $${limitIdx}`,
    values,
  );
  return rows;
}

/**
 * Claim posts pendentes para publicação. Usa FOR UPDATE SKIP LOCKED
 * para permitir múltiplas instâncias do worker sem conflito.
 */
export async function claimDueForPublishing(batchSize: number): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `UPDATE posts SET
       state = 'PUBLISHING',
       last_attempt_at = NOW(),
       attempts = attempts + 1,
       updated_at = NOW()
     WHERE id IN (
       SELECT id FROM posts
       WHERE state = 'QUEUE' AND publish_date <= NOW()
       ORDER BY publish_date ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [batchSize],
  );
  return rows;
}

export async function markPublished(
  id: string,
  releaseId: string,
  releaseUrl: string,
): Promise<void> {
  await pool.query(
    `UPDATE posts SET state = 'PUBLISHED', release_id = $1, release_url = $2, error = NULL, updated_at = NOW()
     WHERE id = $3`,
    [releaseId, releaseUrl, id],
  );
}

export async function markError(id: string, error: string, maxAttempts = 3): Promise<void> {
  // Se ainda tem tentativas, volta pra QUEUE. Se excedeu, vai pra ERROR.
  await pool.query(
    `UPDATE posts SET
       state = CASE WHEN attempts >= $2 THEN 'ERROR' ELSE 'QUEUE' END,
       error = $3,
       updated_at = NOW()
     WHERE id = $1`,
    [id, maxAttempts, error.slice(0, 1000)],
  );
}

export async function cancel(id: string, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE posts SET state = 'CANCELLED', updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND state IN ('DRAFT','QUEUE')`,
    [id, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}