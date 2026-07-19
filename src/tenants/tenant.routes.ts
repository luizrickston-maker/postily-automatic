// src/tenants/tenant.routes.ts — endpoints REST de tenants
import type { FastifyInstance } from 'fastify';
import { createTenantSchema } from './tenant.schemas.js';
import * as repo from './tenant.repository.js';

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  // Lista tenants (admin pode passar ?parent_id=)
  app.get('/api/tenants', async (req) => {
    const { parent_id } = req.query as { parent_id?: string };
    if (parent_id) {
      return repo.listByParent(parent_id);
    }
    // sem filtro: retorna lista vazia (segurança) — usar com parent_id
    return [];
  });

  // Detalhe de um tenant
  app.get<{ Params: { id: string } }>('/api/tenants/:id', async (req, reply) => {
    const tenant = await repo.findById(req.params.id);
    if (!tenant) return reply.code(404).send({ error: 'Tenant não encontrado' });
    return tenant;
  });

  // Criar tenant
  app.post('/api/tenants', async (req, reply) => {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    // Verifica slug único
    const existing = await repo.findBySlug(parsed.data.slug);
    if (existing) {
      return reply.code(409).send({ error: 'slug já existe' });
    }

    const tenant = await repo.create(parsed.data);
    return reply.code(201).send(tenant);
  });

  // Atualizar tenant
  app.patch<{ Params: { id: string } }>('/api/tenants/:id', async (req, reply) => {
    const parsed = createTenantSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const updated = await repo.update(req.params.id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Tenant não encontrado' });
    return updated;
  });

  // Deletar tenant
  app.delete<{ Params: { id: string } }>('/api/tenants/:id', async (req, reply) => {
    const ok = await repo.remove(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'Tenant não encontrado' });
    return reply.code(204).send();
  });
}