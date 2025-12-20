/**
 * Stratégies de cache avancées : cache-aside et write-through
 * Améliore les performances et réduit la charge sur la base de données
 */

import { prometheusMetrics } from '../services/prometheusMetrics.js';
import { deleteCache, getCache, setCache } from './cache.js';
import { logger } from './logger.js';

/**
 * Stratégie Cache-Aside (Lazy Loading)
 * Pattern: L'application charge les données depuis le cache si disponible, sinon depuis la DB puis met en cache
 *
 * @param cacheKey - Clé de cache
 * @param fetchFn - Fonction pour récupérer les données depuis la source (DB, API, etc.)
 * @param ttlSeconds - TTL en secondes (défaut: 300 = 5 min)
 * @returns Données depuis cache ou source
 */
export async function cacheAside<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  // 1. Essayer de récupérer depuis le cache
  const cached = await getCache<T>(cacheKey);
  if (cached !== null) {
    prometheusMetrics.recordCacheAccess('redis', true);
    return cached;
  }

  prometheusMetrics.recordCacheAccess('redis', false);

  // 2. Cache miss: récupérer depuis la source
  const data = await fetchFn();

  // 3. Mettre en cache de manière asynchrone (non-bloquant)
  setCache(cacheKey, data, ttlSeconds).catch((error) => {
    logger.warn('Failed to cache data (non-blocking)', {
      key: cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return data;
}

/**
 * Stratégie Write-Through
 * Pattern: Écrire simultanément dans le cache et la source de données
 *
 * @param cacheKey - Clé de cache
 * @param data - Données à écrire
 * @param writeFn - Fonction pour écrire dans la source (DB, API, etc.)
 * @param ttlSeconds - TTL en secondes (défaut: 300)
 * @returns Données écrites
 */
export async function writeThrough<T>(
  cacheKey: string,
  data: T,
  writeFn: (data: T) => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  // 1. Écrire dans la source de données
  const written = await writeFn(data);

  // 2. Mettre à jour le cache (write-through)
  await setCache(cacheKey, written, ttlSeconds);

  return written;
}

/**
 * Stratégie Write-Behind (Write-Back)
 * Pattern: Écrire d'abord dans le cache, puis de manière asynchrone dans la source
 * Utile pour améliorer les performances d'écriture
 *
 * @param cacheKey - Clé de cache
 * @param data - Données à écrire
 * @param writeFn - Fonction pour écrire dans la source
 * @param ttlSeconds - TTL en secondes (défaut: 300)
 * @returns Données mises en cache
 */
export async function writeBehind<T>(
  cacheKey: string,
  data: T,
  writeFn: (data: T) => Promise<T>,
  ttlSeconds: number = 3600 // TTL plus long car on écrit d'abord en cache
): Promise<T> {
  // 1. Écrire immédiatement dans le cache
  await setCache(cacheKey, data, ttlSeconds);

  // 2. Écrire de manière asynchrone dans la source (non-bloquant)
  writeFn(data).catch((error) => {
    logger.error('Write-behind failed to write to source', error, {
      key: cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });
    // Optionnel: marquer le cache comme "dirty" pour réessayer plus tard
  });

  return data;
}

/**
 * Invalidation de cache intelligente
 * Invalide le cache et les clés associées (pour relations)
 *
 * @param cacheKey - Clé principale à invalider
 * @param relatedKeys - Clés associées à invalider aussi (ex: liste, compteurs)
 */
export async function invalidateCache(cacheKey: string, relatedKeys: string[] = []): Promise<void> {
  await deleteCache(cacheKey);

  // Invalider les clés associées
  if (relatedKeys.length > 0) {
    await Promise.all(relatedKeys.map(key => deleteCache(key)));
  }
}

/**
 * Refresh-Ahead (proactive cache refresh)
 * Actualise le cache avant expiration si demandé
 *
 * @param cacheKey - Clé de cache
 * @param fetchFn - Fonction pour récupérer les données
 * @param ttlSeconds - TTL en secondes
 * @param refreshThreshold - Pourcentage de TTL avant lequel actualiser (0.8 = 80%)
 * @returns Données (depuis cache ou nouvelle)
 */
export async function refreshAhead<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300,
  _refreshThreshold: number = 0.8
): Promise<T> {
  // Pour l'instant, implémentation simple (on pourrait ajouter un système de tracking des accès)
  // Idéalement, on devrait tracker quand la clé a été mise en cache et rafraîchir si proche expiration
  return cacheAside(cacheKey, fetchFn, ttlSeconds);
}

/**
 * Cache avec stale-while-revalidate
 * Retourne les données expirées pendant qu'on les actualise en arrière-plan
 *
 * @param cacheKey - Clé de cache
 * @param fetchFn - Fonction pour récupérer les données
 * @param ttlSeconds - TTL en secondes
 * @param staleTtlSeconds - TTL pour données stale (défaut: même que TTL)
 * @returns Données (peut être stale)
 */
export async function staleWhileRevalidate<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300,
  staleTtlSeconds: number = 300
): Promise<T> {
  // 1. Essayer de récupérer depuis le cache
  const cached = await getCache<{ data: T; cachedAt: number }>(cacheKey);

  if (cached !== null) {
    const age = Date.now() - cached.cachedAt;
    const isStale = age > ttlSeconds * 1000;
    const isTooStale = age > staleTtlSeconds * 1000;

    // Si pas trop stale, retourner et rafraîchir en arrière-plan
    if (!isTooStale) {
      if (isStale) {
        // Rafraîchir en arrière-plan
        fetchFn()
          .then((freshData) => {
            return setCache(cacheKey, { data: freshData, cachedAt: Date.now() }, ttlSeconds);
          })
          .catch((error) => {
            logger.warn('Stale-while-revalidate refresh failed', {
              key: cacheKey,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }
      prometheusMetrics.recordCacheAccess('redis', true);
      return cached.data;
    }
  }

  // Cache miss ou trop stale: récupérer depuis la source
  prometheusMetrics.recordCacheAccess('redis', false);
  const data = await fetchFn();

  // Mettre en cache
  await setCache(cacheKey, { data, cachedAt: Date.now() }, staleTtlSeconds);

  return data;
}

