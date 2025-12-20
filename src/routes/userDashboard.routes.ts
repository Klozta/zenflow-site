/**
 * Routes pour le tableau de bord utilisateur
 */
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/user/dashboard - Stats du dashboard client
 */
router.get(
  '/dashboard',
  authMiddleware,
  asyncHandler(async (req: any, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    try {
      // Total commandes
      const { count: totalOrders } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Total dépensé
      const { data: orders } = await supabase
        .from('orders')
        .select('total, created_at')
        .eq('user_id', userId)
        .in('status', ['confirmed', 'shipped', 'delivered']);

      const totalSpent = (orders || []).reduce((sum: number, o: { total: number | string | null }) => sum + Number(o.total || 0), 0);

      // Points fidélité
      const { data: loyaltyProfile } = await supabase
        .from('loyalty_profiles')
        .select('total_points, tier')
        .eq('user_id', userId)
        .single();

      // Commandes récentes (5 dernières)
      const { data: recentOrders } = await supabase
        .from('orders')
        .select('id, order_number, total, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      // Dépenses mensuelles (6 derniers mois)
      const monthlySpending: Array<{ month: string; amount: number }> = [];
      const now = new Date();

      for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

        const monthOrders = (orders || []).filter((o: { created_at: string }) => {
          const orderDate = new Date(o.created_at);
          return orderDate >= monthStart && orderDate <= monthEnd;
        });

        const monthTotal = monthOrders.reduce((sum: number, o: { total: number | string | null }) => sum + Number(o.total || 0), 0);

        monthlySpending.push({
          month: date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
          amount: monthTotal,
        });
      }

      return res.json({
        totalOrders: totalOrders || 0,
        totalSpent,
        loyaltyPoints: loyaltyProfile?.total_points || 0,
        loyaltyTier: loyaltyProfile?.tier || 'bronze',
        recentOrders: recentOrders || [],
        monthlySpending,
      });
    } catch (error: any) {
      logger.error('Erreur dashboard user', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

export default router;

