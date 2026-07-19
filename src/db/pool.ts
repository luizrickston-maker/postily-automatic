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
  // Supabase sempre exige SSL. Postgres local sem SSL funciona.
  // Detecta Supabase pelo hostname e força SSL habilitado.
  ssl:
    config.DATABASE_URL.includes('localhost') ||
    config.DATABASE_URL.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
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