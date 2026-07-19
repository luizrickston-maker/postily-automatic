// scripts/migrate.ts — roda migrations SQL em ordem
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'supabase', 'migrations');

async function main() {
  logger.info('Running migrations from ' + migrationsDir);

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    logger.info(`  → ${file}`);
    try {
      await pool.query(sql);
      logger.info(`    ✓ done`);
    } catch (err) {
      logger.error({ err, file }, `    ✗ failed`);
      throw err;
    }
  }

  logger.info('All migrations applied.');
  await pool.end();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});