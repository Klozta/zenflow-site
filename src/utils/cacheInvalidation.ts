/**
 * Utilitaires pour invalider le cache
 * Gestion intelligente de l'invalidation du cache
 */
import { deleteCache } from './cache.js';

/**
 * Invalider le cache d'un produit spécifique
 */
export async function invalidateProductCache(productId: string): Promise<void> {
  // Note: Dans une implémentation complète, on utiliserait des patterns
  // Pour l'instant, on invalide les clés connues
  await deleteCache(`products:detail:${productId}`);
}

/**
 * Invalider le cache de la liste des produits
 */
export async function invalidateProductsListCache(): Promise<void> {
  // Dans une implémentation complète avec Redis, on utiliserait des patterns
  // Pour l'instant, le cache expire naturellement (TTL)
}

/**
 * Invalider le cache de recherche
 */
export async function invalidateSearchCache(query?: string): Promise<void> {
  if (query) {
    const { normalizeSearchQuery } = await import('./validationHelpers.js');
    const normalized = normalizeSearchQuery(query);
    await deleteCache(`products:search:${normalized}:*`);
  }
}

/**
 * Invalider tout le cache produits
 */
export async function invalidateAllProductsCache(): Promise<void> {
  // Dans une implémentation complète, on supprimerait toutes les clés produits
  // Pour l'instant, on laisse expirer naturellement
}
