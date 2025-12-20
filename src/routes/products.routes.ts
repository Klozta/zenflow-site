// backend/src/routes/products.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { isLegalCatalogModeEnabled } from '../config/legalCatalog.js';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { rateLimitImport } from '../middleware/rateLimitImport.middleware.js';
import {
    validate
} from '../middleware/validate.middleware.js';
import {
    batchAnalyzeProducts,
    batchImportProducts
} from '../services/batchImportService.js';
import {
    getImportHistory,
    getImportStats
} from '../services/importHistoryService.js';
import {
    analyzeProductUrl,
    importAndCreateProduct
} from '../services/productImportService.js';
import {
    createProduct,
    deleteProduct,
    getProductById,
    getProducts,
    searchProducts,
    updateProduct
} from '../services/productsService.js';
import { searchRateLimiter } from '../utils/rateLimiter.js';
import {
    batchImportSchema,
    importProductSchema,
    productSchema,
    searchProductsSchema,
    updateProductSchema
} from '../validations/schemas.js';

const router = Router();

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Liste des produits avec filtres
 *     description: Retourne une liste paginée de produits avec filtres optionnels (catégorie, prix, stock, tags)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Numéro de page
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Nombre de résultats par page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filtrer par catégorie
 *       - in: query
 *         name: price_min
 *         schema:
 *           type: number
 *         description: Prix minimum
 *       - in: query
 *         name: price_max
 *         schema:
 *           type: number
 *         description: Prix maximum
 *       - in: query
 *         name: stock_status
 *         schema:
 *           type: string
 *           enum: [in_stock, low_stock, out_of_stock, any]
 *         description: Statut du stock
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Tags séparés par virgule
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [price_asc, price_desc, name_asc, name_desc, newest]
 *         description: Tri des résultats
 *     responses:
 *       200:
 *         description: Liste des produits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      // Validation souple avec gestion d'erreur
      const filters: any = {};

      // Pagination
      if (req.query.page) {
        const page = parseInt(String(req.query.page));
        if (!isNaN(page) && page > 0) filters.page = page;
      }
      if (req.query.limit) {
        const limit = parseInt(String(req.query.limit));
        if (!isNaN(limit) && limit > 0 && limit <= 100) filters.limit = limit;
      }

      // Filtres optionnels
      if (req.query.sort && typeof req.query.sort === 'string') {
        const validSorts = ['price_asc', 'price_desc', 'name_asc', 'name_desc', 'newest'];
        if (validSorts.includes(req.query.sort)) {
          filters.sort = req.query.sort;
        }
      }

      if (req.query.category && typeof req.query.category === 'string' && req.query.category.trim() !== '') {
        filters.category = req.query.category.trim();
      }

      if (req.query.price_min && typeof req.query.price_min === 'string') {
        const priceMin = parseFloat(req.query.price_min);
        if (!isNaN(priceMin) && priceMin >= 0) filters.minPrice = priceMin;
      }

      if (req.query.price_max && typeof req.query.price_max === 'string') {
        const priceMax = parseFloat(req.query.price_max);
        if (!isNaN(priceMax) && priceMax >= 0) filters.maxPrice = priceMax;
      }

      // Filtre stock (ancien format boolean pour compatibilité)
      if (req.query.stock && typeof req.query.stock === 'string') {
        if (req.query.stock === 'true') {
          filters.stockStatus = 'in_stock';
        }
      }

      // Nouveau filtre stockStatus (plus précis)
      if (req.query.stock_status && typeof req.query.stock_status === 'string') {
        const validStatuses = ['in_stock', 'low_stock', 'out_of_stock', 'any'];
        if (validStatuses.includes(req.query.stock_status)) {
          filters.stockStatus = req.query.stock_status as 'in_stock' | 'low_stock' | 'out_of_stock' | 'any';
        }
      }

      // Filtre par tags (multi-sélection, séparés par virgule)
      if (req.query.tags && typeof req.query.tags === 'string' && req.query.tags.trim() !== '') {
        filters.tags = req.query.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }

      // Convertir includeDrafts en boolean si présent
      if (req.query.includeDrafts !== undefined) {
        const includeDraftsValue = String(req.query.includeDrafts);
        filters.includeDrafts = includeDraftsValue === 'true' || includeDraftsValue === '1';
      }

      const result = await getProducts(filters);
      return res.json(result);
    } catch (error: any) {
      // Gérer les erreurs de validation gracieusement
      if (error.message?.includes('Validation failed') || error.message?.includes('ZodError')) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Paramètres de requête invalides',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
      }
      throw error;
    }
  })
);

