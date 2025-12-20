/**
 * Route pour exposer les métriques Prometheus
 * GET /metrics - Endpoint Prometheus standard
 */
import { Request, Response, Router } from 'express';
import { register } from '../services/prometheusMetrics.js';

const router = Router();

/**
 * GET /metrics - Expose les métriques au format Prometheus
 * Utilisé par Prometheus pour scraper les métriques
 * Standard: https://prometheus.io/docs/instrumenting/exposition_formats/
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch metrics', message: error.message });
  }
});

export default router;

