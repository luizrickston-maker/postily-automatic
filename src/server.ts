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

export async function buildApp() {
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

  // Rota de Política de Privacidade — exigida pelo Meta App
  app.get('/privacy', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Política de Privacidade — Postly / Chapada Digital</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #222; }
    h1 { color: #1a1a1a; }
    h2 { margin-top: 32px; color: #333; }
    a { color: #0066cc; }
    .meta { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Política de Privacidade</h1>
  <p class="meta">Última atualização: 11 de agosto de 2026 · Postly / Chapada Digital</p>

  <p>A <strong>Chapada Digital</strong> ("nós") opera o <strong>Postly</strong>, uma plataforma de publicação em redes sociais. Esta política descreve como coletamos, usamos e protegemos as informações dos usuários que conectam suas contas de redes sociais (Instagram, TikTok, LinkedIn) ao Postly.</p>

  <h2>1. Dados que coletamos</h2>
  <p>Quando você conecta uma conta de rede social ao Postly via OAuth, recebemos:</p>
  <ul>
    <li>Identificador da conta (ID e username)</li>
    <li>Token de acesso de longa duração (criptografado em repouso)</li>
    <li>Foto de perfil (opcional)</li>
    <li>Metadados das contas (nome, página conectada)</li>
  </ul>
  <p>Não coletamos senha da sua conta em redes sociais — a autenticação é feita pelo próprio Facebook/Meta, TikTok ou LinkedIn.</p>

  <h2>2. Como usamos os dados</h2>
  <p>Os tokens de acesso são usados exclusivamente para publicar conteúdo que você agendou no Postly. Não vendemos, compartilhamos ou usamos para outros fins.</p>

  <h2>3. Armazenamento</h2>
  <p>Os tokens são armazenados em banco de dados PostgreSQL gerenciado pelo Supabase, com criptografia em repouso e acesso restrito.</p>

  <h2>4. Exclusão de dados</h2>
  <p>Você pode revogar o acesso a qualquer momento pelo painel do Postly ou pelas configurações do Facebook em <a href="https://www.facebook.com/settings?tab=applications" target="_blank" rel="noopener">Aplicativos e Sites</a>. Após revogar, deletamos os tokens do nosso banco.</p>

  <h2>5. Contato</h2>
  <p>Dúvidas: <a href="mailto:chapadadigitalbr@gmail.com">chapadadigitalbr@gmail.com</a></p>

  <hr>
  <p class="meta">Chapada Digital · CNPJ: [a definir] · Endereço: Chapada dos Veadeiros, GO</p>
</body>
</html>`;
  });

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