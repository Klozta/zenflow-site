/**
 * Routes analytics - Business intelligence
 */
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { getCached, setCached } from '../utils/metricsCache.js';
import { escapeCsvValue } from '../utils/metricsHelpers.js';

const router = Router();

/**
 * GET /api/analytics/top-products - Top produits par revenus/quantité
 */
router.get(
  '/top-products',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const cacheKey = 'analytics:top-products';
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const period = req.query.period as 'day' | 'week' | 'month' | 'all' || 'all';

      // Récupérer les items de commandes avec produits
      let dateFilter = '';
      if (period !== 'all') {
        const now = new Date();
        if (period === 'day') {
          const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          dateFilter = dayAgo.toISOString();
        } else if (period === 'week') {
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          dateFilter = weekAgo.toISOString();
        } else if (period === 'month') {
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          dateFilter = monthAgo.toISOString();
        }
      }

      // Récupérer les commandes (non annulées)
      let ordersQuery = supabase
        .from('orders')
        .select('id, created_at')
        .neq('status', 'cancelled');

      if (dateFilter) {
        ordersQuery = ordersQuery.gte('created_at', dateFilter);
      }

      const { data: orders, error: ordersError } = await ordersQuery;

      if (ordersError) throw ordersError;

      const orderIds = (orders || []).map((o: any) => o.id);

      if (orderIds.length === 0) {
        const result = { products: [], period, timestamp: new Date().toISOString() };
        setCached(cacheKey, result);
        return res.json(result);
      }

      // Récupérer les items avec produits
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('product_id, quantity, price, order_id')
        .in('order_id', orderIds);

      if (itemsError) throw itemsError;

      // Agréger par produit
      const productStats = new Map<
        string,
        { productId: string; totalRevenue: number; totalQuantity: number; orderCount: number }
      >();

      (items || []).forEach((item: any) => {
        const productId = item.product_id;
        const revenue = Number(item.price || 0) * Number(item.quantity || 0);
        const quantity = Number(item.quantity || 0);

        const existing = productStats.get(productId) || {
          productId,
          totalRevenue: 0,
          totalQuantity: 0,
          orderCount: 0,
        };

        existing.totalRevenue += revenue;
        existing.totalQuantity += quantity;
        existing.orderCount += 1;

        productStats.set(productId, existing);
      });

      // Récupérer les infos produits
      const productIds = Array.from(productStats.keys());
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, title, price, images')
        .in('id', productIds);

      if (productsError) throw productsError;

      // Combiner stats + infos produits
      const topProducts = Array.from(productStats.entries())
        .map(([productId, stats]) => {
          const product = (products || []).find((p: any) => p.id === productId);
          return {
            productId,
            title: product?.title || 'Produit supprimé',
            price: product?.price || 0,
            image: product?.images?.[0] || null,
            totalRevenue: stats.totalRevenue,
            totalQuantity: stats.totalQuantity,
            orderCount: stats.orderCount,
            averageOrderValue: stats.totalRevenue / stats.orderCount,
          };
        })
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, limit);

      const result = {
        products: topProducts,
        period,
        timestamp: new Date().toISOString(),
      };

      setCached(cacheKey, result);
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getTopProducts', 'Erreur récupération top produits');
    }
  })
);

/**
 * GET /api/analytics/funnel - Funnel de conversion
 */
router.get(
  '/funnel',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    try {
      const cacheKey = 'analytics:funnel';
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // Récupérer les métriques depuis la base
      // Note: Ces données devraient venir de Google Analytics ou d'un tracking custom
      // Pour l'instant, on fait une approximation depuis les commandes

      const { count: totalOrders } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .neq('status', 'cancelled');

      // Récupérer paniers abandonnés
      const { count: abandonedCarts } = await supabase
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true })
        .eq('recovered', false);

      // Approximation: on suppose que chaque commande = 1 checkout complété
      // Les autres étapes (vues, panier) nécessitent un tracking custom
      const views = totalOrders ? totalOrders * 10 : 0; // Approximation
      const cart = (totalOrders || 0) + (abandonedCarts || 0);
      const checkout = totalOrders ? totalOrders * 1.5 : 0; // Approximation
      const purchase = totalOrders || 0;

      const result = {
        views,
        cart,
        checkout,
        purchase,
        conversionRates: {
          viewToCart: cart > 0 ? ((cart / views) * 100).toFixed(2) : '0.00',
          cartToCheckout: cart > 0 ? ((checkout / cart) * 100).toFixed(2) : '0.00',
          checkoutToPurchase: checkout > 0 ? ((purchase / checkout) * 100).toFixed(2) : '0.00',
          overall: views > 0 ? ((purchase / views) * 100).toFixed(2) : '0.00',
        },
        timestamp: new Date().toISOString(),
      };

      setCached(cacheKey, result);
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getFunnel', 'Erreur récupération funnel');
    }
  })
);

