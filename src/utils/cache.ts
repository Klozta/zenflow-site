// backend/src/utils/cache.ts
import { Redis } from '@upstash/redis';
import { logger } from './logger.js';

let redis: Redis | null = null;

async function getRedisClient(): Promise<Redis> {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;

    if (!url || !token) {
      throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN must be set in .env');
    }

    redis = new Redis({
      url,
      token,
    });
  }
  return redis;
}

/**
 * Get cached value
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = await getRedisClient();
    const value = await client.get(key);
    if (value === null || value === undefined) return null;

    // Upstash renvoie souvent une string (car on stocke JSON.stringify)
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        // Si ce n'est pas du JSON, retourner la string brute
        return value as unknown as T;
      }
    }

    return value as T;
  } catch (error) {
    logger.warn('Redis GET failed, continuing without cache', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Set cached value with TTL (seconds)
 * Optimisation: Utilise JSON.stringify une seule fois
 */
export async function setCache<T = unknown>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
  try {
    const client = await getRedisClient();
    // Optimisation: Stringify une seule fois
    const serialized = JSON.stringify(value);
    await client.set(key, serialized, { ex: ttlSeconds });
  } catch (error) {
    logger.warn('Redis SET failed', {
      key,
      ttl: ttlSeconds,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Set multiple cache keys at once (batch operation)
 * Optimisation pour invalidation en masse
 */
export async function setCacheBatch<T = unknown>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
  try {
    const client = await getRedisClient();
    // Utiliser pipeline pour batch operations
    const pipeline = [];
    for (const { key, value, ttl = 300 } of entries) {
      const serialized = JSON.stringify(value);
      pipeline.push(['set', key, serialized, 'ex', ttl]);
    }
    // Note: Upstash Redis ne supporte pas pipeline natif, donc on fait séquentiel
    // Mais on peut optimiser avec Promise.all
    await Promise.all(
      entries.map(({ key, value, ttl = 300 }) => {
        const serialized = JSON.stringify(value);
        return client.set(key, serialized, { ex: ttl });
      })
    );
  } catch (error) {
    logger.warn('Redis batch SET failed', {
      count: entries.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Delete single cache key
 */
export async function deleteCache(key: string): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.del(key);
  } catch (error) {
    logger.warn('Redis DEL failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Delete all keys matching pattern (e.g. "products:*")
 */
export async function deleteCachePattern(pattern: string): Promise<void> {
  try {
    const client = await getRedisClient();
    let cursor = 0;
    do {
      const result = await client.scan(cursor, { match: pattern }) as unknown as { cursor: number; keys: string[] };
      cursor = result.cursor;
      if (result.keys && result.keys.length > 0) {
        await client.del(...result.keys);
      }
    } while (cursor !== 0);
  } catch (error) {
    logger.warn('Redis pattern delete failed', {
      pattern,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
