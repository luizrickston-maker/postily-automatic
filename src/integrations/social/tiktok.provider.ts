// src/integrations/social/tiktok.provider.ts — TikTok Content Posting API v2
// https://developers.tiktok.com/doc/content-posting-api-quickstart
//
// Fluxo:
// 1. OAuth com PKCE (obrigatório no TikTok)
// 2. POST /v2/post/publish/video/init/ → recebe upload_url + publish_id
// 3. PUT binário do vídeo para upload_url
// 4. POST /v2/post/publish/status/fetch/ com publish_id → polling até PUBLISH_COMPLETE
//
// Limitações MVP:
// - Apenas vídeo (text posts TikTok têm limitação severa)
// - Vídeo deve estar hospedado em URL pública acessível pelo TikTok

import crypto from 'node:crypto';
import { config } from '../../config.js';
import { SocialAbstract, type ErrorAction } from '../social.abstract.js';
import type {
  AuthTokenDetails,
  GenerateAuthUrlResponse,
  PostDetails,
  PostResponse,
} from '../types.js';

const API_BASE = 'https://open.tiktokapis.com/v2';

const MAX_LENGTH = 2200;
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

export interface TikTokSettings {
  /** Visibilidade do post */
  privacy_level?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  /** Permitir comentários */
  disable_comment?: boolean;
  /** Permitir dueto */
  disable_duet?: boolean;
  /** Permitir stitch */
  disable_stitch?: boolean;
  /** Até 30 segundos — se true, vídeo longo é cortado (business accounts) */
  video_cover_timestamp_ms?: number;
}

export class TikTokProvider extends SocialAbstract {
  identifier = 'tiktok';
  name = 'TikTok';
  scopes = ['user.info.basic', 'video.publish', 'video.upload'];
  editorType = 'normal' as const;

  maxLength(): number {
    return MAX_LENGTH;
  }

  // ============================================================
  // OAuth com PKCE
  // ============================================================

