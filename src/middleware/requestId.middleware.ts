/**
 * Middleware pour générer et gérer les Request IDs
 * Permet le tracing des requêtes à travers l'application
 */
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { structuredLogger } from '../utils/structuredLogger.js';

/**
 * Génère un trace ID W3C compatible (format: 00-{32 hex chars}-{16 hex chars}-01)
 * Format: version-traceId-parentSpanId-flags
 */
function generateTraceId(): string {
  const traceId = uuidv4().replace(/-/g, '').substring(0, 32);
  const spanId = uuidv4().replace(/-/g, '').substring(0, 16);
  return `00-${traceId}-${spanId}-01`;
}

// Extension de Request pour inclure requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
    }
  }
}

/**
 * Middleware pour générer un Request ID unique pour chaque requête
 * Ajoute également le requestId au logger structuré
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  // Générer ou récupérer le request ID depuis le header
  const requestId = req.headers['x-request-id'] as string || uuidv4();

  // Générer ou récupérer le trace ID (W3C Trace Context) depuis le header
  const traceParent = req.headers['traceparent'] as string;
  const traceId = traceParent
    ? traceParent.split('-')[1] // Extraire traceId du format W3C
    : generateTraceId();

  // Générer un span ID unique pour cette requête
  const spanId = uuidv4().replace(/-/g, '').substring(0, 16);

  req.requestId = requestId;
  req.startTime = Date.now();

  // Ajouter les IDs au header de réponse (pour tracing)
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Trace-ID', traceId);

  // Générer le traceparent pour propagation (format W3C)
  const traceparentHeader = `00-${traceId}-${spanId}-01`;
  res.setHeader('Traceparent', traceparentHeader);

  // Configurer le contexte du logger structuré avec corrélation
  const context: any = {
    requestId,
    traceId,
    spanId,
    ip: req.ip,
    path: req.path,
    method: req.method,
    service: 'zenflow-backend',
  };

  // Ajouter userId si disponible (après auth middleware)
  if ((req as any).user?.id) {
    context.userId = (req as any).user.id;
  }

  structuredLogger.setContext(context);

  next();
}

/**
 * Middleware pour logger la requête après traitement
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = req.startTime || Date.now();

  // Logger la fin de la requête
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    structuredLogger.request(
      req.method,
      req.path,
      res.statusCode,
      duration,
      (req as any).user?.id
    );

    // Nettoyer le contexte après la requête
    if (res.statusCode >= 400) {
      structuredLogger.warn('Request completed with error', {
        statusCode: res.statusCode,
        duration,
      });
    }
  });

  next();
}
