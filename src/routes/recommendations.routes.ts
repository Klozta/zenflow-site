/**
 * Routes recommandations produits
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    getPersonalizedRecommendations,
    getProductRecommendations
} from '../services/productRecommendationService.js';

const router = Router();

// GET /api/recommendations/product/:productId - Produits similaires
router.get(
  '/product/:productId',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const limit = parseInt(req.query.limit as string) || 4;

    const recommendations = await getProductRecommendations(productId, limit);
    res.json({ recommendations });
  })
);

// GET /api/recommendations/personalized - Recommandations personnalisées (utilisateur connecté)
router.get(
  '/personalized',
  authMiddleware,
  validate(
    z.object({
      limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 6)),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const limit = parseInt(req.query.limit as string) || 6;
    const recommendations = await getPersonalizedRecommendations(userId, limit);

    return res.json({
      recommendations,
      basedOn: 'Votre historique d\'achat',
      count: recommendations.length,
    });
  })
);

// GET /api/recommendations/frequently-bought/:productId - Frequently bought together
// Note: Fonctionnalité désactivée temporairement (fonction non exportée)
// router.get(
//   '/frequently-bought/:productId',
//   validate(z.object({ productId: z.string().uuid() }), 'params'),
//   asyncHandler(async (req, res) => {
//     const { productId } = req.params;
//     const limit = parseInt(req.query.limit as string) || 3;
//     const recommendations = await getFrequentlyBoughtTogether(productId, limit);
//     res.json({ recommendations });
//   })
// );

export default router;
