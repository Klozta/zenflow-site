/**
 * Utilitaires pour les métriques
 * Fonctions partagées pour éviter la duplication
 *
 * @module utils/metricsHelpers
 * @description Fonctions réutilisables pour le calcul de métriques, export CSV, et filtrage de dates
 */

import { z } from 'zod';

/**
 * Échappe une valeur pour CSV (gère les guillemets et virgules)
 *
 * @param value - La valeur à échapper (peut être n'importe quel type)
 * @returns La valeur échappée sous forme de string CSV-safe
 *
 * @example
 * escapeCsvValue('Hello, "world"') // Retourne: "Hello, ""world"""
 * escapeCsvValue('Simple text') // Retourne: Simple text
 */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // Si contient virgule, guillemet ou saut de ligne, entourer de guillemets et doubler les guillemets
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Calcule les dates de début/fin selon la période ou les dates fournies
 *
 * @param startDate - Date de début au format ISO string (optionnel)
 * @param endDate - Date de fin au format ISO string (optionnel, défaut: maintenant)
 * @param period - Période prédéfinie: '24h' | '7d' | '30d' | '90d' | '1y' | 'all' (optionnel)
 * @returns Objet avec { start: Date, end: Date }
 *
 * @example
 * calculateDateRange(undefined, undefined, '7d') // 7 derniers jours
 * calculateDateRange('2024-01-01', '2024-01-31') // Période spécifique
 */
export function calculateDateRange(startDate?: string, endDate?: string, period?: string): { start: Date; end: Date } {
  const end = endDate ? new Date(endDate) : new Date();
  let start: Date;

  if (startDate) {
    start = new Date(startDate);
  } else if (period) {
    const now = new Date();
    switch (period) {
      case '24h':
        start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        start = new Date(0); // Époque Unix
        break;
    }
  } else {
    // Par défaut: 30 derniers jours
    start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

/**
 * Calcule les tendances (variation en pourcentage entre deux valeurs)
 *
 * @param current - Valeur actuelle
 * @param previous - Valeur précédente (pour comparaison)
 * @returns Objet avec { value, percentage, direction }
 *   - value: valeur actuelle
 *   - percentage: variation en % (arrondi à 2 décimales)
 *   - direction: 'up' si +5%+, 'down' si -5%-, 'stable' sinon
 *
 * @example
 * calculateTrend(110, 100) // { value: 110, percentage: 10, direction: 'up' }
 * calculateTrend(95, 100) // { value: 95, percentage: -5, direction: 'stable' }
 */
export function calculateTrend(
  current: number,
  previous: number
): { value: number; percentage: number; direction: 'up' | 'down' | 'stable' } {
  if (previous === 0) {
    return { value: current, percentage: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'stable' };
  }
  const percentage = ((current - previous) / previous) * 100;
  const direction = percentage > 5 ? 'up' : percentage < -5 ? 'down' : 'stable';
  return {
    value: current,
    percentage: Math.round(percentage * 100) / 100,
    direction,
  };
}

/**
 * Calcule le z-score d'une valeur par rapport à un historique
 * Utile pour la détection d'anomalies dynamiques
 *
 * @param value - Valeur actuelle à évaluer
 * @param historicalValues - Tableau des valeurs historiques
 * @returns Z-score (nombre d'écarts-types)
 *
 * @example
 * calculateZScore(150, [100, 105, 98, 102, 110]) // ~3.5 (anomalie détectée)
 */
export function calculateZScore(value: number, historicalValues: number[]): number {
  if (historicalValues.length === 0) return 0;

  const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
  const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  return Math.abs((value - mean) / stdDev);
}

/**
 * Calcule le Median Absolute Deviation (MAD) d'une valeur
 * Plus robuste aux outliers que le z-score classique
 *
 * @param value - Valeur actuelle à évaluer
 * @param historicalValues - Tableau des valeurs historiques
 * @returns Score MAD normalisé
 *
 * @example
 * calculateMADScore(150, [100, 105, 98, 102, 110]) // Score MAD
 */
export function calculateMADScore(value: number, historicalValues: number[]): number {
  if (historicalValues.length === 0) return 0;

  const sorted = [...historicalValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  const deviations = historicalValues.map(val => Math.abs(val - median));
  deviations.sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];

  if (mad === 0) return 0;

  return Math.abs((value - median) / mad);
}

/**
 * Schéma de validation Zod pour les filtres de date
 * Utilisé pour valider les paramètres de requête des routes métriques
 *
 * @description Valide les query params startDate, endDate, et period
 * - startDate et endDate doivent être des dates ISO valides
 * - period doit être une des valeurs prédéfinies
 * - Si startDate et endDate sont fournis, startDate doit être < endDate
 *
 * @example
 * // Utilisation dans une route:
 * router.get('/metrics', validate(dateFilterSchema, 'query'), handler)
 */
export const dateFilterSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  period: z.enum(['24h', '7d', '30d', '90d', '1y', 'all']).optional(),
}).refine((data) => {
  // Si startDate et endDate sont fournis, valider que startDate < endDate
  if (data.startDate && data.endDate) {
    return new Date(data.startDate) < new Date(data.endDate);
  }
  return true;
}, {
  message: 'startDate must be before endDate',
});

