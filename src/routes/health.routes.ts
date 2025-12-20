/**
 * Routes de health check avancées
 * Vérification de l'état de santé de l'application et des services
 */
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    cache?: ServiceHealth;
    email?: ServiceHealth;
    stripe?: ServiceHealth;
  };
  version: string;
}

interface ServiceHealth {
  status: 'up' | 'down';
  responseTime?: number;
  error?: string;
}

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check simple
 *     description: Vérification rapide de l'état de l'API
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API opérationnelle
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: string
 */
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

/**
 * @swagger
 * /health/detailed:
 *   get:
 *     summary: Health check détaillé
 *     description: Vérification complète de l'état de l'API et des services (database, cache, etc.)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: État de santé des services
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, degraded, unhealthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                 services:
 *                   type: object
 *                 version:
 *                   type: string
 */
router.get('/detailed', async (_req, res) => {
  const startTime = Date.now();
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: { status: 'down' },
    },
    version: '1.0.0',
  };

  // Vérifier Supabase
  try {
    const dbStartTime = Date.now();
    const { error } = await supabase.from('products').select('id').limit(1);
    const dbResponseTime = Date.now() - dbStartTime;

    if (error) {
      health.services.database = {
        status: 'down',
        error: error.message,
      };
      health.status = 'unhealthy';
    } else {
      health.services.database = {
        status: 'up',
        responseTime: dbResponseTime,
      };
    }
  } catch (error: any) {
    logger.error('Health check database error', error);
    health.services.database = {
      status: 'down',
      error: error.message,
    };
    health.status = 'unhealthy';
  }

  // Vérifier Redis (si configuré)
  if (process.env.UPSTASH_REDIS_URL) {
    try {
      const cacheStartTime = Date.now();
      // Test simple de connexion Redis
      const { getCache } = await import('../utils/cache.js');
      await getCache('health-check-test');
      const cacheResponseTime = Date.now() - cacheStartTime;

      health.services.cache = {
        status: 'up',
        responseTime: cacheResponseTime,
      };
    } catch (error: any) {
      logger.warn('Health check cache error', error);
      health.services.cache = {
        status: 'down',
        error: error.message,
      };
      health.status = health.status === 'healthy' ? 'degraded' : health.status;
    }
  }

  // Vérifier Email service avec test réel
  try {
    const { checkEmailHealth } = await import('../services/monitoringService.js');
    const emailHealth = await checkEmailHealth();
    health.services.email = {
      status: emailHealth.status === 'healthy' ? 'up' : 'down',
      responseTime: emailHealth.responseTime,
      error: emailHealth.error,
    };
    if (emailHealth.status !== 'healthy') {
      health.status = health.status === 'healthy' ? 'degraded' : health.status;
    }
  } catch (error: any) {
    logger.warn('Health check email error', error);
    health.services.email = {
      status: 'down',
      error: error.message,
    };
    health.status = health.status === 'healthy' ? 'degraded' : health.status;
  }

  // Vérifier Stripe avec test réel
  try {
    const { checkStripeHealth } = await import('../services/monitoringService.js');
    const stripeHealth = await checkStripeHealth();
    health.services.stripe = {
      status: stripeHealth.status === 'healthy' ? 'up' : 'down',
      responseTime: stripeHealth.responseTime,
      error: stripeHealth.error,
    };
    if (stripeHealth.status !== 'healthy') {
      health.status = health.status === 'healthy' ? 'degraded' : health.status;
    }
  } catch (error: any) {
    logger.warn('Health check stripe error', error);
    health.services.stripe = {
      status: 'down',
      error: error.message,
    };
    health.status = health.status === 'healthy' ? 'degraded' : health.status;
  }

  const totalResponseTime = Date.now() - startTime;

  // Déterminer le statut global
  const allServicesUp = Object.values(health.services).every(
    service => service.status === 'up'
  );

  if (!allServicesUp) {
    const criticalServicesDown = health.services.database.status === 'down';
    health.status = criticalServicesDown ? 'unhealthy' : 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 :
                    health.status === 'degraded' ? 200 : 503;

  return res.status(statusCode).json({
    ...health,
    responseTime: totalResponseTime,
  });
});

/**
 * GET /health/readiness - Readiness check (pour Kubernetes/Docker)
 */
router.get('/readiness', async (_req, res) => {
  try {
    // Vérifier que la base de données est accessible
    const { error } = await supabase.from('products').select('id').limit(1);

    if (error) {
      return res.status(503).json({
        status: 'not ready',
        reason: 'database_unavailable',
        error: error.message,
      });
    }

    return res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'not ready',
      reason: 'database_error',
      error: error.message,
    });
  }
});

/**
 * GET /health/liveness - Liveness check (pour Kubernetes/Docker)
 */
router.get('/liveness', (_req, res) => {
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

export default router;
