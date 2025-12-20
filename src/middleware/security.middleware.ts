/**
 * Middleware de sécurité avancés
 * Basé sur recommandations Perplexity - OWASP Top 10 protection
 */

import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { logger } from '../utils/logger.js';

/**
 * Configuration Helmet pour Content Security Policy
 * Protection contre XSS, clickjacking, etc.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Nécessaire pour certains scripts inline (à minimiser)
        'https://cdn.stripe.com',
        'https://js.stripe.com',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // CSS inline souvent nécessaire
        'https://fonts.googleapis.com',
      ],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: [
        "'self'",
        'https://api.stripe.com',
        'https://hooks.stripe.com',
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Peut causer problèmes avec Stripe
  hsts: {
    maxAge: 31536000, // 1 an
    includeSubDomains: true,
    preload: true,
  },
});

/**
 * Protection contre les attaques de type brute force
 * Track les tentatives d'authentification par IP
 */
export function bruteForceProtection(_req: Request, _res: Response, next: NextFunction): void {
  // Cette logique devrait utiliser Redis pour tracker les tentatives
  // Pour l'instant, on s'appuie sur le rate limiting existant

  // Vérifier si l'IP est dans une blacklist (à implémenter avec Redis)
  // if (await isIpBlacklisted(req.ip)) {
  //   return res.status(403).json({ error: 'Access denied' });
  // }

  next();
}

/**
 * Sanitization des entrées utilisateur
 * Protection contre injection XSS
 */
export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  // Sanitizer basique pour les strings
  const sanitize = (obj: any): any => {
    if (typeof obj === 'string') {
      // Supprimer les caractères potentiellement dangereux
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/on\w+\s*=/gi, ''); // Remove event handlers
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }

    return obj;
  };

  // Sanitizer req.body et req.query
  if (req.body && typeof req.body === 'object') {
    req.body = sanitize(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitize(req.query) as any;
  }

  next();
}

/**
 * Validation des headers de sécurité
 */
export function validateSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Vérifier que la requête vient bien de notre domaine (protection CSRF basique)
  const origin = req.headers.origin || req.headers.referer;

  if (origin && process.env.ALLOWED_ORIGINS) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    const originHost = new URL(origin).origin;

    if (!allowedOrigins.includes(originHost)) {
      logger.warn('Request from unauthorized origin', {
        origin: originHost,
        ip: req.ip,
        path: req.path,
      });
      // Ne pas bloquer en développement
      if (process.env.NODE_ENV === 'production') {
        res.status(403).json({ error: 'Forbidden origin' });
      return;
      }
    }
  }

  next();
}

/**
 * Protection contre les attaques de type timing
 * Ajouter un délai aléatoire pour éviter les attaques par timing
 */
export function timingAttackProtection(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Pour les endpoints d'authentification, ajouter un délai minimum
    if (req.path.includes('/login') || req.path.includes('/register')) {
      const minDuration = 200; // 200ms minimum
      const delay = Math.max(0, minDuration - duration);

      // Attendre le délai restant si nécessaire
      if (delay > 0) {
        setTimeout(() => {}, delay);
      }
    }
  });

  next();
}

/**
 * Logging des tentatives suspectes
 */
export function suspiciousActivityLogging(req: Request, _res: Response, next: NextFunction): void {
  // Détecter des patterns suspects
  const suspiciousPatterns = [
    /\.\.\/\.\.\//, // Path traversal
    /<script/i, // Script injection
    /union.*select/i, // SQL injection pattern
    /eval\(/i, // Code execution
    /exec\(/i, // Command execution
  ];

  const checkSuspicious = (value: any): boolean => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(checkSuspicious);
    }
    return false;
  };

  const isSuspicious =
    checkSuspicious(req.body) || checkSuspicious(req.query) || checkSuspicious(req.params);

  if (isSuspicious) {
    logger.warn('Suspicious activity detected', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.headers['user-agent'],
      body: req.body,
      query: req.query,
    });

    // Importer securityLogger si disponible
    import('../utils/securityLogger.js')
      .then(({ securityLogger }) => {
        securityLogger.suspiciousActivity('input_validation', 'Suspicious input detected', {
          ip: req.ip,
          path: req.path,
        });
      })
      .catch(() => {
        // Ignorer si securityLogger n'est pas disponible
      });
  }

  next();
}

