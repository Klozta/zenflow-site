/**
 * Routes suggestions automatiques de produits
 * Système clic → produits suggérés (sans écrire)
 */
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { autoSearchAndQueueAliExpressProducts } from '../services/autoProductQueueService.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Catégories de suggestions pour femmes 20-45 ans
 */
const SUGGESTION_CATEGORIES = [
  { id: 'jewelry', name: 'Bijoux', icon: '💍', query: 'jewelry' },
  { id: 'necklace', name: 'Colliers', icon: '📿', query: 'necklace' },
  { id: 'earrings', name: 'Boucles d\'oreilles', icon: '✨', query: 'earrings' },
  { id: 'bracelet', name: 'Bracelets', icon: '💫', query: 'bracelet' },
  { id: 'handbag', name: 'Sacs à main', icon: '👜', query: 'handbag' },
  { id: 'scarf', name: 'Écharpes & Foulards', icon: '🧣', query: 'scarf' },
  { id: 'makeup', name: 'Maquillage', icon: '💄', query: 'makeup' },
  { id: 'skincare', name: 'Soins de la peau', icon: '🧴', query: 'skincare' },
  { id: 'perfume', name: 'Parfums', icon: '🌸', query: 'perfume' },
  { id: 'fashion', name: 'Mode', icon: '👗', query: 'fashion' },
  { id: 'home-decor', name: 'Décoration', icon: '🕯️', query: 'home decor' },
  { id: 'phone-case', name: 'Coques téléphone', icon: '📱', query: 'phone case' },
  { id: 'watch', name: 'Montres', icon: '⌚', query: 'watch' },
  { id: 'nail-art', name: 'Nail Art', icon: '💅', query: 'nail art' },
  { id: 'yoga', name: 'Yoga & Bien-être', icon: '🧘', query: 'yoga accessory' },
];

/**
 * GET /api/products/suggestions/categories
 * Liste des catégories de suggestions disponibles
 */
router.get(
  '/suggestions/categories',
  asyncHandler(async (_req, res) => {
    return res.json({
      success: true,
      categories: SUGGESTION_CATEGORIES,
      count: SUGGESTION_CATEGORIES.length,
    });
  })
);

/**
 * POST /api/products/suggestions/generate
 * Générer des produits suggérés pour une catégorie
 *
 * Body: { categoryId: string, maxResults?: number }
 */