/**
 * GET /api/analytics/revenue - Revenus par période
 */
router.get(
  '/revenue',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const period = req.query.period as 'day' | 'week' | 'month' | 'year' || 'month';
      const cacheKey = `analytics:revenue:${period}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const { data: orders, error } = await supabase
        .from('orders')
        .select('total, created_at, status')
        .gte('created_at', startDate.toISOString())
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Grouper par jour/semaine/mois selon période
      const revenueByPeriod: Record<string, number> = {};
      const orderCountByPeriod: Record<string, number> = {};

      (orders || []).forEach((order: any) => {
        const date = new Date(order.created_at);
        let key: string;

        if (period === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (period === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (period === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else {
          key = String(date.getFullYear());
        }

        revenueByPeriod[key] = (revenueByPeriod[key] || 0) + Number(order.total || 0);
        orderCountByPeriod[key] = (orderCountByPeriod[key] || 0) + 1;
      });

      const totalRevenue = Object.values(revenueByPeriod).reduce((sum, val) => sum + val, 0);
      const totalOrders = Object.values(orderCountByPeriod).reduce((sum, val) => sum + val, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const result = {
        period,
        totalRevenue,
        totalOrders,
        averageOrderValue,
        revenueByPeriod,
        orderCountByPeriod,
        timestamp: new Date().toISOString(),
      };

      setCached(cacheKey, result);
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getRevenue', 'Erreur récupération revenus');
    }
  })
);

/**
 * GET /api/analytics/abandoned-carts-recovery - Taux de récupération paniers abandonnés
 */
router.get(
  '/abandoned-carts-recovery',
  requireAdminAuth,
  asyncHandler(async (_req, res) => {
    try {
      const cacheKey = 'analytics:abandoned-carts-recovery';
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const { count: totalAbandoned } = await supabase
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true });

      const { count: recovered } = await supabase
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true })
        .eq('recovered', true);

      const { count: emailed } = await supabase
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true })
        .eq('email_sent', true);

      const recoveryRate = totalAbandoned && totalAbandoned > 0
        ? ((recovered || 0) / totalAbandoned * 100).toFixed(2)
        : '0.00';

      const emailOpenRate = emailed && emailed > 0
        ? ((recovered || 0) / emailed * 100).toFixed(2)
        : '0.00';

      const result = {
        totalAbandoned: totalAbandoned || 0,
        recovered: recovered || 0,
        emailed: emailed || 0,
        recoveryRate: `${recoveryRate}%`,
        emailOpenRate: `${emailOpenRate}%`,
        timestamp: new Date().toISOString(),
      };

      await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getAbandonedCartsRecovery', 'Erreur récupération taux récupération');
    }
  })
);

/**
 * GET /api/analytics/attribution - Attribution marketing (UTM sources/campaigns)
 */
router.get(
  '/attribution',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const period = req.query.period as 'day' | 'week' | 'month' | 'year' || 'month';
      const cacheKey = `analytics:attribution:${period}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const { data: orders, error } = await supabase
        .from('orders')
        .select('total, utm_source, utm_campaign, utm_medium, created_at')
        .gte('created_at', startDate.toISOString())
        .neq('status', 'cancelled');

      if (error) throw error;

      // Agréger par source UTM
      const bySource: Record<string, { revenue: number; orders: number; aov: number }> = {};
      const byCampaign: Record<string, { revenue: number; orders: number; aov: number }> = {};
      const byMedium: Record<string, { revenue: number; orders: number; aov: number }> = {};

      (orders || []).forEach((order: any) => {
        const revenue = Number(order.total || 0);
        const source = order.utm_source || 'direct';
        const campaign = order.utm_campaign || 'none';
        const medium = order.utm_medium || 'none';

        // Par source
        if (!bySource[source]) {
          bySource[source] = { revenue: 0, orders: 0, aov: 0 };
        }
        bySource[source].revenue += revenue;
        bySource[source].orders += 1;

        // Par campagne
        if (!byCampaign[campaign]) {
          byCampaign[campaign] = { revenue: 0, orders: 0, aov: 0 };
        }
        byCampaign[campaign].revenue += revenue;
        byCampaign[campaign].orders += 1;

        // Par medium
        if (!byMedium[medium]) {
          byMedium[medium] = { revenue: 0, orders: 0, aov: 0 };
        }
        byMedium[medium].revenue += revenue;
        byMedium[medium].orders += 1;
      });

      // Calculer AOV pour chaque groupe
      Object.keys(bySource).forEach((source) => {
        bySource[source].aov = bySource[source].orders > 0
          ? bySource[source].revenue / bySource[source].orders
          : 0;
      });
      Object.keys(byCampaign).forEach((campaign) => {
        byCampaign[campaign].aov = byCampaign[campaign].orders > 0
          ? byCampaign[campaign].revenue / byCampaign[campaign].orders
          : 0;
      });
      Object.keys(byMedium).forEach((medium) => {
        byMedium[medium].aov = byMedium[medium].orders > 0
          ? byMedium[medium].revenue / byMedium[medium].orders
          : 0;
      });

      const result = {
        period,
        bySource: Object.entries(bySource)
          .map(([source, data]) => ({ source, ...data }))
          .sort((a, b) => b.revenue - a.revenue),
        byCampaign: Object.entries(byCampaign)
          .map(([campaign, data]) => ({ campaign, ...data }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 20), // Top 20 campagnes
        byMedium: Object.entries(byMedium)
          .map(([medium, data]) => ({ medium, ...data }))
          .sort((a, b) => b.revenue - a.revenue),
        timestamp: new Date().toISOString(),
      };

      await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getAttribution', 'Erreur récupération attribution marketing');
    }
  })
);

