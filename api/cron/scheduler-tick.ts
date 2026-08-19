// api/cron/scheduler-tick.ts — endpoint do cron (chamado a cada minuto pelo GitHub Actions)
// Executa UMA passada do worker: pega posts vencidos e dispara publicação.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runTickNow } from '../../src/worker/scheduler.js';
import { logger } from '../../src/logger.js';

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth simples: GitHub Actions envia header Authorization: Bearer ${CRON_SECRET}
  if (CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${CRON_SECRET}`) {
      logger.warn({ auth: auth?.slice(0, 20) }, 'Cron tick rejeitado — auth inválida');
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
  }

  try {
    const startedAt = Date.now();
    const count = await runTickNow();
    const elapsedMs = Date.now() - startedAt;
    logger.info({ count, elapsedMs }, '🕐 Cron tick executado');
    res.status(200).json({ ok: true, published: count, elapsedMs });
  } catch (err) {
    logger.error({ err }, 'Cron tick falhou');
    res.status(500).json({ ok: false, error: String(err) });
  }
}
