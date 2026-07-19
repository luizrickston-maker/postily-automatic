// src/integrations/integration.manager.ts — registro central de todos os providers
// Adicionar nova rede social = instanciar aqui + criar arquivo em social/

import { InstagramProvider } from './social/instagram.provider.js';
import { TikTokProvider } from './social/tiktok.provider.js';
import { LinkedInProvider } from './social/linkedin.provider.js';
import type { SocialProvider } from './types.js';

/**
 * Array singleton com TODOS os providers disponíveis.
 * A ordem aqui define a ordem de exibição na UI (futuro).
 */
export const socialProviders: SocialProvider[] = [
  new InstagramProvider(),
  new TikTokProvider(),
  new LinkedInProvider(),
];

/**
 * Busca provider pelo identifier ('instagram', 'tiktok', 'linkedin').
 * Lança erro se não encontrar — caller deve validar antes.
 */
export function getSocialProvider(identifier: string): SocialProvider {
  const provider = socialProviders.find((p) => p.identifier === identifier);
  if (!provider) {
    throw new Error(
      `Provider '${identifier}' não encontrado. Disponíveis: ${socialProviders.map((p) => p.identifier).join(', ')}`,
    );
  }
  return provider;
}

/**
 * Lista providers disponíveis para um tenant.
 * Útil para o front renderizar a tela de "conectar nova conta".
 */
export function listSocialProviders(): Array<{
  identifier: string;
  name: string;
  scopes: string[];
  maxLength: number;
  editorType: string;
}> {
  return socialProviders.map((p) => ({
    identifier: p.identifier,
    name: p.name,
    scopes: p.scopes,
    maxLength: p.maxLength(),
    editorType: p.editorType,
  }));
}

/**
 * Verifica se um identifier de provider é válido
 */
export function isValidProvider(identifier: string): boolean {
  return socialProviders.some((p) => p.identifier === identifier);
}