  async generateAuthUrl(state: string): Promise<GenerateAuthUrlResponse> {
    if (!config.TIKTOK_CLIENT_KEY || !config.TIKTOK_REDIRECT_URI) {
      throw new Error('TIKTOK_CLIENT_KEY e TIKTOK_REDIRECT_URI são obrigatórios');
    }

    // PKCE: code_verifier (43-128 chars) → code_challenge (SHA256 base64url)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', config.TIKTOK_CLIENT_KEY);
    url.searchParams.set('scope', this.scopes.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', config.TIKTOK_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return {
      url: url.toString(),
      state,
      codeVerifier,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier?: string;
    redirectUri?: string;
  }): Promise<AuthTokenDetails> {
    if (!config.TIKTOK_CLIENT_KEY || !config.TIKTOK_CLIENT_SECRET) {
      throw new Error('TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET são obrigatórios');
    }

    const body = {
      client_key: config.TIKTOK_CLIENT_KEY,
      client_secret: config.TIKTOK_CLIENT_SECRET,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri ?? config.TIKTOK_REDIRECT_URI!,
      code_verifier: params.codeVerifier,
    };

    const response = await this.fetch(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body as any).toString(),
      },
    );

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      open_id: string;
      scope: string;
      token_type: string;
    };

    // Buscar info do usuário
    const userRes = await this.fetch(`${API_BASE}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const userData = (await userRes.json()) as {
      data?: {
        user?: {
          open_id: string;
          username?: string;
          display_name?: string;
          avatar_url?: string;
        };
      };
    };

    const user = userData.data?.user;

    return {
      id: data.open_id,
      name: user?.display_name ?? user?.username ?? data.open_id,
      username: user?.username ?? data.open_id,
      picture: user?.avatar_url,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    if (!config.TIKTOK_CLIENT_KEY || !config.TIKTOK_CLIENT_SECRET) {
      throw new Error('TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET são obrigatórios');
    }

    const body = {
      client_key: config.TIKTOK_CLIENT_KEY,
      client_secret: config.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    const response = await this.fetch(
      'https://open.tiktokapis.com/v2/oauth/token/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body as any).toString(),
      },
    );

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      open_id: string;
    };

    return {
      id: data.open_id,
      name: data.open_id,
      username: data.open_id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // ============================================================
  // Publicação
  // ============================================================

  async post(
    integration: { internalId: string; accessToken: string },
    posts: PostDetails<TikTokSettings>[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of posts) {
      const settings = post.settings ?? {};
      const media = post.media ?? [];

      // TikTok aceita apenas 1 vídeo por post
      const video = media.find((m) => m.type === 'video');
      if (!video) {
        throw new Error('TikTok requer pelo menos 1 vídeo por post');
      }
      if (media.length > 1) {
        // Ignoramos extras silenciosamente (TikTok não suporta múltiplos vídeos num post)
      }

      const result = await this.publishVideo(
        integration.accessToken,
        video.path,
        post.message,
        settings,
      );
      results.push(result);
    }

    return results;
  }

  private async publishVideo(
    accessToken: string,
    videoUrl: string,
    caption: string,
    settings: TikTokSettings,
  ): Promise<PostResponse> {
    const truncatedCaption = caption.length > MAX_LENGTH ? caption.slice(0, MAX_LENGTH) : caption;

    // 1. INIT — pede upload URL
    const initBody = {
      post_info: {
        title: truncatedCaption,
        privacy_level: settings.privacy_level ?? 'PUBLIC_TO_EVERYONE',
        disable_comment: settings.disable_comment ?? false,
        disable_duet: settings.disable_duet ?? false,
        disable_stitch: settings.disable_stitch ?? false,
        video_cover_timestamp_ms: settings.video_cover_timestamp_ms ?? 1000,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    };

    const initRes = await this.fetch(`${API_BASE}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(initBody),
    });
    const initData = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };

    if (initData.error?.code || !initData.data?.publish_id) {
      throw new Error(`TikTok init falhou: ${initData.error?.message ?? 'sem publish_id'}`);
    }

    const publishId = initData.data.publish_id;

    // 2. Polling no status de publicação (TikTok faz download do vídeo e processa sozinho)
    const finalStatus = await this.pollPublishStatus(accessToken, publishId);

    if (finalStatus.status !== 'PUBLISH_COMPLETE') {
      throw new Error(
        `TikTok publicação falhou: ${finalStatus.status} - ${finalStatus.fail_reason ?? ''}`,
      );
    }

    return {
      postId: publishId,
      releaseURL: finalStatus.share_url ?? `https://www.tiktok.com/@/video/${publishId}`,
      status: 'published',
    };
  }

  private async pollPublishStatus(
    accessToken: string,
    publishId: string,
  ): Promise<{
    status: string;
    fail_reason?: string;
    share_url?: string;
  }> {
    const start = Date.now();
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await this.delay(POLL_INTERVAL_MS);
      const res = await this.fetch(`${API_BASE}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ publish_id: publishId }),
      });
      const data = (await res.json()) as {
        data?: {
          status: string;
          fail_reason?: string;
          share_url?: string;
        };
        error?: { code?: string; message?: string };
      };
      if (data.error?.code === 'ok' || data.data) {
        const status = data.data?.status ?? 'UNKNOWN';
        return {
          status,
          fail_reason: data.data?.fail_reason,
          share_url: data.data?.share_url,
        };
      }
    }
    throw new Error('TikTok polling timeout após 10 minutos');
  }

  override handleErrors(body: string, status: number): ErrorAction | undefined {
    try {
      const parsed = JSON.parse(body);
      const code = parsed?.error?.code;
      const message = parsed?.error?.message ?? '';

      if (code === 'invalid_token' || code === 'expired_token' || status === 401) {
        return { type: 'refresh-token', value: message || 'TikTok token expirado' };
      }
      if (code === 'rate_limit_exceeded' || status === 429) {
        return { type: 'retry', value: 'TikTok rate limit' };
      }
    } catch {
      // não é JSON
    }
    return undefined;
  }

  override async checkValidity(
    media: Array<Array<{ path: string; thumbnail?: string }>>,
  ): Promise<string | true> {
    for (const group of media) {
      if (group.length === 0) return 'TikTok requer pelo menos 1 vídeo';
      for (const item of group) {
        if (!item.path.match(/\.(mp4|mov|m4v|webm)$/i)) {
          return 'TikTok aceita apenas vídeo (mp4, mov, m4v, webm)';
        }
      }
    }
    return true;
  }
}