/**
 * Routes génération automatique intelligente de produits
 * L'IA choisit directement sans input utilisateur
 */
import { Router } from 'express';
import { isLegalCatalogModeEnabled } from '../config/legalCatalog.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { autoSearchAndQueueAliExpressProducts } from '../services/autoProductQueueService.js';
import { generateProductFromImage } from '../services/imageRecognitionService.js';
import { createProduct } from '../services/productsService.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/products/auto-smart/generate
 * Génération automatique complète : l'IA choisit tout
 *
 * Options :
 * - mode: 'image' | 'trending' | 'random'
 * - category: catégorie spécifique (optionnel)
 */
router.post(
  '/auto-smart/generate',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Auto-smart (incluant marketplace) désactivé (mode catalogue légal).',
      });
    }

    const { mode = 'trending', category } = req.body;

    try {
      let product;

      if (mode === 'image' && req.body.imageUrl) {
        // Mode image : générer depuis une image fournie
        logger.info('Génération automatique depuis image', { imageUrl: req.body.imageUrl });

        // Convertir URL en buffer si nécessaire
        const axios = (await import('axios')).default;
        const imageResponse = await axios.get(req.body.imageUrl, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(imageResponse.data);

        const generated = await generateProductFromImage(imageBuffer);

        product = await createProduct({
          title: generated.title || 'Produit généré automatiquement',
          description: generated.description || undefined,
          price: generated.price || 0,
          category: generated.category || category || 'Autre',
          stock: 0,
          images: generated.images || [],
          tags: generated.tags || [],
        });

      } else if (mode === 'trending' || mode === 'random') {
        // Mode trending/random : chercher sur AliExpress et créer automatiquement
        logger.info('Génération automatique depuis AliExpress', { mode, category });

        // Catégories populaires pour recherche aléatoire
        const trendingCategories = [
          'phone case', 'jewelry', 'home decor', 'fashion', 'electronics',
          'beauty', 'sports', 'toys', 'kitchen', 'accessories'
        ];

        const searchQuery = category || trendingCategories[Math.floor(Math.random() * trendingCategories.length)];

        // Rechercher et mettre en queue
        const result = await autoSearchAndQueueAliExpressProducts(searchQuery, {
          maxResults: 1,
          minRating: 4.0,
          category: category,
        });

        if (result.queued === 0 || result.pendingProducts.length === 0) {
          return res.status(404).json({
            error: 'Aucun produit trouvé',
            message: 'Aucun produit correspondant trouvé. Essayez une autre catégorie ou mode.',
          });
        }

        // Approuver automatiquement le premier produit
        const pendingProduct = result.pendingProducts[0];
        const { approvePendingProduct } = await import('../services/autoProductQueueService.js');

        const approved = await approvePendingProduct(pendingProduct.id, {
          price: pendingProduct.price,
          stock: 0,
          category: pendingProduct.category,
        });

        product = approved.product;

      } else {
        return res.status(400).json({
          error: 'Mode invalide',
          message: 'Mode doit être "image", "trending" ou "random"',
        });
      }

      return res.status(201).json({
        success: true,
        product,
        message: 'Produit généré et créé automatiquement avec succès',
      });

    } catch (error: any) {
      logger.error('Erreur génération automatique intelligente', error);

      // Messages d'erreur plus clairs
      let errorMessage = 'Erreur lors de la génération automatique';
      if (error.message?.includes('Validation failed')) {
        errorMessage = 'Les données générées ne sont pas valides. Veuillez réessayer.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'La génération prend trop de temps. Réessayez dans quelques instants.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return res.status(500).json({
        error: 'Erreur lors de la génération',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  })
);

export default router;

