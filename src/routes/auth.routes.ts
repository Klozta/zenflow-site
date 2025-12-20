// backend/src/routes/auth.routes.ts
import { Router } from 'express';
import {
    authMiddleware
} from '../middleware/auth.middleware.js';
import { validateCsrfToken } from '../middleware/csrf.middleware.js';
import { authRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    comparePassword,
    createUser,
    findRefreshToken,
    findUserByEmail,
    findUserById,
    generateAccessToken,
    generateRefreshToken,
    hashPassword,
    revokeRefreshToken,
    saveRefreshToken,
    verifyRefreshToken
} from '../services/authService.js';
import {
    RequestWithUser
} from '../types/auth.types.js';
import { logger } from '../utils/logger.js';
import {
    securityLogger
} from '../utils/securityLogger.js';
import {
    loginSchema,
    refreshTokenSchema,
    registerSchema
} from '../validations/schemas.js';

const router = Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Inscription utilisateur
 *     description: Crée un nouveau compte utilisateur avec email et mot de passe. Retourne les tokens JWT.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *               name:
 *                 type: string
 *               referralCode:
 *                 type: string
 *                 description: Code de parrainage optionnel
 *     responses:
 *       201:
 *         description: Utilisateur créé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       409:
 *         description: Email déjà enregistré
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/register',
  validateCsrfToken,
  validate(registerSchema),
