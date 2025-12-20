/**
 * Cache pour les analyses de produits (évite de re-scraper la même URL)
 */
interface CachedAnalysis {
  data: any;
  timestamp: number;
}

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const cache = new Map<string, CachedAnalysis>();

/**
 * Récupère une analyse depuis le cache
 */
export function getCachedAnalysis(url: string): any | null {
  const cached = cache.get(url);
  if (!cached) return null;

  // Vérifier si le cache est encore valide
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    cache.delete(url);
    return null;
  }

  return cached.data;
}

/**
 * Met en cache une analyse
 */
export function setCachedAnalysis(url: string, data: any): void {
  cache.set(url, {
    data,
    timestamp: Date.now(),
  });
}

/**
 * Invalide le cache pour une URL
 */
export function invalidateCache(url: string): void {
  cache.delete(url);
}

/**
 * Nettoie le cache (supprime les entrées expirées)
 */
export function cleanCache(): void {
  const now = Date.now();
  for (const [url, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(url);
    }
  }
}

// Nettoyer le cache toutes les heures
if (typeof setInterval !== 'undefined') {
  setInterval(cleanCache, 60 * 60 * 1000);
}









