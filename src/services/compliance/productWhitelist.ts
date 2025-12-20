import { z } from 'zod';

/**
 * Whitelist stricte des données "importables" (GDPR by design).
 * Tout ce qui n'est pas dans ce schéma est rejeté.
 */

export const allowedImportedProductSchema = z.object({
  productId: z.string().min(1).max(128),
  title: z.string().min(1).max(140),
  price: z.number().min(0).max(999999.99),
  currency: z.string().min(1).max(8),
  availability: z.string().min(1).max(64),
  sourceUrl: z.string().url(),
  category: z.string().max(100).optional().nullable(),
}).strict();

export type AllowedImportedProduct = z.infer<typeof allowedImportedProductSchema>;

const FORBIDDEN_KEYS = [
  'images',
  'description',
  'reviews',
  'review',
  'seller',
  'sellerEmail',
  'email',
  'phone',
  'geolocation',
  'location',
  'address',
  'user',
  'profile',
] as const;

export function assertNoForbiddenFields(input: unknown): void {
  if (!input || typeof input !== 'object') return;
  const keys = Object.keys(input as Record<string, unknown>);
  for (const k of keys) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_KEYS.some(f => f.toLowerCase() === lower)) {
      throw new Error(`Forbidden field detected: ${k}`);
    }
  }
}

export function enforceImportedProductWhitelist(input: unknown): AllowedImportedProduct {
  assertNoForbiddenFields(input);
  const parsed = allowedImportedProductSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Whitelist validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

