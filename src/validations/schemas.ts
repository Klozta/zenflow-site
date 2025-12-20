/**
 * Validation Schemas avec Zod
 * Validation stricte de tous les inputs API
 */

import { z } from 'zod';
import { sanitizeInput } from '../utils/securityHelpers.js';

/**
 * Schema validation inscription
 */
export const registerSchema = z.object({
  email: z
    .string()
    .email('Email invalide')
    .min(5, 'Email trop court')
    .max(255, 'Email trop long')
    .toLowerCase()
    .trim(),
  password: z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
    .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
    .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre')
    .max(100, 'Mot de passe trop long'),
  name: z
    .string()
    .min(2, 'Le nom doit contenir au moins 2 caractères')
    .max(100, 'Le nom est trop long')
    .trim(),
  referralCode: z
    .string()
    .max(20, 'Code de parrainage trop long')
    .toUpperCase()
    .trim()
    .optional(),
});

/**
 * Schema validation connexion
 */
export const loginSchema = z.object({
  email: z
    .string()
    .email('Email invalide')
    .toLowerCase()
    .trim(),
  password: z.string().min(1, 'Le mot de passe est requis'),
});

/**
 * Schema validation refresh token
 */
export const refreshTokenSchema = z.object({
  // ✅ Le refresh token peut venir du cookie HTTP-only `refreshToken`.
  // On autorise donc un body vide; la route /auth/refresh gère le fallback cookie.
  refreshToken: z.string().min(1, 'Refresh token requis').optional(),
});

/**
 * Schema validation produit
 * Avec sanitization XSS automatique
 */
export const productSchema = z.object({
  title: z
    .string()
    .min(3, 'Le titre doit contenir au moins 3 caractères')
    .max(255, 'Le titre est trop long')
    .trim()
    .refine((val) => {
      // Vérifier pas de code JavaScript
      const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i];
      return !dangerousPatterns.some(pattern => pattern.test(val));
    }, 'Le titre contient des caractères non autorisés'),
  description: z
    .string()
    .max(5000, 'La description est trop longue')
    .optional()
    .nullable()
    .transform((val) => {
      // Sanitization automatique si description fournie
      if (!val) return null;
      return sanitizeInput(val, 5000);
    }),
  price: z
    .number()
    .positive('Le prix doit être positif')
    .max(999999.99, 'Prix trop élevé'),
  category: z
    .string()
    .min(2, 'La catégorie doit contenir au moins 2 caractères')
    .max(100, 'La catégorie est trop longue')
    .trim()
    .optional()
    .nullable(),
  stock: z
    .number()
    .int('Le stock doit être un nombre entier')
    .min(0, 'Le stock ne peut pas être négatif')
    .default(0),
  images: z
    .array(z.string().url('URL image invalide'))
    .max(10, 'Maximum 10 images')
    .optional()
    .default([]),
  tags: z
    .array(z.string().min(1).max(50))
    .max(20, 'Maximum 20 tags')
    .optional()
    .default([]),
});

/**
 * Schema validation mise à jour produit (partielle)
 */
export const updateProductSchema = productSchema.partial();

/**
 * Schema validation pagination
 */
export const paginationSchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/, 'Page doit être un nombre')
    .transform(Number)
    .pipe(z.number().int().min(1))
    .default('1'),
  limit: z
    .string()
    .regex(/^\d+$/, 'Limit doit être un nombre')
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .default('20'),
});

/**
 * Schema validation recherche produits
 * Avec sanitization XSS automatique
 */
export const searchProductsSchema = paginationSchema.extend({
  q: z
    .string()
    .min(1, 'Terme de recherche requis')
    .max(255, 'Terme de recherche trop long')
    .trim()
    .refine((val) => {
      // Vérifier pas de code JavaScript
      const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i, /eval\(/i];
      return !dangerousPatterns.some(pattern => pattern.test(val));
    }, 'Terme de recherche contient des caractères non autorisés')
    .transform((val) => {
      // Sanitization automatique
      return sanitizeInput(val, 255);
    }),
});

/**
 * Schema validation filtres produits
 * Validation souple pour éviter erreurs 400
 */
export const filterProductsSchema = paginationSchema.extend({
  sort: z
    .enum(['price_asc', 'price_desc', 'name_asc', 'name_desc', 'newest'])
    .optional()
    .default('newest'),
  category: z
    .string()
    .max(100, 'Catégorie trop longue')
    .trim()
    .refine((val) => {
      if (!val || val === '') return true; // Optional
      const dangerousPatterns = [/<script/i, /javascript:/i];
      return !dangerousPatterns.some(pattern => pattern.test(val));
    }, 'Catégorie contient des caractères non autorisés')
    .transform((val) => {
      if (!val || val === '') return undefined;
      const { sanitizeInput } = require('../utils/securityHelpers.js');
      return sanitizeInput(val, 100);
    })
    .optional(),
  price_min: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Prix min invalide')
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
  price_max: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Prix max invalide')
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
  in_stock: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .optional(),
  includeDrafts: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .optional()
    .default('false'),
});

