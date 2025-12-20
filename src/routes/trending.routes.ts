// API Routes pour produits trending/populaires AliExpress
// Propose directement les meilleurs produits sans recherche

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    getBestSellersToday,
    getMostViewed,
    getTrendingProducts
} from '../services/aliexpressTrendingService.js';

const router = Router();

// GET /api/trending - Produits trending/populaires
router.get(
  '/',
  validate(z.object({
    category: z.enum(['crochet', 'mode', 'beauté', 'décoration', 'bijoux', 'all']).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
    minOrders: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).optional(),
    sortBy: z.enum(['popularity', 'sales', 'views', 'recent']).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const {
      category = 'all',
      limit = 20,
      minOrders = 10,
      sortBy = 'popularity'
    } = req.query as {
      category?: 'crochet' | 'mode' | 'beauté' | 'décoration' | 'bijoux' | 'all';
      limit?: number;
      minOrders?: number;
      sortBy?: 'popularity' | 'sales' | 'views' | 'recent';
    };

    const products = await getTrendingProducts({
      category: category as any,
      limit: Number(limit),
      minOrders: Number(minOrders),
      sortBy: sortBy as any
    });

    res.json({
      success: true,
      products,
      count: products.length,
      filters: { category, limit, minOrders, sortBy }
    });
  })
);

// GET /api/trending/best-sellers - Produits les plus vendus aujourd'hui
router.get(
  '/best-sellers',
  validate(z.object({
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 20;

    const products = await getBestSellersToday(limit);

    res.json({
      success: true,
      products,
      count: products.length,
      title: 'Produits les plus vendus aujourd\'hui'
    });
  })
);

// GET /api/trending/most-viewed - Produits les plus vus
router.get(
  '/most-viewed',
  validate(z.object({
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(50)).optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 20;

    const products = await getMostViewed(limit);

    res.json({
      success: true,
      products,
      count: products.length,
      title: 'Produits les plus vus'
    });
  })
);

export default router;
