// src/api-keys/api-key.middleware.ts — Fastify preHandler que valida Bearer e injeta tenant
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as service from './api-key.service.js';

export interface AuthenticatedRequest extends FastifyRequest {
  apiKey?: {
    id: string;
    tenant_id: string;
    scopes: string[];
    name: string;
  };
}

/**
 * Middleware Fastify para autenticação via API Key (Bearer).
 * Adiciona req.apiKey com { id, tenant_id, scopes, name } se válido.
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Authorization header missing or invalid' });
  }

  const token = auth.slice('Bearer '.length).trim();
  if (!token) {
    return reply.code(401).send({ error: 'Empty token' });
  }

  const apiKey = await service.validateToken(token);
  if (!apiKey) {
    return reply.code(401).send({ error: 'Invalid or revoked token' });
  }

  req.apiKey = {
    id: apiKey.id,
    tenant_id: apiKey.tenant_id,
    scopes: apiKey.scopes,
    name: apiKey.name,
  };

  // Atualiza last_used_at (não bloqueia)
  service.touchApiKey(apiKey.id);
}

/**
 * Helper para verificar escopo
 */
export function requireScope(scope: string) {
  return async (req: AuthenticatedRequest, reply: FastifyReply): Promise<void> => {
    if (!req.apiKey) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }
    if (!req.apiKey.scopes.includes(scope)) {
      return reply.code(403).send({ error: `Missing scope: ${scope}` });
    }
  };
}