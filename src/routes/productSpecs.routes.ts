/**
 * Routes spécifications produits
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import {
  getProductSpecifications,
  upsertProductSpecifications,
  getFormattedProductSpecs,
} from '../services/productSpecsService.js';

const router = Router();

// GET /api/products/:productId/specs - Récupérer spécifications
router.get(
  '/:productId/specs',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const specs = await getProductSpecifications(productId);
    res.json({ specifications: specs });
  })
);

// GET /api/products/:productId/specs/formatted - Spécifications formatées
router.get(
  '/:productId/specs/formatted',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const formatted = await getFormattedProductSpecs(productId);
    res.json({ specifications: formatted });
  })
);

// PUT /api/products/:productId/specs - Mettre à jour spécifications
router.put(
  '/:productId/specs',
  validate(z.object({ productId: z.string().uuid() }), 'params'),
  validate(z.object({
    specifications: z.array(z.object({
      key: z.string(),
      value: z.string(),
      category: z.string().optional(),
      displayOrder: z.number().optional(),
    })),
  })),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { specifications } = req.body;
    const specs = await upsertProductSpecifications(productId, specifications);
    res.json({ specifications: specs });
  })
);

export default router;








