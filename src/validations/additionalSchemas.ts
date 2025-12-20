/**
 * Schémas de validation supplémentaires
 * Schémas pour endpoints et fonctionnalités avancées
 */

import { z } from 'zod';

/**
 * Schema validation recherche produits
 */
export const searchProductsSchema = z.object({
  q: z
    .string()
    .min(1, 'La recherche doit contenir au moins 1 caractère')
    .max(100, 'La recherche est trop longue')
    .trim(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * Schema validation filtres produits
 */
export const filterProductsSchema = z.object({
  category: z.string().max(100).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z.coerce.boolean().optional(),
  tags: z.string().or(z.array(z.string())).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['price_asc', 'price_desc', 'created_at_desc', 'stock_asc']).optional(),
});

/**
 * Schema validation import produit
 */
export const importProductSchema = z.object({
  url: z
    .string()
    .url('URL invalide')
    .max(500, 'URL trop longue'),
});

/**
 * Schema validation import batch
 */
export const importBatchSchema = z.object({
  urls: z
    .array(z.string().url('URL invalide'))
    .min(1, 'Au moins une URL est requise')
    .max(20, 'Maximum 20 URLs par batch'),
});

/**
 * Schema validation recherche AliExpress
 */
export const aliexpressSearchSchema = z.object({
  query: z
    .string()
    .min(1, 'La recherche doit contenir au moins 1 caractère')
    .max(200, 'La recherche est trop longue')
    .trim(),
  options: z.object({
    maxResults: z.coerce.number().int().min(1).max(20).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    category: z.string().max(100).optional(),
  }).optional(),
});

/**
 * Schema validation approbation produit pending
 */
export const approvePendingProductSchema = z.object({
  price: z.number().positive().max(999999.99).optional(),
  stock: z.number().int().min(0).optional(),
  category: z.string().max(100).optional(),
});

/**
 * Schema validation rejet produit pending
 */
export const rejectPendingProductSchema = z.object({
  reason: z.string().max(500).optional(),
});

/**
 * Schema validation review
 */
export const reviewSchema = z.object({
  productId: z.string().uuid('ID produit invalide'),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/**
 * Schema validation promo code
 */
export const promoCodeSchema = z.object({
  code: z
    .string()
    .min(3, 'Le code doit contenir au moins 3 caractères')
    .max(50, 'Le code est trop long')
    .toUpperCase()
    .trim(),
  discount: z.number().min(0).max(100),
  type: z.enum(['percentage', 'fixed']),
  minPurchase: z.number().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Schema validation pagination générique
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * Schema validation ID UUID
 */
export const uuidSchema = z.object({
  id: z.string().uuid('ID invalide'),
});

/**
 * Schema validation email
 */
export const emailSchema = z.object({
  email: z.string().email('Email invalide').toLowerCase().trim(),
});

/**
 * Schema validation abandonné cart
 */
export const abandonedCartSchema = z.object({
  sessionId: z.string().min(8).max(128),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
    price: z.number().positive(),
  })).min(1),
  total: z.number().positive(),
  email: z.string().email().optional(),
});
