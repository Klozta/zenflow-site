/**
 * Routes métriques - Dashboard
 * Métriques système et dashboard principal
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { handleServiceError } from '../../utils/errorHandlers.js';
import { getCached, setCached } from '../../utils/metricsCache.js';
import { calculateTrend, dateFilterSchema } from '../../utils/metricsHelpers.js';

const router = Router();

/**
 * GET /api/metrics - Métriques de l'API (système de base)
 */
router.get('/', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const packageJson = await import('../../../package.json', { assert: { type: 'json' } }).catch(() => null);
    const version = packageJson?.default?.version || '1.0.0';

    const metrics = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version,
      environment: process.env.NODE_ENV || 'development',
    };

    return res.json(metrics);
  } catch (error) {
    throw handleServiceError(error, 'getSystemMetrics', 'Erreur récupération métriques système');
  }
});

/**
 * GET /api/metrics/dashboard - Dashboard métriques (toutes les métriques importantes en une requête)
 * Retourne un résumé optimisé pour les dashboards admin
 * Query params: startDate, endDate, period (24h|7d|30d|90d|1y|all) - optionnel
 */
router.get('/dashboard', requireAdminAuth, validate(dateFilterSchema, 'query'), async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:dashboard';
    const cached = getCached<{
      timestamp: string;
      system: { uptime: number; memory: { heapUsed: number; heapTotal: number; rss: number } };
      overview: {
        totalOrders: number;
        totalRevenue: number;
        totalUsers: number;
        totalProducts: number;
        conversionRate: number;
      };
      recent: {
        newOrders24h: number;
        newUsers24h: number;
        activeUsers7d: number;
      };
      alerts: {
        outOfStock: number;
        pendingReturns: number;
        lowStock: number;
      };
    }>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Requêtes parallèles pour performance optimale
    const [
      totalOrders,
      totalRevenue,
      totalUsers,
      totalProducts,
      newOrders24h,
      newUsers24h,
      activeUsers7d,
      outOfStock,
      pendingReturns,
      lowStock,
    ] = await Promise.all([
      // Total commandes
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      // Revenue total (commandes non annulées)
      supabase
        .from('orders')
        .select('total')
        .neq('status', 'cancelled'),
      // Total utilisateurs
      supabase.from('users').select('id', { count: 'exact', head: true }),
      // Total produits actifs
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false),
      // Nouvelles commandes (24h)
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', twentyFourHoursAgo.toISOString()),
      // Nouveaux utilisateurs (24h)
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', twentyFourHoursAgo.toISOString()),
      // Utilisateurs actifs (7 jours - ont passé commande)
      supabase
        .from('orders')
        .select('user_id')
        .gte('created_at', sevenDaysAgo.toISOString())
        .not('user_id', 'is', null),
      // Produits en rupture
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .eq('stock', 0),
      // Retours en attente
      supabase
        .from('return_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      // Produits stock faible (<= 5)
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_deleted', false)
        .lte('stock', 5)
        .gt('stock', 0),
    ]);

    // Calculer revenue total
    const revenueData = totalRevenue.data || [];
    const totalRevenueAmount = revenueData.reduce((sum: number, order: { total: number | string | null }) => {
      return sum + Number(order.total || 0);
    }, 0);

    // Utilisateurs actifs (7 jours) - dédupliquer
    const activeUsers7dData = activeUsers7d.data || [];
    const activeUsers7dSet = new Set(activeUsers7dData.map((o: { user_id: string }) => o.user_id));
    const activeUsers7dCount = activeUsers7dSet.size;

    // Calculer taux de conversion (utilisateurs avec commandes / total utilisateurs)
    const totalUsersCount = totalUsers.count || 0;
    const { data: usersWithOrders } = await supabase
      .from('orders')
      .select('user_id')
      .not('user_id', 'is', null);
    const usersWithOrdersSet = new Set((usersWithOrders || []).map((o: { user_id: string }) => o.user_id));
    const conversionRate = totalUsersCount > 0 ? (usersWithOrdersSet.size / totalUsersCount) * 100 : 0;

    // Calculer tendances (comparer avec période précédente)
    const previousPeriodStart = new Date(twentyFourHoursAgo.getTime() - 24 * 60 * 60 * 1000);
    const previousPeriodEnd = twentyFourHoursAgo;

    const [
      previousOrders24h,
      previousUsers24h,
      previousOrders7d,
      previousRevenue7d,
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', previousPeriodStart.toISOString())
        .lt('created_at', previousPeriodEnd.toISOString()),
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', previousPeriodStart.toISOString())
        .lt('created_at', previousPeriodEnd.toISOString()),
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(sevenDaysAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .lt('created_at', sevenDaysAgo.toISOString()),
      supabase
        .from('orders')
        .select('total')
        .gte('created_at', new Date(sevenDaysAgo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .lt('created_at', sevenDaysAgo.toISOString())
        .neq('status', 'cancelled'),
    ]);

    const previousRevenue7dData = previousRevenue7d.data || [];
    const previousRevenue7dAmount = previousRevenue7dData.reduce((sum: number, order: { total: number | string | null }) => {
      return sum + Number(order.total || 0);
    }, 0);

    const result = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: {
          heapUsed: process.memoryUsage().heapUsed,
          heapTotal: process.memoryUsage().heapTotal,
          rss: process.memoryUsage().rss,
        },
      },
      overview: {
        totalOrders: totalOrders.count || 0,
        totalRevenue: totalRevenueAmount,
        totalUsers: totalUsersCount,
        totalProducts: totalProducts.count || 0,
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
      recent: {
        orders24h: calculateTrend(newOrders24h.count || 0, previousOrders24h.count || 0),
        users24h: calculateTrend(newUsers24h.count || 0, previousUsers24h.count || 0),
        orders7d: calculateTrend(
          activeUsers7dCount,
          previousOrders7d.count || 0
        ),
        revenue7d: calculateTrend(totalRevenueAmount, previousRevenue7dAmount),
      },
      alerts: {
        outOfStock: outOfStock.count || 0,
        pendingReturns: pendingReturns.count || 0,
        lowStock: lowStock.count || 0,
      },
    };

    await setCached(cacheKey, result, 2 * 60 * 1000); // Cache 2 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getDashboardMetrics', 'Erreur récupération dashboard métriques');
  }
});

export default router;

