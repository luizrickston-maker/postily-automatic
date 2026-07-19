// src/db/pool.ts — pool único de conexões PostgreSQL
// Em produção (Supabase), SSL é obrigatório. Em dev local, SSL desligado.
import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { Pool } = pg;

const isProd = config.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Supabase exige SSL em produção. Em dev local (Postgres sem SSL), não.
  ssl: isProd ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err: Error) => {
  logger.error({ err }, 'Postgres pool error');
});

pool.on('connect', () => {
  logger.debug({ nodeEnv: config.NODE_ENV, ssl: isProd }, 'Postgres connected');
});

export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Postgres pool closed');
}