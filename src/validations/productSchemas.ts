/**
 * Schémas Zod pour validation produits
 * Validation stricte avant insertion PostgreSQL (Recommandation Perplexity)
 */
import { z } from 'zod';

/**
 * Schéma de validation pour création de produit
 * Garantit que les données sont valides avant insertion PostgreSQL
 */
export const createProductSchema = z.object({
  title: z.string()
    .min(3, 'Le titre doit contenir au moins 3 caractères')
    .max(255, 'Le titre ne peut pas dépasser 255 caractères')
    .trim(),

  description: z.string()
    .min(20, 'La description doit contenir au moins 20 mots')
    .max(5000, 'La description ne peut pas dépasser 5000 caractères')
    .trim()
    .optional()
    .nullable()
    .refine((val) => !val || val.split(/\s+/).length >= 20, {
      message: 'La description doit contenir au moins 20 mots',
    }),

  price: z.number()
    .positive('Le prix doit être positif')
    .finite('Le prix doit être un nombre fini')
    .min(0.01, 'Le prix minimum est 0.01€')
    .max(999999.99, 'Le prix maximum est 999999.99€'),

  category: z.string()
    .min(2, 'La catégorie doit contenir au moins 2 caractères')
    .max(100, 'La catégorie ne peut pas dépasser 100 caractères')
    .trim()
    .default('Autre'),

  stock: z.number()
    .int('Le stock doit être un nombre entier')
    .min(0, 'Le stock ne peut pas être négatif')
    .default(0),

  // Arrays PostgreSQL : doivent être string[] explicites
  images: z.array(z.string().url('Chaque image doit être une URL valide'))
    .min(0, 'Au moins 0 images (peut être vide)')
    .max(20, 'Maximum 20 images')
    .default([]),

  tags: z.array(z.string().max(50, 'Chaque tag ne peut pas dépasser 50 caractères'))
    .max(20, 'Maximum 20 tags')
    .default([]),
});

/**
 * Type TypeScript dérivé du schéma
 */
export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * Valider et nettoyer les données avant insertion
 * Retourne les données validées ou lance une erreur Zod
 */
export function validateProductData(data: unknown): CreateProductInput {
  try {
    return createProductSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Validation échouée: ${errors}`);
    }
    throw error;
  }
}

