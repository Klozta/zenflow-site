/**
 * Rate Limiting avancé avec stratégies multiples
 * Supporte: sliding window, token bucket, rate limiting par utilisateur
 */

import { getCache, setCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { prometheusMetrics } from './prometheusMetrics.js';

export interface RateLimitConfig {
  max: number; // Nombre maximum de requêtes
  windowMs: number; // Fenêtre de temps en millisecondes
  strategy?: 'fixed-window' | 'sliding-window' | 'token-bucket';
  keyGenerator?: (req: any) => string; // Fonction pour générer la clé (IP, userId, etc.)
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Timestamp de réinitialisation
  retryAfter?: number; // Secondes à attendre avant retry
}

/**
 * Rate limiter avec sliding window (plus précis que fixed window)
 * Utilise Redis pour un compteur distribué
 */
export async function slidingWindowRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  try {
    // Utiliser un sorted set Redis pour implémenter le sliding window
    // Clé: `ratelimit:${key}:window`
    // Score: timestamp de chaque requête
    // On supprime les entrées hors fenêtre, puis on compte

    const cacheKey = `ratelimit:sliding:${key}`;

    // Pour simplifier sans Redis sorted sets, on utilise un compteur avec TTL
    // Stocker: { count: number, timestamps: number[] }
    const cached = await getCache<{ count: number; timestamps: number[] }>(cacheKey);

    let count = 0;
    let timestamps: number[] = [];

    if (cached) {
      // Filtrer les timestamps dans la fenêtre
      timestamps = cached.timestamps.filter((ts: number) => ts > windowStart);
      count = timestamps.length;
    }

    // Vérifier la limite
    if (count >= config.max) {
      const oldestTimestamp = Math.min(...timestamps);
      const retryAfter = Math.ceil((oldestTimestamp + config.windowMs - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        resetAt: oldestTimestamp + config.windowMs,
        retryAfter: Math.max(0, retryAfter),
      };
    }

    // Ajouter la nouvelle requête
    timestamps.push(now);
    count = timestamps.length;

    // Stocker avec TTL légèrement supérieur à la fenêtre
    const ttlSeconds = Math.ceil((config.windowMs * 1.1) / 1000);
    await setCache(cacheKey, { count, timestamps }, ttlSeconds);

    return {
      allowed: true,
      remaining: config.max - count,
      resetAt: now + config.windowMs,
    };
  } catch (error) {
    // En cas d'erreur Redis, permettre la requête (fail-open)
    logger.warn('Rate limit check failed, allowing request', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      remaining: config.max,
      resetAt: now + config.windowMs,
    };
  }
}

/**
 * Rate limiter avec token bucket
 * Permet des bursts tout en maintenant une moyenne
 */
export async function tokenBucketRateLimit(
  key: string,
  config: RateLimitConfig & { refillRate?: number } // Tokens par seconde
): Promise<RateLimitResult> {
  const now = Date.now();
  const refillRate = config.refillRate || (config.max / (config.windowMs / 1000)); // Tokens par seconde
  const cacheKey = `ratelimit:token:${key}`;

  try {
    const cached = await getCache<{ tokens: number; lastRefill: number }>(cacheKey);

    let tokens = config.max;
    let lastRefill = now;

    if (cached) {
      // Calculer le nombre de tokens à ajouter depuis le dernier refill
      const timePassed = (now - cached.lastRefill) / 1000; // en secondes
      const tokensToAdd = timePassed * refillRate;

      tokens = Math.min(config.max, cached.tokens + tokensToAdd);
      lastRefill = now;
    }

    if (tokens < 1) {
      // Pas assez de tokens
      const timeUntilNextToken = Math.ceil((1 - tokens) / refillRate);

      return {
        allowed: false,
        remaining: 0,
        resetAt: now + (timeUntilNextToken * 1000),
        retryAfter: timeUntilNextToken,
      };
    }

    // Consommer un token
    tokens -= 1;

    // Stocker l'état
    const ttlSeconds = Math.ceil((config.windowMs * 1.1) / 1000);
    await setCache(cacheKey, { tokens, lastRefill }, ttlSeconds);

    return {
      allowed: true,
      remaining: Math.floor(tokens),
      resetAt: now + Math.ceil((config.max - tokens) / refillRate * 1000),
    };
  } catch (error) {
    logger.warn('Token bucket rate limit failed, allowing request', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      allowed: true,
      remaining: config.max,
      resetAt: now + config.windowMs,
    };
  }
}

/**
 * Rate limiter par utilisateur (au lieu de par IP)
 */
export async function userBasedRateLimit(
  userId: string,
  endpoint: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `user:${userId}:${endpoint}`;
  return slidingWindowRateLimit(key, config);
}

/**
 * Rate limiter adaptatif (augmente la limite pour utilisateurs authentifiés)
 */
export async function adaptiveRateLimit(
  req: any,
  baseConfig: RateLimitConfig,
  authenticatedConfig?: RateLimitConfig
): Promise<RateLimitConfig> {
  const isAuthenticated = !!(req as any).user?.id;

  if (isAuthenticated && authenticatedConfig) {
    return authenticatedConfig;
  }

  return baseConfig;
}

/**
 * Factory pour créer un middleware de rate limiting avancé
 */
export function createAdvancedRateLimiter(config: RateLimitConfig) {
  return async (req: any, res: any, next: any) => {
    try {
      // Générer la clé de rate limiting
      const keyGenerator = config.keyGenerator || ((req: any) => req.ip || 'unknown');
      let key = keyGenerator(req);

      // Ajouter userId si authentifié (pour rate limiting par utilisateur)
      if ((req as any).user?.id) {
        key = `user:${(req as any).user.id}:${req.path}`;
      } else {
        key = `ip:${key}:${req.path}`;
      }

      // Appliquer la stratégie
      let result: RateLimitResult;
      const strategy = config.strategy || 'sliding-window';

      switch (strategy) {
        case 'sliding-window':
          result = await slidingWindowRateLimit(key, config);
          break;
        case 'token-bucket':
          result = await tokenBucketRateLimit(key, config);
          break;
        case 'fixed-window':
        default:
          // Fallback simple (utiliser express-rate-limit normalement)
          result = {
            allowed: true,
            remaining: config.max,
            resetAt: Date.now() + config.windowMs,
          };
          break;
      }

      // Ajouter les headers
      res.setHeader('X-RateLimit-Limit', config.max);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

      if (!result.allowed) {
        // Enregistrer dans Prometheus
        prometheusMetrics.recordRateLimit(req.path, req.ip || 'unknown');

        res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded',
          retryAfter: result.retryAfter,
          resetAt: new Date(result.resetAt).toISOString(),
        });
        return;
      }

      next();
    } catch (error) {
      // En cas d'erreur, permettre la requête (fail-open)
      logger.error('Advanced rate limiter error', error instanceof Error ? error : new Error(String(error)));
      next();
    }
  };
}

