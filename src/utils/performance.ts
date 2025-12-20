/**
 * Utilitaires de performance et monitoring
 * Helpers pour mesurer et optimiser les performances
 */

/**
 * Décorateur pour mesurer le temps d'exécution d'une fonction
 */
export function measurePerformance<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  label?: string
): T {
  return (async (...args: any[]) => {
    const start = performance.now();
    const labelText = label || fn.name || 'Function';

    try {
      const result = await fn(...args);
      const duration = performance.now() - start;

      if (duration > 1000) {
        console.warn(`⚠️  Slow ${labelText}: ${duration.toFixed(2)}ms`);
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`❌ ${labelText} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }) as T;
}

/**
 * Créer un timer pour mesurer une opération
 */
export class PerformanceTimer {
  private startTime: number;
  private label: string;

  constructor(label: string) {
    this.label = label;
    this.startTime = performance.now();
  }

  /**
   * Arrêter le timer et retourner la durée
   */
  stop(): number {
    const duration = performance.now() - this.startTime;
    return duration;
  }

  /**
   * Arrêter le timer et logger la durée
   */
  log(): number {
    const duration = this.stop();
    console.log(`⏱️  ${this.label}: ${duration.toFixed(2)}ms`);
    return duration;
  }

  /**
   * Arrêter le timer et logger si lent
   */
  logIfSlow(threshold: number = 1000): number {
    const duration = this.stop();
    if (duration > threshold) {
      console.warn(`⚠️  Slow ${this.label}: ${duration.toFixed(2)}ms`);
    }
    return duration;
  }
}

/**
 * Mesurer le temps d'exécution d'une fonction async
 */
export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const timer = new PerformanceTimer(label);
  const result = await fn();
  const duration = timer.stop();
  return { result, duration };
}

/**
 * Retry avec backoff exponentiel
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Batch processing avec limite de concurrence
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex(p => p === promise), 1);
    }
  }

  await Promise.all(executing);
  return results;
}





