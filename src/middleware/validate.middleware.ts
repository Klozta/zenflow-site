/**
 * Validation Middleware
 * Validation automatique des inputs avec Zod
 */

import { NextFunction, Request, Response } from 'express';
import { z, ZodSchema } from 'zod';
import { logger } from '../utils/logger.js';
import { securityLogger } from '../utils/securityLogger.js';

/**
 * Middleware de validation générique
 * @param schema Schema Zod pour validation
 * @param source Source des données ('body' | 'query' | 'params')
 */
export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;

      // Valider avec Zod
      const validated = schema.parse(data);

      // Remplacer les données par les données validées (sanitization automatique)
      if (source === 'body') {
        req.body = validated;
      } else if (source === 'query') {
        req.query = validated as Record<string, string | string[] | undefined>;
      } else {
        req.params = validated as Record<string, string>;
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Erreur de validation
        const errors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        // Logger pour sécurité
        securityLogger.validationFailed(
          req.path,
          errors,
          req.ip
        );

        res.status(400).json({
          error: 'Validation failed',
          details: errors,
        });
      } else {
        // Erreur inattendue
        logger.error('Unexpected validation error', error instanceof Error ? error : new Error(String(error)), {
          path: req.path,
          method: req.method,
        });
        res.status(500).json({
          error: 'Internal server error',
        });
      }
    }
  };
}
