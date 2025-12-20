/**
 * Service de monitoring de performance en temps réel
 * Collecte et expose des métriques de performance pour l'optimisation
 */

import { captureMessage } from '../config/sentry.js';
import { logger } from '../utils/logger.js';

interface EndpointMetrics {
  path: string;
  method: string;
  count: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  avgDuration: number;
  errorCount: number;
  lastRequestAt: string;
}

interface DatabaseMetrics {
  queryCount: number;
  totalDuration: number;
  avgDuration: number;
  slowQueries: number; // > 1000ms
  errorCount: number;
}

interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  uptime: number;
  eventLoopDelay: number;
}

class PerformanceMonitor {
  private endpointMetrics: Map<string, EndpointMetrics> = new Map();
  private databaseMetrics: DatabaseMetrics = {
    queryCount: 0,
    totalDuration: 0,
    avgDuration: 0,
    slowQueries: 0,
    errorCount: 0,
  };
  private requestCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  /**
   * Enregistrer une requête HTTP
   */
  recordRequest(
    method: string,
    path: string,
    duration: number,
    statusCode: number,
    error?: Error
  ): void {
    this.requestCount++;
    if (statusCode >= 400 || error) {
      this.errorCount++;
    }

    const key = `${method}:${path}`;
    const existing = this.endpointMetrics.get(key) || {
      path,
      method,
      count: 0,
      totalDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      avgDuration: 0,
      errorCount: 0,
      lastRequestAt: new Date().toISOString(),
    };

    existing.count++;
    existing.totalDuration += duration;
    existing.minDuration = Math.min(existing.minDuration, duration);
    existing.maxDuration = Math.max(existing.maxDuration, duration);
    existing.avgDuration = existing.totalDuration / existing.count;
    existing.lastRequestAt = new Date().toISOString();

    if (statusCode >= 400 || error) {
      existing.errorCount++;
    }

    this.endpointMetrics.set(key, existing);

    // Alerter si endpoint lent (> 2s)
    if (duration > 2000) {
      logger.warn(`Slow endpoint detected: ${method} ${path} took ${duration}ms`);
      if (process.env.SENTRY_DSN) {
        captureMessage(`Slow endpoint: ${method} ${path} (${duration}ms)`, 'warning', {
          method,
          path,
          duration,
          statusCode,
        });
      }
    }

    // Alerter si taux d'erreur élevé (> 10%)
    if (existing.count > 10 && existing.errorCount / existing.count > 0.1) {
      logger.warn(`High error rate on ${method} ${path}: ${((existing.errorCount / existing.count) * 100).toFixed(1)}%`);
    }
  }

  /**
   * Enregistrer une requête DB
   */
  recordDatabaseQuery(duration: number, error?: Error): void {
    this.databaseMetrics.queryCount++;
    this.databaseMetrics.totalDuration += duration;
    this.databaseMetrics.avgDuration = this.databaseMetrics.totalDuration / this.databaseMetrics.queryCount;

    if (duration > 1000) {
      this.databaseMetrics.slowQueries++;
      logger.warn(`Slow database query detected: ${duration}ms`);
    }

    if (error) {
      this.databaseMetrics.errorCount++;
    }
  }

  /**
   * Obtenir les métriques des endpoints
   */
  getEndpointMetrics(): EndpointMetrics[] {
    return Array.from(this.endpointMetrics.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50); // Top 50 endpoints
  }

  /**
   * Obtenir les métriques DB
   */
  getDatabaseMetrics(): DatabaseMetrics {
    return { ...this.databaseMetrics };
  }

  /**
   * Obtenir les métriques système
   */
  getSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Calculer le CPU usage approximatif (basé sur user + system time)
    const totalCpuTime = cpuUsage.user + cpuUsage.system;
    const cpuPercent = (totalCpuTime / 1000000 / process.uptime()) * 100; // Approximation

    // Event loop delay (approximation)
    const eventLoopDelay = process.hrtime.bigint();
    const delayMs = Number(eventLoopDelay) / 1000000; // Convertir en ms

    return {
      cpuUsage: Math.min(100, cpuPercent), // Cap à 100%
      memoryUsage: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
      },
      uptime: process.uptime(),
      eventLoopDelay: delayMs,
    };
  }

  /**
   * Obtenir toutes les métriques
   */
  getAllMetrics() {
    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
        successRate: this.requestCount > 0 ? ((this.requestCount - this.errorCount) / this.requestCount) * 100 : 100,
      },
      endpoints: this.getEndpointMetrics(),
      database: this.getDatabaseMetrics(),
      system: this.getSystemMetrics(),
    };
  }

  /**
   * Réinitialiser les métriques (pour tests ou reset périodique)
   */
  reset(): void {
    this.endpointMetrics.clear();
    this.databaseMetrics = {
      queryCount: 0,
      totalDuration: 0,
      avgDuration: 0,
      slowQueries: 0,
      errorCount: 0,
    };
    this.requestCount = 0;
    this.errorCount = 0;
    this.startTime = Date.now();
  }

  /**
   * Obtenir les endpoints les plus lents
   */
  getSlowestEndpoints(limit: number = 10): EndpointMetrics[] {
    return Array.from(this.endpointMetrics.values())
      .filter((m) => m.count >= 5) // Au moins 5 requêtes pour être significatif
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  /**
   * Obtenir les endpoints avec le plus d'erreurs
   */
  getEndpointsWithErrors(limit: number = 10): EndpointMetrics[] {
    return Array.from(this.endpointMetrics.values())
      .filter((m) => m.errorCount > 0)
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, limit);
  }
}

// Instance singleton
export const performanceMonitor = new PerformanceMonitor();


