/**
 * Routes de monitoring avancé
 * Endpoints pour surveiller la santé des services et les métriques de performance
 */
import { Request, Response, Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import {
    evaluateAlerts,
    getMonitoringMetrics,
} from '../services/monitoringService.js';
import { handleServiceError } from '../utils/errorHandlers.js';

const router = Router();

/**
 * @swagger
 * /api/monitoring/metrics:
 *   get:
 *     summary: Métriques de monitoring complètes
 *     description: Retourne toutes les métriques de monitoring (services, performance, système)
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Métriques de monitoring
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 services:
 *                   type: object
 *                 performance:
 *                   type: object
 *                 system:
 *                   type: object
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/metrics', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = await getMonitoringMetrics();
    return res.json(metrics);
  } catch (error) {
    throw handleServiceError(error, 'getMonitoringMetrics', 'Erreur récupération métriques monitoring');
  }
});

/**
 * @swagger
 * /api/monitoring/alerts:
 *   get:
 *     summary: Alertes actives
 *     description: Retourne les alertes basées sur les seuils configurés
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liste des alertes actives
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alerts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       severity:
 *                         type: string
 *                         enum: [info, warning, critical]
 *                       metric:
 *                         type: string
 *                       value:
 *                         type: number
 *                       threshold:
 *                         type: number
 *                       message:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     critical:
 *                       type: integer
 *                     warning:
 *                       type: integer
 *                     info:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/alerts', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = await getMonitoringMetrics();
    const alerts = evaluateAlerts(metrics);

    const summary = {
      total: alerts.length,
      critical: alerts.filter((a: { severity: string }) => a.severity === 'critical').length,
      warning: alerts.filter((a: { severity: string }) => a.severity === 'warning').length,
      info: alerts.filter((a: { severity: string }) => a.severity === 'info').length,
    };

    return res.json({
      alerts,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    throw handleServiceError(error, 'getMonitoringAlerts', 'Erreur récupération alertes');
  }
});

/**
 * @swagger
 * /api/monitoring/services:
 *   get:
 *     summary: État de santé des services
 *     description: Retourne l'état de santé de tous les services (database, cache, email, stripe)
 *     tags: [Monitoring]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: État des services
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 services:
 *                   type: object
 *                 overall:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get('/services', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = await getMonitoringMetrics();

    const servicesArray = Object.values(metrics.services) as Array<{ status: string }>;
    const overallStatus = servicesArray.every((s) => s.status === 'healthy')
      ? 'healthy'
      : servicesArray.some((s) => s.status === 'unhealthy')
      ? 'unhealthy'
      : 'degraded';

    return res.json({
      services: metrics.services,
      overall: overallStatus,
      timestamp: metrics.timestamp,
    });
  } catch (error) {
    throw handleServiceError(error, 'getServicesHealth', 'Erreur récupération santé services');
  }
});

export default router;

