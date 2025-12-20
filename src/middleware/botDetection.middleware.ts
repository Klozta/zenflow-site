/**
 * Middleware de détection de bots
 * Identifie et log les requêtes provenant de bots
 * Exclut les routes automatisées (génération produits, imports, cron)
 */
import { Request, Response, NextFunction } from 'express';
import { isBot } from '../utils/requestHelpers.js';
import { structuredLogger } from '../utils/structuredLogger.js';

/**
 * Routes à exclure de la détection de bots (processus automatisés)
 */
const EXCLUDED_PATHS = [
  '/api/products/auto-generate',
  '/api/products/auto-generate/create',
  '/api/products/auto-generate/recognize',
  '/api/products/import',
  '/api/products/batch-import',
  '/api/products/auto-queue',
  '/api/cron',
  '/api/health',
  '/api/metrics',
];

/**
 * Vérifier si la route doit être exclue de la détection
 */
function isExcludedPath(path: string): boolean {
  return EXCLUDED_PATHS.some(excluded => path.startsWith(excluded));
}

/**
 * Vérifier si c'est une requête automatisée légitime (header spécial)
 */
function isAutomatedRequest(req: Request): boolean {
  return !!(
    req.headers['x-automated-request'] ||
    req.headers['x-cron-key'] ||
    req.headers['x-internal-request']
  );
}

/**
 * Middleware pour détecter et logger les bots
 * Ignore les processus automatisés légitimes
 */
export function botDetectionMiddleware(req: Request, res: Response, next: NextFunction) {
  // Ignorer les routes automatisées
  if (isExcludedPath(req.path) || isAutomatedRequest(req)) {
    return next();
  }

  // Détecter et logger les bots
  if (isBot(req)) {
    structuredLogger.debug('Bot detected', {
      userAgent: req.headers['user-agent'],
      path: req.path,
      ip: req.ip,
    });

    // Ajouter header pour indiquer que c'est un bot
    res.setHeader('X-Bot-Detected', 'true');
  }

  next();
}





