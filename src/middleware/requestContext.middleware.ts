/**
 * Middleware pour enrichir le contexte des requêtes
 * Ajoute des informations utiles pour le logging et le debugging
 */
import { Request, Response, NextFunction } from 'express';
import { structuredLogger } from '../utils/structuredLogger.js';

/**
 * Middleware pour enrichir le contexte de la requête
 * À utiliser après requestIdMiddleware
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Enrichir le contexte du logger avec des infos de la requête
  const context: any = {
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer,
    ...(req.headers['x-forwarded-for'] && {
      forwardedFor: req.headers['x-forwarded-for'],
    }),
  };

  structuredLogger.setContext(context);
  next();
}





