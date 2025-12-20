/**
 * Protection CSRF (Cross-Site Request Forgery)
 * Basé sur recommandations Perplexity - OWASP Top 10
 */

import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

/**
 * Générer un token CSRF et le mettre dans un cookie
 * À appeler avant de servir les formulaires
 */
function generateCsrfToken(_req: Request, res: Response, next: NextFunction): void {
  const token = crypto.randomBytes(32).toString('hex');

  // Mettre le token dans un cookie HTTP-only
  res.cookie('csrf-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 3600000, // 1 heure
  });

  // Ajouter le token au locals pour les templates
  (res as any).locals.csrfToken = token;

  next();
}

/**
 * Vérification basique du token CSRF
 * Pour une protection complète, utiliser express-csrf ou csurf
 */
function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Skip pour les méthodes GET, HEAD, OPTIONS (safe methods)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Vérifier le token CSRF depuis cookie ou header
  const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;
  const csrfCookie = req.cookies?.['csrf-token'];

  // En développement, permettre sans token pour faciliter les tests
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_CSRF === 'true') {
    return next();
  }

  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
    logger.warn('CSRF token validation failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      hasToken: !!csrfToken,
      hasCookie: !!csrfCookie,
    });

    res.status(403).json({
      error: 'CSRF token validation failed',
      message: 'Invalid or missing CSRF token',
    });
    return;
  }

  next();
}

/**
 * Endpoint handler pour récupérer token CSRF
 */
export function getCsrfToken(req: Request, res: Response): void {
  const token = req.cookies?.['csrf-token'];

  if (!token) {
    // Générer nouveau token
    generateCsrfToken(req, res, () => {
      res.json({ csrfToken: (res as any).locals.csrfToken });
    });
  } else {
    res.json({ csrfToken: token });
  }
}

// Exports pour compatibilité
export const validateCsrfToken = csrfProtection;
export const csrfTokenMiddleware = generateCsrfToken;
