/**
 * Routes avis clients
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { 
  createReview, 
  getProductReviews, 
  markReviewAsHelpful,
  getProductReviewStats 
} from '../services/reviewService.js';

const router = Router();

// GET /api/reviews/product/:productId - Avis d'un produit
router.get(
  '/product/:productId',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const result = await getProductReviews(productId, limit, offset);
    res.json(result);
  })
);

// GET /api/reviews/product/:productId/stats - Statistiques avis
router.get(
  '/product/:productId/stats',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const stats = await getProductReviewStats(productId);
    res.json(stats);
  })
);

// POST /api/reviews - Créer un avis
router.post(
  '/',
  validate(z.object({
    productId: z.string().uuid(),
    userId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    title: z.string().min(3).max(100),
    comment: z.string().min(10).max(1000),
  })),
  asyncHandler(async (req, res) => {
    const review = await createReview(req.body);
    res.status(201).json({ review });
  })
);

// POST /api/reviews/:id/helpful - Marquer comme utile
router.post(
  '/:id/helpful',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await markReviewAsHelpful(req.params.id);
    res.json({ message: 'Review marked as helpful' });
  })
);

export default router;