async (req: RequestWithUser, res) => {
    try {
      const { email, password, name, referralCode } = req.body;

      // Check if user exists
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await hashPassword(password);
      const user = await createUser(email, passwordHash, name);

      // Traiter le code de parrainage si fourni (non-bloquant)
      if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
        try {
          const { validateReferralCode, trackReferral } = await import('../services/referralService.js');
          const validation = await validateReferralCode(referralCode.trim());

          if (validation.valid && validation.referrerId) {
            // Ne pas parrainer soi-même
            if (validation.referrerId !== user.id) {
              await trackReferral(validation.referrerId, user.id, referralCode.trim());
            }
          }
        } catch (error: any) {
          // Non-bloquant: on log mais on ne fait pas échouer l'inscription
          logger.warn('Erreur traitement code parrainage (non-blocking)', {
            userId: user.id,
            referralCode,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const accessToken = generateAccessToken(user.id);
      const refreshTokenStr = generateRefreshToken(user.id);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await saveRefreshToken(user.id, refreshTokenStr, expiresAt);

      // Définir cookies HTTP-only pour sécurité
      const isProduction = process.env.NODE_ENV === 'production';

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 minutes
        path: '/',
      });

      res.cookie('refreshToken', refreshTokenStr, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
        path: '/',
      });

      return res.status(201).json({
        user,
        accessToken,
        refreshToken: refreshTokenStr
      });
    } catch (error) {
      // Sanitizer l'erreur avant logging
      const { sanitizeError } = await import('../utils/logSanitizer.js');
      const { logger } = await import('../utils/logger.js');
      logger.error('Register error', sanitizeError(error));
      return res.status(500).json({ error: 'Registration failed' });
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connexion utilisateur
 *     description: Authentifie un utilisateur avec email et mot de passe. Retourne les tokens JWT (access + refresh).
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *       401:
 *         description: Identifiants invalides
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/login',
  authRateLimiter,
  validateCsrfToken,
  validate(loginSchema),
  async (req: RequestWithUser, res) => {
    try {
      const { email, password } = req.body;
      const ip = req.ip || req.connection.remoteAddress || 'unknown';

      const user = await findUserByEmail(email);
      if (!user || !await comparePassword(password, user.password_hash)) {
        securityLogger.authAttempt(email, false, ip);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const accessToken = generateAccessToken(user.id);
      const refreshTokenStr = generateRefreshToken(user.id);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await saveRefreshToken(user.id, refreshTokenStr, expiresAt);
      securityLogger.authAttempt(email, true, ip);

      // Définir cookies HTTP-only pour sécurité
      const isProduction = process.env.NODE_ENV === 'production';

      res.cookie('accessToken', accessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000, // 15 minutes
        path: '/',
      });

      res.cookie('refreshToken', refreshTokenStr, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
        path: '/',
      });

      // Exclure le hash du mot de passe de la réponse API
      // eslint no-unused-vars: on destructure pour omettre le champ
      const { password_hash: _password_hash, ...userResponse } = user;
      return res.json({
        user: userResponse,
        accessToken,
        refreshToken: refreshTokenStr
      });
    } catch (error) {
      // Sanitizer l'erreur avant logging
      const { sanitizeError } = await import('../utils/logSanitizer.js');
      const { logger } = await import('../utils/logger.js');
      logger.error('Login error', sanitizeError(error));
      return res.status(500).json({ error: 'Login failed' });
    }
  }
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Rafraîchir le token d'accès
 *     description: Génère un nouveau access token à partir d'un refresh token valide. Le refresh token peut être dans le body ou dans un cookie HTTP-only.
 *     tags: [Auth]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token (optionnel si présent dans cookie)
 *     responses:
 *       200:
 *         description: Nouveau token généré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *       400:
 *         description: Refresh token manquant
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post(
  '/refresh',
  validate(refreshTokenSchema),
  async (req: RequestWithUser, res) => {
    try {
      // Le refresh token peut venir du body (clients API) OU du cookie HTTP-only (frontend).
      const token =
        (req.body?.refreshToken as string | undefined) ||
        (req as any).cookies?.refreshToken;

      if (!token) {
        return res.status(400).json({ error: 'Refresh token required' });
      }

      // Verify JWT signature
      const decoded = verifyRefreshToken(token);
      if (!decoded) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      // Check database record
      const tokenRecord = await findRefreshToken(token);
      if (!tokenRecord ||
          tokenRecord.is_revoked ||
          new Date(tokenRecord.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Refresh token expired or revoked' });
      }

      // 🔒 DÉTECTION RÉUTILISATION: Vérifier si un autre token actif existe
      const { findRefreshTokensByUserId, revokeAllUserTokens } = await import('../services/authService.js');
      const activeTokens = await findRefreshTokensByUserId(decoded.userId);
      const otherActiveToken = activeTokens.find(t => t.token !== token && !t.is_revoked);

      if (otherActiveToken) {
        // Token réutilisé → révoquer TOUS les tokens de l'utilisateur (sécurité)
        await revokeAllUserTokens(decoded.userId);

        // Logger l'activité suspecte
        try {
          const { securityLogger } = await import('../utils/securityLogger.js');
          securityLogger.suspiciousActivity('token_reuse', `Token reuse detected for user ${decoded.userId}`, {
            ip: req.ip || 'unknown',
            userId: decoded.userId,
          });
        } catch {
          // Logger optionnel, ne pas bloquer si erreur
        }

        return res.status(401).json({ error: 'Token compromised. Please login again.' });
      }

      // Rotate: revoke old token
      await revokeRefreshToken(token);

      // Generate new tokens
      const newAccessToken = generateAccessToken(decoded.userId);
      const newRefreshToken = generateRefreshToken(decoded.userId);
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await saveRefreshToken(decoded.userId, newRefreshToken, newExpiresAt);

      // Définir nouveaux cookies
      const isProduction = process.env.NODE_ENV === 'production';

      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 15 * 60 * 1000,
        path: '/',
      });

      res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      return res.json({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      });
    } catch (error) {
      // Sanitizer l'erreur avant logging
      const { sanitizeError } = await import('../utils/logSanitizer.js');
      const { logger } = await import('../utils/logger.js');
      logger.error('Refresh error', sanitizeError(error));
      return res.status(401).json({ error: 'Token refresh failed' });
    }
  }
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Déconnexion utilisateur
 *     description: Révoque le refresh token et efface les cookies de session
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token à révoquer (optionnel si présent dans cookie)
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.post(
  '/logout',
  validate(refreshTokenSchema),
  async (req: RequestWithUser, res) => {
    try {
      const token =
        (req.body?.refreshToken as string | undefined) ||
        (req as any).cookies?.refreshToken;

      // Si on n'a pas de token (ex: déjà déconnecté), on se contente de clear les cookies.
      if (token) {
        await revokeRefreshToken(token);
      }

      // Supprimer cookies
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/' });

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      // Sanitizer l'erreur avant logging
      const { sanitizeError } = await import('../utils/logSanitizer.js');
      const { logger } = await import('../utils/logger.js');
      logger.error('Logout error', sanitizeError(error));
      // Supprimer cookies même en cas d'erreur
      res.clearCookie('accessToken', { path: '/' });
      res.clearCookie('refreshToken', { path: '/' });
      res.status(200).json({ message: 'Logged out successfully' });
    }
  }
);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Profil utilisateur actuel
 *     description: Retourne les informations de l'utilisateur authentifié
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Informations utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/me',
  authMiddleware,
  async (req: RequestWithUser, res) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await findUserById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ user });
    } catch (error) {
      // Sanitizer l'erreur avant logging
      const { sanitizeError } = await import('../utils/logSanitizer.js');
      const { logger } = await import('../utils/logger.js');
      logger.error('Me endpoint error', sanitizeError(error));
      return res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

export default router;
