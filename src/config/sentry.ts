/**
 * Configuration Sentry pour monitoring et alertes
 * Filtre les données sensibles avant envoi
 *
 * Note: @sentry/node est optionnel - le code fonctionne même si non installé
 */

let Sentry: any = null;
let sentryInitialized = false;

/**
 * Initialiser Sentry si DSN configuré
 */
export async function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    // Sentry optionnel, pas d'erreur si non configuré
    return;
  }

  try {
    // Import direct maintenant que @sentry/node est installé
    const SentryModule = await import('@sentry/node');
    Sentry = SentryModule.default || SentryModule;

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

      /**
       * Filtrer les données sensibles avant envoi
       */
      beforeSend(event: any, _hint?: any) {
      // Filtrer les secrets dans les messages d'erreur
      if (event.exception?.values?.[0]?.value) {
        event.exception.values[0].value = event.exception.values[0].value
          .replace(/password[=:]\s*[^\s]{0,100}/gi, 'password=[REDACTED]')
          .replace(/token[=:]\s*[^\s]{0,100}/gi, 'token=[REDACTED]')
          .replace(/secret[=:]\s*[^\s]{0,100}/gi, 'secret=[REDACTED]')
          .replace(/email[=:]\s*[^\s@]{0,50}@[^\s]{0,50}/gi, 'email=[REDACTED]')
          .replace(/JWT_SECRET[=:]\s*[^\s]{0,100}/gi, 'JWT_SECRET=[REDACTED]')
          .replace(/UPSTASH_REDIS_TOKEN[=:]\s*[^\s]{0,100}/gi, 'UPSTASH_REDIS_TOKEN=[REDACTED]')
          .replace(/SUPABASE_KEY[=:]\s*[^\s]{0,100}/gi, 'SUPABASE_KEY=[REDACTED]');
      }

      // Filtrer les données sensibles dans request.data
      if (event.request?.data) {
        if (typeof event.request.data === 'object') {
          const sensitiveFields = ['password', 'password_hash', 'token', 'refreshToken', 'secret', 'apiKey', 'accessToken'];
          sensitiveFields.forEach(field => {
            if (event.request.data && typeof event.request.data === 'object') {
              delete (event.request.data as any)[field];
            }
          });
        }
      }

      // Filtrer les query params sensibles
      if (event.request?.query_string) {
        event.request.query_string = event.request.query_string
          .replace(/token=[^&]*/gi, 'token=[REDACTED]')
          .replace(/secret=[^&]*/gi, 'secret=[REDACTED]')
          .replace(/password=[^&]*/gi, 'password=[REDACTED]');
      }

      // Filtrer les headers sensibles
      if (event.request?.headers) {
        const sensitiveHeaders = ['authorization', 'x-api-key', 'x-cron-key'];
        sensitiveHeaders.forEach(header => {
          if (event.request.headers && typeof event.request.headers === 'object') {
            delete (event.request.headers as any)[header];
            delete (event.request.headers as any)[header.toLowerCase()];
          }
        });
      }

        return event;
      },

      /**
       * Intégrations
       */
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app: undefined as any }),
      ],

      /**
       * Tags par défaut
       */
      initialScope: {
        tags: {
          app: 'zenflow-backend',
          version: process.env.npm_package_version || '1.0.0',
        },
      },
    });

    sentryInitialized = true;
    console.log('✅ Sentry initialisé pour monitoring');
  } catch {
    // @sentry/node non installé - monitoring désactivé silencieusement
    // Pas d'erreur, Sentry est optionnel
  }
}

/**
 * Helper pour capturer des erreurs avec contexte
 */
export function captureError(error: Error, context?: Record<string, any>) {
  if (!sentryInitialized || !Sentry) return;

  try {
    Sentry.captureException(error, {
      extra: context,
    });
  } catch {
    // Ignorer silencieusement si Sentry non disponible
  }
}

/**
 * Helper pour capturer des messages avec niveau
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' | 'fatal' | 'debug' = 'info', context?: Record<string, any>) {
  if (!sentryInitialized || !Sentry) return;

  try {
    Sentry.captureMessage(message, level, {
      extra: context,
    });
  } catch {
    // Ignorer silencieusement si Sentry non disponible
  }
}

/**
 * Helper pour ajouter du contexte utilisateur
 */
export function setUserContext(userId: string, email?: string) {
  if (!sentryInitialized || !Sentry) return;

  try {
    Sentry.setUser({
      id: userId,
      email: email ? email.substring(0, 3) + '***' : undefined, // Masquer email
    });
  } catch {
    // Ignorer silencieusement si Sentry non disponible
  }
}

/**
 * Helper pour nettoyer le contexte utilisateur
 */
export function clearUserContext() {
  if (!sentryInitialized || !Sentry) return;

  try {
    Sentry.setUser(null);
  } catch {
    // Ignorer silencieusement si Sentry non disponible
  }
}
