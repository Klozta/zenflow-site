/**
 * Service de recommandations produits (IA simple basée sur similarité)
 * Amélioré avec algorithme basé sur l'historique d'achat réel
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { getProductById, getProducts } from './productsService.js';

export interface ProductRecommendation {
  productId: string;
  score: number;
  reason: string;
}

/**
 * Recommande des produits similaires basés sur la catégorie, tags, prix
 */
export async function getProductRecommendations(
  productId: string,
  limit: number = 4
): Promise<ProductRecommendation[]> {
  try {
    // Récupérer le produit actuel
    const allProducts = await getProducts({ limit: 1000 });
    const currentProduct = allProducts.products.find((p: any) => p.id === productId);

    if (!currentProduct) {
      return [];
    }

    // Calculer similarité avec autres produits
    const recommendations = allProducts.products
      .filter((p: any) => p.id !== productId && p.stock > 0)
      .map((product: any) => {
        let score = 0;
        const reasons: string[] = [];

        // Même catégorie (+30 points)
        if (product.category === currentProduct.category) {
          score += 30;
          reasons.push('Même catégorie');
        }

        // Tags communs (+10 points par tag)
        const currentTags = currentProduct.tags || [];
        const productTags = product.tags || [];
        const commonTags = currentTags.filter((tag: string) =>
          productTags.includes(tag)
        );
        score += commonTags.length * 10;
        if (commonTags.length > 0) {
          reasons.push(`${commonTags.length} tag(s) commun(s)`);
        }

        // Prix similaire (±20% = +20 points)
        const priceDiff = Math.abs(product.price - currentProduct.price) / currentProduct.price;
        if (priceDiff <= 0.2) {
          score += 20;
          reasons.push('Prix similaire');
        }

        // En stock (+10 points)
        if (product.stock > 0) {
          score += 10;
        }

        return {
          productId: product.id,
          score,
          reason: reasons.join(', ') || 'Produit similaire',
          product,
        };
      })
      .filter((rec: any) => rec.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit)
      .map((rec: any) => ({
        productId: rec.productId,
        score: rec.score,
        reason: rec.reason,
      }));

    return recommendations;
  } catch (error: any) {
    logger.error('Erreur recommandations produits', error, { productId });
    return [];
  }
}

/**
 * Recommande des produits basés sur l'historique utilisateur
 * Algorithme amélioré avec prix moyen, produits complémentaires, récurrence
 */
