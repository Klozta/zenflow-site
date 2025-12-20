/**
 * Système de feature flags avec configuration dynamique
 * Permet d'activer/désactiver des fonctionnalités sans redémarrage
 */

import { getCache, setCache } from '../utils/cache.js';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
  rollout?: {
    percentage: number; // Pourcentage d'utilisateurs (0-100)
    userIds?: string[]; // IDs d'utilisateurs spécifiques
    userEmails?: string[]; // Emails spécifiques
  };
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Feature flags par défaut (depuis variables d'environnement)
const defaultFlags: Record<string, FeatureFlag> = {};

// Cache en mémoire pour performance
let flagsCache: Map<string, FeatureFlag> = new Map();
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute

/**
 * Charge les feature flags depuis le cache ou les variables d'environnement
 */
async function loadFlags(): Promise<Map<string, FeatureFlag>> {
  const now = Date.now();

  // Utiliser le cache si récent (< 1 min)
  if (now - cacheTimestamp < CACHE_TTL_MS && flagsCache.size > 0) {
    return flagsCache;
  }

  // Essayer de charger depuis Redis
  const cached = await getCache<Record<string, FeatureFlag>>('feature_flags:all');
  if (cached) {
    flagsCache = new Map(Object.entries(cached));
    cacheTimestamp = now;
    return flagsCache;
  }

  // Fallback: charger depuis les variables d'environnement
  // Format: FEATURE_FLAG_NAME=true, FEATURE_FLAG_NEW_FEATURE=false
  const envFlags: Record<string, FeatureFlag> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('FEATURE_')) {
      const flagName = key.replace('FEATURE_', '').toLowerCase().replace(/_/g, '-');
      envFlags[flagName] = {
        name: flagName,
        enabled: value === 'true' || value === '1',
        description: `Feature flag from environment variable ${key}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  flagsCache = new Map(Object.entries({ ...defaultFlags, ...envFlags }));
  cacheTimestamp = now;

  return flagsCache;
}

/**
 * Service de feature flags
 */
export class FeatureFlagsService {
  /**
   * Vérifie si une feature est activée
   */
  async isEnabled(flagName: string, context?: { userId?: string; userEmail?: string }): Promise<boolean> {
    const flags = await loadFlags();
    const flag = flags.get(flagName);

    if (!flag) {
      // Si flag non défini, retourner false (opt-in par défaut)
      return false;
    }

    if (!flag.enabled) {
      return false;
    }

    // Vérifier le rollout si configuré
    if (flag.rollout) {
      // Vérifier les utilisateurs spécifiques
      if (context?.userId && flag.rollout.userIds?.includes(context.userId)) {
        return true;
      }

      if (context?.userEmail && flag.rollout.userEmails?.includes(context.userEmail)) {
        return true;
      }

      // Rollout par pourcentage (basé sur userId hash si disponible)
      if (flag.rollout.percentage < 100 && context?.userId) {
        // Hash simple pour déterminer si l'utilisateur fait partie du pourcentage
        const hash = this.hashUserId(context.userId);
        const userPercentage = hash % 100;
        return userPercentage < flag.rollout.percentage;
      }

      // Si rollout < 100% et pas de contexte utilisateur, retourner false
      if (flag.rollout.percentage < 100 && !context?.userId) {
        return false;
      }
    }

    return flag.enabled;
  }

  /**
   * Récupère toutes les feature flags
   */
  async getAllFlags(): Promise<FeatureFlag[]> {
    const flags = await loadFlags();
    return Array.from(flags.values());
  }

  /**
   * Récupère une feature flag spécifique
   */
  async getFlag(flagName: string): Promise<FeatureFlag | null> {
    const flags = await loadFlags();
    return flags.get(flagName) || null;
  }

  /**
   * Met à jour une feature flag (persiste dans Redis)
   */
  async setFlag(flag: FeatureFlag): Promise<void> {
    const flags = await loadFlags();
    flags.set(flag.name, {
      ...flag,
      updatedAt: new Date().toISOString(),
    });

    // Persister dans Redis
    const flagsObject = Object.fromEntries(flags);
    await setCache('feature_flags:all', flagsObject, 86400); // 24 heures

    // Invalider le cache mémoire
    cacheTimestamp = 0;
    flagsCache = flags;
  }

  /**
   * Active une feature flag
   */
  async enableFlag(flagName: string, description?: string): Promise<void> {
    const existing = await this.getFlag(flagName);
    const flag: FeatureFlag = existing || {
      name: flagName,
      enabled: true,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    flag.enabled = true;
    if (description) {
      flag.description = description;
    }
    flag.updatedAt = new Date().toISOString();

    await this.setFlag(flag);
  }

  /**
   * Désactive une feature flag
   */
  async disableFlag(flagName: string): Promise<void> {
    const existing = await this.getFlag(flagName);
    if (!existing) {
      throw new Error(`Feature flag ${flagName} not found`);
    }

    existing.enabled = false;
    existing.updatedAt = new Date().toISOString();
    await this.setFlag(existing);
  }

  /**
   * Hash simple d'un userId pour le rollout par pourcentage
   */
  private hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convertir en 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Invalide le cache (utile après mise à jour)
   */
  invalidateCache(): void {
    cacheTimestamp = 0;
    flagsCache.clear();
  }
}

// Export singleton
export const featureFlags = new FeatureFlagsService();

// Helper pour vérifier une feature flag (syntaxe simplifiée)
export async function isFeatureEnabled(
  flagName: string,
  context?: { userId?: string; userEmail?: string }
): Promise<boolean> {
  return featureFlags.isEnabled(flagName, context);
}

