// src/api-keys/api-key.routes.ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireScope, type AuthenticatedRequest } from './api-key.middleware.js';
import * as service from './api-key.service.js';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  expires_at: z.string().datetime().optional().nullable(),
});

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  // Criar nova API key (requer auth + integrations:write ou admin)
  app.post('/api/api-keys', {
    preHandler: [authMiddleware, requireScope('integrations:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    const { apiKey, token } = await service.createApiKey({
      tenant_id: req.apiKey!.tenant_id,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      expires_at: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
    });

    // IMPORTANTE: o token puro é retornado APENAS aqui. Não é possível recuperá-lo depois.
    return reply.code(201).send({
      id: apiKey.id,
      name: apiKey.name,
      key_prefix: apiKey.key_prefix,
      token, // ← só aparece aqui
      scopes: apiKey.scopes,
      expires_at: apiKey.expires_at,
      created_at: apiKey.created_at,
    });
  });

  // Listar API keys do tenant
  app.get('/api/api-keys', {
    preHandler: [authMiddleware],
  }, async (req: AuthenticatedRequest) => {
    return service.listByTenant(req.apiKey!.tenant_id);
  });

  // Revogar API key
  app.delete<{ Params: { id: string } }>('/api/api-keys/:id', {
    preHandler: [authMiddleware, requireScope('integrations:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const ok = await service.revokeApiKey(id);
    if (!ok) return reply.code(404).send({ error: 'API key não encontrada ou já revogada' });
    return reply.code(204).send();
  });
}