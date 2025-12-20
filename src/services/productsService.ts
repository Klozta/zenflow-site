// backend/src/services/productsService.ts
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import {
    FilterProductsInput,
    Pagination,
    Product,
    ProductInput,
    SearchProductsInput,
    UpdateProductInput
} from '../types/products.types.js';
import {
    deleteCache,
    deleteCachePattern,
    getCache,
    setCache
} from '../utils/cache.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isNetworkError, retry } from '../utils/retry.js';
import { validateProductData } from '../validations/productSchemas.js';

function isSupabaseRetryable(error: unknown): boolean {
  if (!error) return false;

  // Ne jamais retry si Supabase n'est pas configuré (mock)
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.toLowerCase().includes('supabase non configur')) return false;

  // Erreurs réseau/timeout
  if (isNetworkError(error)) return true;

  // Codes Postgres / Supabase parfois temporaires (RLS/timeout côté DB, etc.)
  const code = (error as { code?: string })?.code;
  if (!code) return false;

  // 57P01/57P02: admin shutdown/crash, 53300: too many connections
  // P0001: raise exception côté DB, parfois utilisé pour timeouts/guardrails
  // 42501: insufficient_privilege (souvent RLS) -> pas toujours transient, mais peut l'être si token/session change
  return ['57P01', '57P02', '53300', 'P0001', '42501'].includes(code);
}

