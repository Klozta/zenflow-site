/**
 * Service de queue pour produits en attente de validation
 */
import { supabase } from '../config/supabase.js';
import type { Product } from '../types/products.types.js';
import { logger } from '../utils/logger.js';
import { analyzeAliExpressProduct } from './aliexpressSearchService.js';
import { upsertProductSpecifications } from './productSpecsService.js';
import { createProduct } from './productsService.js';
// Import analyzePrice function
async function analyzePrice(originalPrice: number, category?: string): Promise<{ suggestedPrice: number; margin: number }> {
  // Marges par catégorie (en pourcentage)
  const margins: Record<string, number> = {
    'Imprimante 3D': 30,
    'Bijoux': 150,
    'Accessoires': 100,
    'Décoration': 80,
    'Textile': 70,
    'Cosmétique': 120,
    'Maison': 90,
    'Mode': 100,
    'Noël': 100,
    'Autre': 80,
  };

  const marginPercent = category ? margins[category] || 80 : 80;
  const margin = (originalPrice * marginPercent) / 100;
  const suggestedPrice = Math.round((originalPrice + margin) * 100) / 100;

  return {
    suggestedPrice,
    margin: marginPercent,
  };
}

export interface PendingProduct {
  id: string;
  source: 'aliexpress' | 'image' | 'manual';
  sourceUrl?: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: string;
  tags: string[];
  images: string[];
  specifications: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedAt?: string;
  rejectedReason?: string;
}

export interface PendingProductInput {
  source: 'aliexpress' | 'image' | 'manual';
  sourceUrl?: string;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: string;
  tags: string[];
  images: string[];
  specifications: Record<string, string>;
}

/**
 * Ajouter un produit en attente de validation
 */
