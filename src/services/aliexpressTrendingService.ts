// 🚀 Service de produits trending/populaires AliExpress
// Récupère directement les produits les plus vendus/vus sans recherche par mot-clé

import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';

export interface TrendingProduct {
  productId: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  images?: string[];
  url: string;
  rating?: number;
  orders?: number; // Nombre de commandes
  views?: number; // Nombre de vues
  soldToday?: number; // Vendu aujourd'hui
  category?: string;
  description?: string;
  popularityScore?: number; // Score calculé (ventes + vues + visibilité)
}

export interface TrendingOptions {
  category?: 'crochet' | 'mode' | 'beauté' | 'décoration' | 'bijoux' | 'all';
  limit?: number;
  minOrders?: number; // Minimum de commandes pour filtrer
  sortBy?: 'popularity' | 'sales' | 'views' | 'recent';
}

// Catégories AliExpress adaptées au public féminin
const CATEGORY_MAPPING = {
  crochet: {
    aliCategory: 'Crocheting',
    keywords: ['crochet', 'knitting', 'yarn', 'needle'],
    url: 'https://www.aliexpress.com/category/200003482/crocheting.html'
  },
  mode: {
    aliCategory: 'Women\'s Clothing',
    keywords: ['women', 'fashion', 'dress', 'clothing'],
    url: 'https://www.aliexpress.com/category/100003109/women-clothing.html'
  },
  beauté: {
    aliCategory: 'Beauty & Personal Care',
    keywords: ['beauty', 'cosmetic', 'makeup', 'skincare'],
    url: 'https://www.aliexpress.com/category/100003109/beauty-personal-care.html'
  },
  décoration: {
    aliCategory: 'Home & Garden',
    keywords: ['home', 'decoration', 'decor', 'interior'],
    url: 'https://www.aliexpress.com/category/100003109/home-garden.html'
  },
  bijoux: {
    aliCategory: 'Jewelry & Accessories',
    keywords: ['jewelry', 'accessories', 'necklace', 'bracelet'],
    url: 'https://www.aliexpress.com/category/100003109/jewelry-accessories.html'
  }
};

/**
 * Récupérer les produits trending d'une catégorie AliExpress
 * Utilise les pages "Best Selling" ou "Hot Products"
 */
async function fetchTrendingFromCategory(
  category: keyof typeof CATEGORY_MAPPING,
  limit: number
): Promise<TrendingProduct[]> {
  try {
    const categoryConfig = CATEGORY_MAPPING[category];

    // URL pour produits les plus vendus (Best Selling)
    const trendingUrl = `${categoryConfig.url}?SortType=total_tranpro_desc&page=1`;

    logger.info('Récupération produits trending', { category, url: trendingUrl });

    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

    const html = await retryNetwork(() => axios.get(trendingUrl, {
      headers: {
        'User-Agent': randomUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.aliexpress.com/',
        'Connection': 'keep-alive',
      },
      timeout: 30000,
      maxRedirects: 5,
    }), {
      maxRetries: 3,
      initialDelay: 2000,
    });

    const $ = cheerio.load(html.data);
    const products: TrendingProduct[] = [];

    // Extraire depuis les data attributes ou JSON-LD
    // AliExpress utilise souvent des data attributes pour les produits
    const productSelectors = [
      '[data-widget-cid="search-result"]',
      '.list--gallery--C2f2tM1 .gallery-offer',
      '[data-product-id]',
      '.item-card',
      '.search-item-card-wrapper',
    ];

    for (const selector of productSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        logger.debug(`Sélecteur trouvé: ${selector}`, { count: elements.length });

        elements.slice(0, limit * 2).each((_index, element) => {
          try {
            const $el = $(element);

            // Extraire les données depuis les data attributes
            const productId = $el.attr('data-product-id') ||
                            $el.find('[data-product-id]').attr('data-product-id') ||
                            '';

            // Titre
            const title = $el.find('.item-title, .product-title, [data-title]').text().trim() ||
                         $el.attr('data-title') ||
                         $el.find('a').attr('title') ||
                         '';

            // Prix
            const priceText = $el.find('.price-current, .price, [data-price]').text().trim() ||
                            $el.attr('data-price') ||
                            '';
            const price = parsePrice(priceText);

            // Image
            const image = $el.find('img').attr('src') ||
                         $el.find('img').attr('data-src') ||
                         $el.attr('data-image') ||
                         '';

            // URL
            const url = $el.find('a').attr('href') ||
                      $el.attr('data-url') ||
                      '';
            const fullUrl = url.startsWith('http') ? url : `https://www.aliexpress.com${url}`;

            // Orders (commandes)
            const ordersText = $el.find('.order-num, [data-orders]').text().trim() ||
                             $el.attr('data-orders') ||
                             '';
            const orders = parseOrders(ordersText);

            // Rating
            const ratingText = $el.find('.rating-value, [data-rating]').text().trim() ||
                             $el.attr('data-rating') ||
                             '';
            const rating = parseFloat(ratingText) || undefined;

            if (productId && title && price > 0 && image) {
              // Calculer score de popularité
              const popularityScore = calculatePopularityScore({
                orders: orders || 0,
                rating: rating || 0,
                price
              });

              products.push({
                productId,
                title: title.substring(0, 200), // Limiter la longueur
                price,
                image: image.startsWith('http') ? image : `https:${image}`,
                url: fullUrl,
                orders,
                rating,
                category: category,
                popularityScore,
              });
            }
          } catch (error) {
            logger.debug('Erreur extraction produit', { error });
          }
        });

        if (products.length > 0) break; // Si on a trouvé des produits, arrêter
      }
    }

    // Trier par score de popularité et limiter
    return products
      .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0))
      .slice(0, limit);

  } catch (error: unknown) {
    logger.error('Erreur récupération trending', error instanceof Error ? error : new Error(String(error)), { category });
    return [];
  }
}

