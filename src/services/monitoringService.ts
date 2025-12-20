/**
 * Service de monitoring avancé
 * Surveille la santé des services, les métriques de performance et génère des alertes
 */
import { supabase } from '../config/supabase.js';
import { performanceMonitor } from './performanceMonitoring.js';

export interface ServiceHealthCheck {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  lastCheck: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface MonitoringMetrics {
  timestamp: string;
  uptime: number;
  services: Record<string, ServiceHealthCheck>;
  performance: {
    averageResponseTime: number;
    errorRate: number;
    requestsPerMinute: number;
    slowestEndpoints: Array<{ path: string; avgTime: number; count: number }>;
    errorEndpoints: Array<{ path: string; errorCount: number; lastError?: string }>;
  };
  system: {
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      external: number;
    };
    cpu?: {
      usage: number;
    };
  };
}

export interface AlertThreshold {
  metric: string;
  operator: 'gt' | 'lt' | 'eq';
  value: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

/**
 * Vérifie la santé de la base de données Supabase
 */
export async function checkDatabaseHealth(): Promise<ServiceHealthCheck> {
  const startTime = Date.now();
  try {
    // Test simple de connexion
    const { error, data } = await supabase
      .from('products')
      .select('id')
      .limit(1);

    const responseTime = Date.now() - startTime;

    if (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        error: error.message,
        details: { code: error.code, hint: error.hint },
      };
    }

    // Vérifier la latence
    const isSlow = responseTime > 1000; // > 1s = dégradé
    const isVerySlow = responseTime > 3000; // > 3s = unhealthy

    return {
      name: 'database',
      status: isVerySlow ? 'unhealthy' : isSlow ? 'degraded' : 'healthy',
      responseTime,
      lastCheck: new Date().toISOString(),
      details: { recordCount: data?.length || 0 },
    };
  } catch (error: any) {
    return {
      name: 'database',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      lastCheck: new Date().toISOString(),
      error: error.message || 'Unknown database error',
    };
  }
}

/**
 * Vérifie la santé de Redis/Cache
 */
export async function checkCacheHealth(): Promise<ServiceHealthCheck> {
  const startTime = Date.now();
  try {
    const { getCache, setCache } = await import('../utils/cache.js');

    // Test write/read
    const testKey = `health-check-${Date.now()}`;
    const testValue = { test: true, timestamp: Date.now() };

    await setCache(testKey, testValue, 10); // TTL 10s
    const retrieved = await getCache<typeof testValue>(testKey);

    const responseTime = Date.now() - startTime;

    if (!retrieved || retrieved.test !== true) {
      return {
        name: 'cache',
        status: 'degraded',
        responseTime,
        lastCheck: new Date().toISOString(),
        error: 'Cache read/write test failed',
      };
    }

    return {
      name: 'cache',
      status: responseTime > 500 ? 'degraded' : 'healthy',
      responseTime,
      lastCheck: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      name: 'cache',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      lastCheck: new Date().toISOString(),
      error: error.message || 'Cache unavailable',
    };
  }
}

/**
 * Vérifie la santé du service Email (Resend)
 */
export async function checkEmailHealth(): Promise<ServiceHealthCheck> {
  const startTime = Date.now();
  try {
    const emailProvider = process.env.EMAIL_PROVIDER || 'resend';
    const hasConfig =
      (emailProvider === 'resend' && !!process.env.RESEND_API_KEY) ||
      (emailProvider === 'sendgrid' && !!process.env.SENDGRID_API_KEY) ||
      (emailProvider === 'mailgun' && !!process.env.MAILGUN_API_KEY && !!process.env.MAILGUN_DOMAIN);

    if (!hasConfig) {
      return {
        name: 'email',
        status: 'degraded',
        lastCheck: new Date().toISOString(),
        error: 'Email provider not configured',
        details: { provider: emailProvider },
      };
    }

    // Pour Resend, on vérifie juste la configuration (pas de test API sans envoyer d'email)
    if (emailProvider === 'resend' && process.env.RESEND_API_KEY) {
      const responseTime = Date.now() - startTime;
      return {
        name: 'email',
        status: 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: { provider: 'resend', configured: true },
      };
    }

    return {
      name: 'email',
      status: 'healthy',
      responseTime: Date.now() - startTime,
      lastCheck: new Date().toISOString(),
      details: { provider: emailProvider, configured: true },
    };
  } catch (error: any) {
    return {
      name: 'email',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      lastCheck: new Date().toISOString(),
      error: error.message || 'Email service unavailable',
    };
  }
}

/**
 * Vérifie la santé de Stripe
 */
export async function checkStripeHealth(): Promise<ServiceHealthCheck> {
  const startTime = Date.now();
  try {
    const hasStripeConfig = !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

    if (!hasStripeConfig) {
      return {
        name: 'stripe',
        status: 'degraded',
        lastCheck: new Date().toISOString(),
        error: 'Stripe not configured',
      };
    }

    // Test de connexion Stripe (sans créer de charge)
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2025-12-15.clover',
      });

      // Test simple: récupérer les détails du compte (opération légère)
      await stripe.accounts.retrieve();

      const responseTime = Date.now() - startTime;

      return {
        name: 'stripe',
        status: responseTime > 2000 ? 'degraded' : 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: { configured: true },
      };
    } catch (error: any) {
      return {
        name: 'stripe',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        error: error.message || 'Stripe API error',
        details: { type: error.type, code: error.code },
      };
    }
  } catch (error: any) {
    return {
      name: 'stripe',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      lastCheck: new Date().toISOString(),
      error: error.message || 'Stripe unavailable',
    };
  }
}

/**
 * Récupère toutes les métriques de monitoring
 */
