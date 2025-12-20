/**
 * Configuration du connection pooling pour Supabase/PostgreSQL
 * Optimise les performances et la gestion des connexions
 */

import { logger } from '../utils/logger.js';

/**
 * Configuration recommandée pour le connection pooling
 * Basée sur les meilleures pratiques Supabase
 */
export interface DatabasePoolConfig {
  maxConnections?: number; // Nombre max de connexions (défaut: 10)
  idleTimeout?: number; // Timeout inactif en ms (défaut: 30000)
  connectionTimeout?: number; // Timeout connexion en ms (défaut: 5000)
  statementTimeout?: number; // Timeout requêtes en ms (défaut: 30000)
  queryTimeout?: number; // Timeout queries en ms (défaut: 60000)
}

/**
 * Configuration par défaut optimisée pour Supabase
 */
export const DEFAULT_POOL_CONFIG: Required<DatabasePoolConfig> = {
  maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  statementTimeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10),
  queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '60000', 10),
};

/**
 * Recommandations pour le connection pooling Supabase
 *
 * Supabase utilise PgBouncer avec différents modes:
 * - Session mode: Pour migrations et scripts
 * - Transaction mode: Recommandé pour les applications (par défaut)
 * - Statement mode: Pour les requêtes individuelles (non recommandé)
 *
 * Pour Supabase, utiliser l'URL avec le paramètre ?pgbouncer=true
 * ou utiliser directement l'URL de connection pooling
 */
export const SUPABASE_POOLING_CONFIG = {
  // URL avec pooling (transaction mode)
  // Format: postgresql://[user]:[password]@[host]:[port]/[database]?pgbouncer=true
  usePooling: process.env.SUPABASE_USE_POOLING !== 'false', // Par défaut: true

  // URL alternative pour pooling direct (si disponible)
  poolingUrl: process.env.SUPABASE_POOLING_URL,

  // Mode de pooling (transaction recommandé)
  poolingMode: 'transaction' as const,

  // Configuration des connexions
  ...DEFAULT_POOL_CONFIG,
};

/**
 * Validation de la configuration de pooling
 */
export function validatePoolConfig(config: DatabasePoolConfig = {}): void {
  const finalConfig = { ...DEFAULT_POOL_CONFIG, ...config };

  if (finalConfig.maxConnections < 1 || finalConfig.maxConnections > 100) {
    logger.warn('DB_MAX_CONNECTIONS should be between 1 and 100', {
      current: finalConfig.maxConnections,
      recommended: 10,
    });
  }

  if (finalConfig.queryTimeout < 1000) {
    logger.warn('DB_QUERY_TIMEOUT_MS should be at least 1000ms', {
      current: finalConfig.queryTimeout,
    });
  }

  logger.info('Database pool configuration', finalConfig);
}

/**
 * Helper pour obtenir l'URL de connexion avec pooling
 */
export function getPooledConnectionUrl(baseUrl: string): string {
  if (!SUPABASE_POOLING_CONFIG.usePooling) {
    return baseUrl;
  }

  // Si une URL de pooling dédiée est fournie, l'utiliser
  if (SUPABASE_POOLING_CONFIG.poolingUrl) {
    return SUPABASE_POOLING_CONFIG.poolingUrl;
  }

  // Ajouter le paramètre pgbouncer=true si pas déjà présent
  const url = new URL(baseUrl);
  if (!url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  return url.toString();
}

/**
 * Initialiser la configuration de pooling au démarrage
 */
export function initializeDatabasePooling(): void {
  validatePoolConfig();

  if (SUPABASE_POOLING_CONFIG.usePooling) {
    logger.info('Database connection pooling enabled', {
      mode: SUPABASE_POOLING_CONFIG.poolingMode,
      maxConnections: DEFAULT_POOL_CONFIG.maxConnections,
    });
  } else {
    logger.warn('Database connection pooling disabled - not recommended for production');
  }
}