/**
 * GET /api/analytics/conversion - Taux de conversion et métriques clés
 */
router.get(
  '/conversion',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const period = req.query.period as 'day' | 'week' | 'month' | 'year' || 'month';
      const cacheKey = `analytics:conversion:${period}`;
      const cached = await getCached<any>(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'day':
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Commandes
      const { data: orders, count: totalOrders } = await supabase
        .from('orders')
        .select('total, created_at', { count: 'exact' })
        .gte('created_at', startDate.toISOString())
        .neq('status', 'cancelled');

      // Utilisateurs (nouveaux)
      const { count: newUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString());

      // Utilisateurs avec commandes
      const { data: usersWithOrders } = await supabase
        .from('orders')
        .select('user_id')
        .gte('created_at', startDate.toISOString())
        .neq('status', 'cancelled')
        .not('user_id', 'is', null);

      const uniqueBuyers = new Set((usersWithOrders || []).map((o: any) => o.user_id)).size;

      // Calculs
      const totalRevenue = (orders || []).reduce((sum: number, o: any) => sum + Number(o.total || 0), 0);
      const averageOrderValue = (totalOrders || 0) > 0 ? totalRevenue / (totalOrders || 1) : 0;
      const conversionRate = (newUsers || 0) > 0
        ? ((uniqueBuyers / (newUsers || 1)) * 100).toFixed(2)
        : '0.00';

      // Paniers abandonnés
      const { count: abandonedCarts } = await supabase
        .from('abandoned_carts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startDate.toISOString());

      const cartAbandonmentRate = (totalOrders || 0) + (abandonedCarts || 0) > 0
        ? (((abandonedCarts || 0) / ((totalOrders || 0) + (abandonedCarts || 0))) * 100).toFixed(2)
        : '0.00';

      const result = {
        period,
        totalRevenue,
        totalOrders: totalOrders || 0,
        averageOrderValue,
        newUsers: newUsers || 0,
        uniqueBuyers,
        conversionRate: `${conversionRate}%`,
        abandonedCarts: abandonedCarts || 0,
        cartAbandonmentRate: `${cartAbandonmentRate}%`,
        timestamp: new Date().toISOString(),
      };

      await setCached(cacheKey, result, 5 * 60 * 1000); // Cache 5 minutes
      return res.json(result);
    } catch (error) {
      throw handleServiceError(error, 'getConversion', 'Erreur récupération métriques conversion');
    }
  })
);

/**
 * GET /api/analytics/export/:type - Export CSV des données analytics
 * Types: revenue, attribution, conversion, top-products, funnel
 */