function hashObject(obj: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Get products list with filters and pagination
 */
export async function getProducts(filters: FilterProductsInput): Promise<{ products: Product[]; pagination: Pagination }> {
  const cacheKey = `products:list:${hashObject(filters)}`;
  const cached = await getCache<{ products: Product[]; pagination: Pagination }>(cacheKey);

  if (cached) {
    return cached;
  }

  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  // Optimisation: Sélectionner uniquement les colonnes nécessaires
  const selectFields = 'id,title,price,original_price,description,images,category,stock,rating,created_at,tags';

  let query = supabase
    .from('products')
    .select(selectFields, { count: 'exact' })
    .eq('is_deleted', false);

  // Exclure les produits draft par défaut (sauf si includeDrafts=true)
  // Note: Supabase ne supporte pas directement .not() pour les arrays
  // On filtre après récupération des données

  // Filters
  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.minPrice !== undefined) {
    query = query.gte('price', filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice);
  }
  
  // Filtre par disponibilité (stock)
  if (filters.stockStatus && filters.stockStatus !== 'any') {
    switch (filters.stockStatus) {
      case 'in_stock':
        query = query.gt('stock', 5); // Stock > 5
        break;
      case 'low_stock':
        query = query.gte('stock', 1).lte('stock', 5); // Stock entre 1 et 5
        break;
      case 'out_of_stock':
        query = query.eq('stock', 0); // Stock = 0
        break;
    }
  }

  // Sorting - utiliser des index DB pour meilleure performance
  switch (filters.sort) {
    case 'price_asc':
      query = query.order('price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      break;
    case 'stock_asc':
      query = query.order('stock', { ascending: true });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    logger.error('Database error in filterProducts', new Error(error.message), { filters });
    throw createError.database(`Erreur lors de la récupération des produits: ${error.message}`, new Error(error.message));
  }

  let products = (data || []) as Product[];

  // Filtrer par tags (multi-sélection) - doit contenir au moins un des tags sélectionnés
  if (filters.tags && filters.tags.length > 0) {
    products = products.filter(product => {
      if (!product.tags || product.tags.length === 0) return false;
      // Vérifier si le produit contient au moins un des tags demandés
      return filters.tags!.some(tag => product.tags!.includes(tag));
    });
  }

  // Filtrer les produits draft si includeDrafts n'est pas activé (fallback si filtre DB échoue)
  if (!filters.includeDrafts) {
    products = products.filter(product => !product.tags?.includes('draft'));
    // Note: count de Supabase devrait déjà être correct si le filtre DB fonctionne
  }

  // Utiliser le count de Supabase si disponible, sinon calculer
  const total = count !== null ? count : products.length;
  const totalPages = Math.ceil(total / limit);

  const result = {
    products,
    pagination: { page, limit, total, totalPages }
  };

  // Cache avec TTL adaptatif selon le type de requête
  // Les listes de produits changent moins souvent que les détails
  const cacheTTL = filters.category ? 600 : 300; // 10min pour catégories, 5min pour tout
  await setCache(cacheKey, result, cacheTTL);
  return result;
}

/**
 * Full-text search products
 */
export async function searchProducts({ q, ...pagination }: SearchProductsInput): Promise<{ products: Product[]; query: string; pagination: Pagination }> {
  // Normaliser la requête de recherche pour sécurité
  const { normalizeSearchQuery } = await import('../utils/validationHelpers.js');
  const normalizedQuery = normalizeSearchQuery(q);

  if (!normalizedQuery) {
    return {
      products: [],
      query: q,
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
  }

  const cacheKey = `products:search:${normalizedQuery}:${hashObject(pagination)}`;
  const cached = await getCache<{ products: Product[]; query: string; pagination: Pagination }>(cacheKey);

  if (cached) {
    return cached;
  }

  const page = Math.max(1, pagination.page || 1);
  const limit = Math.min(100, Math.max(1, pagination.limit || 20));
  // const offset = (page - 1) * limit; // Non utilisé - géré par RPC

  // Full-text search avec tsvector (utiliser la requête normalisée)
  const { data, error } = await supabase
    .rpc('search_products', {
      query_text: normalizedQuery,
      page_num: page,
      page_size: limit
    });

  if (error) {
    logger.error('Search error in searchProducts', new Error(error.message), { query: normalizedQuery });
    throw createError.database(`Erreur lors de la recherche: ${error.message}`, new Error(error.message));
  }

  let products = (data || []) as Product[];

  // Filtrer les produits draft (les recherches publiques ne doivent pas inclure les drafts)
  // Note: Si vous voulez permettre la recherche de drafts en admin, ajoutez un paramètre
  products = products.filter(product => !product.tags?.includes('draft'));

  const total = products.length;
  const totalPages = Math.ceil(total / limit);

  const result = {
    products,
    query: q,
    pagination: { page, limit, total, totalPages }
  };

  await setCache(cacheKey, result, 300); // 5min
  return result;
}

/**
 * Get single product by ID
 */
export async function getProductById(id: string): Promise<Product | null> {
  const cacheKey = `products:detail:${id}`;
  const cached = await getCache<Product>(cacheKey);

  if (cached) {
    return cached;
  }

  // Optimisation: Sélectionner uniquement les colonnes nécessaires
  const selectFields = 'id,title,price,original_price,description,images,category,stock,rating,created_at,updated_at,tags,specifications';

  const { data, error } = await supabase
    .from('products')
    .select(selectFields)
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const product = data as Product;
  await setCache(cacheKey, product, 600); // 10min
  return product;
}

/**
 * Create new product
 */
export async function createProduct(data: ProductInput): Promise<Product> {
  // Validation Zod AVANT nettoyage (Recommandation Perplexity)
  let validatedData;
  try {
    // Préparer les données pour validation Zod
    const dataForValidation = {
      title: data.title || '',
      description: data.description || null,
      price: typeof data.price === 'number' ? data.price : (typeof data.price === 'string' ? parseFloat(data.price) : 19.99),
      category: data.category || 'Autre',
      stock: typeof data.stock === 'number' ? data.stock : (typeof data.stock === 'string' ? parseInt(data.stock, 10) : 0),
      // Cast explicite arrays string[] pour PostgreSQL (Recommandation Perplexity)
      images: Array.isArray(data.images)
        ? data.images.filter((img: any) => typeof img === 'string' && img.length > 0 && (img.startsWith('http://') || img.startsWith('https://')))
        : [],
      tags: Array.isArray(data.tags)
        ? data.tags.filter((tag: any) => typeof tag === 'string' && tag.length > 0 && tag.length <= 50).slice(0, 20)
        : [],
    };

    validatedData = validateProductData(dataForValidation);
  } catch (validationError: any) {
    logger.error('Validation Zod échouée', validationError instanceof Error ? validationError : new Error(String(validationError)), {
      originalData: {
        title: data.title,
        price: data.price,
        category: data.category,
        hasDescription: !!data.description,
        imagesCount: Array.isArray(data.images) ? data.images.length : 0,
        tagsCount: Array.isArray(data.tags) ? data.tags.length : 0,
      },
    });
    throw createError.validation(validationError.message || 'Données invalides');
  }

  // Nettoyage final avec données validées
  const cleanedData: any = {
    title: validatedData.title,
    description: validatedData.description || null,
    price: Number(validatedData.price.toFixed(2)), // Cast explicite number
    category: validatedData.category,
    stock: Math.floor(validatedData.stock), // Cast explicite int
    // Arrays PostgreSQL : string[] explicites (Recommandation Perplexity)
    images: validatedData.images as string[],
    tags: validatedData.tags as string[],
  };

  // Validation finale avec messages clairs
  if (!cleanedData.title || cleanedData.title.length < 3) {
    logger.warn('Validation échouée: titre trop court', {
      title: cleanedData.title,
      length: cleanedData.title?.length || 0
    });
    throw createError.validation(`Le titre doit contenir au moins 3 caractères (reçu: "${cleanedData.title}" - ${cleanedData.title?.length || 0} caractères)`);
  }

  if (cleanedData.price <= 0 || cleanedData.price > 999999.99) {
    logger.warn('Validation échouée: prix invalide', { price: cleanedData.price });
    throw createError.validation(`Le prix doit être entre 0.01 et 999999.99€ (reçu: ${cleanedData.price}€)`);
  }

  // Validation description (optionnelle mais si présente, doit être valide)
  if (cleanedData.description && cleanedData.description.length > 5000) {
    logger.warn('Description trop longue, tronquée', {
      originalLength: cleanedData.description.length
    });
    cleanedData.description = cleanedData.description.substring(0, 4997) + '...';
  }

  // S'assurer que la description fait au moins 20 mots si elle existe (évite descriptions trop courtes)
  if (cleanedData.description && cleanedData.description.trim().split(/\s+/).length < 20) {
    logger.warn('Description trop courte, génération d\'une description plus détaillée', {
      originalLength: cleanedData.description.trim().split(/\s+/).length,
      originalDescription: cleanedData.description.substring(0, 100),
    });
    // Générer une description plus détaillée en ajoutant des informations
    const category = cleanedData.category || 'produit';
    const additionalInfo = `Ce ${category.toLowerCase()} allie qualité et design pour répondre à vos besoins. La fabrication soignée garantit une longue durée de vie et une satisfaction optimale. Idéal pour compléter votre collection et exprimer votre personnalité unique.`;
    cleanedData.description = cleanedData.description + ' ' + additionalInfo;
  }

  // Logger JSON.stringify pour diagnostic complet (Recommandation Perplexity)
  logger.info('Tentative création produit', {
    cleanedDataJSON: JSON.stringify(cleanedData, null, 2), // JSON complet pour diagnostic
    cleanedData: {
      title: cleanedData.title,
      titleLength: cleanedData.title?.length || 0,
      price: cleanedData.price,
      priceType: typeof cleanedData.price,
      category: cleanedData.category,
      stock: cleanedData.stock,
      stockType: typeof cleanedData.stock,
      hasDescription: !!cleanedData.description,
      descriptionLength: cleanedData.description?.length || 0,
      imagesCount: cleanedData.images?.length || 0,
      imagesType: Array.isArray(cleanedData.images),
      imagesIsStringArray: cleanedData.images.every((img: any) => typeof img === 'string'),
      tagsCount: cleanedData.tags?.length || 0,
      tagsType: Array.isArray(cleanedData.tags),
      tagsIsStringArray: cleanedData.tags.every((tag: any) => typeof tag === 'string'),
    },
  });

  // Retry Supabase avec backoff exponentiel (Recommandation Perplexity)
  const { data: product, error } = await retry(
    async () => {
      const res = await supabase
        .from('products')
        .insert(cleanedData)
        .select()
        .single();

      // Supabase renvoie { error } sans throw : on throw pour déclencher le retry
      if (res.error) {
        throw res.error;
      }
      return res;
    },
    {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 4000,
      backoffMultiplier: 2,
      retryable: (err) => {
        const ok = isSupabaseRetryable(err);
        if (ok) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('Retry Supabase createProduct', { message: msg });
        }
        return ok;
      },
    }
  );

  if (error) {
    // Logging amélioré avec JSON.stringify et error.code/details (Recommandation Perplexity)
    logger.error('Failed to create product', new Error(error.message), {
      cleanedDataJSON: JSON.stringify(cleanedData, null, 2), // JSON complet
      cleanedData: {
        title: cleanedData.title,
        price: cleanedData.price,
        priceType: typeof cleanedData.price,
        category: cleanedData.category,
        stock: cleanedData.stock,
        stockType: typeof cleanedData.stock,
        hasDescription: !!cleanedData.description,
        descriptionLength: cleanedData.description?.length || 0,
        imagesCount: cleanedData.images?.length || 0,
        imagesType: Array.isArray(cleanedData.images),
        imagesSample: cleanedData.images.slice(0, 2),
        tagsCount: cleanedData.tags?.length || 0,
        tagsType: Array.isArray(cleanedData.tags),
        tagsSample: cleanedData.tags.slice(0, 5),
      },
      originalData: {
        title: data.title,
        price: data.price,
        category: data.category,
      },
      errorCode: error.code, // Code PostgreSQL (23505, 23502, 22P02, etc.)
      errorMessage: error.message,
      errorDetails: error.details, // Détails Supabase
      errorHint: error.hint, // Hint Supabase si disponible
    });

    // Message d'erreur plus spécifique selon le type d'erreur
    let userMessage = `Erreur lors de l'enregistrement en base de données: ${error.message}`;
    if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
      userMessage = 'Un produit avec ce titre existe déjà. Veuillez modifier le titre et réessayer.';
    } else if (error.code === '23503' || error.message?.includes('foreign key')) {
      userMessage = 'Erreur de référence. Vérifiez que la catégorie existe.';
    } else if (error.code === '23502' || error.message?.includes('not null')) {
      userMessage = 'Des champs obligatoires sont manquants. Vérifiez le titre, le prix et la catégorie.';
    } else if (error.code === '22P02' || error.message?.includes('invalid input') || error.message?.includes('syntax')) {
      userMessage = 'Format de données invalide. Vérifiez que le prix est un nombre valide.';
    } else if (error.message?.includes('connection') || error.message?.includes('timeout')) {
      userMessage = 'Erreur de connexion à la base de données. Vérifiez que Supabase est configuré correctement.';
    } else if (error.hint) {
      userMessage = `Erreur base de données: ${error.message}. Indice: ${error.hint}`;
    }

    throw createError.database(userMessage, new Error(error.message));
  }

  // Invalidate all products cache
  await deleteCachePattern('products:*');

  return product as Product;
}

/**
 * Update existing product
 */
export async function updateProduct(id: string, data: UpdateProductInput): Promise<Product> {
  const { data: product, error } = await supabase
    .from('products')
    .update(data)
    .eq('id', id)
    .eq('is_deleted', false)
    .select()
    .single();

  if (error || !product) {
    logger.warn('Product not found or update failed', { id, error: error?.message });
    throw createError.notFound('Produit');
  }

  // Invalidate caches
  await deleteCache(`products:detail:${id}`);
  await deleteCachePattern('products:*');

  return product as Product;
}

/**
 * Soft delete product
 */
export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ is_deleted: true })
    .eq('id', id);

  if (error) {
    logger.warn('Product not found or delete failed', { id, error: error.message });
    throw createError.notFound('Produit');
  }

  // Invalidate caches
  await deleteCache(`products:detail:${id}`);
  await deleteCachePattern('products:*');
}
