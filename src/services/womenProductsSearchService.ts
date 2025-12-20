/**
 * Service de recherche intelligente pour produits femmes 20-45 ans
 * Remplace les recherches non pertinentes par des produits ciblés
 */
import { logger } from '../utils/logger.js';
import { AliExpressSearchResult, searchAliExpressProducts } from './aliexpressSearchService.js';

/**
 * Catégories de produits populaires pour femmes 20-45 ans
 */
const WOMEN_PRODUCTS_CATEGORIES = [
  // Bijoux et accessoires
  'jewelry', 'necklace', 'earrings', 'bracelet', 'ring', 'choker',
  'handbag', 'purse', 'wallet', 'clutch', 'tote bag',
  'scarf', 'shawl', 'hair clip', 'hair band', 'hairpin',

  // Beauté et cosmétiques
  'makeup', 'cosmetic', 'skincare', 'beauty set',
  'nail art', 'nail polish', 'nail sticker',
  'perfume', 'fragrance', 'body mist', 'body lotion',
  'makeup bag', 'cosmetic organizer',

  // Mode et vêtements
  'fashion', 'dress', 'blouse', 'top', 'skirt',
  'accessories', 'fashion jewelry',

  // Décoration et lifestyle
  'home decor', 'candle', 'vase', 'pillow', 'wall art',
  'organizer', 'storage', 'desk accessory',

  // Électronique et gadgets
  'phone case', 'phone accessory', 'wireless charger',
  'watch', 'fitness tracker', 'smart bracelet',

  // Bien-être
  'yoga mat', 'yoga accessory', 'fitness accessory',
  'aromatherapy', 'essential oil',
];

/**
 * Recherche intelligente pour femmes 20-45 ans
 * Remplace les recherches non pertinentes par des produits ciblés
 */
