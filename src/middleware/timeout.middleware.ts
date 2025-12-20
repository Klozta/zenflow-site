/**
 * Timeout Middleware
 * Protection contre les requêtes qui bloquent trop longtemps
 */

import { NextFunction, Request, Response } from 'express';

const TIMEOUT_MS = 30000; // 30 secondes par défaut
const TIMEOUT_ALIEXPRESS_MS = 90000; // 90 secondes pour AliExpress (augmenté pour ScraperAPI)
const TIMEOUT_SUGGESTIONS_MS = 120000; // 120 secondes pour suggestions (génération auto)

/**
 * Middleware de timeout pour toutes les requêtes
 * Timeout plus long pour les routes AliExpress et suggestions
 */
export function timeoutMiddleware(req: Request, res: Response, next: NextFunction) {
  // Routes suggestions/génération nécessitent le plus de temps
  const isSuggestionsRoute = req.path.includes('/suggestions') ||
                             req.path.includes('/generate') ||
                             req.path.includes('/auto-generate');

  // Routes AliExpress nécessitent plus de temps
  const isAliExpressRoute = req.path.includes('/auto-queue/aliexpress') ||
                            req.path.includes('/products/auto-queue/aliexpress');

  let timeoutMs = TIMEOUT_MS;
  if (isSuggestionsRoute) {
    timeoutMs = TIMEOUT_SUGGESTIONS_MS;
  } else if (isAliExpressRoute) {
    timeoutMs = TIMEOUT_ALIEXPRESS_MS;
  }

  // Créer un timeout
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'Request timeout',
        message: isAliExpressRoute
          ? 'La recherche AliExpress prend trop de temps. Réessayez dans quelques instants.'
          : 'The request took too long to process. Please try again.',
      });
    }
  }, timeoutMs);

  // Nettoyer le timeout quand la réponse est envoyée
  res.on('finish', () => {
    clearTimeout(timeout);
  });

  res.on('close', () => {
    clearTimeout(timeout);
  });

  next();
}
