/**
 * Logger structuré avec niveaux et contexte
 * Améliore le logging avec des métadonnées structurées
 */
import { logger } from './logger.js';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogContext {
  userId?: string;
  requestId?: string;
  traceId?: string; // Trace ID pour corrélation distribuée (span parent)
  spanId?: string; // Span ID pour tracing distribué
  ip?: string;
  path?: string;
  method?: string;
  service?: string; // Nom du service (pour microservices)
  [key: string]: any;
}

class StructuredLogger {
  private context: LogContext = {};

  /**
   * Définir le contexte pour tous les logs suivants
   */
  setContext(context: LogContext) {
    this.context = { ...this.context, ...context };
  }

  /**
   * Réinitialiser le contexte
   */
  clearContext() {
    this.context = {};
  }

  /**
   * Log avec niveau et contexte
   */
  private log(level: LogLevel, message: string, data?: any, error?: Error) {
    // Construire l'entrée de log structurée avec corrélation
    const logEntry: any = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(this.context.requestId && { requestId: this.context.requestId }),
      ...(this.context.traceId && { traceId: this.context.traceId }),
      ...(this.context.spanId && { spanId: this.context.spanId }),
      ...(this.context.userId && { userId: this.context.userId }),
      ...(this.context.service && { service: this.context.service }),
      ...(this.context.ip && { ip: this.context.ip }),
      ...(this.context.method && this.context.path && {
        http: {
          method: this.context.method,
          path: this.context.path,
        },
      }),
      ...(data && { data }),
      ...(error && {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      }),
    };

    // En production, utiliser JSON structuré pour faciliter l'ingestion par les systèmes de log
    const useJsonLogs = process.env.NODE_ENV === 'production' || process.env.JSON_LOGS === 'true';

    switch (level) {
      case LogLevel.DEBUG:
        if (process.env.NODE_ENV === 'development') {
          if (useJsonLogs) {
            console.debug(JSON.stringify(logEntry));
          } else {
            console.debug(JSON.stringify(logEntry, null, 2));
          }
        }
        break;
      case LogLevel.INFO:
        if (useJsonLogs) {
          console.log(JSON.stringify(logEntry));
        } else {
          logger.info(message, { ...this.context, ...data });
        }
        break;
      case LogLevel.WARN:
        if (useJsonLogs) {
          console.warn(JSON.stringify(logEntry));
        } else {
          logger.warn(message, { ...this.context, ...data });
        }
        break;
      case LogLevel.ERROR:
        if (useJsonLogs) {
          console.error(JSON.stringify(logEntry));
        } else {
          logger.error(message, error || data, { ...this.context });
        }
        break;
    }
  }

  debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error, data?: any) {
    this.log(LogLevel.ERROR, message, data, error);
  }

  /**
   * Log une requête HTTP
   */
  request(method: string, path: string, statusCode: number, duration: number, userId?: string) {
    this.log(LogLevel.INFO, 'HTTP Request', {
      method,
      path,
      statusCode,
      duration,
      userId,
    });
  }

  /**
   * Log une action utilisateur
   */
  userAction(action: string, userId: string, details?: any) {
    this.log(LogLevel.INFO, `User Action: ${action}`, {
      userId,
      ...details,
    });
  }

  /**
   * Log une erreur de sécurité
   */
  security(event: string, details: any) {
    this.log(LogLevel.WARN, `Security Event: ${event}`, details);
  }
}

export const structuredLogger = new StructuredLogger();
