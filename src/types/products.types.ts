// backend/src/types/products.types.ts
export interface Product {
  id: string;
  title: string;
  description: string | null;
  price: number;
  category: string | null;
  stock: number;
  images: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

export interface ProductInput {
  title: string;
  description?: string;
  price: number;
  category?: string;
  stock: number;
  images?: string[];
  tags?: string[];
}

export interface UpdateProductInput {
  title?: string;
  description?: string;
  price?: number;
  category?: string;
  stock?: number;
  images?: string[];
  tags?: string[];
  is_draft?: boolean; // Support pour champ draft si ajouté à la DB
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FilterProductsInput {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[]; // Filtre par tags (multi-sélection)
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'any'; // Filtre par disponibilité
  sort?: 'price_asc' | 'price_desc' | 'created_at_desc' | 'stock_asc';
  includeDrafts?: boolean; // Si true, inclut les produits en draft (admin uniquement)
}

export interface SearchProductsInput {
  q: string;
  page?: number;
  limit?: number;
}
