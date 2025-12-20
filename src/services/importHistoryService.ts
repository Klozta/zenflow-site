/**
 * Service d'historique et traçabilité des imports
 */
import { supabase } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';

export interface ImportHistory {
  id: string;
  url: string;
  product_id: string | null;
  status: 'success' | 'failed' | 'pending';
  original_price: number;
  final_price: number;
  suggested_price: number;
  margin: number;
  category: string | null;
  source_site: string;
  error_message: string | null;
  created_at: string;
}

export interface ImportHistoryInput {
  url: string;
  productId?: string | null;
  status: 'success' | 'failed' | 'pending';
  originalPrice: number;
  finalPrice: number;
  suggestedPrice: number;
  margin: number;
  category?: string | null;
  sourceSite: string;
  errorMessage?: string | null;
}

/**
 * Créer une entrée d'historique d'import
 */
export async function createImportHistory(
  data: ImportHistoryInput
): Promise<ImportHistory> {
  const historyData = {
    id: uuidv4(),
    url: data.url,
    product_id: data.productId || null,
    status: data.status,
    original_price: data.originalPrice,
    final_price: data.finalPrice,
    suggested_price: data.suggestedPrice,
    margin: data.margin,
    category: data.category || null,
    source_site: data.sourceSite,
    error_message: data.errorMessage || null,
  };

  try {
    // Vérifier si Supabase est configuré
    if (!supabase || typeof supabase.from !== 'function') {
      return historyData as any;
    }

    const { data: history, error } = await supabase
      .from('import_history')
      .insert(historyData)
      .select()
      .single();

    if (error) {
      // Si la table n'existe pas, on continue sans erreur (mode développement)
      if (error.message.includes('non configuré') || error.message.includes('does not exist')) {
        console.warn('⚠️  Table import_history non disponible, historique non enregistré');
        return historyData as any;
      }
      throw new Error(`Erreur création historique: ${error.message}`);
    }

    return history as ImportHistory;
  } catch (error: any) {
    // En cas d'erreur, retourner les données sans les sauvegarder
    console.warn(`⚠️  Erreur création historique: ${error.message}`);
    return historyData as any;
  }
}

/**
 * Récupérer l'historique des imports
 */
export async function getImportHistory(options?: {
  limit?: number;
  offset?: number;
  status?: 'success' | 'failed' | 'pending';
  sourceSite?: string;
}): Promise<{ history: ImportHistory[]; total: number }> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  try {
    // Vérifier si Supabase est configuré
    if (!supabase || typeof supabase.from !== 'function') {
      return { history: [], total: 0 };
    }

    let query = supabase
      .from('import_history')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.sourceSite) {
      query = query.eq('source_site', options.sourceSite);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      if (error.message.includes('non configuré') || error.message.includes('does not exist')) {
        return { history: [], total: 0 };
      }
      throw new Error(`Erreur récupération historique: ${error.message}`);
    }

    return {
      history: (data || []) as ImportHistory[],
      total: count || 0,
    };
  } catch (error: any) {
    // En cas d'erreur, retourner un historique vide
    console.warn(`⚠️  Erreur récupération historique: ${error.message}`);
    return { history: [], total: 0 };
  }
}

/**
 * Récupérer les statistiques d'import
 */
export async function getImportStats(): Promise<{
  total: number;
  success: number;
  failed: number;
  totalValue: number;
  avgMargin: number;
  bySite: Record<string, number>;
  byCategory: Record<string, number>;
}> {
  try {
    const { history } = await getImportHistory({ limit: 1000 });

    const stats = {
      total: history.length,
      success: history.filter(h => h.status === 'success').length,
      failed: history.filter(h => h.status === 'failed').length,
      totalValue: history.reduce((sum, h) => sum + h.final_price, 0),
      avgMargin: history.length > 0
        ? history.reduce((sum, h) => sum + h.margin, 0) / history.length
        : 0,
      bySite: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
    };

    // Compter par site
    history.forEach(h => {
      stats.bySite[h.source_site] = (stats.bySite[h.source_site] || 0) + 1;
    });

    // Compter par catégorie
    history.forEach(h => {
      if (h.category) {
        stats.byCategory[h.category] = (stats.byCategory[h.category] || 0) + 1;
      }
    });

    return stats;
  } catch (error: any) {
    // En cas d'erreur, retourner des stats vides
    return {
      total: 0,
      success: 0,
      failed: 0,
      totalValue: 0,
      avgMargin: 0,
      bySite: {},
      byCategory: {},
    };
  }
}

/**
 * Vérifier si une URL a déjà été importée
 */
export async function checkUrlAlreadyImported(url: string): Promise<{
  imported: boolean;
  productId?: string;
  importDate?: string;
}> {
  try {
    const { history } = await getImportHistory({ limit: 1000 });
    const existing = history.find(h => h.url === url && h.status === 'success');

    if (existing) {
      return {
        imported: true,
        productId: existing.product_id || undefined,
        importDate: existing.created_at,
      };
    }

    return { imported: false };
  } catch {
    return { imported: false };
  }
}









