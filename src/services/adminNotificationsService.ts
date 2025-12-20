/**
 * Service centralisé pour les notifications admin
 * Agrège les alertes, commandes en attente, et autres événements critiques
 */

import { supabase } from '../config/supabase.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';
import { evaluateAlerts, getMonitoringMetrics } from './monitoringService.js';

export type NotificationType = 'order_pending' | 'order_new' | 'alert_critical' | 'alert_warning' | 'system_health';

export interface AdminNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  link?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

/**
 * Récupère toutes les notifications admin (non lues)
 */
export async function getAdminNotifications(_includeRead = false): Promise<AdminNotification[]> {
  try {
    const notifications: AdminNotification[] = [];

    // 1. Commandes en attente
    const { count: pendingCount, error: pendingError } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (pendingError) {
      logger.warn('Erreur récupération commandes en attente', { error: pendingError });
    } else if (pendingCount && pendingCount > 0) {
      notifications.push({
        id: `pending-orders-${Date.now()}`,
        type: 'order_pending',
        title: `${pendingCount} commande${pendingCount > 1 ? 's' : ''} en attente`,
        message: `Il y a ${pendingCount} commande${pendingCount > 1 ? 's' : ''} nécessitant votre attention.`,
        severity: pendingCount >= 10 ? 'critical' : 'warning',
        link: '/admin/orders?status=pending',
        metadata: { count: pendingCount },
        createdAt: new Date().toISOString(),
        read: false,
      });
    }

    // 2. Nouvelles commandes (dernières 30 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentOrders, error: recentError } = await supabase
      .from('orders')
      .select('id, order_number, total, created_at')
      .gte('created_at', thirtyMinutesAgo)
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentError) {
      logger.warn('Erreur récupération nouvelles commandes', { error: recentError });
    } else if (recentOrders && recentOrders.length > 0) {
      notifications.push({
        id: `new-orders-${Date.now()}`,
        type: 'order_new',
        title: `${recentOrders.length} nouvelle${recentOrders.length > 1 ? 's' : ''} commande${recentOrders.length > 1 ? 's' : ''}`,
        message: `${recentOrders.length} commande${recentOrders.length > 1 ? 's' : ''} reçue${recentOrders.length > 1 ? 's' : ''} dans les 30 dernières minutes.`,
        severity: 'info',
        link: '/admin/orders',
        metadata: {
          orders: recentOrders.map((o: any) => ({
            id: o.id,
            order_number: o.order_number,
            total: o.total,
            created_at: o.created_at,
          })),
        },
        createdAt: new Date().toISOString(),
        read: false,
      });
    }

    // 3. Alertes du monitoring
    try {
      const monitoringMetrics = await getMonitoringMetrics();
      const alerts = evaluateAlerts(monitoringMetrics);

      for (let i = 0; i < alerts.length; i++) {
        const alert = alerts[i];
        notifications.push({
          id: `alert-${alert.metric}-${i}-${Date.now()}`,
          type: alert.severity === 'critical' ? 'alert_critical' : 'alert_warning',
          title: alert.message,
          message: `${alert.metric}: ${alert.value} (seuil: ${alert.threshold})`,
          severity: alert.severity,
          link: '/admin/monitoring',
          metadata: {
            metric: alert.metric,
            value: alert.value,
            threshold: alert.threshold,
          },
          createdAt: alert.timestamp,
          read: false,
        });
      }
    } catch (monitoringError) {
      logger.warn('Erreur récupération alertes monitoring', { error: monitoringError });
    }

    // 4. Vérification santé système (si critique)
    try {
      const monitoringMetrics = await getMonitoringMetrics();
      const services = monitoringMetrics.services || {};

      const criticalServices = Object.entries(services).filter(
        ([_name, service]: [string, any]) => service.status === 'down' || service.status === 'degraded'
      );

      if (criticalServices.length > 0) {
        notifications.push({
          id: `system-health-${Date.now()}`,
          type: 'system_health',
          title: `${criticalServices.length} service${criticalServices.length > 1 ? 's' : ''} en panne`,
          message: `Les services suivants sont en panne ou dégradés: ${criticalServices.map(([name]) => name).join(', ')}`,
          severity: 'critical',
          link: '/admin/monitoring',
          metadata: {
            services: criticalServices.map(([name, service]: [string, any]) => ({
              name,
              status: service.status,
            })),
          },
          createdAt: new Date().toISOString(),
          read: false,
        });
      }
    } catch (healthError) {
      logger.warn('Erreur vérification santé système', { error: healthError });
    }

    // Trier par sévérité et date (critical > warning > info, puis plus récent en premier)
    const severityOrder: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    notifications.sort((a, b) => {
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return notifications;
  } catch (error) {
    throw handleServiceError(error, 'getAdminNotifications', 'Erreur récupération notifications admin');
  }
}

/**
 * Marque une notification comme lue (stockage en DB si nécessaire)
 * Pour l'instant, on utilise un cache simple en mémoire
 */
const readNotifications = new Set<string>();

export function markNotificationAsRead(notificationId: string): void {
  readNotifications.add(notificationId);
}

export function isNotificationRead(notificationId: string): boolean {
  return readNotifications.has(notificationId);
}

/**
 * Nettoie les notifications lues anciennes (plus de 24h)
 */
export function cleanupReadNotifications(): void {
  // Pour l'instant, on garde tout en mémoire
  // TODO: Implémenter un stockage persistant si nécessaire
}

