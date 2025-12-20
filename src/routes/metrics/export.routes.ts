/**
 * Routes métriques - Export
 * Export métriques en CSV/JSON
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { handleServiceError } from '../../utils/errorHandlers.js';
import { calculateDateRange, escapeCsvValue } from '../../utils/metricsHelpers.js';

const router = Router();

/**
 * GET /api/metrics/export/:type - Export métriques en CSV
 * Types: orders, products, users, reviews, returns, loyalty, dashboard
 */
router.get('/export/:type', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const validTypes = ['orders', 'products', 'users', 'reviews', 'returns', 'loyalty', 'dashboard'];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        error: 'Invalid export type',
        validTypes,
      });
    }

    switch (type) {
      case 'orders': {
        const { start, end } = calculateDateRange();
        const { data: allOrders } = await supabase
          .from('orders')
          .select('order_number, status, total, created_at, shipping_email, shipping_country')
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString());

        const csvRows = [
          ['Order Number', 'Status', 'Total', 'Created At', 'Email', 'Country'].map(escapeCsvValue).join(','),
          ...(allOrders || []).map((order: { order_number: string; status: string; total: number | string | null; created_at: string; shipping_email: string; shipping_country: string }) =>
            [
              escapeCsvValue(order.order_number),
              escapeCsvValue(order.status),
              escapeCsvValue(Number(order.total || 0).toFixed(2)),
              escapeCsvValue(order.created_at),
              escapeCsvValue(order.shipping_email),
              escapeCsvValue(order.shipping_country),
            ].join(',')
          ),
        ];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().split('T')[0]}.csv"`);
        return res.send(csvRows.join('\n'));
      }

      case 'products': {
        const { data: products } = await supabase
          .from('products')
          .select('title, price, stock, category, rating, created_at')
          .eq('is_deleted', false);

        const csvRows = [
          ['Title', 'Price', 'Stock', 'Category', 'Rating', 'Created At'].map(escapeCsvValue).join(','),
          ...(products || []).map((p: { title: string; price: number | string | null; stock: number | null; category: string; rating: number | null; created_at: string }) =>
            [
              escapeCsvValue(p.title),
              escapeCsvValue(Number(p.price || 0).toFixed(2)),
              escapeCsvValue(p.stock || 0),
              escapeCsvValue(p.category || ''),
              escapeCsvValue(p.rating || 0),
              escapeCsvValue(p.created_at),
            ].join(',')
          ),
        ];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="products-${new Date().toISOString().split('T')[0]}.csv"`);
        return res.send(csvRows.join('\n'));
      }

      case 'users': {
        const { data: users } = await supabase
          .from('users')
          .select('email, created_at')
          .limit(10000); // Limite pour éviter les exports trop volumineux

        const csvRows = [
          ['Email', 'Created At'].map(escapeCsvValue).join(','),
          ...(users || []).map((u: { email: string; created_at: string }) =>
            [
              escapeCsvValue(u.email),
              escapeCsvValue(u.created_at),
            ].join(',')
          ),
        ];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="users-${new Date().toISOString().split('T')[0]}.csv"`);
        return res.send(csvRows.join('\n'));
      }

      case 'dashboard': {
        // Export dashboard en JSON (trop complexe pour CSV)
        // Récupérer depuis le cache directement
        const { getCached } = await import('../../utils/metricsCache.js');
        const cacheKey = 'metrics:dashboard';
        const cached = await getCached(cacheKey);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="dashboard-${new Date().toISOString().split('T')[0]}.json"`);
        return res.json({
          exportedAt: new Date().toISOString(),
          data: cached || { message: 'No cached data available. Please call /api/metrics/dashboard first.' },
        });
      }

      default:
        return res.status(400).json({ error: `Export type ${type} not yet implemented` });
    }
  } catch (error) {
    throw handleServiceError(error, 'exportMetrics', 'Erreur export métriques');
  }
});

export default router;

