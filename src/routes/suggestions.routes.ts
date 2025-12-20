// API Routes pour suggestions intelligentes
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { getPreparedSearches, getSmartSuggestions } from '../services/smartSuggestionsService.js';

const router = Router();

// GET /api/suggestions?q=... - Obtenir suggestions intelligentes
router.get(
  '/',
  validate(z.object({ q: z.string().min(1).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const query = (req.query.q as string) || '';

    const suggestions = await getSmartSuggestions(query);

    res.json({
      success: true,
      ...suggestions
    });
  })
);

// GET /api/suggestions/prepared - Obtenir toutes les recherches pré-configurées
router.get(
  '/prepared',
  asyncHandler(async (_req, res) => {
    const searches = getPreparedSearches();

    res.json({
      success: true,
      searches
    });
  })
);

export default router;
