/**
 * Routes métriques - Alertes
 * Alertes critiques basées sur les métriques
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { supabase } from '../../config/supabase.js';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { handleServiceError } from '../../utils/errorHandlers.js';
import { getCached, setCached } from '../../utils/metricsCache.js';

// Note: alertingService est optionnel - si non disponible, on utilise la logique simple
// Import dynamique pour éviter les erreurs si le service n'existe pas

const router = Router();

/**
 * GET /api/metrics/alerts - Alertes critiques basées sur les métriques
 * Retourne les métriques qui nécessitent une attention immédiate
 */
router.get('/alerts', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'metrics:alerts';
    const cached = getCached<{
      timestamp: string;
      critical: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low'; value: number; threshold?: number }>;
      warnings: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low'; value: number; threshold?: number }>;
    }>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const alerts: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low'; value: number; threshold?: number }> = [];
    const warnings: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low'; value: number; threshold?: number }> = [];

    // Essayer d'utiliser le service d'alerting intelligent s'il est disponible
    let alertingService: any = null;
    let ecommerceAlertRules: any[] = [];
    try {
      const alertingModule = await import('../../services/alertingService.js');
      alertingService = alertingModule.alertingService;
      // Règles d'alerte prédéfinies pour l'e-commerce
      ecommerceAlertRules = [
        {
          name: 'Critical Low Stock',
          condition: (value: number) => value > 50,
          severity: 'high' as const,
          threshold: 50,
        },
        {
          name: 'Low Stock Warning',
          condition: (value: number) => value > 20 && value <= 50,
          severity: 'medium' as const,
          threshold: 20,
        },
        {
          name: 'Pending Returns',
          condition: (value: number) => value > 20,
          severity: 'high' as const,
          threshold: 20,
        },
        {
          name: 'Old Pending Orders',
          condition: (value: number) => value > 10,
          severity: 'high' as const,
          threshold: 10,
        },
        {
          name: 'Low Conversion Rate',
          condition: (value: number) => value < 1,
          severity: 'medium' as const,
          threshold: 1,
        },
      ];
    } catch {
      // Service d'alerting non disponible, on utilise la logique simple
    }

    // Collecter les métriques actuelles
    const [
      { count: outOfStock },
      { count: lowStock },
      { count: pendingReturns },
      { count: oldPendingOrders },
    ] = await Promise.all([
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_deleted', false).eq('stock', 0),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_deleted', false).lte('stock', 5).gt('stock', 0),
      supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);

    // Évaluer les alertes avec le service intelligent si disponible, sinon logique simple
    if (alertingService && ecommerceAlertRules.length > 0) {
      // Utiliser le service d'alerting intelligent
      const outOfStockRule = ecommerceAlertRules.find((r: any) => r.name === 'Critical Low Stock');
      if (outOfStockRule && outOfStock !== null) {
        const alert = await alertingService.evaluateAlert(outOfStockRule, outOfStock || 0);
        if (alert) {
          if (alert.severity === 'critical') alerts.push(alert);
          else if (alert.severity === 'warning') warnings.push(alert);
        }
      }

      const lowStockRule = ecommerceAlertRules.find((r: any) => r.name === 'Low Stock Warning');
      if (lowStockRule && lowStock !== null) {
        const alert = await alertingService.evaluateAlert(lowStockRule, lowStock || 0);
        if (alert) {
          if (alert.severity === 'critical') alerts.push(alert);
          else if (alert.severity === 'warning') warnings.push(alert);
        }
      }

      const pendingReturnsRule = ecommerceAlertRules.find((r: any) => r.name === 'Pending Returns');
      if (pendingReturnsRule && pendingReturns !== null) {
        const alert = await alertingService.evaluateAlert(pendingReturnsRule, pendingReturns || 0);
        if (alert) {
          if (alert.severity === 'critical') alerts.push(alert);
          else if (alert.severity === 'warning') warnings.push(alert);
        }
      }

      const oldPendingOrdersRule = ecommerceAlertRules.find((r: any) => r.name === 'Old Pending Orders');
      if (oldPendingOrdersRule && oldPendingOrders !== null) {
        const alert = await alertingService.evaluateAlert(oldPendingOrdersRule, oldPendingOrders || 0);
        if (alert) {
          if (alert.severity === 'critical') alerts.push(alert);
          else if (alert.severity === 'warning') warnings.push(alert);
        }
      }
    } else {
      // Logique simple si service non disponible
      if (outOfStock && outOfStock > 10) {
        alerts.push({
          type: 'out_of_stock',
          message: `${outOfStock} produits en rupture de stock`,
          severity: outOfStock > 50 ? 'high' : 'medium',
          value: outOfStock,
          threshold: 10,
        });
      } else if (outOfStock && outOfStock > 0) {
        warnings.push({
          type: 'out_of_stock',
          message: `${outOfStock} produits en rupture de stock`,
          severity: 'low',
          value: outOfStock,
          threshold: 10,
        });
      }

      if (lowStock && lowStock > 20) {
        warnings.push({
          type: 'low_stock',
          message: `${lowStock} produits avec stock faible (≤5)`,
          severity: lowStock > 50 ? 'high' : 'medium',
          value: lowStock,
          threshold: 20,
        });
      }

      if (pendingReturns && pendingReturns > 5) {
        alerts.push({
          type: 'pending_returns',
          message: `${pendingReturns} retours en attente de traitement`,
          severity: pendingReturns > 20 ? 'high' : 'medium',
          value: pendingReturns,
          threshold: 5,
        });
      }

      if (oldPendingOrders && oldPendingOrders > 3) {
        alerts.push({
          type: 'old_pending_orders',
          message: `${oldPendingOrders} commandes en attente depuis plus de 24h`,
          severity: oldPendingOrders > 10 ? 'high' : 'medium',
          value: oldPendingOrders,
          threshold: 3,
        });
      }
    }

    // Vérifier le taux de conversion (si < 1%, c'est suspect)
    const { count: totalUsers } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true });

    const { data: usersWithOrders } = await supabase
      .from('orders')
      .select('user_id')
      .not('user_id', 'is', null);

    if (totalUsers && totalUsers > 100) {
      const usersWithOrdersCount = new Set((usersWithOrders || []).map((o: { user_id: string }) => o.user_id)).size;
      const conversionRate = (usersWithOrdersCount / totalUsers) * 100;

      if (conversionRate < 1) {
        warnings.push({
          type: 'low_conversion_rate',
          message: `Taux de conversion très faible: ${conversionRate.toFixed(2)}%`,
          severity: 'medium',
          value: conversionRate,
          threshold: 1,
        });
      }
    }

    const result = {
      timestamp: new Date().toISOString(),
      critical: alerts,
      warnings,
      summary: {
        totalAlerts: alerts.length,
        totalWarnings: warnings.length,
        hasCritical: alerts.some(a => a.severity === 'high'),
      },
    };

    await setCached(cacheKey, result, 1 * 60 * 1000); // Cache 1 minute pour alertes
    return res.json(result);
  } catch (error) {
    throw handleServiceError(error, 'getAlerts', 'Erreur récupération alertes métriques');
  }
});

export default router;

