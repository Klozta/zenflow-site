/**
 * Routes métriques - Divers
 * Autres métriques (database, rate-limit, payments, etc.)
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { getRateLimitCounters } from '../../middleware/rateLimit.middleware.js';
import { getPaymentsCounters } from '../../services/paymentsMetrics.js';
import { handleServiceError } from '../../utils/errorHandlers.js';
import { getCached, setCached } from '../../utils/metricsCache.js';

const router = Router();

/**
 * GET /api/metrics/database - Métriques base de données (cached 5min)
 */
router.get('/database', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:database';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Compter les enregistrements par table
    const tables = ['users', 'products', 'orders', 'reviews', 'return_requests', 'loyalty_profiles'];
    const counts: Record<string, number> = {};

    await Promise.all(
      tables.map(async (table) => {
        try {
          const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
          counts[table] = count || 0;
        } catch {
          counts[table] = 0;
        }
      })
    );

    const result = {
      timestamp: new Date().toISOString(),
      tables: counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getDatabaseMetrics', 'Erreur récupération métriques base de données');
  }
});

/**
 * GET /api/metrics/rate-limit - Compteurs rate-limit (429)
 */
router.get('/rate-limit', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const counters = getRateLimitCounters();
    return res.json({
      timestamp: new Date().toISOString(),
      ...counters,
    });
  } catch (error) {
    throw handleServiceError(error, 'getRateLimitMetrics', 'Erreur récupération métriques rate-limit');
  }
});

/**
 * GET /api/metrics/payments - Compteurs paiements (in-memory)
 */
router.get('/payments', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const counters = getPaymentsCounters();
    return res.json({
      timestamp: new Date().toISOString(),
      ...counters,
    });
  } catch (error) {
    throw handleServiceError(error, 'getPaymentsMetrics', 'Erreur récupération métriques paiements');
  }
});

/**
 * GET /api/metrics/abandoned-carts - Statistiques paniers abandonnés (cached 5min)
 */
router.get('/abandoned-carts', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:abandoned-carts';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { count: total } = await supabase
      .from('abandoned_carts')
      .select('id', { count: 'exact', head: true });

    const { count: recovered } = await supabase
      .from('abandoned_carts')
      .select('id', { count: 'exact', head: true })
      .eq('recovered', true);

    const result = {
      timestamp: new Date().toISOString(),
      total: total || 0,
      recovered: recovered || 0,
      recoveryRate: total && total > 0 ? ((recovered || 0) / total) * 100 : 0,
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getAbandonedCartsMetrics', 'Erreur récupération métriques paniers abandonnés');
  }
});

/**
 * GET /api/metrics/attribution - Statistiques attribution marketing (UTM) (cached 5min)
 */
router.get('/attribution', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:attribution';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { data: orders } = await supabase
      .from('orders')
      .select('utm_source, utm_campaign, utm_medium')
      .not('utm_source', 'is', null);

    const attribution: Record<string, { source: string; campaign?: string; medium?: string; count: number }> = {};
    (orders || []).forEach((order: { utm_source?: string; utm_campaign?: string; utm_medium?: string }) => {
      const key = `${order.utm_source || 'direct'}-${order.utm_campaign || 'none'}-${order.utm_medium || 'none'}`;
      if (!attribution[key]) {
        attribution[key] = {
          source: order.utm_source || 'direct',
          campaign: order.utm_campaign,
          medium: order.utm_medium,
          count: 0,
        };
      }
      attribution[key].count++;
    });

    const result = {
      timestamp: new Date().toISOString(),
      attribution: Object.values(attribution).sort((a, b) => b.count - a.count),
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getAttributionMetrics', 'Erreur récupération métriques attribution');
  }
});

/**
 * GET /api/metrics/reviews - Métriques avis clients (cached 5min)
 */
router.get('/reviews', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:reviews';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { count: total } = await supabase.from('reviews').select('id', { count: 'exact', head: true });
    const { data: reviews } = await supabase.from('reviews').select('rating');

    const ratingCounts: Record<number, number> = {};
    let totalRating = 0;
    (reviews || []).forEach((r: { rating: number }) => {
      ratingCounts[r.rating] = (ratingCounts[r.rating] || 0) + 1;
      totalRating += r.rating;
    });

    const result = {
      timestamp: new Date().toISOString(),
      total: total || 0,
      averageRating: reviews && reviews.length > 0 ? totalRating / reviews.length : 0,
      byRating: ratingCounts,
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getReviewsMetrics', 'Erreur récupération métriques avis');
  }
});

/**
 * GET /api/metrics/returns - Métriques retours (cached 5min)
 */
router.get('/returns', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:returns';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { count: total } = await supabase.from('return_requests').select('id', { count: 'exact', head: true });
    const { data: returns } = await supabase.from('return_requests').select('status');

    const byStatus: Record<string, number> = {};
    (returns || []).forEach((r: { status: string }) => {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    });

    const result = {
      timestamp: new Date().toISOString(),
      total: total || 0,
      byStatus,
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getReturnsMetrics', 'Erreur récupération métriques retours');
  }
});

/**
 * GET /api/metrics/loyalty - Métriques programme de fidélité (cached 5min)
 */
router.get('/loyalty', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:loyalty';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const { count: total } = await supabase.from('loyalty_profiles').select('id', { count: 'exact', head: true });
    const { data: profiles } = await supabase.from('loyalty_profiles').select('tier, total_points');

    const byTier: Record<string, number> = {};
    let totalPoints = 0;
    (profiles || []).forEach((p: { tier: string; total_points: number }) => {
      byTier[p.tier] = (byTier[p.tier] || 0) + 1;
      totalPoints += p.total_points || 0;
    });

    const result = {
      timestamp: new Date().toISOString(),
      total: total || 0,
      totalPoints,
      averagePoints: total && total > 0 ? totalPoints / total : 0,
      byTier,
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getLoyaltyMetrics', 'Erreur récupération métriques fidélité');
  }
});

export default router;

