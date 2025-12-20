/**
 * Système de retry avancé avec backoff exponentiel et circuit breaker
 */

import { logger } from './logger.js';

export interface RetryConfig {
  maxAttempts?: number; // Nombre maximum de tentatives (défaut: 3)
  initialDelayMs?: number; // Délai initial en ms (défaut: 100)
  maxDelayMs?: number; // Délai maximum en ms (défaut: 5000)
  backoffMultiplier?: number; // Multiplicateur pour backoff exponentiel (défaut: 2)
  shouldRetry?: (error: any, attempt: number) => boolean; // Fonction pour déterminer si on doit retry
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

/**
 * Retry avec backoff exponentiel
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 5000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
  } = config;

  let lastError: Error | undefined;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();

      // Log si ce n'était pas le premier essai
      if (attempt > 1) {
        logger.info('Retry succeeded', {
          attempts: attempt,
          operation: fn.name || 'unknown',
        });
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Vérifier si on doit retry
      if (!shouldRetry(lastError, attempt) || attempt >= maxAttempts) {
        if (attempt >= maxAttempts) {
          logger.error('Retry exhausted', lastError, {
            attempts: attempt,
            maxAttempts,
            operation: fn.name || 'unknown',
          });
        }
        throw new RetryError(
          `Failed after ${attempt} attempts: ${lastError.message}`,
          lastError,
          attempt
        );
      }

      // Attendre avant de retry (backoff exponentiel avec jitter)
      const jitter = Math.random() * 0.3 * delay; // Jitter de 30%
      const waitTime = Math.min(delay + jitter, maxDelayMs);

      logger.warn('Retry attempt', {
        attempt,
        maxAttempts,
        waitTimeMs: waitTime,
        error: lastError.message,
        operation: fn.name || 'unknown',
      });

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      // Augmenter le délai pour la prochaine tentative
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  // Ne devrait jamais arriver ici, mais TypeScript le demande
  throw new RetryError(
    `Failed after ${maxAttempts} attempts`,
    lastError || new Error('Unknown error'),
    maxAttempts
  );
}

/**
 * Circuit breaker pour éviter de surcharger un service en panne
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number | null = null;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold: number = 5, // Nombre d'échecs avant ouverture
    private readonly timeoutMs: number = 60000, // 1 minute avant half-open
    private readonly name: string = 'circuit-breaker'
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Vérifier l'état du circuit
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);

      if (timeSinceLastFailure >= this.timeoutMs) {
        // Passer en half-open pour tester
        this.state = 'half-open';
        logger.info('Circuit breaker transitioning to half-open', { name: this.name });
      } else {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }
    }

    try {
      const result = await fn();

      // Succès: réinitialiser si on était en half-open ou closed
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
        logger.info('Circuit breaker closed after successful half-open', { name: this.name });
      } else if (this.state === 'closed') {
        this.failures = 0; // Réinitialiser les échecs
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.state === 'half-open') {
        // Échec en half-open: retourner à open
        this.state = 'open';
        logger.warn('Circuit breaker opened after half-open failure', {
          name: this.name,
          error: error instanceof Error ? error.message : String(error),
        });
      } else if (this.failures >= this.threshold) {
        // Trop d'échecs: ouvrir le circuit
        this.state = 'open';
        logger.error('Circuit breaker opened', error instanceof Error ? error : new Error(String(error)), {
          name: this.name,
          failures: this.failures,
          threshold: this.threshold,
        });
      }

      throw error;
    }
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = null;
  }
}

/**
 * Helper pour déterminer si une erreur est retryable
 */
export function isRetryableError(error: any): boolean {
  if (!error) return false;

  // Erreurs réseau
  const networkErrors = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'];
  if (error.code && networkErrors.includes(error.code)) {
    return true;
  }

  // Erreurs HTTP 5xx (erreurs serveur)
  if (error.status && error.status >= 500 && error.status < 600) {
    return true;
  }

  // Erreurs HTTP 429 (rate limit) - retry avec backoff
  if (error.status === 429) {
    return true;
  }

  // Erreurs de timeout
  if (error.message && (
    error.message.includes('timeout') ||
    error.message.includes('TIMEOUT')
  )) {
    return true;
  }

  return false;
}

