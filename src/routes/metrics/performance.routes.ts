/**
 * Routes métriques - Performance
 * Métriques de performance en temps réel
 */
import type { Request, Response } from 'express';
import { Router } from 'express';
import { requireAdminAuth } from '../../middleware/adminAuth.middleware.js';
import { performanceMonitor } from '../../services/performanceMonitoring.js';
import { handleServiceError } from '../../utils/errorHandlers.js';

const router = Router();

/**
 * GET /api/metrics/performance - Métriques de performance en temps réel
 */
router.get('/performance', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const metrics = performanceMonitor.getAllMetrics();
    return res.json(metrics);
  } catch (error) {
    throw handleServiceError(error, 'getPerformanceMetrics', 'Erreur récupération métriques performance');
  }
});

/**
 * GET /api/metrics/performance/slowest - Endpoints les plus lents
 */
router.get('/performance/slowest', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const metrics = performanceMonitor.getAllMetrics();
    const slowest = Object.entries(metrics.endpoints || {})
      .map(([path, data]: [string, any]) => ({
        path,
        avgResponseTime: data.avgResponseTime || 0,
        requestCount: data.requestCount || 0,
      }))
      .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
      .slice(0, limit);

    return res.json({
      timestamp: new Date().toISOString(),
      slowestEndpoints: slowest,
    });
  } catch (error) {
    throw handleServiceError(error, 'getSlowestEndpoints', 'Erreur récupération endpoints lents');
  }
});

/**
 * GET /api/metrics/performance/errors - Endpoints avec erreurs
 */
router.get('/performance/errors', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const metrics = performanceMonitor.getAllMetrics();
    const withErrors = Object.entries(metrics.endpoints || {})
      .map(([path, data]: [string, any]) => ({
        path,
        errorCount: data.errorCount || 0,
        errorRate: data.errorRate || 0,
        requestCount: data.requestCount || 0,
      }))
      .filter((e) => e.errorCount > 0)
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, limit);

    return res.json({
      timestamp: new Date().toISOString(),
      errorEndpoints: withErrors,
    });
  } catch (error) {
    throw handleServiceError(error, 'getErrorEndpoints', 'Erreur récupération endpoints avec erreurs');
  }
});

/**
 * POST /api/metrics/performance/reset - Réinitialiser les métriques de performance
 */
router.post('/performance/reset', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    performanceMonitor.reset();
    return res.json({ success: true, message: 'Métriques de performance réinitialisées' });
  } catch (error) {
    throw handleServiceError(error, 'resetPerformanceMetrics', 'Erreur réinitialisation métriques performance');
  }
});

export default router;