/**
 * @swagger
 * /api/products/search:
 *   get:
 *     summary: Recherche full-text de produits
 *     description: Recherche de produits par mots-clés dans le titre et la description
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Terme de recherche
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Numéro de page
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Nombre de résultats par page
 *     responses:
 *       200:
 *         description: Résultats de la recherche
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Product'
 *                 total:
 *                   type: integer
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/RateLimitError'
 */
router.get(
  '/search',
  searchRateLimiter, // Rate limiting spécifique pour recherche
  validate(searchProductsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q, ...pagination } = req.query as any;
    const result = await searchProducts({ q, ...pagination });
    res.json(result);
  })
);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Détails d'un produit
 *     description: Retourne les informations complètes d'un produit par son ID
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID du produit
 *     responses:
 *       200:
 *         description: Détails du produit
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product:
 *                   $ref: '#/components/schemas/Product'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const product = await getProductById(req.params.id);
    if (!product) {
      const { createError } = await import('../utils/errors.js');
      throw createError.notFound('Product');
    }
    res.json({ product });
  })
);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Créer un produit (admin)
 *     description: Crée un nouveau produit. Nécessite des droits administrateur.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - price
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               price:
 *                 type: number
 *               category:
 *                 type: string
 *               stock:
 *                 type: integer
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       201:
 *         description: Produit créé
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 product:
 *                   $ref: '#/components/schemas/Product'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/',
  requireAdminAuth,
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const product = await createProduct(req.body);
    res.status(201).json({ product });
  })
);

// PUT /api/products/:id - Mettre à jour (admin)
router.put(
  '/:id',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const product = await updateProduct(req.params.id, req.body);
    res.json({ product });
  })
);

// DELETE /api/products/:id - Supprimer (admin)
router.delete(
  '/:id',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await deleteProduct(req.params.id);
    res.json({ message: 'Product deleted successfully' });
  })
);

// PATCH /api/products/:id/draft - Mettre à jour le statut draft
router.patch(
  '/:id/draft',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ isDraft: z.boolean() })),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isDraft } = req.body;

    // Récupérer le produit actuel
    const product = await getProductById(id);
    if (!product) {
      const { createError } = await import('../utils/errors.js');
      throw createError.notFound('Product');
    }

    // Gérer le statut draft via les tags
    const currentTags = product.tags || [];
    const draftTag = 'draft';

    let updatedTags: string[];
    if (isDraft) {
      // Ajouter le tag draft s'il n'existe pas
      updatedTags = currentTags.includes(draftTag)
        ? currentTags
        : [...currentTags, draftTag];
    } else {
      // Retirer le tag draft
      updatedTags = currentTags.filter(tag => tag !== draftTag);
    }

    // Mettre à jour le produit
    const updatedProduct = await updateProduct(id, { tags: updatedTags });

    res.json({
      message: isDraft ? 'Produit mis en brouillon' : 'Produit publié',
      product: updatedProduct,
      isDraft,
    });
  })
);

// GET /api/products/export/csv - Export CSV des produits
router.get(
  '/export/csv',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    const filters = _req.query as any;
    const result = await getProducts({ ...filters, limit: 10000 }); // Pas de limite pour export

    // Générer CSV
    const headers = ['ID', 'Titre', 'Prix', 'Catégorie', 'Stock', 'Description'];
    const rows = result.products.map((p: any) => [
      p.id,
      `"${p.title.replace(/"/g, '""')}"`,
      p.price,
      p.category || '',
      p.stock,
      `"${(p.description || '').replace(/"/g, '""')}"`,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row: any[]) => row.join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=produits.csv');
    return res.send('\ufeff' + csv); // BOM UTF-8 pour Excel
  })
);