/**
 * Schema validation commande
 */
export const orderItemSchema = z.object({
  productId: z.string().uuid('ID produit invalide'),
  quantity: z
    .number()
    .int('La quantité doit être un nombre entier')
    .min(1, 'La quantité doit être au moins 1')
    .max(50, 'La quantité ne peut pas dépasser 50 par produit'),
  price: z
    .number()
    .positive('Le prix doit être positif')
    .max(999999.99, 'Prix trop élevé'),
});

export const shippingInfoSchema = z.object({
  firstName: z
    .string()
    .min(2, 'Le prénom doit contenir au moins 2 caractères')
    .max(50, 'Le prénom ne peut pas dépasser 50 caractères')
    .trim(),
  lastName: z
    .string()
    .min(2, 'Le nom doit contenir au moins 2 caractères')
    .max(50, 'Le nom ne peut pas dépasser 50 caractères')
    .trim(),
  email: z
    .string()
    .email('Email invalide')
    .min(5, 'Email trop court')
    .max(255, 'Email trop long')
    .toLowerCase()
    .trim(),
  phone: z
    .string()
    .regex(/^[0-9+\-\s()]+$/, 'Numéro de téléphone invalide')
    .min(10, 'Numéro de téléphone trop court')
    .max(20, 'Numéro de téléphone trop long')
    .trim(),
  address: z
    .string()
    .min(5, 'Adresse trop courte')
    .max(200, 'Adresse trop longue')
    .trim(),
  city: z
    .string()
    .min(2, 'Ville invalide')
    .max(100, 'Ville trop longue')
    .trim(),
  postalCode: z
    .string()
    .regex(/^[0-9]{5}$/, 'Code postal invalide (5 chiffres)')
    .trim(),
  country: z
    .string()
    .min(2, 'Pays invalide')
    .max(100, 'Pays trop long')
    .trim()
    .default('France'),
  promoCode: z
    .string()
    .min(3, 'Code promo invalide')
    .max(50, 'Code promo trop long')
    .optional()
    .nullable(),

  // Consentement légal (checkout)
  acceptTerms: z
    .boolean()
    .refine((v) => v === true, 'Consentement requis (CGV + politique de confidentialité)'),
});

export const attributionSchema = z
  .object({
    utm_source: z.string().max(255).optional(),
    utm_medium: z.string().max(255).optional(),
    utm_campaign: z.string().max(255).optional(),
    utm_term: z.string().max(255).optional(),
    utm_content: z.string().max(255).optional(),
    referrer: z.string().max(2048).optional(),
    landing_page: z.string().max(2048).optional(),
  })
  .optional();

export const createOrderSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, 'Au moins un article est requis')
    .max(50, 'Maximum 50 articles par commande'),
  shipping: shippingInfoSchema,
  total: z
    .number()
    .positive('Le total doit être positif')
    .min(0.01, 'Le total doit être au moins 0.01€')
    .max(10000.0, 'Total trop élevé (maximum 10000€). Contactez le support pour les commandes importantes.'),
  attribution: attributionSchema,
});

/**
 * Type inference depuis schemas
 */
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type ShippingInfoInput = z.infer<typeof shippingInfoSchema>;

/**
 * Schema validation import produit depuis URL
 */
export const importProductSchema = z.object({
  url: z
    .string()
    .url('URL invalide')
    .min(1, 'URL requise'),
  useSuggestedPrice: z.boolean().optional().default(false),
  customPrice: z.number().positive('Le prix doit être positif').optional(),
  customCategory: z.string().optional(),
  stock: z.number().int().min(0, 'Le stock doit être positif ou nul').optional(),
  downloadImages: z.boolean().optional().default(true), // Par défaut, télécharger les images
});

/**
 * Schema validation import batch
 */
export const batchImportSchema = z.object({
  items: z.array(z.object({
    url: z.string().url('URL invalide'),
    useSuggestedPrice: z.boolean().optional(),
    customPrice: z.number().positive().optional(),
    customCategory: z.string().optional(),
    stock: z.number().int().min(0).optional(),
    downloadImages: z.boolean().optional(),
  })).min(1, 'Au moins un produit requis').max(20, 'Maximum 20 produits par batch'),
  maxConcurrent: z.number().int().min(1).max(5).optional().default(3),
  downloadImages: z.boolean().optional().default(true),
});

export type SearchProductsInput = z.infer<typeof searchProductsSchema>;
export type FilterProductsInput = z.infer<typeof filterProductsSchema>;
export type ImportProductInput = z.infer<typeof importProductSchema>;
export type BatchImportInput = z.infer<typeof batchImportSchema>;

/**
 * Schema validation cours
 */
