/**
 * Error Handlers standardisés
 * Gestion d'erreurs centralisée et réutilisable
 *
 * @module utils/errorHandlers
 * @description Fonctions pour gérer les erreurs de manière cohérente dans tout le codebase
 */

import { AppError, createError } from './errors.js';
import { logger } from './logger.js';

/**
 * Convertit une erreur inconnue en AppError
 *
 * @param error - L'erreur à convertir (peut être de n'importe quel type)
 * @param context - Contexte où l'erreur s'est produite (ex: "getProducts", "createOrder")
 * @param defaultMessage - Message par défaut si l'erreur n'a pas de message
 * @returns AppError standardisé
 *
 * @example
 * try {
 *   await someOperation();
 * } catch (error) {
 *   throw handleServiceError(error, 'someOperation', 'Erreur lors de l\'opération');
 * }
 */
export function handleServiceError(
  error: unknown,
  context: string,
  defaultMessage?: string
): AppError {
  // Si c'est déjà une AppError, la retourner telle quelle
  if (error instanceof AppError) {
    return error;
  }

  // Si c'est une Error standard, logger et convertir
  if (error instanceof Error) {
    logger.error(`Error in ${context}`, error, { context });
    return createError.internal(
      defaultMessage || error.message || `Erreur dans ${context}`
    );
  }

  // Erreur inconnue
  logger.error(`Unknown error in ${context}`, new Error(String(error)), { context, error });
  return createError.internal(
    defaultMessage || `Erreur inconnue dans ${context}`
  );
}

/**
 * Wrapper pour gérer les erreurs de manière non-bloquante
 * Utile pour les opérations secondaires (logs, notifications, etc.)
 *
 * @param fn - Fonction async à exécuter
 * @param context - Contexte de l'opération
 * @param onError - Callback optionnel appelé en cas d'erreur
 * @returns Promise qui se résout toujours (même en cas d'erreur)
 *
 * @example
 * await handleNonBlockingError(
 *   () => sendNotification(userId),
 *   'sendNotification',
 *   (error) => logger.warn('Notification failed', { error })
 * );
 */
export async function handleNonBlockingError<T>(
  fn: () => Promise<T>,
  context: string,
  onError?: (error: Error) => void
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.warn(`Non-blocking error in ${context}`, { context, error: err.message });

    if (onError) {
      try {
        onError(err);
      } catch {
        // Ignorer les erreurs dans le callback
      }
    }

    return null;
  }
}

/**
 * Gère les erreurs de validation avec détails
 *
 * @param error - Erreur de validation (ZodError ou autre)
 * @param context - Contexte de la validation
 * @returns ValidationError avec détails
 *
 * @example
 * try {
 *   schema.parse(data);
 * } catch (error) {
 *   throw handleValidationError(error, 'userRegistration');
 * }
 */
export function handleValidationError(
  error: unknown,
  context: string
): AppError {
  if (error instanceof Error && 'errors' in error) {
    // ZodError ou erreur similaire avec détails
    const zodError = error as { errors: Array<{ path: (string | number)[]; message: string }> };
    const fields: Record<string, string> = {};

    zodError.errors.forEach((err) => {
      const field = err.path.join('.');
      fields[field] = err.message;
    });

    logger.warn(`Validation error in ${context}`, { context, fields, error: error.message });
    return createError.validation('Erreur de validation', fields);
  }

  // Erreur de validation générique
  const err = error instanceof Error ? error : new Error(String(error));
  logger.warn(`Validation error in ${context}`, { context, error: err.message });
  return createError.validation(err.message || `Erreur de validation dans ${context}`);
}

/**
 * Gère les erreurs de base de données Supabase
 *
 * @param error - Erreur Supabase
 * @param context - Contexte de l'opération DB
 * @param operation - Type d'opération (SELECT, INSERT, UPDATE, DELETE)
 * @returns AppError approprié selon le type d'erreur
 *
 * @example
 * const { data, error } = await supabase.from('users').select('*');
 * if (error) {
 *   throw handleDatabaseError(error, 'getUsers', 'SELECT');
 * }
 */
export function handleDatabaseError(
  error: unknown,
  context: string,
  operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' = 'SELECT'
): AppError {
  if (!error) {
    return createError.database(`Erreur inconnue dans ${context}`);
  }

  const errorObj = error as { code?: string; message?: string; details?: string };
  const code = errorObj.code || 'UNKNOWN';
  const message = errorObj.message || 'Erreur base de données';

  // Logger avec contexte
  logger.error(`Database error in ${context}`, new Error(message), {
    context,
    operation,
    code,
    details: errorObj.details,
  });

  // Erreurs spécifiques selon le code
  switch (code) {
    case 'PGRST116': // Table not found
      return createError.notFound(`Table introuvable dans ${context}`);

    case '23505': // Unique violation
      return createError.conflict(`Conflit de données dans ${context}`);

    case '23503': // Foreign key violation
      return createError.badRequest(`Référence invalide dans ${context}`);

    case '42501': // Insufficient privilege (RLS)
      return createError.forbidden(`Accès refusé à la ressource dans ${context}`);

    case '53300': // Too many connections
      return createError.internal('Base de données surchargée, réessayez plus tard');

    default:
      return createError.database(`Erreur base de données dans ${context}: ${message}`);
  }
}

/**
 * Gère les erreurs réseau/timeout
 *
 * @param error - Erreur réseau
 * @param context - Contexte de l'opération
 * @param retryable - Indique si l'opération peut être réessayée
 * @returns AppError avec indication de retry
 *
 * @example
 * try {
 *   await fetchExternalAPI();
 * } catch (error) {
 *   throw handleNetworkError(error, 'fetchExternalAPI', true);
 * }
 */
export function handleNetworkError(
  error: unknown,
  context: string,
  retryable: boolean = true
): AppError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  logger.error(`Network error in ${context}`, err, { context, retryable });

  // Détecter le type d'erreur réseau
  if (message.includes('timeout') || message.includes('timed out')) {
    return createError.internal(`Timeout lors de ${context}`);
  }

  if (message.includes('econnrefused') || message.includes('connection refused')) {
    return createError.internal(`Service indisponible: ${context}`);
  }

  if (message.includes('enotfound') || message.includes('dns')) {
    return createError.internal(`Service introuvable: ${context}`);
  }

  return createError.internal(`Erreur réseau dans ${context}: ${err.message}`);
}

