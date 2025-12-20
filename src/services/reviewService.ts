/**
 * Service de gestion des avis clients
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export interface Review {
  id: string;
  productId: string;
  userId: string;
  rating: number; // 1-5
  title: string;
  comment: string;
  verified: boolean; // Achat vérifié
  helpful: number; // Nombre de "utile"
  createdAt: string;
  user?: {
    name: string;
    email: string;
  };
}

export interface ReviewInput {
  productId: string;
  userId: string;
  rating: number;
  title: string;
  comment: string;
}

/**
 * Créer un avis
 */
export async function createReview(input: ReviewInput): Promise<Review> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    // Vérifier que l'utilisateur a acheté le produit (pour verified)
    const { data: order } = await supabase
      .from('order_items')
      .select('order_id, orders!inner(user_id)')
      .eq('product_id', input.productId)
      .eq('orders.user_id', input.userId)
      .limit(1)
      .single();

    const verified = !!order;

    const { data, error } = await supabase
      .from('reviews')
      .insert({
        product_id: input.productId,
        user_id: input.userId,
        rating: Math.max(1, Math.min(5, input.rating)),
        title: input.title,
        comment: input.comment,
        verified,
        helpful: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Review;
  } catch (error: any) {
    logger.error('Erreur création avis', error, { productId: input.productId });
    throw error;
  }
}

/**
 * Récupérer les avis d'un produit
 */
export async function getProductReviews(
  productId: string,
  limit: number = 10,
  offset: number = 0
): Promise<{ reviews: Review[]; total: number; averageRating: number }> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return { reviews: [], total: 0, averageRating: 0 };
    }

    const { data, error } = await supabase
      .from('reviews')
      .select('*, users(name, email)', { count: 'exact' })
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const reviews = (data || []) as Review[];
    const total = (data as any)?._count || reviews.length;

    // Calculer moyenne
    const averageRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    return { reviews, total, averageRating };
  } catch (error: any) {
    logger.error('Erreur récupération avis', error, { productId });
    return { reviews: [], total: 0, averageRating: 0 };
  }
}

/**
 * Marquer un avis comme utile
 */
export async function markReviewAsHelpful(reviewId: string): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return;
    }

    await supabase.rpc('increment_review_helpful', { review_id: reviewId });
  } catch (error: any) {
    logger.warn('Erreur marquage avis utile', { reviewId, error: error.message });
  }
}

/**
 * Récupérer les statistiques d'avis d'un produit
 */
export async function getProductReviewStats(productId: string): Promise<{
  averageRating: number;
  totalReviews: number;
  ratingDistribution: Record<number, number>;
}> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return {
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: {},
      };
    }

    const { data, error } = await supabase
      .from('reviews')
      .select('rating')
      .eq('product_id', productId);

    if (error) throw error;

    const reviews = (data || []) as Array<{ rating: number }>;
    const totalReviews = reviews.length;

    if (totalReviews === 0) {
      return {
        averageRating: 0,
        totalReviews: 0,
        ratingDistribution: {},
      };
    }

    const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((r) => {
      ratingDistribution[r.rating] = (ratingDistribution[r.rating] || 0) + 1;
    });

    return {
      averageRating: Math.round(averageRating * 10) / 10,
      totalReviews,
      ratingDistribution,
    };
  } catch (error: any) {
    logger.error('Erreur stats avis', error, { productId });
    return {
      averageRating: 0,
      totalReviews: 0,
      ratingDistribution: {},
    };
  }
}