export const courseSchema = z.object({
  title: z
    .string()
    .min(3, 'Le titre doit contenir au moins 3 caractères')
    .max(255, 'Le titre est trop long')
    .trim()
    .refine((val) => {
      const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i];
      return !dangerousPatterns.some(pattern => pattern.test(val));
    }, 'Le titre contient des caractères non autorisés'),
  description: z
    .string()
    .max(5000, 'La description est trop longue')
    .optional()
    .nullable()
    .transform((val) => {
      if (!val) return null;
      return sanitizeInput(val, 5000);
    }),
  price: z
    .number()
    .positive('Le prix doit être positif')
    .max(9999.99, 'Prix trop élevé'),
  duration: z
    .string()
    .min(1, 'La durée est requise')
    .max(50, 'Durée trop longue')
    .trim(),
  level: z.enum(['débutant', 'intermédiaire', 'avancé'], {
    errorMap: () => ({ message: 'Niveau invalide (débutant, intermédiaire, avancé)' }),
  }),
  format: z.enum(['en ligne', 'présentiel', 'mixte'], {
    errorMap: () => ({ message: 'Format invalide (en ligne, présentiel, mixte)' }),
  }),
  instructor_id: z.string().uuid('ID instructeur invalide'),
  image: z
    .string()
    .url('URL image invalide')
    .optional()
    .nullable(),
  badge: z
    .string()
    .max(50, 'Badge trop long')
    .trim()
    .optional()
    .nullable(),
  objectives: z
    .array(z.string().min(3).max(200))
    .max(20, 'Maximum 20 objectifs')
    .optional()
    .default([]),
  prerequisites: z
    .array(z.string().min(3).max(200))
    .max(20, 'Maximum 20 prérequis')
    .optional()
    .default([]),
  faq: z
    .array(
      z.object({
        question: z.string().min(5).max(255),
        answer: z.string().min(10).max(2000),
      })
    )
    .max(50, 'Maximum 50 questions FAQ')
    .optional()
    .default([]),
});

/**
 * Schema validation mise à jour cours (partielle)
 */
export const updateCourseSchema = courseSchema.partial();

/**
 * Schema validation filtres cours
 */
export const filterCoursesSchema = paginationSchema.extend({
  level: z
    .enum(['débutant', 'intermédiaire', 'avancé'])
    .optional(),
  format: z
    .enum(['en ligne', 'présentiel', 'mixte'])
    .optional(),
  price_min: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Prix min invalide')
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
  price_max: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Prix max invalide')
    .transform(Number)
    .pipe(z.number().min(0))
    .optional(),
  instructor_id: z
    .string()
    .uuid('ID instructeur invalide')
    .optional(),
  sort: z
    .enum(['price_asc', 'price_desc', 'rating_desc', 'created_at_desc'])
    .optional()
    .default('created_at_desc'),
  search: z
    .string()
    .min(1, 'Terme de recherche requis')
    .max(255, 'Terme de recherche trop long')
    .trim()
    .refine((val) => {
      const dangerousPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i];
      return !dangerousPatterns.some(pattern => pattern.test(val));
    }, 'Terme de recherche contient des caractères non autorisés')
    .transform((val) => {
      return sanitizeInput(val, 255);
    })
    .optional(),
});

/**
 * Schema validation leçon
 */
export const lessonSchema = z.object({
  title: z
    .string()
    .min(3, 'Le titre doit contenir au moins 3 caractères')
    .max(255, 'Le titre est trop long')
    .trim(),
  duration: z
    .string()
    .min(1, 'La durée est requise')
    .max(50, 'Durée trop longue')
    .trim(),
  description: z
    .string()
    .max(2000, 'La description est trop longue')
    .optional()
    .nullable()
    .transform((val) => {
      if (!val) return null;
      return sanitizeInput(val, 2000);
    }),
  order: z
    .number()
    .int('L\'ordre doit être un nombre entier')
    .min(0, 'L\'ordre ne peut pas être négatif'),
});

/**
 * Schema validation mise à jour leçon
 */
export const updateLessonSchema = lessonSchema.partial();

/**
 * Schema validation avis cours
 */
export const courseReviewSchema = z.object({
  rating: z
    .number()
    .int('La note doit être un nombre entier')
    .min(1, 'La note doit être au moins 1')
    .max(5, 'La note ne peut pas dépasser 5'),
  comment: z
    .string()
    .max(2000, 'Le commentaire est trop long')
    .optional()
    .nullable()
    .transform((val) => {
      if (!val) return null;
      return sanitizeInput(val, 2000);
    }),
});

// Types exports
export type CourseInput = z.infer<typeof courseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type FilterCoursesInput = z.infer<typeof filterCoursesSchema>;
export type LessonInput = z.infer<typeof lessonSchema>;
export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export type CourseReviewInput = z.infer<typeof courseReviewSchema>;
