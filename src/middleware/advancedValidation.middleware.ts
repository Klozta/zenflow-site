/**
 * Middleware de validation avancé avec sanitization et transformation
 * Améliore la sécurité et la robustesse des validations
 */

import { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { structuredLogger } from '../utils/structuredLogger.js';

export interface ValidationOptions {
  schema: z.ZodSchema;
  source?: 'body' | 'query' | 'params'; // Source des données (défaut: 'body')
  sanitize?: boolean; // Activer la sanitization (défaut: true)
  transform?: boolean; // Activer la transformation (défaut: true)
  stripUnknown?: boolean; // Supprimer les champs inconnus (défaut: true)
}

/**
 * Sanitization basique pour sécuriser les entrées
 */
function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return String(value);

  return value
    .trim() // Supprimer espaces début/fin
    .replace(/\0/g, '') // Supprimer null bytes
    .replace(/[\x00-\x1F\x7F]/g, ''); // Supprimer caractères de contrôle
}

/**
 * Sanitization récursive d'un objet
 */
function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize la clé aussi
      const sanitizedKey = sanitizeString(key);
      sanitized[sanitizedKey] = sanitizeObject(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Transformation des données avant validation
 * - Trim des strings
 * - Conversion de types si nécessaire
 * - Normalisation des formats
 */
function transformData(data: unknown, schema: z.ZodSchema): unknown {
  // Zod gère déjà beaucoup de transformations via .transform()
  // Ici on fait juste des transformations de base avant la validation

  if (data === null || data === undefined) {
    return data;
  }

  // Si c'est une string, trim
  if (typeof data === 'string') {
    return data.trim();
  }

  // Si c'est un objet, transformer récursivement
  if (typeof data === 'object' && !Array.isArray(data)) {
    const transformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        transformed[key] = value.trim();
      } else if (typeof value === 'object') {
        transformed[key] = transformData(value, schema);
      } else {
        transformed[key] = value;
      }
    }
    return transformed;
  }

  return data;
}

/**
 * Middleware de validation avancé
 */
export function advancedValidate(options: ValidationOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const {
        schema,
        source = 'body',
        sanitize = true,
        transform = true,
        stripUnknown = true,
      } = options;

      // Récupérer les données depuis la source spécifiée
      let data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;

      // Sanitization (avant validation)
      if (sanitize) {
        data = sanitizeObject(data);
      }

      // Transformation basique (avant validation)
      if (transform) {
        data = transformData(data, schema);
      }

      // Validation avec Zod
      // Zod ignore les champs inconnus par défaut, sauf si on utilise .strict()
      // Pour supprimer les champs inconnus, on utilise .passthrough() qui les laisse passer
      // mais on filtre ensuite si stripUnknown est true
      let validatedData = await schema.parseAsync(data);

      // Filtrer les champs inconnus si demandé
      if (stripUnknown && typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const schemaShape = (schema as any)._def?.shape;
        if (schemaShape) {
          const allowedKeys = new Set(Object.keys(schemaShape));
          if (typeof validatedData === 'object' && validatedData !== null && !Array.isArray(validatedData)) {
            validatedData = Object.fromEntries(
              Object.entries(validatedData).filter(([key]) => allowedKeys.has(key))
            ) as typeof validatedData;
          }
        }
      }

      // Injecter les données validées dans la requête
      if (source === 'body') {
        req.body = validatedData;
      } else if (source === 'query') {
        req.query = validatedData as any;
      } else {
        req.params = validatedData as any;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Erreur de validation Zod
        const errors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
          code: err.code,
        }));

        structuredLogger.warn('Validation failed', {
          errors,
          source: options.source,
          path: req.path,
          requestId: (req as any).requestId,
        });

        res.status(400).json({
          error: 'Validation failed',
          message: 'Invalid request data',
          errors,
        });
        return;
      }

      // Erreur inattendue
      logger.error('Validation middleware error', error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred during validation',
      });
    }
  };
}

/**
 * Helper pour créer un schema avec sanitization automatique pour les strings
 */
export function createSanitizedStringSchema(
  minLength?: number,
  maxLength?: number,
  pattern?: RegExp
): z.ZodString {
  let schema = z.string().trim();

  if (minLength !== undefined) {
    schema = schema.min(minLength, `Must be at least ${minLength} characters`);
  }

  if (maxLength !== undefined) {
    schema = schema.max(maxLength, `Must be at most ${maxLength} characters`);
  }

  if (pattern) {
    schema = schema.regex(pattern, 'Invalid format');
  }

  return schema;
}

/**
 * Schema pour email avec validation stricte
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(255, 'Email too long');

/**
 * Schema pour URL avec validation
 */
export const urlSchema = z
  .string()
  .trim()
  .url('Invalid URL')
  .max(2048, 'URL too long');

/**
 * Schema pour password avec règles de sécurité
 */
export function createPasswordSchema(minLength: number = 8): z.ZodString {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number');
}

/**
 * Schema pour nombres positifs
 */
export const positiveNumberSchema = z
  .number()
  .positive('Must be a positive number');

/**
 * Schema pour IDs UUID
 */
export const uuidSchema = z
  .string()
  .uuid('Invalid UUID format');

/**
 * Schema pour dates ISO
 */
export const isoDateSchema = z
  .string()
  .datetime('Invalid ISO date format');

