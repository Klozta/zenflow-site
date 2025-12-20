/**
 * Pagination cursor-based pour optimiser les performances sur grandes tables
 * Utilise un curseur (timestamp ou ID) au lieu d'offset pour éviter les problèmes de performance
 *
 * Avantages:
 * - Performance constante même avec de grandes tables
 * - Pas de problème de "saut" de résultats si de nouveaux enregistrements sont ajoutés
 * - Meilleure scalabilité
 */

export interface CursorPaginationParams {
  cursor?: string; // Cursor encodé (timestamp:uuid ou timestamp)
  limit?: number; // Nombre de résultats (défaut: 20, max: 100)
  direction?: 'next' | 'prev'; // Direction de pagination (défaut: 'next')
}

export interface CursorPaginationResult<T> {
  items: T[];
  nextCursor: string | null; // Cursor pour la page suivante
  prevCursor: string | null; // Cursor pour la page précédente
  hasMore: boolean; // Indique s'il y a plus de résultats
  limit: number;
}

/**
 * Encode un cursor à partir d'un timestamp et d'un ID optionnel
 * Format: timestamp:uuid (ex: "1703001234567:abc-123-def")
 * Si pas d'ID, utilise juste le timestamp (ex: "1703001234567")
 */
export function encodeCursor(timestamp: string | Date, id?: string): string {
  const ts = typeof timestamp === 'string' ? timestamp : timestamp.toISOString();
  const timestampMs = new Date(ts).getTime();
  if (id) {
    return `${timestampMs}:${id}`;
  }
  return String(timestampMs);
}

/**
 * Décode un cursor en timestamp et ID
 */
export function decodeCursor(cursor: string): { timestamp: Date; id?: string } {
  const parts = cursor.split(':');
  const timestamp = new Date(parseInt(parts[0], 10));

  if (parts.length > 1) {
    return { timestamp, id: parts.slice(1).join(':') };
  }

  return { timestamp };
}

/**
 * Crée une query Supabase avec pagination cursor-based
 * Utilise created_at comme curseur principal (avec id comme tie-breaker si nécessaire)
 *
 * @param query - Query Supabase à modifier
 * @param params - Paramètres de pagination
 * @param orderBy - Colonne pour le tri (défaut: 'created_at')
 * @param orderDirection - Direction du tri (défaut: 'desc')
 * @returns Query modifiée avec pagination cursor
 */
export function applyCursorPagination(
  query: any,
  params: CursorPaginationParams,
  orderBy: string = 'created_at',
  orderDirection: 'asc' | 'desc' = 'desc'
): any {
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const direction = params.direction || 'next';
  const isDesc = orderDirection === 'desc';

  // Appliquer le tri
  query = query.order(orderBy, { ascending: !isDesc });

  // Si un cursor est fourni, filtrer les résultats
  if (params.cursor) {
    try {
      const { timestamp } = decodeCursor(params.cursor);

      if (direction === 'next') {
        // Page suivante: résultats après le cursor
        if (isDesc) {
          query = query.lt(orderBy, timestamp.toISOString());
        } else {
          query = query.gt(orderBy, timestamp.toISOString());
        }
      } else {
        // Page précédente: résultats avant le cursor
        if (isDesc) {
          query = query.gt(orderBy, timestamp.toISOString());
        } else {
          query = query.lt(orderBy, timestamp.toISOString());
        }
      }
    } catch (error) {
      // Cursor invalide, ignorer et retourner les premiers résultats
      console.warn('Invalid cursor, ignoring:', params.cursor);
    }
  }

  // Limiter le nombre de résultats (+1 pour savoir s'il y a plus)
  query = query.limit(limit + 1);

  return query;
}

/**
 * Traite les résultats d'une query avec pagination cursor
 * Extrait le cursor suivant/précédent et indique s'il y a plus de résultats
 */
export function processCursorResults<T extends { created_at: string; id?: string }>(
  items: T[],
  limit: number
): CursorPaginationResult<T> {
  const hasMore = items.length > limit;
  const actualItems = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  let prevCursor: string | null = null;

  if (actualItems.length > 0) {
    const lastItem = actualItems[actualItems.length - 1];
    const firstItem = actualItems[0];

    // Cursor suivant (pour aller vers les résultats plus récents/anciens selon direction)
    if (hasMore) {
      nextCursor = encodeCursor(
        lastItem.created_at,
        lastItem.id
      );
    }

    // Cursor précédent (pour revenir en arrière)
    prevCursor = encodeCursor(
      firstItem.created_at,
      firstItem.id
    );
  }

  return {
    items: actualItems,
    nextCursor,
    prevCursor,
    hasMore,
    limit,
  };
}

/**
 * Helper pour créer une réponse de pagination compatible avec l'ancien format
 * (pour rétrocompatibilité avec le frontend existant)
 */
export function toLegacyPagination<T>(
  cursorResult: CursorPaginationResult<T>,
  estimatedTotal?: number
): {
  items: T[];
  pagination: {
    page: number; // Estimé (non précis avec cursor)
    limit: number;
    total?: number; // Optionnel (nécessite count séparé)
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
} {
  return {
    items: cursorResult.items,
    pagination: {
      page: 1, // Page estimée (non utilisable avec cursor)
      limit: cursorResult.limit,
      total: estimatedTotal,
      hasMore: cursorResult.hasMore,
      nextCursor: cursorResult.nextCursor,
      prevCursor: cursorResult.prevCursor,
    },
  };
}

