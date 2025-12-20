/**
 * Middleware asyncHandler amélioré
 * Wrapper pour routes async avec gestion d'erreurs améliorée
 */
import { Request, Response, NextFunction } from 'express';
import { asyncHandler as baseAsyncHandler } from './errorHandler.middleware.js';
import { AppError, createError } from '../utils/errors.js';
import { structuredLogger } from '../utils/structuredLogger.js';

/**
 * Wrapper async amélioré avec logging automatique
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return baseAsyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      // Logger l'erreur avec contexte
      if (error instanceof AppError) {
        structuredLogger.error(
          `Error in ${req.method} ${req.path}`,
          error,
          {
            statusCode: error.statusCode,
            code: error.code,
          }
        );
      } else {
        structuredLogger.error(
          `Unexpected error in ${req.method} ${req.path}`,
          error as Error,
        );
      }

      // Passer à l'error handler
      next(error);
    }
  });
}

/**
 * Wrapper pour routes nécessitant authentification
 */
export function authenticatedHandler(
  fn: (req: Request & { user: { id: string } }, res: Response, next: NextFunction) => Promise<any>
) {
  return asyncHandler(async (req: Request & { user?: { id: string } }, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw createError.auth('Authentication required');
    }

    return fn(req as Request & { user: { id: string } }, res, next);
  });
}

/**
 * Wrapper pour routes nécessitant admin
 */
export function adminHandler(
  fn: (req: Request & { user: { id: string; role?: string } }, res: Response, next: NextFunction) => Promise<any>
) {
  return authenticatedHandler(async (req: Request & { user: { id: string; role?: string } }, res: Response, next: NextFunction) => {
    if (req.user.role !== 'admin') {
      throw createError.forbidden('Admin access required');
    }

    return fn(req, res, next);
  });
}





