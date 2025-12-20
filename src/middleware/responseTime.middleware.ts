/**
 * Middleware pour mesurer et logger le temps de réponse
 * Ajoute le header X-Response-Time et enregistre les métriques de performance
 */
import { NextFunction, Request, Response } from 'express';
import { performanceMonitor } from '../services/performanceMonitoring.js';
import { prometheusMetrics } from '../services/prometheusMetrics.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware pour mesurer le temps de réponse
 */
export function responseTimeMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  let error: Error | undefined;

  // Capturer les erreurs
  const originalSend = res.send.bind(res);
  res.send = function (body) {
    if (res.statusCode >= 400) {
      error = new Error(`HTTP ${res.statusCode}`);
    }
    return originalSend(body);
  };

  // Intercepter la méthode end() pour définir le header avant l'envoi
  const originalEnd = res.end.bind(res);
  // Type-safe wrapper pour res.end
  res.end = function(
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    cb?: () => void
  ) {
    const duration = Date.now() - startTime;
    // Définir le header avant d'appeler end()
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${duration}ms`);
    }
    // Appeler la méthode end() originale avec les bons types
    if (typeof encoding === 'function') {
      return originalEnd(chunk as Parameters<typeof originalEnd>[0], encoding);
    }
    if (cb) {
      return originalEnd(chunk as Parameters<typeof originalEnd>[0], encoding as BufferEncoding, cb);
    }
    if (encoding) {
      return originalEnd(chunk as Parameters<typeof originalEnd>[0], encoding as BufferEncoding);
    }
    return originalEnd(chunk as Parameters<typeof originalEnd>[0]);
  } as typeof res.end;

  // Logger le temps de réponse après l'envoi et enregistrer les métriques
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Normaliser le path pour les métriques (remplacer les IDs par :id)
    const normalizedPath = req.path.replace(/\/[a-f0-9-]{36}/g, '/:id').replace(/\/\d+/g, '/:id');

    // Enregistrer dans le performance monitor
    performanceMonitor.recordRequest(
      req.method,
      req.path,
      duration,
      res.statusCode,
      error
    );

    // Enregistrer dans Prometheus
    prometheusMetrics.recordHttpRequest(req.method, normalizedPath, res.statusCode, duration);

    // Logger si réponse lente (> 1s) ou en dev
    if (duration > 1000 || process.env.NODE_ENV === 'development') {
      logger.debug('Response time', {
        duration: `${duration}ms`,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      });
    }
  });

  next();
}
