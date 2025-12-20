// backend/src/middleware/auth.middleware.ts
import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/authService.js';
import { RequestWithUser } from '../types/auth.types.js';

/**
 * Auth middleware - verifies JWT access token from cookie (HTTP-only) or Authorization header
 */
export function authMiddleware(req: RequestWithUser, res: Response, next: NextFunction): void {
  try {
    // Essayer d'abord depuis cookie (sécurisé, HTTP-only)
    const token = req.cookies?.accessToken;

    // Fallback: header Authorization (pour compatibilité)
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    const jwtToken = token || headerToken;

    if (!jwtToken) {
      res.status(401).json({ error: 'Missing authentication token' });
      return;
    }

    const decoded = verifyAccessToken(jwtToken);

    if (!decoded) {
      res.status(401).json({ error: 'Invalid or expired access token' });
      return;
    }

    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}
