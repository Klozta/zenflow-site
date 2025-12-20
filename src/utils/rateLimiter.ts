/**
 * Rate limiter utilitaire amélioré
 * Helpers pour créer des rate limiters personnalisés
 */
import rateLimit from 'express-rate-limit';
import { logger } from './logger.js';

/**
 * Créer un rate limiter personnalisé
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: options.message || 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
      });

      res.status(429).json({
        error: options.message || 'Too many requests',
        retryAfter: Math.ceil(options.windowMs / 1000),
      });
    },
  });
}

/**
 * Rate limiter pour uploads
 */
export const uploadRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 uploads par 15 minutes
  message: 'Too many uploads, please try again later.',
});

/**
 * Rate limiter pour recherche
 */
export const searchRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 recherches par minute
  message: 'Too many search requests, please slow down.',
});

/**
 * Rate limiter pour imports
 */
export const importRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 50, // 50 imports par heure
  message: 'Import limit reached, please try again later.',
});





