// src/integrations/types.ts — contrato estável entre Postly e cada provedor de rede social
// Esta interface é a Camada 1 da arquitetura: mudanças aqui quebram todos os providers.
// Inspirado em gitroomhq/postiz-app (social.integrations.interface.ts) — versão simplificada.

export interface PostDetails<T = any> {
  /** Texto/caption do post */
  message: string;
  /** Configurações específicas do provider (ex: Instagram settings) */
  settings: T;
  /** Mídias anexadas (URLs já públicas, vindas do Supabase Storage) */
  media?: MediaContent[];
}

export interface MediaContent {
  type: 'image' | 'video';
  /** URL pública acessível pela plataforma externa (Meta/TikTok/LinkedIn vão baixar) */
  path: string;
  alt?: string;
  thumbnail?: string;
  /** Em segundos — para vídeos longos, indica o frame do thumbnail */
  thumbnailTimestamp?: number;
}

export interface PostResponse {
  /** ID retornado pela plataforma após publicação */
  postId: string;
  /** URL pública do post publicado (permalink) */
  releaseURL: string;
  /** Status inicial (algumas plataformas retornam 'processing' antes de finalizar) */
  status: string;
}

export interface AuthTokenDetails {
  /** ID da conta na plataforma (instagram_user_id, tiktok_open_id, linkedin_urn) */
  id: string;
  name: string;
  username: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  /** Tempo em segundos até expirar */
  expiresIn?: number;
}

export interface GenerateAuthUrlResponse {
  url: string;
  /** Estado único para proteção CSRF */
  state: string;
  /** PKCE code_verifier (TikTok exige) */
  codeVerifier?: string;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}

export interface SocialProvider {
  /** Identificador único: 'instagram' | 'tiktok' | 'linkedin' */
  identifier: string;
  /** Nome exibido pro usuário */
  name: string;
  /** Escopos OAuth que serão solicitados */
  scopes: string[];
  /** Tamanho máximo do texto (caracteres) */
  maxLength(): number;
  /** Tipo de editor recomendado no front */
  editorType: 'normal' | 'markdown' | 'none';

  // ===== OAuth =====

  /** Gera a URL para redirecionar o usuário ao consentimento do provider */
  generateAuthUrl(state: string): Promise<GenerateAuthUrlResponse>;

  /** Troca o code recebido no callback por tokens persistentes */
  authenticate(params: {
    code: string;
    codeVerifier?: string;
    redirectUri?: string;
  }): Promise<AuthTokenDetails>;

  /** Renova o access_token quando expirado (long-lived token no Meta, refresh token no TikTok/LinkedIn) */
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;

  // ===== Publicação =====

  /** Publica o conteúdo na rede social. Pode retornar múltiplos PostResponse (carrossel, story múltipla) */
  post(
    integration: { internalId: string; accessToken: string },
    posts: PostDetails[],
  ): Promise<PostResponse[]>;

  /** Pré-validação de mídia — chamado antes de agendar. Retorna 'true' se ok, string com erro caso contrário. */
  checkValidity(
    media: Array<Array<{ path: string; thumbnail?: string }>>,
    settings: any,
  ): Promise<string | true>;

  // ===== Opcionais =====

  /** Métricas agregadas por período */
  analytics?(
    internalId: string,
    accessToken: string,
    date: Date,
  ): Promise<AnalyticsData[]>;

  /** Métricas de um post específico */
  postAnalytics?(
    internalId: string,
    accessToken: string,
    postId: string,
    fromDate: Date,
  ): Promise<AnalyticsData[]>;
}