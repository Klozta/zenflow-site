/**
 * Routes métriques - Utilisateurs
 * Statistiques et métriques liées aux utilisateurs
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
 * GET /api/metrics/users - Métriques utilisateurs (cached 5min)
 */
router.get('/users', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:users';
    const cached = getCached<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Requêtes parallèles
    const [
      totalUsers,
      newUsers24h,
      newUsers7d,
      newUsers30d,
      usersWithOrders,
    ] = await Promise.all([
      // Total utilisateurs
      supabase.from('users').select('id', { count: 'exact', head: true }),
      // Nouveaux utilisateurs (24h)
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', twentyFourHoursAgo.toISOString()),
      // Nouveaux utilisateurs (7 jours)
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo.toISOString()),
      // Nouveaux utilisateurs (30 jours)
      supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString()),
      // Utilisateurs avec commandes
      supabase
        .from('orders')
        .select('user_id')
        .not('user_id', 'is', null),
    ]);

    // Dédupliquer utilisateurs avec commandes
    const usersWithOrdersData = usersWithOrders.data || [];
    const usersWithOrdersSet = new Set(usersWithOrdersData.map((o: { user_id: string }) => o.user_id));
    const usersWithOrdersCount = usersWithOrdersSet.size;

    // Calculer taux de conversion
    const totalUsersCount = totalUsers.count || 0;
    const conversionRate = totalUsersCount > 0 ? (usersWithOrdersCount / totalUsersCount) * 100 : 0;

    const result = {
      timestamp: new Date().toISOString(),
      summary: {
        total: totalUsers.count || 0,
        withOrders: usersWithOrdersCount,
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
      growth: {
        last24h: newUsers24h.count || 0,
        last7d: newUsers7d.count || 0,
        last30d: newUsers30d.count || 0,
      },
    };

    await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getUsersMetrics', 'Erreur récupération métriques utilisateurs');
  }
});

export default router;

