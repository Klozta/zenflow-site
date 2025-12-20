/**
 * Security Logger
 * Logging des événements de sécurité pour détection d'intrusions
 */
import { logger } from './logger.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/**
 * Logger sécurité avec format standardisé
 */
interface SecurityLogDetails {
  ip?: string;
  userAgent?: string;
  [key: string]: unknown;
}

function logSecurity(level: LogLevel, type: string, message: string, details?: SecurityLogDetails): void {
  const logContext = {
    type,
    message,
    ...details,
  };

  switch (level) {
    case 'INFO':
      logger.info(`[SECURITY] ${type}: ${message}`, logContext);
      break;
    case 'WARN':
      logger.warn(`[SECURITY] ${type}: ${message}`, logContext);
      break;
    case 'ERROR':
      logger.error(`[SECURITY] ${type}: ${message}`, undefined, logContext);
      // En production, envoyer à Sentry (si configuré)
      // Note: Import dynamique asynchrone, ne bloque pas le flux
      if (process.env.NODE_ENV === 'production' && process.env.SENTRY_DSN) {
        // @ts-ignore - Module optionnel, peut ne pas être installé
        import('@sentry/node')
          .then((Sentry) => {
            Sentry.captureMessage(`[SECURITY] ${type}: ${message}`, 'warning');
          })
          .catch(() => {
            // Sentry non disponible, ignorer silencieusement
          });
      }
      break;
  }
}

/**
 * Logger pour tentatives d'authentification
 */
export const securityLogger = {
  /**
   * Tentative d'authentification (succès ou échec)
   */
  authAttempt: (email: string, success: boolean, ip?: string, userAgent?: string): void => {
    const level = success ? 'INFO' : 'WARN';
    const maskedEmail = email ? `${email.substring(0, 3)}***` : 'unknown';
    const message = success
      ? `Authentication successful for ${maskedEmail}`
      : `Authentication failed for ${maskedEmail}`;

    // Conformité: ne pas logger l'email complet (PII)
    logSecurity(level, 'AUTH_ATTEMPT', message, { ip, userAgent, email: maskedEmail, success });

    // Si échec répété, logger comme suspect
    if (!success) {
      // Compteur d'échecs par IP/email (via cache)
      // Import asynchrone pour ne pas bloquer le flux
      import('./cache.js')
        .then(async ({ getCache, setCache }) => {
          const cacheKey = `auth:failures:${ip}:${email || 'unknown'}`;
          const failures = (await getCache<number>(cacheKey)) || 0;
          const newFailures = failures + 1;

          await setCache(cacheKey, newFailures, 900); // 15 minutes TTL

          // Alerter si trop d'échecs (5+ en 15min)
          if (newFailures >= 5) {
            securityLogger.securityEvent('multiple_auth_failures', {
              ip,
              email: email ? email.substring(0, 3) + '***' : 'unknown',
              failures: newFailures,
            });
          }
        })
        .catch(() => {
          // Cache non disponible, ignorer silencieusement
          // Ne pas bloquer le flux si le cache est down
        });
    }
  },

  /**
   * Activité suspecte détectée
   */
  suspiciousActivity: (
    type: string,
    message: string,
    details?: SecurityLogDetails
  ): void => {
    logSecurity('ERROR', 'SUSPICIOUS_ACTIVITY', `${type}: ${message}`, details);
  },

  /**
   * Rate limit dépassé
   */
  rateLimitExceeded: (ip: string, endpoint: string, userAgent?: string): void => {
    logSecurity('WARN', 'RATE_LIMIT', `Rate limit exceeded for ${endpoint}`, {
      ip,
      userAgent,
      endpoint,
    });
  },

  /**
   * Tentative d'accès non autorisé
   */
  unauthorizedAccess: (endpoint: string, ip?: string, userAgent?: string): void => {
    logSecurity('WARN', 'UNAUTHORIZED', `Unauthorized access attempt to ${endpoint}`, {
      ip,
      userAgent,
      endpoint,
    });
  },

  /**
   * Erreur critique de sécurité
   */
  criticalError: (message: string, details?: Record<string, unknown>): void => {
    logSecurity('ERROR', 'CRITICAL', message, details);
  },

  /**
   * Validation échouée
   */
  validationFailed: (endpoint: string, errors: unknown, ip?: string): void => {
    logSecurity('WARN', 'VALIDATION_FAILED', `Validation failed for ${endpoint}`, {
      ip,
      endpoint,
      errors,
    });
  },

  /**
   * Événement de sécurité générique
   */
  securityEvent: (eventType: string, details?: SecurityLogDetails): void => {
    logSecurity('WARN', 'SECURITY_EVENT', eventType, details);
  },
};
