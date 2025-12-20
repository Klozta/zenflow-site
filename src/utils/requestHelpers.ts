/**
 * Helpers pour manipulation de requêtes
 * Fonctions utilitaires pour extraire et traiter les données de requête
 */

import { Request } from 'express';

/**
 * Extraire l'IP réelle du client (gère les proxies)
 */
export function getClientIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

/**
 * Extraire le User-Agent
 */
export function getUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown';
}

/**
 * Vérifier si la requête vient d'un bot
 */
export function isBot(req: Request): boolean {
  const userAgent = getUserAgent(req).toLowerCase();
  const botPatterns = [
    'bot', 'crawler', 'spider', 'scraper',
    'googlebot', 'bingbot', 'slurp', 'duckduckbot',
  ];

  return botPatterns.some(pattern => userAgent.includes(pattern));
}

/**
 * Extraire les paramètres de pagination depuis la requête
 */
export function getPaginationParams(req: Request): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Extraire les paramètres de tri depuis la requête
 */
export function getSortParams(req: Request, defaultSort: string = 'created_at_desc'): {
  field: string;
  order: 'asc' | 'desc';
} {
  const sort = (req.query.sort as string) || defaultSort;
  const [field, order] = sort.split('_');

  return {
    field: field || 'created_at',
    order: (order as 'asc' | 'desc') || 'desc',
  };
}

/**
 * Vérifier si la requête est une requête API (JSON)
 */
export function isApiRequest(req: Request): boolean {
  return (
    req.headers.accept?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json') ||
    req.path.startsWith('/api')
  );
}

/**
 * Extraire le userId depuis la requête (token JWT ou header)
 */
export function getUserId(req: Request): string | undefined {
  return (req as any).user?.id || req.headers['x-user-id'] as string | undefined;
}





