// src/integrations/social/instagram.provider.ts — Instagram Graph API v20.0
// Port de gitroomhq/postiz-app (instagram.provider.ts) — versão simplificada sem NestJS.
//
// Suporta:
//  - Feed: imagem única / carrossel
//  - Reels: vídeo curto com áudio opcional
//  - Stories: imagem/vídeo (múltiplas = múltiplas stories)
//  - Trial reels (recurso de teste do Instagram)
//  - Collaborators (colaboradores)
//  - Long-lived token (60 dias) com auto-refresh

import { config } from '../../config.js';
import { logger } from '../../logger.js';
import { SocialAbstract, type ErrorAction } from '../social.abstract.js';
import type {
  AuthTokenDetails,
  GenerateAuthUrlResponse,
  PostDetails,
  PostResponse,
} from '../types.js';

const API_BASE = 'https://graph.facebook.com';
const API_VERSION = config.META_GRAPH_VERSION;

export interface InstagramSettings {
  /** Tipo de mídia: post (feed) | story | reel */
  type?: 'post' | 'story' | 'reel';
  /** Compartilhar como trial reel */
  trial?: boolean;
  /** Estratégia de graduação do trial: MANUAL ou AUTOMATIC */
  trialGraduationStrategy?: 'MANUAL' | 'AUTOMATIC';
  /** IDs de colaboradores (até 3) */
  collaborators?: string[];
  /** Configuração de áudio (apenas Reels single video via Facebook Login) */
  audio?: {
    audioId: string;
    audioVolume?: number;
    videoVolume?: number;
  };
}

const MAX_RETRIES = 18;
const RETRY_DELAY_MS = 30_000;
const MAX_LENGTH = 2200;

