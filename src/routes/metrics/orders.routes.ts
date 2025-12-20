/**
 * Routes métriques - Commandes
 * Statistiques et métriques liées aux commandes
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { validate } from '../../middleware/validate.middleware.js';
import { handleServiceError } from '../../utils/errorHandlers.js';
import { getCached, setCached } from '../../utils/metricsCache.js';
import { calculateDateRange, calculateTrend, dateFilterSchema } from '../../utils/metricsHelpers.js';

const router = Router();

/**
 * GET /api/metrics/orders - Statistiques commandes (cached 5min)
 * Query params: startDate, endDate, period (24h|7d|30d|90d|1y|all) - optionnel
 */
router.get('/orders', requireAdminAuth, validate(dateFilterSchema, 'query'), async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, period } = req.query as { startDate?: string; endDate?: string; period?: string };
    const { start, end } = calculateDateRange(startDate, endDate, period);

    const cacheKey = `metrics:orders:${start.toISOString()}:${end.toISOString()}`;
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Récupérer toutes les commandes dans la période
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false });

    if (ordersError) {
      throw handleServiceError(ordersError, 'getOrdersMetrics', 'Erreur récupération commandes');
    }

    const ordersList = orders || [];

    // Calculer statistiques
    const total = ordersList.length;
    const totalRevenue = ordersList
      .filter((o: { status: string }) => o.status !== 'cancelled')
      .reduce((sum: number, o: { total: number | string | null }) => sum + Number(o.total || 0), 0);

    const byStatus: Record<string, number> = {};
    ordersList.forEach((order: { status: string }) => {
      byStatus[order.status] = (byStatus[order.status] || 0) + 1;
    });

    const byCountry: Record<string, number> = {};
    ordersList.forEach((order: { shipping_country?: string }) => {
      const country = order.shipping_country || 'unknown';
      byCountry[country] = (byCountry[country] || 0) + 1;
    });

    // Période précédente pour tendances
    const periodDuration = end.getTime() - start.getTime();
    const previousStart = new Date(start.getTime() - periodDuration);
    const previousEnd = start;

    const { data: previousOrders } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', previousStart.toISOString())
      .lt('created_at', previousEnd.toISOString());

    const previousOrdersList = previousOrders || [];
    const previousTotalRevenue = previousOrdersList
      .filter((o: { status: string }) => o.status !== 'cancelled')
      .reduce((sum: number, o: { total: number | string | null }) => sum + Number(o.total || 0), 0);

    // Top countries
    const topCountries = Object.entries(byCountry)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    const result = {
      timestamp: new Date().toISOString(),
      period: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        total: calculateTrend(total, previousOrdersList.length),
        revenue: calculateTrend(totalRevenue, previousTotalRevenue),
        averageOrderValue: total > 0 ? totalRevenue / total : 0,
      },
      byStatus,
      byCountry,
      topCountries,
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getOrdersMetrics', 'Erreur récupération métriques commandes');
  }
});

export default router;

