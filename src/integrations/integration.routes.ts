// src/integrations/integration.routes.ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireScope, type AuthenticatedRequest } from '../api-keys/api-key.middleware.js';
import * as repo from './integration.repository.js';
import * as service from './integration.service.js';
import { listSocialProviders, isValidProvider } from './integration.manager.js';

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // Lista providers disponíveis (não precisa auth — útil pra UI antes de conectar)
  app.get('/api/integrations/providers', async () => {
    return listSocialProviders();
  });

  // Lista integrações conectadas do tenant
  app.get('/api/integrations', {
    preHandler: [authMiddleware],
  }, async (req: AuthenticatedRequest) => {
    return service.listForTenant(req.apiKey!.tenant_id);
  });

  // Detalhe de uma integração
  app.get<{ Params: { id: string } }>('/api/integrations/:id', {
    preHandler: [authMiddleware],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const integration = await service.findById(id, req.apiKey!.tenant_id);
    if (!integration) return reply.code(404).send({ error: 'Integração não encontrada' });
    // Não retorna access_token na listagem por segurança
    const { access_token, refresh_token, ...safe } = integration;
    return safe;
  });

  // Deletar (desconectar)
  app.delete<{ Params: { id: string } }>('/api/integrations/:id', {
    preHandler: [authMiddleware, requireScope('integrations:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const ok = await repo.remove(id, req.apiKey!.tenant_id);
    if (!ok) return reply.code(404).send({ error: 'Integração não encontrada' });
    return reply.code(204).send();
  });

  // Toggle disabled
  app.patch<{ Params: { id: string } }>('/api/integrations/:id', {
    preHandler: [authMiddleware, requireScope('integrations:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const { disabled } = req.body as { disabled?: boolean };
    if (typeof disabled !== 'boolean') {
      return reply.code(400).send({ error: 'Campo disabled deve ser boolean' });
    }
    const updated = await repo.setDisabled(id, req.apiKey!.tenant_id, disabled);
    if (!updated) return reply.code(404).send({ error: 'Integração não encontrada' });
    const { access_token, refresh_token, ...safe } = updated;
    return safe;
  });
}