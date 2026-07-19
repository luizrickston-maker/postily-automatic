// src/posts/post.service.ts — lógica de negócio
import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import * as repo from './post.repository.js';
import * as integrationRepo from '../integrations/integration.repository.js';
import * as integrationService from '../integrations/integration.service.js';
import { getSocialProvider } from '../integrations/integration.manager.js';
import { RefreshTokenError, BadBodyError } from '../integrations/errors.js';
import { logger } from '../logger.js';
import type { CreatePostInputSchema } from './post.schemas.js';

export async function createScheduledPost(
  tenantId: string,
  input: CreatePostInputSchema,
): Promise<{ group_id: string | null; posts: repo.Post[] }> {
  // 1. Verifica que todas as integrações existem e pertencem ao tenant
  const integrations = await Promise.all(
    input.integration_ids.map((id) =>
      integrationRepo.findById(id).then((int) => {
        if (!int) throw new Error(`Integration ${id} não encontrada`);
        if (int.tenant_id !== tenantId) throw new Error(`Integration ${id} não pertence ao tenant`);
        if (int.disabled) throw new Error(`Integration ${id} está desabilitada`);
        return int;
      }),
    ),
  );

  // 2. Se múltiplas plataformas, gera group_id (combo multi-plataforma)
  const groupId = input.integration_ids.length > 1 ? crypto.randomUUID() : null;

  // 3. Validação prévia: cada integration só recebe mídia compatível com seu provider
  for (let i = 0; i < integrations.length; i++) {
    const integration = integrations[i]!;
    const provider = getSocialProvider(integration.provider_identifier);
    const validity = await provider.checkValidity(
      [input.media ?? []],
      input.settings ?? {},
    );
    if (validity !== true) {
      throw new Error(`Validação falhou para ${integration.provider_identifier}: ${validity}`);
    }
  }

  // 4. Cria 1 post por integration
  const posts = await Promise.all(
    integrations.map((integration) =>
      repo.create({
        tenant_id: tenantId,
        integration_id: integration.id,
        group_id: groupId,
        publish_date: new Date(input.publish_date),
        content: input.content,
        settings: input.settings ?? {},
        media: input.media ?? [],
      }),
    ),
  );

  logger.info(
    {
      tenantId,
      groupId,
      postIds: posts.map((p) => p.id),
      platforms: integrations.map((i) => i.provider_identifier),
    },
    'Posts criados',
  );

  return { group_id: groupId, posts };
}

export async function listPosts(
  tenantId: string,
  query: {
    state?: repo.PostState;
    from?: Date;
    to?: Date;
    integrationId?: string;
    groupId?: string;
    limit?: number;
  },
): Promise<repo.Post[]> {
  return repo.list({
    tenantId,
    state: query.state,
    from: query.from,
    to: query.to,
    integrationId: query.integrationId,
    groupId: query.groupId,
    limit: query.limit,
  });
}

export async function cancelPost(
  id: string,
  tenantId: string,
): Promise<boolean> {
  return repo.cancel(id, tenantId);
}

/**
 * Publica um post específico (chamado pelo worker).
 */
export async function publishPost(postId: string): Promise<void> {
  // Carrega post + integration em uma query
  const { rows } = await pool.query(
    `SELECT p.*,
            i.id as integration_uuid,
            i.provider_identifier, i.internal_id, i.access_token, i.refresh_token,
            i.token_expires_at, i.tenant_id as integration_tenant_id
     FROM posts p
     JOIN integrations i ON i.id = p.integration_id
     WHERE p.id = $1`,
    [postId],
  );
  const data = rows[0];
  if (!data) {
    logger.warn({ postId }, 'Post não encontrado para publicação');
    return;
  }

  try {
    // Garante token válido (renova se expirado/próximo de expirar)
    const validToken = await integrationService.ensureValidToken({
      id: data.integration_uuid,
      tenant_id: data.integration_tenant_id,
      provider_identifier: data.provider_identifier,
      internal_id: data.internal_id,
      name: '',
      username: null,
      picture: null,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.token_expires_at,
      additional_settings: {},
      disabled: false,
      refresh_needed: false,
      created_at: data.created_at,
      updated_at: data.updated_at,
    });

    const provider = getSocialProvider(data.provider_identifier);
    const responses = await provider.post(
      { internalId: data.internal_id, accessToken: validToken },
      [
        {
          message: data.content,
          settings: data.settings ?? {},
          media: data.media ?? [],
        },
      ],
    );

    const main = responses[0];
    if (!main) {
      throw new BadBodyError('Provider retornou sem response', data.provider_identifier);
    }
    await repo.markPublished(postId, main.postId, main.releaseURL);

    logger.info(
      { postId, platform: data.provider_identifier, releaseUrl: main.releaseURL },
      'Post publicado com sucesso',
    );
  } catch (err) {
    if (err instanceof RefreshTokenError) {
      await integrationRepo.markRefreshNeeded(data.integration_uuid);
      logger.warn(
        { postId, integrationId: data.integration_uuid, err: err.message },
        'Token precisa ser renovado — marcando integration.refresh_needed',
      );
      await repo.markError(postId, `Token expirado: ${err.message}`, 5);
      return;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ postId, err: errMsg }, 'Falha ao publicar post');
    await repo.markError(postId, errMsg);
  }
}