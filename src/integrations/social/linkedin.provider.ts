// src/integrations/social/linkedin.provider.ts — LinkedIn Posts API (ugcPosts)
//
// Documentação:
// - Posts API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/posts/posts-api
// - UGC Posts: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/posts/ugc-post-api
// - Upload de imagem: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/posts/images-api
// - Upload de vídeo: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/posts/videos-api
//
// Limitações MVP:
// - Apenas posts pessoais (ugcPosts). Posts em Páginas serão linkedin.page.provider.ts (próxima fase).
// - Limite: 3000 chars texto, máx 9 imagens ou 1 vídeo por post
// - Vídeo: precisa estar hospedado em URL acessível pela LinkedIn (igual TikTok)

import { config } from '../../config.js';
import { SocialAbstract, type ErrorAction } from '../social.abstract.js';
import type {
  AuthTokenDetails,
  GenerateAuthUrlResponse,
  PostDetails,
  PostResponse,
} from '../types.js';

const API_BASE = 'https://api.linkedin.com';
const REST_API = 'https://api.linkedin.com/rest';

const MAX_LENGTH = 3000;

export interface LinkedInSettings {
  /** Visibilidade: PUBLIC | CONNECTIONS | LOGGED_IN | CONTAINER */
  visibility?: 'PUBLIC' | 'CONNECTIONS' | 'LOGGED_IN' | 'CONTAINER';
  /** Categoria do post (padrão: NONE) */
  lifecycleState?: 'PUBLISHED' | 'DRAFT';
}

export class LinkedInProvider extends SocialAbstract {
  identifier = 'linkedin';
  name = 'LinkedIn';
  scopes = ['openid', 'profile', 'email', 'w_member_social', 'r_basicprofile'];
  editorType = 'markdown' as const;

  maxLength(): number {
    return MAX_LENGTH;
  }

  // ============================================================
  // OAuth
  // ============================================================

  async generateAuthUrl(state: string): Promise<GenerateAuthUrlResponse> {
    if (!config.LINKEDIN_CLIENT_ID || !config.LINKEDIN_REDIRECT_URI) {
      throw new Error('LINKEDIN_CLIENT_ID e LINKEDIN_REDIRECT_URI são obrigatórios');
    }

    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.LINKEDIN_CLIENT_ID);
    url.searchParams.set('redirect_uri', config.LINKEDIN_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', this.scopes.join(' '));

    return { url: url.toString(), state };
  }

