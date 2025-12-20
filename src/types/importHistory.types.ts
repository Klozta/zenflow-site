/**
 * Types pour l'historique des imports
 */
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

export interface ImportStats {
  total: number;
  success: number;
  failed: number;
  totalValue: number;
  avgMargin: number;
  bySite: Record<string, number>;
  byCategory: Record<string, number>;
}