router.post(
  '/suggestions/generate',
  asyncHandler(async (req, res) => {
    const { categoryId, maxResults = 5 } = req.body;

    if (!categoryId) {
      return res.status(400).json({
        error: 'Category ID required',
        message: 'Veuillez spécifier une catégorie (categoryId)',
      });
    }

    // Trouver la catégorie
    const category = SUGGESTION_CATEGORIES.find(cat => cat.id === categoryId);
    if (!category) {
      return res.status(404).json({
        error: 'Category not found',
        message: `Catégorie "${categoryId}" non trouvée`,
        availableCategories: SUGGESTION_CATEGORIES.map(c => ({ id: c.id, name: c.name })),
      });
    }

    try {
      logger.info('Génération suggestions produits', { categoryId, categoryName: category.name, query: category.query });

      // Rechercher et mettre en queue - utiliser directement la query de la catégorie
      const result = await autoSearchAndQueueAliExpressProducts(category.query, {
        maxResults: Math.min(maxResults, 10),
        minRating: 4.0,
      });

      logger.info('Résultat génération suggestions', {
        categoryId,
        queued: result.queued,
        pendingCount: result.pendingProducts?.length || 0,
      });

      // Message plus informatif
      let message = '';
      if (result.queued > 0) {
        message = `${result.queued} produit(s) ${category.name.toLowerCase()} ajouté(s) en attente de validation`;
      } else if (result.pendingProducts && result.pendingProducts.length > 0) {
        // Produits trouvés mais pas ajoutés (erreur lors de l'ajout)
        message = `${result.pendingProducts.length} produit(s) trouvé(s) mais erreur lors de l'ajout. Réessayez.`;
      } else {
        // Aucun produit trouvé
        const hasScraperAPI = !!process.env.SCRAPER_API_KEY;
        message = `Aucun produit ${category.name.toLowerCase()} trouvé pour le moment. ${
          hasScraperAPI
            ? 'AliExpress peut être temporairement indisponible ou bloqué. Réessayez dans quelques instants.'
            : 'AliExpress bloque souvent les requêtes directes. Configurez SCRAPER_API_KEY pour améliorer le taux de succès.'
        }`;
      }

      return res.json({
        success: true,
        category: {
          id: category.id,
          name: category.name,
          icon: category.icon,
        },
        queued: result.queued,
        pendingProducts: result.pendingProducts || [],
        message,
        suggestion: result.queued === 0 && !process.env.SCRAPER_API_KEY
          ? 'Ajoutez SCRAPER_API_KEY dans l’environnement backend pour débloquer les suggestions.'
          : undefined,
      });
    } catch (error: any) {
      logger.error('Erreur génération suggestions', error, { categoryId });

      let errorMessage = 'Erreur lors de la génération des suggestions';
      if (error.message?.includes('timeout')) {
        errorMessage = 'La recherche prend trop de temps. Réessayez dans quelques instants.';
      } else if (error.message?.includes('block')) {
        errorMessage = 'AliExpress bloque temporairement. Configurez SCRAPER_API_KEY pour contourner.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return res.status(500).json({
        error: 'Erreur génération suggestions',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  })
);

/**
 * POST /api/products/suggestions/generate-random
 * Générer des produits aléatoires (sans spécifier de catégorie)
 */
router.post(
  '/suggestions/generate-random',
  asyncHandler(async (req, res) => {
    const { maxResults = 5 } = req.body;

    // Choisir une catégorie aléatoire
    const randomCategory = SUGGESTION_CATEGORIES[
      Math.floor(Math.random() * SUGGESTION_CATEGORIES.length)
    ];

    try {
      logger.info('Génération suggestions aléatoires', {
        category: randomCategory.name,
        query: randomCategory.query,
        hasScraperAPI: !!process.env.SCRAPER_API_KEY,
      });

      const result = await autoSearchAndQueueAliExpressProducts(randomCategory.query, {
        maxResults: Math.min(maxResults, 5), // Réduire à 5 pour éviter timeout
        minRating: 4.0,
      });

      logger.info('Résultat génération aléatoire', {
        category: randomCategory.name,
        query: randomCategory.query,
        queued: result.queued,
        pendingCount: result.pendingProducts?.length || 0,
      });

      // Message plus informatif selon le résultat
      let message = '';
      if (result.queued > 0) {
        message = `${result.queued} produit(s) ${randomCategory.name.toLowerCase()} ajouté(s) en attente !`;
      } else if (result.pendingProducts && result.pendingProducts.length > 0) {
        message = `${result.pendingProducts.length} produit(s) trouvé(s) mais erreur lors de l'ajout. Réessayez.`;
      } else {
        // Message plus détaillé pour aider l'utilisateur
        const hasScraperAPI = !!process.env.SCRAPER_API_KEY;
        message = `Aucun produit ${randomCategory.name.toLowerCase()} trouvé pour le moment. ${hasScraperAPI ? 'AliExpress peut être temporairement indisponible ou bloqué. Réessayez dans quelques instants.' : 'Configurez SCRAPER_API_KEY dans .env pour améliorer le taux de succès. AliExpress bloque souvent les requêtes directes.'}`;
      }

      return res.json({
        success: result.queued > 0,
        category: {
          id: randomCategory.id,
          name: randomCategory.name,
          icon: randomCategory.icon,
        },
        queued: result.queued,
        pendingProducts: result.pendingProducts || [],
        message,
        suggestion: result.queued === 0 && !process.env.SCRAPER_API_KEY
          ? 'Configurez SCRAPER_API_KEY pour améliorer les résultats'
          : undefined,
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Erreur génération suggestions aléatoires', error instanceof Error ? error : new Error(errorMessage), {
        category: randomCategory?.name,
        query: randomCategory?.query,
        hasScraperAPI: !!process.env.SCRAPER_API_KEY,
      });

      // Message d'erreur plus spécifique
      let userMessage = 'Erreur lors de la génération des suggestions aléatoires.';
      if (errorMessage.includes('timeout') || errorMessage.includes('too long')) {
        userMessage = 'La recherche prend trop de temps. Réessayez dans quelques instants ou configurez SCRAPER_API_KEY.';
      } else if (errorMessage.includes('block') || errorMessage.includes('403')) {
        userMessage = 'AliExpress bloque temporairement. Configurez SCRAPER_API_KEY pour contourner le blocage.';
      } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
        userMessage = 'Erreur de connexion. Vérifiez votre connexion internet et réessayez.';
      }

      return res.status(500).json({
        success: false,
        error: 'Erreur génération suggestions',
        message: userMessage,
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  })
);

export default router;

