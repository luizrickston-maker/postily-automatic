// api/index.ts — entry point da Vercel Serverless Function
// Expõe a aplicação Fastify (buildApp) como handler Vercel.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildApp } from '../src/server.js';
import { logger } from '../src/logger.js';

// Singleton entre cold starts: o Vercel mantém a instância quente por alguns minutos
const appPromise = buildApp().catch((err: unknown) => {
  logger.error({ err }, 'Falha ao construir Fastify app');
  throw err;
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await appPromise;
  await app.ready();
  app.server.emit('request', req, res);
}
