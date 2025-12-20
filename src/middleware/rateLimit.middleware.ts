/**
 * Rate Limiting Middleware
 * Protection contre les attaques DDoS et brute force
 */

import rateLimit from 'express-rate-limit';

type RateLimitCounters = {
  total429: number;
  byKey: Record<string, number>;
  last429At?: string;
};

const counters: RateLimitCounters = {
  total429: 0,
  byKey: {},
};

export function getRateLimitCounters(): RateLimitCounters {
  // shallow clone to avoid mutation by callers
  return {
    total429: counters.total429,
    byKey: { ...counters.byKey },
    last429At: counters.last429At,
  };
}

/**
 * Logger pour rate limiting (optionnel, ne bloque pas si erreur)
 */
async function logRateLimitExceeded(ip: string, path: string) {
  try {
    const { securityLogger } = await import('../utils/securityLogger.js');
    securityLogger.rateLimitExceeded(ip, path);
  } catch {
    // Logger optionnel, ne pas bloquer si erreur
  }
}

function increment429(req: any) {
  counters.total429 += 1;
  counters.last429At = new Date().toISOString();
  const key = `${req.method} ${req.baseUrl || ''}${req.path || ''}`.trim();
  counters.byKey[key] = (counters.byKey[key] || 0) + 1;
}

/**
 * Rate limiter global : 100 requêtes / 15 minutes par IP
 */
export const globalRateLimiter = rateLimit({
  windowMs: process.env.NODE_ENV === 'development' ? 60 * 1000 : 15 * 60 * 1000, // dev: 1 min, prod: 15 min
  max: process.env.NODE_ENV === 'development' ? 2000 : 100, // dev: large (UX), prod: strict
  standardHeaders: true, // Retourne rate limit info dans headers `RateLimit-*`
  legacyHeaders: false, // Désactive `X-RateLimit-*` headers
  // Ne pas pénaliser les checks d'auth (fréquents) ni la santé.
  skip: (req) => {
    const p = req.path || '';
    // app.use('/api', ...) -> req.path est du type "/auth/me"
    if (p === '/auth/me' || p === '/auth/refresh') return true;
    // Webhook Stripe: doit rester joignable même en cas de bursts / retries côté Stripe
    if (p === '/payments/stripe/webhook') return true;
    if (p === '/health' || p.startsWith('/health/')) return true;
    return false;
  },
  handler: async (req, res) => {
    increment429(req);
    await logRateLimitExceeded(req.ip || 'unknown', req.path);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please try again later.',
      retryAfter: process.env.NODE_ENV === 'development' ? '1 minute' : '15 minutes',
    });
  },
  // Store: memory (dev) ou Redis (prod) - à configurer plus tard
});

/**
 * Rate limiter pour authentification : 5 tentatives / 15 minutes
 * Protection contre brute force
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 tentatives par IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Ne compte pas les requêtes réussies
  handler: async (req, res) => {
    increment429(req);
    await logRateLimitExceeded(req.ip || 'unknown', req.path);
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Please try again in 15 minutes.',
      retryAfter: '15 minutes',
    });
  },
});

/**
 * Rate limiter strict : 3 tentatives / 15 minutes
 * Pour endpoints critiques (register, password reset)
 */
export const strictRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 tentatives par IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: async (req, res) => {
    increment429(req);
    await logRateLimitExceeded(req.ip || 'unknown', req.path);
    res.status(429).json({
      error: 'Too many attempts',
      message: 'Please try again in 15 minutes.',
      retryAfter: '15 minutes',
    });
  },
});

/**
 * Rate limiter par IP pour endpoints sensibles
 * @param max Nombre maximum de requêtes
 * @param windowMs Fenêtre de temps en millisecondes
 */
export const ipBasedRateLimiter = (max: number = 10, windowMs: number = 15 * 60 * 1000) => {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => req.ip || 'unknown',
    standardHeaders: true,
    legacyHeaders: false,
    handler: async (req, res) => {
      increment429(req);
      await logRateLimitExceeded(req.ip || 'unknown', req.path);
      res.status(429).json({
        error: 'Too many requests from this IP',
        message: 'Please try again later.',
      });
    },
  });
};
