/**
 * Routes pour notifications admin (nouvelles commandes, etc.)
 */
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { getAdminNotifications, markNotificationAsRead } from '../services/adminNotificationsService.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/notifications/pending-orders-count - Compte commandes en attente
 */
router.get(
  '/pending-orders-count',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    try {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;

      return res.json({
        count: count || 0,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('Erreur récupération count pending orders', error);
      return res.status(500).json({ error: 'Failed to fetch pending orders count' });
    }
  })
);

/**
 * GET /api/notifications/recent-orders - Commandes récentes (dernières 5)
 */
router.get(
  '/recent-orders',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const since = req.query.since as string | undefined; // ISO timestamp

      let query = supabase
        .from('orders')
        .select('id, order_number, total, status, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (since) {
        query = query.gte('created_at', since);
      }

      const { data, error } = await query;

      if (error) throw error;

      return res.json({
        orders: data || [],
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      throw handleServiceError(error, 'getRecentOrders', 'Erreur récupération commandes récentes');
    }
  })
);

/**
 * GET /api/notifications/admin - Récupère toutes les notifications admin
 * Query params: includeRead (boolean, défaut: false)
 */
router.get(
  '/admin',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const includeRead = req.query.includeRead === 'true';
      const notifications = await getAdminNotifications(includeRead);
      return res.json({
        notifications,
        count: notifications.length,
        unreadCount: notifications.filter((n) => !n.read).length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      throw handleServiceError(error, 'getAdminNotifications', 'Erreur récupération notifications admin');
    }
  })
);

/**
 * POST /api/notifications/admin/:id/read - Marque une notification comme lue
 */
router.post(
  '/admin/:id/read',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      markNotificationAsRead(id);
      return res.json({ success: true, id });
    } catch (error) {
      throw handleServiceError(error, 'markNotificationRead', 'Erreur marquage notification comme lue');
    }
  })
);

export default router;
