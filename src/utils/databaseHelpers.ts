/**
 * Helpers pour opérations base de données
 * Fonctions utilitaires pour les requêtes DB
 */
import { supabase } from '../config/supabase.js';

/**
 * Vérifier si une table existe
 */
export async function tableExists(tableName: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);

    // Si pas d'erreur ou erreur de permission (table existe mais pas d'accès)
    return !error || error.code !== 'PGRST116';
  } catch {
    return false;
  }
}

/**
 * Compter les enregistrements d'une table
 */
export async function countRecords(tableName: string, filters?: Record<string, any>): Promise<number> {
  try {
    let query = supabase.from(tableName).select('*', { count: 'exact', head: true });

    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });
    }

    const { count, error } = await query;

    if (error) throw error;
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Vérifier si un enregistrement existe
 */
export async function recordExists(
  tableName: string,
  column: string,
  value: any
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select(column)
      .eq(column, value)
      .limit(1)
      .single();

    return !error && data !== null;
  } catch {
    return false;
  }
}

/**
 * Nettoyer les données avant insertion (supprimer undefined, null si non nécessaire)
 */
export function cleanDataForInsert(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    // Garder null si explicitement null, supprimer undefined
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}





