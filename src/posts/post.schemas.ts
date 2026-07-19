// src/posts/post.schemas.ts
import { z } from 'zod';

const mediaSchema = z.object({
  type: z.enum(['image', 'video']),
  path: z.string().url(),
  alt: z.string().optional(),
  thumbnail: z.string().url().optional(),
  thumbnailTimestamp: z.number().int().nonnegative().optional(),
});

export const createPostSchema = z.object({
  /** IDs das integrações alvo — pode ser 1 (single platform) ou N (multi-plataforma simultânea) */
  integration_ids: z.array(z.string().uuid()).min(1).max(10),
  publish_date: z.string().datetime(),
  content: z.string().min(0).max(5000),
  media: z.array(mediaSchema).optional(),
  settings: z.record(z.any()).optional(),
});

export const listPostsSchema = z.object({
  state: z.enum(['DRAFT', 'QUEUE', 'PUBLISHING', 'PUBLISHED', 'ERROR', 'CANCELLED']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  integration_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export type CreatePostInputSchema = z.infer<typeof createPostSchema>;
export type ListPostsQuerySchema = z.infer<typeof listPostsSchema>;