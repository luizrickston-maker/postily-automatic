// src/oauth/oauth.routes.ts — endpoints públicos (sem auth de API key — a segurança é o state)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as service from './oauth.service.js';
import { config } from '../config.js';
import { isValidProvider } from '../integrations/integration.manager.js';

const startSchema = z.object({
  tenant_id: z.string().uuid('tenant_id deve ser UUID'),
  redirect_after: z.string().url().optional(),
});

export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /oauth/:provider/start?tenant_id=xxx
   * Inicia o fluxo — redireciona para o provider.
   *
   * NOTA: este endpoint NÃO usa Bearer auth porque é o início do fluxo.
   * Em produção, a UI do postly redireciona o usuário aqui passando tenant_id.
   * Para taskvision: o taskvision chama este endpoint com o tenant_id do Postly
   * (criado anteriormente via POST /api/tenants).
   */
  app.get<{ Params: { provider: string } }>(
    '/oauth/:provider/start',
    async (req, reply) => {
      const provider = req.params.provider;
      if (!isValidProvider(provider)) {
        return reply.code(404).send({ error: `Provider '${provider}' não suportado` });
      }

      const parsed = startSchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'tenant_id obrigatório (UUID)' });
      }

      try {
        const { url } = await service.startOAuth({
          tenantId: parsed.data.tenant_id,
          providerIdentifier: provider,
          redirectAfter: parsed.data.redirect_after,
        });
        return reply.redirect(url);
      } catch (err) {
        req.log.error({ err }, 'Falha ao iniciar OAuth');
        return reply.code(500).send({ error: 'Falha ao iniciar OAuth' });
      }
    },
  );

  /**
   * GET /oauth/:provider/callback?code=xxx&state=xxx
   * Recebe o retorno do provider, troca code por tokens, persiste integração.
   */
  app.get<{ Params: { provider: string } }>(
    '/oauth/:provider/callback',
    async (req, reply) => {
      const provider = req.params.provider;
      if (!isValidProvider(provider)) {
        return reply.code(404).send({ error: `Provider '${provider}' não suportado` });
      }

      const { code, state, error: oauthError } = req.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (oauthError) {
        return reply.code(400).send({ error: `Provider retornou erro: ${oauthError}` });
      }
      if (!code || !state) {
        return reply.code(400).send({ error: 'code e state são obrigatórios' });
      }

      try {
        const result = await service.completeOAuth({
          providerIdentifier: provider,
          code,
          state,
        });

        // Redireciona para o redirect_after (UI do postly ou taskvision)
        const redirectUrl = result.redirectAfter ?? `${config.PUBLIC_URL}/integrations?success=true&id=${result.integrationId}`;
        return reply.redirect(redirectUrl);
      } catch (err) {
        req.log.error({ err }, 'Falha no callback OAuth');
        return reply.code(500).send({ error: err instanceof Error ? err.message : 'Falha no callback' });
      }
    },
  );
}