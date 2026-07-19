// src/posts/post.routes.ts
import type { FastifyInstance } from 'fastify';
import { authMiddleware, requireScope, type AuthenticatedRequest } from '../api-keys/api-key.middleware.js';
import { createPostSchema, listPostsSchema } from './post.schemas.js';
import * as service from './post.service.js';

export async function postRoutes(app: FastifyInstance): Promise<void> {
  // Criar post agendado (suporta multi-plataforma via integration_ids[])
  app.post('/api/posts', {
    preHandler: [authMiddleware, requireScope('posts:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    try {
      const result = await service.createScheduledPost(req.apiKey!.tenant_id, parsed.data);
      return reply.code(201).send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      return reply.code(400).send({ error: msg });
    }
  });

  // Listar posts
  app.get('/api/posts', {
    preHandler: [authMiddleware, requireScope('posts:read')],
  }, async (req: AuthenticatedRequest, reply) => {
    const parsed = listPostsSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }

    return service.listPosts(req.apiKey!.tenant_id, {
      state: parsed.data.state,
      from: parsed.data.from ? new Date(parsed.data.from) : undefined,
      to: parsed.data.to ? new Date(parsed.data.to) : undefined,
      integrationId: parsed.data.integration_id,
      groupId: parsed.data.group_id,
      limit: parsed.data.limit,
    });
  });

  // Detalhe de um post
  app.get<{ Params: { id: string } }>('/api/posts/:id', {
    preHandler: [authMiddleware, requireScope('posts:read')],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const post = await service.listPosts(req.apiKey!.tenant_id, {}).then((all) =>
      all.find((p) => p.id === id),
    );
    if (!post) return reply.code(404).send({ error: 'Post não encontrado' });
    return post;
  });

  // Cancelar post QUEUE
  app.patch<{ Params: { id: string } }>('/api/posts/:id/cancel', {
    preHandler: [authMiddleware, requireScope('posts:write')],
  }, async (req: AuthenticatedRequest, reply) => {
    const { id } = req.params as { id: string };
    const ok = await service.cancelPost(id, req.apiKey!.tenant_id);
    if (!ok) {
      return reply.code(409).send({ error: 'Post não pode ser cancelado (já publicado ou em publicação)' });
    }
    return reply.code(204).send();
  });
}