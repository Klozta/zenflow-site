/**
 * Routes codes promo
 */
import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { validatePromoCode, createPromoCode } from '../services/promoCodeService.js';

const router = Router();

// POST /api/promo/validate - Valider un code promo
router.post(
  '/validate',
  validate(z.object({
    code: z.string().min(1),
    totalAmount: z.number().min(0),
  })),
  asyncHandler(async (req, res) => {
    const { code, totalAmount } = req.body;
    const result = await validatePromoCode(code, totalAmount);
    res.json(result);
  })
);

// POST /api/promo - Créer un code promo (admin)
router.post(
  '/',
  validate(z.object({
    code: z.string().min(1),
    discountType: z.enum(['percentage', 'fixed']),
    discountValue: z.number().positive(),
    minPurchase: z.number().positive().optional(),
    maxDiscount: z.number().positive().optional(),
    validFrom: z.string().datetime(),
    validUntil: z.string().datetime(),
    usageLimit: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  })),
  asyncHandler(async (req, res) => {
    const promoCode = await createPromoCode(req.body);
    res.status(201).json({ promoCode });
  })
);

export default router;









