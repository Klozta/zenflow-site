/**
 * Utilitaire de retry avec backoff exponentiel
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryable: () => true,
};

/**
 * Exécute une fonction avec retry automatique
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Vérifier si l'erreur est retryable
      if (!opts.retryable(error)) {
        throw error;
      }

      // Dernière tentative, ne pas attendre
      if (attempt === opts.maxRetries) {
        break;
      }

      // Attendre avant de réessayer
      await new Promise(resolve => setTimeout(resolve, delay));

      // Augmenter le délai pour la prochaine tentative (backoff exponentiel)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  throw lastError;
}

/**
 * Retry spécifique pour les erreurs réseau
 */
export function isNetworkError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof Error) {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = (error as { code?: string }).code?.toLowerCase() || '';
    const axiosError = error as { response?: { status?: number } };

    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound') ||
      errorCode === 'etimedout' ||
      errorCode === 'econnrefused' ||
      errorCode === 'enotfound' ||
      (axiosError.response?.status !== undefined && axiosError.response.status >= 500)
    );
  }

  return false;
}

/**
 * Retry avec gestion spécifique des erreurs réseau
 */
export async function retryNetwork<T>(
  fn: () => Promise<T>,
  options: Omit<RetryOptions, 'retryable'> = {}
): Promise<T> {
  return retry(fn, {
    ...options,
    retryable: isNetworkError,
  });
}
