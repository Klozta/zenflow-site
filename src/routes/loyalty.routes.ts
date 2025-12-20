/**
 * Routes API pour le programme de fidélité
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    getLoyaltyHistory,
    getLoyaltyStats,
    getOrCreateLoyaltyProfile,
    redeemLoyaltyPoints,
} from '../services/loyaltyService.js';

const router = Router();

/**
 * GET /api/loyalty/profile
 * Récupère le profil de fidélité de l'utilisateur connecté
 */
router.get(
  '/profile',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const profile = await getOrCreateLoyaltyProfile(userId);
    if (!profile) {
      return res.status(500).json({ error: 'Erreur récupération profil' });
    }

    return res.json(profile);
  })
);

/**
 * GET /api/loyalty/stats
 * Récupère les statistiques de fidélité (profil, prochain tier, points expirant)
 */
router.get(
  '/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const stats = await getLoyaltyStats(userId);
    return res.json(stats);
  })
);

/**
 * GET /api/loyalty/history
 * Récupère l'historique des transactions de points
 */
router.get(
  '/history',
  authMiddleware,
  validate(
    z.object({
      limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 50)),
      offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await getLoyaltyHistory(userId, limit, offset);
    return res.json({ transactions: history });
  })
);

/**
 * POST /api/loyalty/redeem
 * Utilise des points pour une réduction
 */
router.post(
  '/redeem',
  authMiddleware,
  validate(
    z.object({
      points: z.number().int().min(100).max(10000),
      orderId: z.string().uuid().optional(),
      description: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { points, orderId, description } = req.body;

    const result = await redeemLoyaltyPoints(userId, points, orderId, description);

    if (!result.success) {
      return res.status(400).json({ error: result.error, discountAmount: 0 });
    }

    return res.json({
      success: true,
      pointsRedeemed: points,
      discountAmount: result.discountAmount,
    });
  })
);

export default router;


