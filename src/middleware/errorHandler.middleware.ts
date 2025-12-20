/**
 * Middleware de gestion d'erreurs centralisée
 */
import { NextFunction, Request, Response } from 'express';
import { captureError } from '../config/sentry.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Export pour compatibilité
export { AppError, createError } from '../utils/errors.js';

/**
 * Middleware de gestion d'erreurs
 */
export function errorHandler(
  err: AppError | Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Déterminer le type d'erreur
  const isAppError = err instanceof AppError;
  const isOperational = isAppError ? err.isOperational : false;
  const statusCode = isAppError ? err.statusCode : 500;
  const errorCode: string = isAppError ? (err.code || 'UNKNOWN_ERROR') : 'INTERNAL_ERROR';

  // Logger l'erreur selon le niveau
  if (statusCode >= 500) {
    logger.error('Erreur serveur', err as Error, {
      path: req.path,
      method: req.method,
      ip: req.ip,
      statusCode,
      errorCode,
      ...(isAppError && err instanceof Error && 'originalError' in err ? {
        originalError: (err as { originalError?: Error }).originalError?.message
      } : {}),
    });

    // Envoyer à Sentry pour les erreurs serveur
    if (err instanceof Error) {
      captureError(err, {
        path: req.path,
        method: req.method,
        statusCode,
        errorCode,
      });
    }
  } else if (statusCode >= 400) {
    logger.warn('Erreur client', {
      path: req.path,
      method: req.method,
      statusCode,
      errorCode,
      message: err.message,
    });
  }

  // Réponse selon l'environnement
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Construire la réponse
  interface ErrorResponse {
    error: string;
    code: string;
    message?: string;
    stack?: string;
    path?: string | undefined;
    method?: string | undefined;
    fields?: Record<string, string>;
  }

  const response: ErrorResponse = {
    error: statusCode >= 500 ? 'Internal server error' : err.message,
    code: errorCode,
  };

  // Ajouter détails en développement
  if (isDevelopment) {
    response.message = err.message;
    if (!isOperational && err.stack) {
      response.stack = err.stack;
    }
    if (req.path) {
      response.path = req.path;
    }
    if (req.method) {
      response.method = req.method;
    }
  }

  // Ajouter fields pour ValidationError
  if (isAppError && 'fields' in err && (err as { fields?: Record<string, string> }).fields) {
    response.fields = (err as { fields: Record<string, string> }).fields;
  }

  res.status(statusCode).json(response);
}

/**
 * Wrapper async pour éviter try/catch dans les routes
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