  async authenticate(params: {
    code: string;
    redirectUri?: string;
  }): Promise<AuthTokenDetails> {
    if (!config.LINKEDIN_CLIENT_ID || !config.LINKEDIN_CLIENT_SECRET) {
      throw new Error('LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET são obrigatórios');
    }

    const redirectUri = params.redirectUri ?? config.LINKEDIN_REDIRECT_URI!;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirectUri,
      client_id: config.LINKEDIN_CLIENT_ID,
      client_secret: config.LINKEDIN_CLIENT_SECRET,
    });

    const tokenRes = await this.fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Buscar perfil do usuário
    const profileRes = await this.fetch(`${API_BASE}/v2/userinfo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileRes.json()) as {
      sub: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      email?: string;
      picture?: string;
    };

    return {
      id: profile.sub,
      name: profile.name ?? ((`${profile.given_name ?? ''} ${profile.family_name ?? ''}`.trim()) || profile.sub),
      username: profile.email ?? profile.sub,
      picture: profile.picture,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    if (!config.LINKEDIN_CLIENT_ID || !config.LINKEDIN_CLIENT_SECRET) {
      throw new Error('LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET são obrigatórios');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.LINKEDIN_CLIENT_ID,
      client_secret: config.LINKEDIN_CLIENT_SECRET,
    });

    const res = await this.fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      id: '', // será re-resolvido em uso
      name: '',
      username: '',
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // ============================================================
  // Publicação (ugcPosts)
  // ============================================================

  async post(
    integration: { internalId: string; accessToken: string },
    posts: PostDetails<LinkedInSettings>[],
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    const authorUrn = `urn:li:person:${integration.internalId}`;

    for (const post of posts) {
      const settings = post.settings ?? {};
      const media = post.media ?? [];
      const message = post.message.slice(0, MAX_LENGTH);

      let mediaCategory: 'NONE' | 'IMAGE' | 'VIDEO' = 'NONE';
      const mediaUrns: string[] = [];

      if (media.length > 0) {
        const firstVideo = media.find((m) => m.type === 'video');
        const images = media.filter((m) => m.type === 'image');

        if (firstVideo && images.length === 0) {
          mediaCategory = 'VIDEO';
          const urn = await this.uploadVideo(integration.accessToken, firstVideo.path, authorUrn);
          mediaUrns.push(urn);
        } else if (images.length > 0) {
          mediaCategory = 'IMAGE';
          if (images.length > 9) {
            throw new Error('LinkedIn aceita no máximo 9 imagens por post');
          }
          for (const image of images) {
            const urn = await this.uploadImage(integration.accessToken, image.path, authorUrn);
            mediaUrns.push(urn);
          }
        }
      }

      const ugcPostBody: Record<string, any> = {
        author: authorUrn,
        lifecycleState: settings.lifecycleState ?? 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: message },
            shareMediaCategory: mediaCategory,
            media: mediaUrns.map((urn) => ({
              status: 'READY',
              description: { text: '' },
              media: urn,
              title: { text: '' },
            })),
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': settings.visibility ?? 'PUBLIC',
        },
      };

      const postRes = await this.fetch(`${REST_API}/ugcPosts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          Authorization: `Bearer ${integration.accessToken}`,
        },
        body: JSON.stringify(ugcPostBody),
      });

      const postId = postRes.headers.get('x-restli-id');
      if (!postId) {
        throw new Error('LinkedIn não retornou x-restli-id');
      }

      results.push({
        postId,
        releaseURL: `https://www.linkedin.com/feed/update/${postId}`,
        status: 'published',
      });
    }

    return results;
  }

  // ============================================================
  // Upload de mídia (LinkedIn exige URN próprio)
  // ============================================================

  private async uploadImage(
    accessToken: string,
    imageUrl: string,
    authorUrn: string,
  ): Promise<string> {
    // 1. Registrar upload
    const registerBody = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    };

    const registerRes = await this.fetch(`${REST_API}/assets?action=registerUpload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(registerBody),
    });
    const registerData = (await registerRes.json()) as {
      value: {
        uploadMechanism: {
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
            uploadUrl: string;
            headers: Record<string, string>;
          };
        };
        asset: string;
      };
    };

    const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const assetUrn = registerData.value.asset;

    // 2. Baixar a imagem do Supabase Storage
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Falha ao baixar imagem de ${imageUrl}`);
    }
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

    // 3. Upload binário
    const uploadRes = await this.fetch(uploadUrl, {
      method: 'POST',
      headers: registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].headers,
      body: imgBuffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`LinkedIn upload de imagem falhou: ${uploadRes.status}`);
    }

    return assetUrn;
  }

  private async uploadVideo(
    accessToken: string,
    videoUrl: string,
    authorUrn: string,
  ): Promise<string> {
    // 1. Registrar upload de vídeo
    const registerBody = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          },
        ],
      },
    };

    const registerRes = await this.fetch(`${REST_API}/assets?action=registerUpload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(registerBody),
    });
    const registerData = (await registerRes.json()) as {
      value: {
        uploadMechanism: {
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
            uploadUrl: string;
            headers: Record<string, string>;
          };
        };
        asset: string;
      };
    };

    const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const assetUrn = registerData.value.asset;

    // 2. Baixar o vídeo
    const vidRes = await fetch(videoUrl);
    if (!vidRes.ok) {
      throw new Error(`Falha ao baixar vídeo de ${videoUrl}`);
    }
    const vidBuffer = Buffer.from(await vidRes.arrayBuffer());

    // 3. Upload binário (LinkedIn processa em background, é async)
    const uploadRes = await this.fetch(uploadUrl, {
      method: 'POST',
      headers: registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].headers,
      body: vidBuffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`LinkedIn upload de vídeo falhou: ${uploadRes.status}`);
    }

    // 4. LinkedIn processa o vídeo de forma assíncrona. Em produção, pollar até status=AVAILABLE.
    // Para MVP, retornamos a URN imediatamente — o post pode ficar em estado PROCESSING
    // e atualizar via webhook (futuro).

    return assetUrn;
  }

  override handleErrors(body: string, status: number): ErrorAction | undefined {
    try {
      const parsed = JSON.parse(body);
      const status2 = parsed?.status ?? status;
      const message = parsed?.message ?? '';

      if (status2 === 401 || parsed?.code === 'INVALID_ACCESS_TOKEN') {
        return { type: 'refresh-token', value: message || 'LinkedIn token expirado' };
      }
      if (status2 === 429) {
        return { type: 'retry', value: 'LinkedIn rate limit' };
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
      if (group.length > 9) return 'LinkedIn aceita no máximo 9 mídias por post';
      const videos = group.filter((m) => m.path.match(/\.(mp4|mov|m4v|webm)$/i));
      if (videos.length > 1) return 'LinkedIn aceita no máximo 1 vídeo por post';
    }
    return true;
  }
}