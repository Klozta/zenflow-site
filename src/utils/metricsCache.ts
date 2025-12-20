/**
 * Cache hybride Redis + mémoire pour les métriques
 * Utilise Redis si disponible, sinon fallback en mémoire
 * Optimisation: évite les appels DB répétés pour les métriques fréquemment consultées
 */
import { deleteCache as deleteRedisCache, getCache, setCache } from './cache.js';
import { logger } from './logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

// Cache mémoire de fallback
const memoryCache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes par défaut

// Flag pour savoir si Redis est disponible
let redisAvailable = false;
let redisCheckDone = false;

/**
 * Vérifie si Redis est disponible (une seule fois)
 */
async function checkRedisAvailability(): Promise<boolean> {
  if (redisCheckDone) return redisAvailable;

  try {
    // Test simple: essayer de lire une clé qui n'existe pas
    await getCache('__redis_check__');
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    logger.warn('Redis non disponible, utilisation du cache mémoire pour les métriques');
  } finally {
    redisCheckDone = true;
  }

  return redisAvailable;
}

/**
 * Récupère une valeur du cache (async pour Redis, sync pour mémoire)
 * Utilise Redis si disponible, sinon fallback mémoire
 */
export async function getCached<T>(key: string): Promise<T | null> {
  // Préfixe pour les métriques
  const redisKey = `metrics:${key}`;

  // Vérifier Redis une fois
  const useRedis = await checkRedisAvailability();

  if (useRedis) {
    try {
      const value = await getCache<T>(redisKey);
      if (value !== null) {
        // Mettre aussi en cache mémoire pour accès rapide
        memoryCache.set(key, {
          value,
          expiresAt: Date.now() + DEFAULT_TTL_MS,
        });
        return value;
      }
    } catch (error) {
      logger.warn('Erreur Redis getCache, fallback mémoire', {
        key: redisKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fallback: cache mémoire
  const entry = memoryCache.get(key);
  if (!entry) return null;

  // Vérifier expiration
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

/**
 * Version synchrone pour compatibilité (utilise uniquement mémoire)
 * À utiliser uniquement si vous savez que Redis n'est pas nécessaire
 */
export function getCachedSync<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }

  return entry.value as T;
}

/**
 * Met une valeur en cache (async pour Redis, sync pour mémoire)
 */
export async function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
  const redisKey = `metrics:${key}`;
  const ttlSeconds = Math.floor(ttlMs / 1000);

  // Mettre en cache mémoire immédiatement (synchrone)
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  // Nettoyer le cache mémoire si trop grand (max 1000 entrées)
  if (memoryCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (now > v.expiresAt) {
        memoryCache.delete(k);
      }
    }
    // Si toujours trop grand, supprimer les plus anciennes
    if (memoryCache.size > 1000) {
      const entries = Array.from(memoryCache.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toDelete = entries.slice(0, memoryCache.size - 1000);
      for (const [k] of toDelete) {
        memoryCache.delete(k);
      }
    }
  }

  // Mettre aussi en Redis si disponible (async, non-bloquant)
  const useRedis = await checkRedisAvailability();
  if (useRedis) {
    setCache(redisKey, value, ttlSeconds).catch((error) => {
      logger.warn('Erreur Redis setCache (non-bloquant)', {
        key: redisKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * Version synchrone pour compatibilité (utilise uniquement mémoire)
 */
export function setCachedSync<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Supprime une clé du cache
 */
export async function deleteCached(key: string): Promise<void> {
  const redisKey = `metrics:${key}`;
  memoryCache.delete(key);

  const useRedis = await checkRedisAvailability();
  if (useRedis) {
    deleteRedisCache(redisKey).catch((error) => {
      logger.warn('Erreur Redis deleteCache (non-bloquant)', {
        key: redisKey,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

/**
 * Vide tout le cache
 */
export function clearCache(): void {
  memoryCache.clear();
  // Note: On ne vide pas Redis car il peut être partagé avec d'autres services
}