export class InstagramProvider extends SocialAbstract {
  identifier = 'instagram';
  name = 'Instagram';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
  ];
  editorType = 'normal' as const;

  maxLength(): number {
    return MAX_LENGTH;
  }

  // ============================================================
  // OAuth
  // ============================================================

  async generateAuthUrl(state: string): Promise<GenerateAuthUrlResponse> {
    if (!config.META_APP_ID || !config.META_REDIRECT_URI) {
      throw new Error('META_APP_ID e META_REDIRECT_URI são obrigatórios para Instagram');
    }
    const url = new URL('https://www.facebook.com/' + API_VERSION + '/dialog/oauth');
    url.searchParams.set('client_id', config.META_APP_ID);
    url.searchParams.set('redirect_uri', config.META_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scopes.join(','));
    url.searchParams.set('response_type', 'code');
    return { url: url.toString(), state };
  }

  async authenticate(params: {
    code: string;
    redirectUri?: string;
  }): Promise<AuthTokenDetails> {
    if (!config.META_APP_ID || !config.META_APP_SECRET) {
      throw new Error('META_APP_ID e META_APP_SECRET são obrigatórios');
    }

    // 1. Trocar code por short-lived token
    const redirectUri = params.redirectUri ?? config.META_REDIRECT_URI!;
    const tokenUrl = new URL(`${API_BASE}/${API_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', config.META_APP_ID);
    tokenUrl.searchParams.set('client_secret', config.META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', params.code);

    const tokenRes = await this.fetch(tokenUrl.toString(), { method: 'GET' });
    const tokenData = (await tokenRes.json()) as { access_token: string };

    // 2. Upgrade para long-lived token (60 dias)
    const longLivedUrl = new URL(`${API_BASE}/${API_VERSION}/oauth/access_token`);
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.set('client_id', config.META_APP_ID);
    longLivedUrl.searchParams.set('client_secret', config.META_APP_SECRET);
    longLivedUrl.searchParams.set('fb_exchange_token', tokenData.access_token);

    const longRes = await this.fetch(longLivedUrl.toString(), { method: 'GET' });
    const longData = (await longRes.json()) as {
      access_token: string;
      expires_in: number;
    };

    // 3. Buscar informações do usuário e suas páginas
    const meUrl = `${API_BASE}/${API_VERSION}/me?fields=id,name&access_token=${longData.access_token}`;
    const meRes = await this.fetch(meUrl, { method: 'GET' });
    const meData = (await meRes.json()) as { id: string; name: string };

    // 4. Encontrar conta Instagram Business conectada à primeira página
    const pagesUrl = `${API_BASE}/${API_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${longData.access_token}`;
    const pagesRes = await this.fetch(pagesUrl, { method: 'GET' });
    const pagesData = (await pagesRes.json()) as {
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: {
          id: string;
          username: string;
          profile_picture_url?: string;
        };
      }>;
    };

    const pageWithInstagram = pagesData.data.find((p) => p.instagram_business_account);
    if (!pageWithInstagram?.instagram_business_account) {
      throw new Error(
        'Nenhuma conta Instagram Business encontrada. Você precisa ter uma Página do Facebook conectada a um Instagram Business.',
      );
    }

    const igAccount = pageWithInstagram.instagram_business_account;

    return {
      id: igAccount.id,
      name: igAccount.username,
      username: igAccount.username,
      picture: igAccount.profile_picture_url,
      accessToken: longData.access_token,
      expiresIn: longData.expires_in,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    // Para long-lived tokens do Meta: o mesmo token de 60 dias pode ser "renovado"
    // desde que ainda não tenha expirado (regra do Meta). Se já expirou, o usuário
    // precisa refazer o OAuth. Aqui tentamos renovar o que ainda é válido.
    const url = new URL(`${API_BASE}/${API_VERSION}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token');
    url.searchParams.set('client_id', config.META_APP_ID!);
    url.searchParams.set('client_secret', config.META_APP_SECRET!);
    url.searchParams.set('fb_exchange_token', refreshToken);

    const response = await this.fetch(url.toString(), { method: 'GET' });
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      id?: string;
      name?: string;
    };

    return {
      id: data.id ?? '',
      name: data.name ?? '',
      username: data.name ?? '',
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  // ============================================================
  // Publicação
  // ============================================================

  async post(
    integration: { internalId: string; accessToken: string },
    posts: PostDetails<InstagramSettings>[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      const settings = post.settings ?? {};
      const type = settings.type ?? 'post';
      const media = post.media ?? [];
      const message = post.message;

      // Validação
      if (message.length > MAX_LENGTH) {
        throw new Error(`Mensagem excede ${MAX_LENGTH} caracteres do Instagram`);
      }

      if (type === 'story') {
        // Stories múltiplas viram múltiplas stories individuais (Instagram não suporta carrossel em story)
        for (const item of media) {
          const result = await this.publishStory(integration, item);
          results.push(result);
        }
      } else if (media.length === 0) {
        // Texto puro no feed (suportado pelo Instagram)
        const result = await this.publishSingleFeed(integration, {
          message,
          media: null,
          settings,
        });
        results.push(result);
      } else if (media.length === 1) {
        const result = await this.publishSingleFeed(integration, {
          message,
          media: media[0]!,
          settings,
        });
        results.push(result);
      } else {
        // Carrossel
        const result = await this.publishCarousel(integration, {
          message,
          media,
          settings,
        });
        results.push(result);
      }
    }

    return results;
  }

  // ============================================================
  // Cenários individuais
  // ============================================================

  private async publishSingleFeed(
    integration: { internalId: string; accessToken: string },
    args: { message: string; media: MediaContent | null; settings: InstagramSettings },
  ): Promise<PostResponse> {
    const { internalId, accessToken } = integration;
    const { message, media, settings } = args;

    const isReel = settings.type === 'reel';
    const isVideo = media?.type === 'video';

    // 1. Criar container de mídia
    const createParams: Record<string, string> = {
      caption: message,
      access_token: accessToken,
    };

    if (!media) {
      // Sem mídia: post só de texto (requer conta business)
      // O Graph API não suporta text-only posts diretamente — retorna erro
      throw new Error('Instagram não suporta post só de texto. Anexe ao menos uma imagem/vídeo.');
    }

    if (isVideo) {
      createParams.media_type = isReel ? 'REELS' : 'VIDEO';
      createParams.video_url = media.path;
    } else {
      createParams.image_url = media.path;
    }

    // Trial reels
    if (isReel && settings.trial) {
      createParams.trial_params = JSON.stringify({
        graduation_strategy: settings.trialGraduationStrategy ?? 'MANUAL',
      });
    }

    // Collaborators
    if (settings.collaborators?.length && !isReel) {
      createParams.collaborators = JSON.stringify(settings.collaborators);
    }

    // Audio (single reel only)
    if (isReel && isVideo && settings.audio && media === args.media) {
      createParams.audio_id = settings.audio.audioId;
      if (settings.audio.audioVolume !== undefined) {
        createParams.audio_volume = String(settings.audio.audioVolume);
      }
      if (settings.audio.videoVolume !== undefined) {
        createParams.video_volume = String(settings.audio.videoVolume);
      }
    }

    const createUrl = `${API_BASE}/${API_VERSION}/${internalId}/media`;
    const createRes = await this.fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createParams),
    });
    const createData = (await createRes.json()) as { id: string };

    // 2. Polling até o container ficar pronto
    const mediaId = await this.pollMediaStatus(internalId, createData.id, accessToken);

    // 3. Publicar
    const publishUrl = `${API_BASE}/${API_VERSION}/${internalId}/media_publish?creation_id=${mediaId}&access_token=${accessToken}`;
    const publishRes = await this.fetch(publishUrl, { method: 'POST' });
    const publishData = (await publishRes.json()) as { id: string };

    // 4. Buscar permalink
    const permalink = await this.fetchPermalink(internalId, publishData.id, accessToken);

    return {
      postId: publishData.id,
      releaseURL: permalink,
      status: 'published',
    };
  }

  private async publishCarousel(
    integration: { internalId: string; accessToken: string },
    args: { message: string; media: MediaContent[]; settings: InstagramSettings },
  ): Promise<PostResponse> {
    const { internalId, accessToken } = integration;
    const { message, media, settings } = args;

    if (media.length < 2 || media.length > 10) {
      throw new Error('Carrossel do Instagram aceita entre 2 e 10 mídias');
    }

    // 1. Criar container para cada item do carrossel
    const childrenIds: string[] = [];
    for (const item of media) {
      const params: Record<string, string> = {
        is_carousel_item: 'true',
        access_token: accessToken,
      };
      if (item.type === 'video') {
        params.media_type = 'VIDEO';
        params.video_url = item.path;
      } else {
        params.image_url = item.path;
      }
      const url = `${API_BASE}/${API_VERSION}/${internalId}/media`;
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = (await res.json()) as { id: string };
      childrenIds.push(data.id);
    }

    // 2. Polling em cada filho
    for (const id of childrenIds) {
      await this.pollMediaStatus(internalId, id, accessToken);
    }

    // 3. Criar container do carrossel
    const carouselParams: Record<string, string> = {
      media_type: 'CAROUSEL',
      caption: message,
      children: childrenIds.join(','),
      access_token: accessToken,
    };
    if (settings.collaborators?.length) {
      carouselParams.collaborators = JSON.stringify(settings.collaborators);
    }
    const carouselUrl = `${API_BASE}/${API_VERSION}/${internalId}/media`;
    const carouselRes = await this.fetch(carouselUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(carouselParams),
    });
    const carouselData = (await carouselRes.json()) as { id: string };

    // 4. Polling no container do carrossel
    const finalContainerId = await this.pollMediaStatus(internalId, carouselData.id, accessToken);

    // 5. Publicar
    const publishUrl = `${API_BASE}/${API_VERSION}/${internalId}/media_publish?creation_id=${finalContainerId}&access_token=${accessToken}`;
    const publishRes = await this.fetch(publishUrl, { method: 'POST' });
    const publishData = (await publishRes.json()) as { id: string };

    const permalink = await this.fetchPermalink(internalId, publishData.id, accessToken);

    return {
      postId: publishData.id,
      releaseURL: permalink,
      status: 'published',
    };
  }

  private async publishStory(
    integration: { internalId: string; accessToken: string },
    media: MediaContent,
  ): Promise<PostResponse> {
    const { internalId, accessToken } = integration;

    const params: Record<string, string> = {
      media_type: 'STORIES',
      access_token: accessToken,
    };
    if (media.type === 'video') {
      params.video_url = media.path;
    } else {
      params.image_url = media.path;
    }

    const url = `${API_BASE}/${API_VERSION}/${internalId}/media`;
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as { id: string };

    const mediaId = await this.pollMediaStatus(internalId, data.id, accessToken);

    const publishUrl = `${API_BASE}/${API_VERSION}/${internalId}/media_publish?creation_id=${mediaId}&access_token=${accessToken}`;
    const publishRes = await this.fetch(publishUrl, { method: 'POST' });
    const publishData = (await publishRes.json()) as { id: string };

    const permalink = await this.fetchPermalink(internalId, publishData.id, accessToken);

    return {
      postId: publishData.id,
      releaseURL: permalink,
      status: 'published',
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  private async pollMediaStatus(
    userId: string,
    containerId: string,
    accessToken: string,
  ): Promise<string> {
    const url = `${API_BASE}/${API_VERSION}/${containerId}?fields=status_code,status&access_token=${accessToken}`;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      await this.delay(RETRY_DELAY_MS);
      const res = await this.fetch(url, { method: 'GET' });
      const data = (await res.json()) as {
        status_code?: string;
        status?: string;
      };
      const status = data.status_code ?? data.status;
      if (status === 'FINISHED') return containerId;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Instagram container ${containerId} falhou: ${status}`);
      }
      logger.debug({ containerId, attempt, status }, 'Instagram polling...');
    }
    throw new Error(`Instagram container ${containerId} timeout após ${MAX_RETRIES} tentativas`);
  }

  private async fetchPermalink(
    userId: string,
    mediaId: string,
    accessToken: string,
  ): Promise<string> {
    try {
      const url = `${API_BASE}/${API_VERSION}/${mediaId}?fields=permalink&access_token=${accessToken}`;
      const res = await this.fetch(url, { method: 'GET' });
      const data = (await res.json()) as { permalink?: string };
      return data.permalink ?? `https://www.instagram.com/p/${mediaId}`;
    } catch {
      return `https://www.instagram.com/p/${mediaId}`;
    }
  }

  override handleErrors(body: string, status: number): ErrorAction | undefined {
    // Mapeamento de erros comuns do Graph API
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.error?.code;
      const message = parsed?.error?.message ?? '';

      // Token expirado
      if (code === 190 || status === 401) {
        return { type: 'refresh-token', value: message || 'Token expirado' };
      }

      // Rate limit
      if (code === 4 || code === 17 || code === 32 || status === 429) {
        return { type: 'retry', value: 'Rate limit do Instagram' };
      }

      // Erros recuperáveis (transient)
      if ([2, 4, 17, 341, 368, 2207050].includes(code)) {
        return { type: 'retry', value: message };
      }
    } catch {
      // body não é JSON
    }
    return undefined;
  }

  override async checkValidity(
    media: Array<Array<{ path: string; thumbnail?: string }>>,
    settings: InstagramSettings,
  ): Promise<string | true> {
    for (const group of media) {
      if (settings.type === 'reel' && group.length > 1) {
        return 'Reel aceita apenas 1 vídeo';
      }
      if (settings.type === 'reel' && group[0]?.path && !group[0].path.match(/\.(mp4|mov)$/i)) {
        return 'Reel precisa ser vídeo (mp4 ou mov)';
      }
      if (settings.type === 'story' && group.length > 1) {
        return 'Para múltiplas stories, cada uma será um post separado';
      }
      if (settings.type !== 'story' && group.length > 10) {
        return 'Máximo de 10 mídias por carrossel';
      }
    }
    return true;
  }
}

// Helper type import
type MediaContent = NonNullable<PostDetails['media']>[number];