/**
 * Parser le prix depuis un texte
 */
function parsePrice(text: string): number {
  if (!text) return 0;

  // Extraire les nombres (ex: "$12.99" -> 12.99)
  const match = text.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(/,/g, ''));
  }
  return 0;
}

/**
 * Parser le nombre de commandes depuis un texte
 */
function parseOrders(text: string): number | undefined {
  if (!text) return undefined;

  // Exemples: "1.2k orders", "500+ orders", "1,234 sold"
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(?:k|K|m|M|orders|sold|\+)?/);
  if (match) {
    let num = parseFloat(match[1].replace(/,/g, ''));
    if (text.toLowerCase().includes('k')) num *= 1000;
    if (text.toLowerCase().includes('m')) num *= 1000000;
    return Math.floor(num);
  }
  return undefined;
}

/**
 * Calculer un score de popularité
 */
function calculatePopularityScore(data: {
  orders: number;
  rating: number;
  price: number;
}): number {
  // Score basé sur :
  // - Nombre de commandes (poids 60%)
  // - Rating (poids 30%)
  // - Prix raisonnable (poids 10% - pénalise les prix trop élevés)

  const ordersScore = Math.min(data.orders / 1000, 100); // Max 100 pour 1000+ commandes
  const ratingScore = data.rating * 20; // Max 100 pour rating 5.0
  const priceScore = data.price > 0 && data.price < 100 ? 10 : 0; // Bonus si prix raisonnable

  return (ordersScore * 0.6) + (ratingScore * 0.3) + priceScore;
}

/**
 * Récupérer les produits trending depuis plusieurs catégories
 */
async function fetchMultiCategoryTrending(
  categories: Array<keyof typeof CATEGORY_MAPPING>,
  limitPerCategory: number
): Promise<TrendingProduct[]> {
  const allProducts: TrendingProduct[] = [];

  // Récupérer en parallèle depuis plusieurs catégories
  const promises = categories.map(category =>
    fetchTrendingFromCategory(category, limitPerCategory)
  );

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allProducts.push(...result.value);
    }
  }

  // Trier par score de popularité global
  return allProducts
    .sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
}

/**
 * Obtenir les produits trending/populaires
 * Propose directement les meilleurs produits sans recherche
 */
export async function getTrendingProducts(options: TrendingOptions = {}): Promise<TrendingProduct[]> {
  const {
    category = 'all',
    limit = 20,
    minOrders = 10,
    sortBy = 'popularity'
  } = options;

  try {
    let products: TrendingProduct[] = [];

    if (category === 'all') {
      // Récupérer depuis toutes les catégories pertinentes
      const categories: Array<keyof typeof CATEGORY_MAPPING> = ['crochet', 'mode', 'beauté', 'décoration', 'bijoux'];
      const limitPerCategory = Math.ceil(limit / categories.length);
      products = await fetchMultiCategoryTrending(categories, limitPerCategory);
    } else {
      // Récupérer depuis une catégorie spécifique
      products = await fetchTrendingFromCategory(category, limit * 2);
    }

    // Filtrer par minimum de commandes
    if (minOrders > 0) {
      products = products.filter(p => (p.orders || 0) >= minOrders);
    }

    // Trier selon le critère demandé
    switch (sortBy) {
      case 'sales':
        products.sort((a, b) => (b.orders || 0) - (a.orders || 0));
        break;
      case 'views':
        products.sort((a, b) => (b.views || 0) - (a.views || 0));
        break;
      case 'popularity':
      default:
        products.sort((a, b) => (b.popularityScore || 0) - (a.popularityScore || 0));
        break;
    }

    return products.slice(0, limit);

  } catch (error: unknown) {
    logger.error('Erreur récupération produits trending', error instanceof Error ? error : new Error(String(error)), { options });
    return [];
  }
}

/**
 * Obtenir les produits les plus vendus aujourd'hui
 */
export async function getBestSellersToday(limit: number = 20): Promise<TrendingProduct[]> {
  return getTrendingProducts({
    category: 'all',
    limit,
    minOrders: 50, // Au moins 50 commandes
    sortBy: 'sales'
  });
}

/**
 * Obtenir les produits les plus vus/visibles
 */
export async function getMostViewed(limit: number = 20): Promise<TrendingProduct[]> {
  return getTrendingProducts({
    category: 'all',
    limit,
    minOrders: 20,
    sortBy: 'views'
  });
}
