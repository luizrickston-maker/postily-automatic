// src/worker/scheduler.ts — loop que pega posts pendentes e dispara publicação
// Usa SELECT FOR UPDATE SKIP LOCKED para suportar múltiplos workers paralelos.
import { config } from '../config.js';
import { logger } from '../logger.js';
import * as postRepo from '../posts/post.repository.js';
import { publishPost } from '../posts/post.service.js';

let interval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startScheduler(): void {
  if (!config.SCHEDULER_ENABLED) {
    logger.info('Scheduler desabilitado por SCHEDULER_ENABLED=false');
    return;
  }

  if (interval) {
    logger.warn('Scheduler já está rodando');
    return;
  }

  logger.info(
    { pollMs: config.SCHEDULER_POLL_MS, batchSize: config.SCHEDULER_BATCH_SIZE },
    '🕐 Scheduler iniciado',
  );

  interval = setInterval(tick, config.SCHEDULER_POLL_MS);

  // Primeira tick quase imediata pra demo
  setTimeout(tick, 1000);
}

export function stopScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
    logger.info('Scheduler parado');
  }
}

async function tick(): Promise<void> {
  if (isRunning) {
    logger.debug('Tick anterior ainda rodando — pulando');
    return;
  }
  isRunning = true;

  try {
    const claimed = await postRepo.claimDueForPublishing(config.SCHEDULER_BATCH_SIZE);
    if (claimed.length === 0) {
      logger.debug('Nenhum post devido para publicação');
      return;
    }

    logger.info({ count: claimed.length }, `📤 Publicando ${claimed.length} post(s)`);

    // Publica em paralelo — falhas em um não afetam os outros
    await Promise.allSettled(
      claimed.map((post) =>
        publishPost(post.id).catch((err) =>
          logger.error({ postId: post.id, err }, 'publishPost threw'),
        ),
      ),
    );
  } catch (err) {
    logger.error({ err }, 'Erro no tick do scheduler');
  } finally {
    isRunning = false;
  }
}

/**
 * Função utilitária pra rodar manualmente um tick (útil pra testes / debug)
 */
export async function runTickNow(): Promise<number> {
  const claimed = await postRepo.claimDueForPublishing(config.SCHEDULER_BATCH_SIZE);
  await Promise.allSettled(
    claimed.map((post) => publishPost(post.id)),
  );
  return claimed.length;
}