// POST /api/products/import - Importer produit depuis URL
router.post(
  '/import',
  requireAdminAuth,
  rateLimitImport,
  validate(importProductSchema),
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Import depuis URL externe désactivé (mode catalogue légal).',
        hint: 'Utilise /api/products/import/analyze (analyse-only) ou un flux fournisseur autorisé (CSV/API).',
      });
    }

    const { url, useSuggestedPrice, customPrice, customCategory, stock, downloadImages } = req.body;

    // Analyser le produit (toujours autorisé)
    const analysis = await analyzeProductUrl(url);

    // Créer le produit (peut être interdit en mode conformité minimal)
    let result: any;
    try {
      result = await importAndCreateProduct(url, {
        useSuggestedPrice,
        customPrice,
        customCategory,
        stock,
        downloadImages: downloadImages !== false, // Par défaut true
      });
    } catch (error: any) {
      const message = error?.message || 'Import interdit';
      // Si la création est désactivée en mode conformité, renvoyer un message actionnable.
      if (
        typeof message === 'string' &&
        (message.includes('dataScope=minimal') || message.includes('création de produit désactivée'))
      ) {
        return res.status(409).json({
          error: 'COMPLIANCE_IMPORT_BLOCKED',
          message,
          hint: 'Utilise /api/products/import/analyze pour prévisualiser (mode analyse-only).',
          analysis,
        });
      }
      throw error;
    }

    return res.status(201).json({
      message: 'Produit importé avec succès',
      product: result.product,
      analysis: {
        originalPrice: analysis.price,
        suggestedPrice: analysis.suggestedPrice,
        margin: analysis.margin,
        category: analysis.category,
        tags: analysis.tags,
      },
    });
  })
);

// GET /api/products/import/analyze - Analyser un produit sans le créer
router.post(
  '/import/analyze',
  requireAdminAuth,
  rateLimitImport,
  validate(z.object({ url: z.string().url() })),
  asyncHandler(async (req, res) => {
    const analysis = await analyzeProductUrl(req.body.url);
    res.json({
      analysis,
      preview: {
        title: analysis.title,
        price: analysis.price,
        suggestedPrice: analysis.suggestedPrice,
        margin: analysis.margin,
        category: analysis.category,
        tags: analysis.tags,
        images: analysis.images.slice(0, 3),
      },
    });
  })
);

// POST /api/products/import/batch - Importer plusieurs produits
router.post(
  '/import/batch',
  requireAdminAuth,
  rateLimitImport,
  validate(batchImportSchema),
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Batch import depuis URLs externes désactivé (mode catalogue légal).',
        hint: 'Utilise /api/products/import/batch/analyze (analyse-only) ou un flux fournisseur autorisé.',
      });
    }

    const { items, maxConcurrent, downloadImages } = req.body;

    const result = await batchImportProducts(items, {
      maxConcurrent,
      downloadImages,
    });

    return res.status(201).json({
      message: `Import batch terminé: ${result.success} succès, ${result.failed} échecs`,
      ...result,
    });
  })
);

// POST /api/products/import/batch/analyze - Analyser plusieurs produits
router.post(
  '/import/batch/analyze',
  requireAdminAuth,
  rateLimitImport,
  validate(z.object({
    urls: z.array(z.string().url()).min(1).max(20),
    maxConcurrent: z.number().int().min(1).max(5).optional().default(3),
  })),
  asyncHandler(async (req, res) => {
    const { urls, maxConcurrent } = req.body;

    const results = await batchAnalyzeProducts(urls, maxConcurrent);

    res.json({
      total: results.length,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  })
);

// GET /api/products/import/history - Récupérer l'historique des imports
router.get(
  '/import/history',
  requireAdminAuth,
  validate(z.object({
    limit: z.number().int().min(1).max(100).optional().default(50),
    offset: z.number().int().min(0).optional().default(0),
    status: z.enum(['success', 'failed', 'pending']).optional(),
    sourceSite: z.string().optional(),
  }), 'query'),
  asyncHandler(async (req, res) => {
    const { limit, offset, status, sourceSite } = req.query as any;

    const result = await getImportHistory({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
      status,
      sourceSite,
    });

    res.json(result);
  })
);

// GET /api/products/tags - Récupérer tous les tags disponibles
router.get(
  '/tags',
  asyncHandler(async (_req, res) => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('tags')
        .eq('is_deleted', false);

      if (error) {
        throw error;
      }

      // Extraire tous les tags uniques
      const allTags = new Set<string>();
      (data || []).forEach((product: { tags?: string[] | null }) => {
        if (Array.isArray(product.tags)) {
          product.tags.forEach(tag => {
            if (typeof tag === 'string' && tag.trim().length > 0 && tag !== 'draft') {
              allTags.add(tag.trim());
            }
          });
        }
      });

      const tags = Array.from(allTags).sort();
      return res.json({ tags });
    } catch (error: any) {
      const { logger } = await import('../utils/logger.js');
      logger.error('Erreur récupération tags', error);
      return res.status(500).json({ error: 'Failed to fetch tags' });
    }
  })
);

// GET /api/products/import/stats - Statistiques des imports
router.get(
  '/import/stats',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    const stats = await getImportStats();
    return res.json(stats);
  })
);

export default router;