export async function searchWomenProducts(
  originalQuery: string,
  options?: {
    maxResults?: number;
    minRating?: number;
    maxPrice?: number;
  }
): Promise<{
  results: AliExpressSearchResult[];
  originalQuery: string;
  smartQuery: string;
  replaced: boolean;
}> {
  const lowerQuery = originalQuery.toLowerCase().trim();

  // Recherches non pertinentes à remplacer
  const irrelevantQueries = [
    'couteau', 'knife', 'couteaux', 'knives',
    'weapon', 'tool', 'outil', 'armes',
    'gun', 'pistol', 'rifle',
  ];

  // Traductions français -> anglais pour produits femmes
  const translations: Record<string, string> = {
    'écharpe': 'scarf',
    'echarpe': 'scarf',
    'foulard': 'scarf',
    'châle': 'shawl',
    'chale': 'shawl',
    'bijou': 'jewelry',
    'bijoux': 'jewelry',
    'collier': 'necklace',
    'boucles': 'earrings',
    'boucle': 'earring',
    'bracelet': 'bracelet',
    'bague': 'ring',
    'bagues': 'rings',
    'sac': 'handbag',
    'sacs': 'handbag',
    'maquillage': 'makeup',
    'cosmétique': 'cosmetic',
    'beauté': 'beauty',
    'mode': 'fashion',
    'décoration': 'home decor',
    'accessoire': 'accessories',
  };

  // Synonymes recommandés 2025 (Perplexity) – 2-3 max testés en parallèle
  const synonyms: Record<string, string[]> = {
    // Handbags (highest success first)
    'handbag': ['women luxury handbag', 'women shoulder bag 2025', 'cow leather handbag women'],

    // Necklaces
    'necklace': ['women necklace gold', 'customized necklace women', 'geometric chain necklace women'],

    // Earrings
    'earrings': ['women hoop earrings gold', 'tassel earrings women', 'geometric earrings fashion'],

    // Fallbacks (génériques)
    'bracelet': ['women bracelet', 'fashion bracelet women'],
    'ring': ['women ring', 'fashion ring women'],
    'jewelry': ['women jewelry', 'fashion jewelry women'],
    'scarf': ['women scarf', 'fashion scarf women'],
  };

  // Fonction helper pour rechercher avec synonymes - PARALLÉLISÉE (Recommandation Perplexity)
  const searchWithSynonyms = async (baseQuery: string): Promise<AliExpressSearchResult[]> => {
    const queriesToTry = synonyms[baseQuery] || [baseQuery];

    // Paralléliser les recherches (au lieu de boucle séquentielle) - max 2 pour éviter timeout
    const searchPromises = queriesToTry.slice(0, 2).map(async (tryQuery) => {
      try {
        const searchResult = await searchAliExpressProducts({
          query: tryQuery,
          limit: 2, // Limiter à 2 résultats max par requête (Recommandation Perplexity)
          minRating: options?.minRating || 4.0,
        }, true); // Retourner avec status

        const results = Array.isArray(searchResult) ? searchResult : searchResult.results;

        if (results.length > 0) {
          logger.info('Synonyme réussi (parallélisé)', {
            baseQuery,
            synonym: tryQuery,
            resultsCount: results.length,
          });
          return results;
        } else {
          logger.warn('Synonyme sans résultats', {
            baseQuery,
            synonym: tryQuery,
            status: !Array.isArray(searchResult) ? searchResult.status : undefined,
          });
          return [];
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn('Erreur recherche synonyme (parallélisé)', {
          query: tryQuery,
          error: errorMsg,
        });
        return []; // Retourner tableau vide en cas d'erreur
      }
    });

    // Exécuter toutes les recherches en parallèle
    const resultsArrays = await Promise.all(searchPromises);

    // Flatten et dédupliquer par URL
    const allResults = resultsArrays.flat();
    const uniqueResults = Array.from(
      new Map(allResults.map(r => [r.url, r])).values()
    ).slice(0, options?.maxResults || 5);

    logger.info('Recherche parallélisée terminée', {
      baseQuery,
      totalResults: uniqueResults.length,
      queriesTried: queriesToTry.slice(0, 2).length,
    });

    return uniqueResults;
  };

  // Vérifier traduction directe
  if (translations[lowerQuery]) {
    const translatedQuery = translations[lowerQuery];
    const results = await searchWithSynonyms(translatedQuery);
    return {
      results,
      originalQuery: originalQuery,
      smartQuery: translatedQuery,
      replaced: true,
    };
  }

  // Vérifier si le mot contient un mot français connu
  for (const [french, english] of Object.entries(translations)) {
    if (lowerQuery.includes(french)) {
      const results = await searchWithSynonyms(english);
      return {
        results,
        originalQuery: originalQuery,
        smartQuery: english,
        replaced: true,
      };
    }
  }

  // Vérifier si la recherche est non pertinente
  const isIrrelevant = irrelevantQueries.some(irrelevant => lowerQuery.includes(irrelevant));

  let smartQuery: string;
  let replaced = false;

  if (isIrrelevant) {
    // Choisir une catégorie aléatoire parmi les populaires
    const randomCategory = WOMEN_PRODUCTS_CATEGORIES[
      Math.floor(Math.random() * WOMEN_PRODUCTS_CATEGORIES.length)
    ];
    smartQuery = randomCategory;
    replaced = true;

    logger.info('Recherche intelligente activée', {
      original: originalQuery,
      smartQuery,
      reason: 'Recherche non pertinente pour cible femmes 20-45 ans',
    });
  } else {
    // Utiliser la recherche originale
    smartQuery = originalQuery;
  }

  // Utiliser synonymes pour la recherche finale (synonyms déjà déclaré plus haut)
  const results = await searchWithSynonyms(smartQuery);

  return {
    results,
    originalQuery,
    smartQuery,
    replaced,
  };
}

/**
 * Recherche par catégorie pour femmes 20-45 ans
 */
export async function searchByCategory(
  category: string,
  options?: {
    maxResults?: number;
    minRating?: number;
    maxPrice?: number;
  }
): Promise<AliExpressSearchResult[]> {
  const categoryLower = category.toLowerCase();

  // Mapper catégories françaises vers anglais
  const categoryMap: Record<string, string> = {
    'bijoux': 'jewelry',
    'bijou': 'jewelry',
    'collier': 'necklace',
    'boucles': 'earrings',
    'bracelet': 'bracelet',
    'bague': 'ring',
    'sac': 'handbag',
    'sacs': 'handbag',
    'maquillage': 'makeup',
    'cosmétique': 'cosmetic',
    'beauté': 'beauty',
    'mode': 'fashion',
    'décoration': 'home decor',
    'accessoire': 'accessories',
  };

  const englishCategory = categoryMap[categoryLower] || categoryLower;

  // Vérifier que la catégorie est dans la liste des produits femmes
  if (!WOMEN_PRODUCTS_CATEGORIES.includes(englishCategory)) {
    logger.warn('Catégorie non dans liste produits femmes', { category, englishCategory });
  }

  const results = await searchAliExpressProducts({
    query: englishCategory,
    minRating: options?.minRating || 4.0,
    maxPrice: options?.maxPrice,
    limit: options?.maxResults || 10,
    sortBy: 'rating',
  });

  return results;
}

