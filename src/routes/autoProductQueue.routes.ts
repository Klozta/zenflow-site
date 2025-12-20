/**
 * Routes pour la queue de produits en attente de validation
 */
import { Router } from 'express';
import { z } from 'zod';
import { isLegalCatalogModeEnabled } from '../config/legalCatalog.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    addPendingProduct,
    approvePendingProduct,
    autoSearchAndQueueAliExpressProducts,
    getPendingProducts,
    rejectPendingProduct,
} from '../services/autoProductQueueService.js';

const router = Router();

// POST /api/products/auto-queue/aliexpress - Rechercher et mettre en queue depuis AliExpress
router.post(
  '/aliexpress',
  requireAdminAuth,
  validate(z.object({
    query: z.string().min(2),
    maxResults: z.number().int().min(1).max(10).optional(),
    minRating: z.number().min(0).max(5).optional(),
    maxPrice: z.number().positive().optional(),
    category: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Recherche/queue AliExpress désactivée (mode catalogue légal).',
      });
    }

    const { query, maxResults, minRating, maxPrice, category } = req.body;

    try {
      const result = await autoSearchAndQueueAliExpressProducts(query, {
        maxResults,
        minRating,
        maxPrice,
        category,
      });

      // Message informatif si recherche intelligente utilisée
      let message = result.queued > 0
        ? `${result.queued} produit(s) ajouté(s) en attente de validation`
        : 'Aucun produit trouvé. Essayez une recherche différente.';

      // Ajouter info si recherche remplacée (via logger dans service)
      if (query.toLowerCase().includes('couteau') || query.toLowerCase().includes('knife')) {
        message += ' (Recherche optimisée pour produits femmes 20-45 ans)';
      }

      return res.json({
        success: true,
        queued: result.queued,
        pendingProducts: result.pendingProducts,
        message,
      });
    } catch (error: any) {
      // Si c'est juste "aucun produit trouvé", retourner un succès avec 0 produits
      if (error.message?.includes('Aucun produit trouvé')) {
        return res.json({
          success: true,
          queued: 0,
          pendingProducts: [],
          message: 'Aucun produit trouvé. Essayez une recherche différente.',
        });
      }
      throw error;
    }
  })
);

// GET /api/products/auto-queue - Liste produits en attente
router.get(
  '/',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const pending = await getPendingProducts(status, limit);
    res.json({
      success: true,
      pendingProducts: pending,
      count: pending.length,
    });
  })
);

// POST /api/products/auto-queue/:id/approve - Approuver un produit
router.post(
  '/:id/approve',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({
    price: z.number().positive().optional(),
    stock: z.number().int().min(0).optional(),
    category: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Approbation (création produit) désactivée (mode catalogue légal).',
      });
    }

    const { id } = req.params;
    const { price, stock, category } = req.body;

    const result = await approvePendingProduct(id, { price, stock, category });

    return res.json({
      success: true,
      product: result.product,
      message: 'Produit approuvé et créé avec succès',
    });
  })
);

// POST /api/products/auto-queue/:id/reject - Rejeter un produit
router.post(
  '/:id/reject',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({
    reason: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    await rejectPendingProduct(id, reason);

    res.json({
      success: true,
      message: 'Produit rejeté',
    });
  })
);

// POST /api/products/auto-queue - Ajouter manuellement un produit en attente
router.post(
  '/',
  requireAdminAuth,
  validate(z.object({
    source: z.enum(['aliexpress', 'image', 'manual']),
    sourceUrl: z.string().url().optional(),
    title: z.string().min(3),
    description: z.string().optional(),
    price: z.number().positive(),
    originalPrice: z.number().positive().optional(),
    category: z.string(),
    tags: z.array(z.string()).optional(),
    images: z.array(z.string().url()).optional(),
    specifications: z.record(z.string()).optional(),
  })),
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Ajout de produit en attente désactivé (mode catalogue légal).',
      });
    }

    const pending = await addPendingProduct(req.body);
    return res.status(201).json({
      success: true,
      pendingProduct: pending,
    });
  })
);

export default router;
