/**
 * Routes pour le système de gamification
 * Badges, Points, Niveaux, Challenges, Leaderboard
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { gamificationService } from '../services/gamificationService.js';
import { handleServiceError } from '../utils/errorHandlers.js';

const router = Router();

/**
 * GET /api/gamification/me - Profil de gamification de l'utilisateur connecté
 */
router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const gamification = await gamificationService.getUserGamification(userId);
      return res.json(gamification);
    } catch (error) {
      throw handleServiceError(error, 'getUserGamification', 'Erreur récupération profil gamification');
    }
  })
);

/**
 * GET /api/gamification/leaderboard - Classement des utilisateurs
 * Query params: limit (défaut: 10)
 */
router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const leaderboard = await gamificationService.getLeaderboard(limit);
      return res.json({
        leaderboard,
        count: leaderboard.length,
      });
    } catch (error) {
      throw handleServiceError(error, 'getLeaderboard', 'Erreur récupération leaderboard');
    }
  })
);

/**
 * GET /api/gamification/challenges - Challenges actifs
 */
router.get(
  '/challenges',
  asyncHandler(async (_req, res) => {
    try {
      const challenges = await gamificationService.getActiveChallenges();
      return res.json({
        challenges,
        count: challenges.length,
      });
    } catch (error) {
      throw handleServiceError(error, 'getActiveChallenges', 'Erreur récupération challenges');
    }
  })
);

/**
 * POST /api/gamification/events - Enregistrer un événement (appelé automatiquement)
 * Body: { eventType: string, points?: number, reason?: string }
 * Admin only ou appelé par le système
 */
router.post(
  '/events',
  authMiddleware,
  validate(
    z.object({
      eventType: z.string(),
      points: z.number().optional(),
      reason: z.string().optional(),
    })
  ),
  asyncHandler(async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const { eventType, points = 0, reason } = req.body;

      // Ajouter les points si fournis
      let newTotal = 0;
      if (points > 0) {
        newTotal = await gamificationService.addPoints(userId, points, reason || eventType);
      }

      return res.json({
        success: true,
        pointsAdded: points,
        newTotal,
      });
    } catch (error) {
      throw handleServiceError(error, 'recordEvent', 'Erreur enregistrement événement');
    }
  })
);

/**
 * POST /api/gamification/badges/:badgeType/unlock - Débloquer un badge (admin only)
 */
router.post(
  '/badges/:badgeType/unlock',
  requireAdminAuth,
  validate(z.object({ badgeType: z.string() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { badgeType } = req.params;
      const userId = req.body.userId || req.query.userId;

      if (!userId) {
        return res.status(400).json({ error: 'userId requis' });
      }

      const badge = await gamificationService.unlockBadge(userId, badgeType as any);
      return res.json({
        success: true,
        badge,
      });
    } catch (error) {
      throw handleServiceError(error, 'unlockBadge', 'Erreur déblocage badge');
    }
  })
);

export default router;

