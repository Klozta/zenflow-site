/**
 * Routes métriques - Produits
 * Statistiques et métriques liées aux produits
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
// logger non utilisé dans ce fichier
import { handleServiceError } from '../../utils/errorHandlers.js';
import { getCached, setCached } from '../../utils/metricsCache.js';

const router = Router();

/**
 * GET /api/metrics/products - Métriques produits (cached 5min)
 */
router.get('/products', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:products';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Requêtes parallèles
    const [
      totalProducts,
      activeProducts,
      outOfStock,
      lowStock,
      byCategory,
      topRated,
    ] = await Promise.all([
      // Total produits
      supabase.from('products').select('id', { count: 'exact', head: true }),
      // Produits actifs (non supprimés)
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false),
      // Produits en rupture
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .eq('stock', 0),
      // Produits stock faible (<= 5)
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .lte('stock', 5)
        .gt('stock', 0),
      // Produits par catégorie
      supabase
        .from('products')
        .select('category')
        .eq('is_deleted', false),
      // Top produits notés
      supabase
        .from('products')
        .select('id, title, rating, stock')
        .eq('is_deleted', false)
        .not('rating', 'is', null)
        .order('rating', { ascending: false })
        .limit(10),
    ]);

    // Compter par catégorie
    const categoryData = byCategory.data || [];
    const categoryCounts: Record<string, number> = {};
    categoryData.forEach((p: { category?: string }) => {
      const cat = p.category || 'uncategorized';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        total: totalProducts.count || 0,
        active: activeProducts.count || 0,
        outOfStock: outOfStock.count || 0,
        lowStock: lowStock.count || 0,
      },
      byCategory: categoryCounts,
      topRated: topRated.data || [],
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getProductsMetrics', 'Erreur récupération métriques produits');
  }
});

export default router;

