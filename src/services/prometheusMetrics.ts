/**
 * Service de métriques Prometheus
 * Expose des métriques au format Prometheus pour monitoring
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Créer un registre Prometheus
export const register = new Registry();

// Collecter les métriques système par défaut (CPU, mémoire, etc.)
collectDefaultMetrics({ register });

// Métriques HTTP
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export const httpRequestErrors = new Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Métriques métier
export const ordersTotal = new Counter({
  name: 'orders_total',
  help: 'Total number of orders',
  labelNames: ['status'],
  registers: [register],
});

export const ordersRevenue = new Counter({
  name: 'orders_revenue_total',
  help: 'Total revenue from orders',
  labelNames: ['status'],
  registers: [register],
});

export const productsActive = new Gauge({
  name: 'products_active',
  help: 'Number of active products',
  registers: [register],
});

export const productsOutOfStock = new Gauge({
  name: 'products_out_of_stock',
  help: 'Number of products out of stock',
  registers: [register],
});

export const usersTotal = new Gauge({
  name: 'users_total',
  help: 'Total number of users',
  registers: [register],
});

export const usersActive = new Gauge({
  name: 'users_active',
  help: 'Number of active users (last 7 days)',
  registers: [register],
});

// Métriques de cache
export const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Total number of cache hits',
  labelNames: ['cache_type'],
  registers: [register],
});

export const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Total number of cache misses',
  labelNames: ['cache_type'],
  registers: [register],
});

// Métriques de base de données
export const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const databaseQueryErrors = new Counter({
  name: 'database_query_errors_total',
  help: 'Total number of database query errors',
  labelNames: ['operation', 'table'],
  registers: [register],
});

// Métriques d'authentification
export const authAttempts = new Counter({
  name: 'auth_attempts_total',
  help: 'Total number of authentication attempts',
  labelNames: ['result'], // 'success' or 'failure'
  registers: [register],
});

export const authFailures = new Counter({
  name: 'auth_failures_total',
  help: 'Total number of authentication failures',
  registers: [register],
});

// Métriques de rate limiting
export const rateLimitHits = new Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'ip'],
  registers: [register],
});

// Fonctions utilitaires pour enregistrer des métriques
export const prometheusMetrics = {
  /**
   * Enregistre une requête HTTP
   */
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    const labels = {
      method,
      route,
      status_code: statusCode.toString(),
    };

    httpRequestDuration.observe(labels, duration / 1000); // Convertir ms en secondes
    httpRequestTotal.inc(labels);

    if (statusCode >= 400) {
      httpRequestErrors.inc(labels);
    }
  },

  /**
   * Enregistre une commande
   */
  recordOrder(status: string, revenue: number) {
    ordersTotal.inc({ status });
    ordersRevenue.inc({ status }, revenue);
  },

  /**
   * Mise à jour des métriques produits
   */
  updateProductsMetrics(active: number, outOfStock: number) {
    productsActive.set(active);
    productsOutOfStock.set(outOfStock);
  },

  /**
   * Mise à jour des métriques utilisateurs
   */
  updateUsersMetrics(total: number, active: number) {
    usersTotal.set(total);
    usersActive.set(active);
  },

  /**
   * Enregistre un hit/miss de cache
   */
  recordCacheAccess(cacheType: string, hit: boolean) {
    if (hit) {
      cacheHits.inc({ cache_type: cacheType });
    } else {
      cacheMisses.inc({ cache_type: cacheType });
    }
  },

  /**
   * Enregistre une requête de base de données
   */
  recordDatabaseQuery(operation: string, table: string, duration: number, error?: boolean) {
    const labels = { operation, table };
    databaseQueryDuration.observe(labels, duration / 1000);

    if (error) {
      databaseQueryErrors.inc(labels);
    }
  },

  /**
   * Enregistre une tentative d'authentification
   */
  recordAuthAttempt(success: boolean) {
    authAttempts.inc({ result: success ? 'success' : 'failure' });
    if (!success) {
      authFailures.inc();
    }
  },

  /**
   * Enregistre un rate limit hit
   */
  recordRateLimit(endpoint: string, ip: string) {
    rateLimitHits.inc({ endpoint, ip });
  },
};