export async function addPendingProduct(input: PendingProductInput): Promise<PendingProduct> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    const { data, error } = await supabase
      .from('pending_products')
      .insert({
        source: input.source,
        source_url: input.sourceUrl || null,
        title: input.title,
        description: input.description,
        price: input.price,
        original_price: input.originalPrice || null,
        category: input.category,
        tags: input.tags,
        images: input.images,
        specifications: input.specifications,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return mapToPendingProduct(data);
  } catch (error: unknown) {
    logger.error('Erreur ajout produit en attente', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Rechercher et créer automatiquement des produits depuis AliExpress
 */
export async function autoSearchAndQueueAliExpressProducts(
  query: string,
  options?: {
    maxResults?: number;
    minRating?: number;
    maxPrice?: number;
    category?: string;
  }
): Promise<{
  queued: number;
  pendingProducts: PendingProduct[];
}> {
  try {
    // Utiliser recherche intelligente pour femmes 20-45 ans
    const { searchWomenProducts } = await import('./womenProductsSearchService.js');

    const searchResult = await searchWomenProducts(query, {
      maxResults: options?.maxResults || 5,
      minRating: options?.minRating,
      maxPrice: options?.maxPrice,
    });

    const searchResults = searchResult.results;

    // Logger si recherche remplacée
    if (searchResult.replaced) {
      logger.info('Recherche intelligente utilisée', {
        original: searchResult.originalQuery,
        smart: searchResult.smartQuery,
        resultsCount: searchResults.length,
      });
    }

    // Si aucun résultat, logger plus de détails pour diagnostic
    if (searchResults.length === 0) {
      logger.warn('Aucun produit trouvé pour la recherche', {
        query,
        originalQuery: searchResult.originalQuery,
        smartQuery: searchResult.smartQuery,
        replaced: searchResult.replaced,
        suggestion: 'Vérifier si AliExpress bloque les requêtes ou si la structure HTML a changé',
      });

      // Retourner avec message informatif plutôt qu'erreur
      return {
        queued: 0,
        pendingProducts: [],
      };
    }

    logger.info('Produits trouvés pour la recherche', {
      query,
      resultsCount: searchResults.length,
      firstProductTitle: searchResults[0]?.title?.substring(0, 50),
    });

    const pendingProducts: PendingProduct[] = [];
    const maxResults = options?.maxResults || 5;

    // Analyser chaque produit et créer une entrée en attente
    for (const result of searchResults.slice(0, maxResults)) {
      try {
        // Analyser le produit en détail
        const analysis = await analyzeAliExpressProduct(result.url);

        // Calculer prix suggéré
        const priceAnalysis = await analyzePrice(analysis.price, analysis.category);

        // Créer produit en attente
        const pending = await addPendingProduct({
          source: 'aliexpress',
          sourceUrl: result.url,
          title: analysis.title || result.title,
          description: analysis.description || `Produit ${result.title} de qualité.`,
          price: priceAnalysis.suggestedPrice,
          originalPrice: analysis.price,
          category: analysis.category || options?.category || 'Autre',
          tags: generateTagsFromTitle(analysis.title || result.title),
          images: analysis.images.length > 0 ? analysis.images : [result.image],
          specifications: analysis.specifications,
        });

        pendingProducts.push(pending);
      } catch (error: unknown) {
        logger.warn('Erreur analyse produit AliExpress', {
          url: result.url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return {
      queued: pendingProducts.length,
      pendingProducts,
    };
  } catch (error: unknown) {
    logger.error('Erreur recherche auto AliExpress', error instanceof Error ? error : new Error(String(error)), {
      query,
    });
    throw error;
  }
}

/**
 * Récupérer les produits en attente
 */
export async function getPendingProducts(
  status?: 'pending' | 'approved' | 'rejected',
  limit: number = 50
): Promise<PendingProduct[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return [];
    }

    let query = supabase
      .from('pending_products')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []).map(mapToPendingProduct);
  } catch (error: unknown) {
    logger.error('Erreur récupération produits en attente', error instanceof Error ? error : new Error(String(error)));
    return [];
  }
}

/**
 * Approuver un produit (le créer)
 */
export async function approvePendingProduct(
  pendingId: string,
  customData?: {
    price?: number;
    stock?: number;
    category?: string;
  }
): Promise<{ product: Product; pending: PendingProduct }> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    // Récupérer le produit en attente
    const { data: pendingData, error: fetchError } = await supabase
      .from('pending_products')
      .select('*')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !pendingData) {
      throw new Error('Produit en attente non trouvé');
    }

    const pending = mapToPendingProduct(pendingData);

    // Créer le produit
    let product: Product;
    try {
      product = await createProduct({
        title: pending.title,
        description: pending.description,
        price: customData?.price || pending.price,
        category: customData?.category || pending.category,
        stock: customData?.stock || 0,
        images: pending.images,
        tags: pending.tags,
      });
      logger.info('Produit créé avec succès', { productId: product.id, title: product.title });
    } catch (createError: unknown) {
      logger.error('Erreur création produit', createError instanceof Error ? createError : new Error(String(createError)), {
        pendingId,
        pendingTitle: pending.title,
      });
      throw new Error(`Erreur lors de la création du produit: ${createError instanceof Error ? createError.message : String(createError)}`);
    }

    // Créer les spécifications si imprimante 3D
    if (pending.category === 'Imprimante 3D' && Object.keys(pending.specifications).length > 0) {
      try {
        const specs = Object.entries(pending.specifications).map(([key, value], index) => ({
          key,
          value: String(value),
          category: '3d-printer',
          displayOrder: index,
        }));
        await upsertProductSpecifications(product.id, specs);
      } catch (specError: unknown) {
        logger.warn('Erreur création specs', {
          productId: product.id,
          error: specError instanceof Error ? specError.message : String(specError),
        });
      }
    }

    // Marquer comme approuvé
    await supabase
      .from('pending_products')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', pendingId);

    logger.info('Produit approuvé et créé', { pendingId, productId: product.id });

    return { product, pending };
  } catch (error: unknown) {
    logger.error('Erreur approbation produit', error instanceof Error ? error : new Error(String(error)), {
      pendingId,
    });
    throw error;
  }
}

/**
 * Rejeter un produit
 */
export async function rejectPendingProduct(
  pendingId: string,
  reason?: string
): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    await supabase
      .from('pending_products')
      .update({
        status: 'rejected',
        rejected_reason: reason || null,
      })
      .eq('id', pendingId);

    logger.info('Produit rejeté', { pendingId, reason });
  } catch (error: unknown) {
    logger.error('Erreur rejet produit', error instanceof Error ? error : new Error(String(error)), {
      pendingId,
    });
    throw error;
  }
}

// Helpers
interface PendingProductData {
  id: string;
  source: 'aliexpress' | 'image' | 'manual';
  source_url?: string | null;
  title: string;
  description: string;
  price: string | number;
  original_price?: string | number | null;
  category: string;
  tags?: string[];
  images?: string[];
  specifications?: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  approved_at?: string | null;
  rejected_reason?: string | null;
}

function mapToPendingProduct(data: PendingProductData): PendingProduct {
  return {
    id: data.id,
    source: data.source,
    sourceUrl: data.source_url || undefined,
    title: data.title,
    description: data.description,
    price: typeof data.price === 'string' ? parseFloat(data.price) : data.price,
    originalPrice: data.original_price
      ? (typeof data.original_price === 'string' ? parseFloat(data.original_price) : data.original_price)
      : undefined,
    category: data.category,
    tags: data.tags || [],
    images: data.images || [],
    specifications: data.specifications || {},
    status: data.status,
    createdAt: data.created_at,
    approvedAt: data.approved_at || undefined,
    rejectedReason: data.rejected_reason || undefined,
  };
}

function generateTagsFromTitle(title: string): string[] {
  const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return [...new Set(words)].slice(0, 5);
}

// Fonction non utilisée - commentée
// function generateDescriptionFromTitle(title: string): string {
//   return `${title} de qualité professionnelle. Produit soigneusement sélectionné pour vous offrir le meilleur rapport qualité-prix.`;
// }
