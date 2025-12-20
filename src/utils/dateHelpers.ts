/**
 * Helpers pour manipulation de dates
 * Fonctions utilitaires pour formater et manipuler les dates
 */

/**
 * Vérifier si une date est valide
 */
export function isValidDate(date: any): boolean {
  if (!date) return false;
  const d = new Date(date);
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Formater une date ISO
 */
export function formatISO(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}

/**
 * Ajouter des jours à une date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = date instanceof Date ? date : new Date(date);
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Calculer la différence en jours entre deux dates
 */
export function daysDifference(date1: Date | string, date2: Date | string): number {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Vérifier si une date est dans le passé
 */
export function isPast(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() < Date.now();
}

/**
 * Vérifier si une date est dans le futur
 */
export function isFuture(date: Date | string): boolean {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() > Date.now();
}

/**
 * Obtenir le début du jour
 */
export function startOfDay(date: Date | string): Date {
  const d = date instanceof Date ? date : new Date(date);
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Obtenir la fin du jour
 */
export function endOfDay(date: Date | string): Date {
  const d = date instanceof Date ? date : new Date(date);
  const result = new Date(d);
  result.setHours(23, 59, 59, 999);
  return result;
}





