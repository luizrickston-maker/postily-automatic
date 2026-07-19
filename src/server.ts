// src/server.ts — entry point da aplicação Postly
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

import { config } from './config.js';
import { logger } from './logger.js';
import { closePool, pool } from './db/pool.js';
import { startScheduler, stopScheduler } from './worker/scheduler.js';

// Routes
import { tenantRoutes } from './tenants/tenant.routes.js';
import { apiKeyRoutes } from './api-keys/api-key.routes.js';
import { integrationRoutes } from './integrations/integration.routes.js';
import { oauthRoutes } from './oauth/oauth.routes.js';
import { postRoutes } from './posts/post.routes.js';

async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: true, // libera tudo em dev; em prod, configure domínios específicos
    credentials: true,
  });
  await app.register(sensible);

  // Healthcheck (não conta na auth)
  app.get('/healthz', async () => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', db: 'connected', scheduler: config.SCHEDULER_ENABLED };
    } catch (err) {
      return { status: 'degraded', db: 'disconnected', error: String(err) };
    }
  });

  // Registra rotas
  await app.register(tenantRoutes);
  await app.register(apiKeyRoutes);
  await app.register(integrationRoutes);
  await app.register(oauthRoutes);
  await app.register(postRoutes);

  return app;
}

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info(`🚀 Postly rodando em http://localhost:${config.PORT}`);
  } catch (err) {
    logger.error({ err }, 'Falha ao iniciar servidor');
    process.exit(1);
  }

  // Inicia scheduler (mesmo processo)
  startScheduler();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Recebido sinal de shutdown');
    stopScheduler();
    try {
      await app.close();
      await closePool();
      logger.info('Shutdown completo');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Erro fatal');
  process.exit(1);
});