router.get(
  '/export/:type',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const type = req.params.type as 'revenue' | 'attribution' | 'conversion' | 'top-products' | 'funnel';
      const period = (req.query.period as 'day' | 'week' | 'month' | 'year') || 'month';

      let csv = '';
      let filename = '';

      switch (type) {
        case 'revenue': {
          const cacheKey = `analytics:revenue:${period}`;
          const data = await getCached<any>(cacheKey);
          if (!data) {
            return res.status(404).json({ error: 'Data not found. Please fetch analytics first.' });
          }

          filename = `revenue-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          csv = [
            ['Période', 'Revenus (€)', 'Commandes'].map(escapeCsvValue).join(','),
            ...Object.entries(data.revenueByPeriod || {}).map(([period, revenue]) => [
              period,
              Number(revenue).toFixed(2),
              data.orderCountByPeriod?.[period] || 0,
            ].map(escapeCsvValue).join(',')),
            '',
            ['Total', data.totalRevenue.toFixed(2), data.totalOrders].map(escapeCsvValue).join(','),
            ['Panier moyen', data.averageOrderValue.toFixed(2), ''].map(escapeCsvValue).join(','),
          ].join('\n');
          break;
        }

        case 'attribution': {
          const cacheKey = `analytics:attribution:${period}`;
          const data = await getCached<any>(cacheKey);
          if (!data) {
            return res.status(404).json({ error: 'Data not found. Please fetch analytics first.' });
          }

          filename = `attribution-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          csv = [
            // Par source
            ['Source UTM', 'Revenus (€)', 'Commandes', 'Panier moyen (€)'].map(escapeCsvValue).join(','),
            ...(data.bySource || []).map((s: any) => [
              s.source,
              s.revenue.toFixed(2),
              s.orders,
              s.aov.toFixed(2),
            ].map(escapeCsvValue).join(',')),
            '',
            // Par campagne
            ['Campagne', 'Revenus (€)', 'Commandes', 'Panier moyen (€)'].map(escapeCsvValue).join(','),
            ...(data.byCampaign || []).map((c: any) => [
              c.campaign,
              c.revenue.toFixed(2),
              c.orders,
              c.aov.toFixed(2),
            ].map(escapeCsvValue).join(',')),
          ].join('\n');
          break;
        }

        case 'conversion': {
          const cacheKey = `analytics:conversion:${period}`;
          const data = await getCached<any>(cacheKey);
          if (!data) {
            return res.status(404).json({ error: 'Data not found. Please fetch analytics first.' });
          }

          filename = `conversion-${period}-${new Date().toISOString().split('T')[0]}.csv`;
          csv = [
            ['Métrique', 'Valeur'].map(escapeCsvValue).join(','),
            ['Revenus totaux (€)', data.totalRevenue.toFixed(2)].map(escapeCsvValue).join(','),
            ['Commandes totales', data.totalOrders].map(escapeCsvValue).join(','),
            ['Panier moyen (€)', data.averageOrderValue.toFixed(2)].map(escapeCsvValue).join(','),
            ['Nouveaux utilisateurs', data.newUsers].map(escapeCsvValue).join(','),
            ['Acheteurs uniques', data.uniqueBuyers].map(escapeCsvValue).join(','),
            ['Taux de conversion', data.conversionRate].map(escapeCsvValue).join(','),
            ['Paniers abandonnés', data.abandonedCarts].map(escapeCsvValue).join(','),
            ['Taux d\'abandon panier', data.cartAbandonmentRate].map(escapeCsvValue).join(','),
          ].join('\n');
          break;
        }

        case 'top-products': {
          const cacheKey = 'analytics:top-products';
          const data = await getCached<any>(cacheKey);
          if (!data) {
            return res.status(404).json({ error: 'Data not found. Please fetch analytics first.' });
          }

          filename = `top-products-${new Date().toISOString().split('T')[0]}.csv`;
          csv = [
            ['Produit', 'Revenus (€)', 'Quantité vendue', 'Commandes', 'Panier moyen (€)'].map(escapeCsvValue).join(','),
            ...(data.products || []).map((p: any) => [
              p.title,
              p.totalRevenue.toFixed(2),
              p.totalQuantity,
              p.orderCount,
              p.averageOrderValue.toFixed(2),
            ].map(escapeCsvValue).join(',')),
          ].join('\n');
          break;
        }

        case 'funnel': {
          const cacheKey = 'analytics:funnel';
          const data = await getCached<any>(cacheKey);
          if (!data) {
            return res.status(404).json({ error: 'Data not found. Please fetch analytics first.' });
          }

          filename = `funnel-${new Date().toISOString().split('T')[0]}.csv`;
          csv = [
            ['Étape', 'Nombre', 'Taux de conversion (%)'].map(escapeCsvValue).join(','),
            ['Vues', data.views, '100.00'].map(escapeCsvValue).join(','),
            ['Panier', data.cart, data.conversionRates?.viewToCart || '0.00'].map(escapeCsvValue).join(','),
            ['Checkout', data.checkout, data.conversionRates?.cartToCheckout || '0.00'].map(escapeCsvValue).join(','),
            ['Achat', data.purchase, data.conversionRates?.checkoutToPurchase || '0.00'].map(escapeCsvValue).join(','),
            ['', '', ''],
            ['Taux global', data.conversionRates?.overall || '0.00', ''].map(escapeCsvValue).join(','),
          ].join('\n');
          break;
        }

        default:
          return res.status(400).json({ error: `Invalid export type: ${type}. Valid types: revenue, attribution, conversion, top-products, funnel` });
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send('\ufeff' + csv); // BOM UTF-8 pour Excel
    } catch (error) {
      throw handleServiceError(error, 'exportAnalytics', 'Erreur export CSV analytics');
    }
  })
);

export default router;
