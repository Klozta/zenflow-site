import type { NextFunction, Request, Response } from 'express';
import { verifyAdminSessionToken } from '../utils/adminSession.js';

/**
 * Autorisation admin "simple" basée sur un secret (ADMIN_TOKEN / CRON_API_KEY).
 *
 * - En production: obligatoire (cookie session httpOnly OU header `x-cron-key` ou query `?key=`).
 * - En dev: si aucun secret n'est configuré, on autorise (DX).
 */
export function isAdminAuthorized(req: Request): boolean {
  // Cookie session (préféré)
  const cookieToken = (req as any)?.cookies?.admin_session as string | undefined;
  if (cookieToken && verifyAdminSessionToken(cookieToken)) return true;

  const key = (req.headers['x-cron-key'] as string | undefined) || (req.query.key as string | undefined);
  const expected = process.env.CRON_API_KEY || process.env.ADMIN_TOKEN;
  if (!expected) return process.env.NODE_ENV === 'development';
  return key === expected;
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