export async function getMonitoringMetrics(): Promise<MonitoringMetrics> {
  const [databaseHealth, cacheHealth, emailHealth, stripeHealth] = await Promise.allSettled([
    checkDatabaseHealth(),
    checkCacheHealth(),
    checkEmailHealth(),
    checkStripeHealth(),
  ]);

  const services: Record<string, ServiceHealthCheck> = {
    database: databaseHealth.status === 'fulfilled' ? databaseHealth.value : {
      name: 'database',
      status: 'unhealthy',
      lastCheck: new Date().toISOString(),
      error: databaseHealth.reason?.message || 'Database check failed',
    },
    cache: cacheHealth.status === 'fulfilled' ? cacheHealth.value : {
      name: 'cache',
      status: 'degraded',
      lastCheck: new Date().toISOString(),
      error: cacheHealth.reason?.message || 'Cache check failed',
    },
    email: emailHealth.status === 'fulfilled' ? emailHealth.value : {
      name: 'email',
      status: 'degraded',
      lastCheck: new Date().toISOString(),
      error: emailHealth.reason?.message || 'Email check failed',
    },
    stripe: stripeHealth.status === 'fulfilled' ? stripeHealth.value : {
      name: 'stripe',
      status: 'degraded',
      lastCheck: new Date().toISOString(),
      error: stripeHealth.reason?.message || 'Stripe check failed',
    },
  };

  // Métriques de performance
  const perfMetrics = performanceMonitor.getAllMetrics();
  const slowestEndpoints = performanceMonitor.getSlowestEndpoints(5);
  const errorEndpoints = performanceMonitor.getEndpointsWithErrors(5);

  // Calculer le taux d'erreur
  const totalRequests = perfMetrics.requests.total || 1;
  const totalErrors = perfMetrics.requests.errors || 0;
  const errorRate = (totalErrors / totalRequests) * 100;

  // Calculer les requêtes par minute (approximatif)
  const uptimeMinutes = process.uptime() / 60;
  const requestsPerMinute = uptimeMinutes > 0 ? totalRequests / uptimeMinutes : 0;

  // Calculer le temps de réponse moyen
  const allEndpoints = perfMetrics.endpoints;
  const totalDuration = allEndpoints.reduce((sum, ep) => sum + ep.totalDuration, 0);
  const totalCount = allEndpoints.reduce((sum, ep) => sum + ep.count, 0);
  const averageResponseTime = totalCount > 0 ? totalDuration / totalCount : 0;

  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services,
    performance: {
      averageResponseTime,
      errorRate,
      requestsPerMinute,
      slowestEndpoints: slowestEndpoints.map((ep) => ({
        path: ep.path,
        avgTime: ep.avgDuration,
        count: ep.count,
      })),
      errorEndpoints: errorEndpoints.map((ep) => ({
        path: ep.path,
        errorCount: ep.errorCount,
        lastError: ep.lastRequestAt,
      })),
    },
    system: {
      memory: process.memoryUsage(),
    },
  };
}

/**
 * Évalue les seuils d'alerte et retourne les alertes actives
 */
export function evaluateAlerts(metrics: MonitoringMetrics): Array<{
  severity: 'info' | 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: string;
}> {
  const alerts: Array<{
    severity: 'info' | 'warning' | 'critical';
    metric: string;
    value: number;
    threshold: number;
    message: string;
    timestamp: string;
  }> = [];

  const timestamp = new Date().toISOString();

  // Seuils d'alerte configurables
  const thresholds: AlertThreshold[] = [
    {
      metric: 'errorRate',
      operator: 'gt',
      value: 5,
      severity: 'critical',
      message: 'Taux d\'erreur élevé (>5%)',
    },
    {
      metric: 'errorRate',
      operator: 'gt',
      value: 2,
      severity: 'warning',
      message: 'Taux d\'erreur modéré (>2%)',
    },
    {
      metric: 'averageResponseTime',
      operator: 'gt',
      value: 2000,
      severity: 'critical',
      message: 'Latence élevée (>2s)',
    },
    {
      metric: 'averageResponseTime',
      operator: 'gt',
      value: 1000,
      severity: 'warning',
      message: 'Latence modérée (>1s)',
    },
    {
      metric: 'memory.heapUsed',
      operator: 'gt',
      value: 500 * 1024 * 1024, // 500MB
      severity: 'warning',
      message: 'Utilisation mémoire élevée',
    },
  ];

  // Vérifier les seuils
  for (const threshold of thresholds) {
    let value: number | undefined;

    if (threshold.metric === 'errorRate') {
      value = metrics.performance.errorRate;
    } else if (threshold.metric === 'averageResponseTime') {
      value = metrics.performance.averageResponseTime;
    } else if (threshold.metric === 'memory.heapUsed') {
      value = metrics.system.memory.heapUsed;
    }

    if (value !== undefined) {
      const shouldAlert =
        (threshold.operator === 'gt' && value > threshold.value) ||
        (threshold.operator === 'lt' && value < threshold.value) ||
        (threshold.operator === 'eq' && value === threshold.value);

      if (shouldAlert) {
        alerts.push({
          severity: threshold.severity,
          metric: threshold.metric,
          value,
          threshold: threshold.value,
          message: threshold.message,
          timestamp,
        });
      }
    }
  }

  // Vérifier les services
  for (const [name, service] of Object.entries(metrics.services)) {
    if (service.status === 'unhealthy') {
      alerts.push({
        severity: 'critical',
        metric: `service.${name}`,
        value: 0,
        threshold: 1,
        message: `Service ${name} est down`,
        timestamp,
      });
    } else if (service.status === 'degraded') {
      alerts.push({
        severity: 'warning',
        metric: `service.${name}`,
        value: 0.5,
        threshold: 1,
        message: `Service ${name} est dégradé`,
        timestamp,
      });
    }
  }

  return alerts;
}