export async function getPersonalizedRecommendations(
  userId: string,
  limit: number = 6
): Promise<ProductRecommendation[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      // Fallback si Supabase non configuré
      const products = await getProducts({ limit });
      return products.products.map((product: any) => ({
        productId: product.id,
        score: 50,
        reason: 'Produit populaire',
      }));
    }

    // 1. Récupérer l'historique des commandes de l'utilisateur (toutes les commandes, pas seulement confirmed)
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, status, created_at')
      .eq('user_id', userId)
      .in('status', ['confirmed', 'shipped', 'delivered']) // Commandes validées
      .order('created_at', { ascending: false })
      .limit(100); // Limiter pour performance

    if (ordersError || !orders || orders.length === 0) {
      // Pas d'historique : retourner produits populaires
      const products = await getProducts({ limit });
      return products.products.map((product: any) => ({
        productId: product.id,
        score: 30,
        reason: 'Produit populaire',
      }));
    }

    const orderIds = orders.map((o: { id: string }) => o.id);

    // 2. Récupérer les produits achetés par l'utilisateur avec quantités
    const { data: orderItemsRaw, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity, price')
      .in('order_id', orderIds);

    if (itemsError || !orderItemsRaw || orderItemsRaw.length === 0) {
      const products = await getProducts({ limit });
      return products.products.map((product: any) => ({
        productId: product.id,
        score: 30,
        reason: 'Produit populaire',
      }));
    }

    // Mapper les données Supabase (snake_case) vers le format attendu
    const orderItems = orderItemsRaw.map((item: { product_id: string; quantity: number; price: number }) => ({
      productId: item.product_id,
      quantity: item.quantity,
      price: item.price,
    }));

    // 3. Compter les achats par catégorie, tags, et calculer prix moyen
    const purchasedProductIds = new Set(orderItems.map((item: { productId: string }) => item.productId));
    const categoryCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    const productFrequency: Record<string, number> = {}; // Nombre de fois qu'un produit a été acheté

    let totalSpent = 0;
    let totalItems = 0;
    const purchasedProductsMap = new Map<string, any>(); // Stocker les produits chargés

    for (const item of orderItems) {
      const product = await getProductById(item.productId);
      if (!product) continue;

      // Stocker le produit pour utilisation ultérieure
      purchasedProductsMap.set(item.productId, product);

      // Compter fréquence d'achat
      productFrequency[item.productId] = (productFrequency[item.productId] || 0) + item.quantity;

      // Compter catégories (pondéré par quantité)
      if (product.category) {
        categoryCounts[product.category] = (categoryCounts[product.category] || 0) + item.quantity;
      }

      // Compter tags (pondéré par quantité)
      if (product.tags && Array.isArray(product.tags)) {
        for (const tag of product.tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + item.quantity;
        }
      }

      // Calculer prix moyen
      totalSpent += item.price * item.quantity;
      totalItems += item.quantity;
    }

    // 4. Trouver les catégories et tags préférés (top 3 catégories, top 5 tags)
    const topCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    // 5. Calculer le prix moyen des achats
    const averagePrice = totalItems > 0 ? totalSpent / totalItems : 0;

    // 6. Trouver les produits les plus achetés (pour recommandations complémentaires)
    const topPurchasedProducts = Object.entries(productFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([productId]) => productId);

    // 6.5. Précharger les catégories des produits les plus achetés
    const topProductsCategories = new Set<string>();
    for (const topProductId of topPurchasedProducts) {
      const topProduct = purchasedProductsMap.get(topProductId);
      if (topProduct?.category) {
        topProductsCategories.add(topProduct.category);
      }
    }

    // 7. Recommander des produits similaires (pas déjà achetés)
    const allProducts = await getProducts({ limit: 200 });
    const recommendations = allProducts.products
      .filter((p: any) => !purchasedProductIds.has(p.id) && p.stock > 0) // Exclure produits achetés et hors stock
      .map((product: any) => {
        let score = 0;
        const reasons: string[] = [];

        // Catégorie préférée (+50 points, plus important)
        if (product.category && topCategories.includes(product.category)) {
          score += 50;
          reasons.push('Catégorie que vous aimez');
        }

        // Tags préférés (+20 points par tag, plus important)
        if (product.tags && Array.isArray(product.tags)) {
          const commonTags = product.tags.filter((tag: string) => topTags.includes(tag));
          score += commonTags.length * 20;
          if (commonTags.length > 0) {
            reasons.push(`${commonTags.length} tag(s) que vous aimez`);
          }
        }

        // Prix similaire au prix moyen d'achat (±30% = +30 points)
        if (averagePrice > 0) {
          const priceDiff = Math.abs(product.price - averagePrice) / averagePrice;
          if (priceDiff <= 0.3) {
            score += 30;
            reasons.push('Prix similaire à vos achats');
          }
        }

        // Produits complémentaires : même catégorie mais différents tags (+25 points)
        if (product.category && topCategories.includes(product.category)) {
          const hasNewTags = product.tags && Array.isArray(product.tags) &&
            product.tags.some((tag: string) => !topTags.includes(tag));
          if (hasNewTags) {
            score += 25;
            reasons.push('Nouveau style dans votre catégorie préférée');
          }
        }

        // Produits complémentaires aux produits les plus achetés (+15 points)
        // (même catégorie que produits fréquemment achetés)
        if (product.category && topProductsCategories.has(product.category)) {
          score += 15;
          reasons.push('Complémentaire à vos achats fréquents');
        }

        // En stock (+10 points)
        if (product.stock > 0) {
          score += 10;
        }

        // Bonus pour produits récents (+5 points si créé dans les 30 derniers jours)
        if (product.created_at) {
          const daysSinceCreation = (Date.now() - new Date(product.created_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceCreation <= 30) {
            score += 5;
          }
        }

        return {
          productId: product.id,
          score,
          reason: reasons.join(', ') || 'Basé sur vos achats',
          product,
        };
      })
      .filter((rec: any) => rec.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit)
      .map((rec: any) => ({
        productId: rec.productId,
        score: rec.score,
        reason: rec.reason,
      }));

    return recommendations.length > 0
      ? recommendations
      : (await getProducts({ limit })).products.map((product: any) => ({
          productId: product.id,
          score: 30,
          reason: 'Produit populaire',
        }));
  } catch (error: any) {
    logger.error('Erreur recommandations personnalisées', error, { userId });
    // Fallback
    const products = await getProducts({ limit });
    return products.products.map((product: any) => ({
      productId: product.id,
      score: 30,
      reason: 'Produit populaire',
    }));
  }
}
