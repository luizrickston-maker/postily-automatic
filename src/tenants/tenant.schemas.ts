// src/tenants/tenant.schemas.ts — validação zod dos inputs
import { z } from 'zod';

export const createTenantSchema = z.object({
  type: z.enum(['agency', 'client']),
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug deve ter apenas letras minúsculas, números e hífens'),
  external_id: z.string().max(200).optional(),
  parent_id: z.string().uuid().optional(),
  settings: z.record(z.any()).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;