// 🎯 Service de suggestions intelligentes basées sur le contexte féminin
// Propose des produits même quand la recherche ne retourne rien

import { logger } from '../utils/logger.js';
import { getProducts } from './productsService.js';

// Base de données de recherches pré-configurées pour public féminin
const PREPARED_SEARCHES = {
  // Crochet et artisanat
  crochet: {
    keywords: ['crochet', 'aiguille', 'fil', 'laine', 'tricot', 'artisanat', 'fait main'],
    categories: ['crochet', 'artisanat', 'accessoires'],
    tags: ['crochet', 'fait-main', 'artisanat', 'laine'],
    description: 'Découvrez nos kits de crochet, fils et accessoires pour vos créations'
  },
  mode: {
    keywords: ['mode', 'vêtement', 'vetement', 'robe', 'top', 'jupe', 'accessoire mode'],
    categories: ['mode', 'vêtements', 'accessoires'],
    tags: ['mode', 'fashion', 'style', 'tendance'],
    description: 'Trouvez les dernières tendances mode pour votre garde-robe'
  },
  beauté: {
    keywords: ['beauté', 'beaute', 'maquillage', 'cosmétique', 'soin', 'peau', 'visage'],
    categories: ['beauté', 'cosmétiques', 'soins'],
    tags: ['beauté', 'cosmétique', 'soin', 'maquillage'],
    description: 'Découvrez nos produits de beauté et soins pour prendre soin de vous'
  },
  décoration: {
    keywords: ['décoration', 'decoration', 'déco', 'deco', 'maison', 'intérieur', 'interieur'],
    categories: ['décoration', 'maison', 'intérieur'],
    tags: ['décoration', 'maison', 'intérieur', 'déco'],
    description: 'Transformez votre intérieur avec nos créations décoratives'
  },
  bijoux: {
    keywords: ['bijou', 'bijoux', 'collier', 'bracelet', 'boucle', 'oreille', 'bague'],
    categories: ['bijoux', 'accessoires'],
    tags: ['bijou', 'accessoire', 'fantaisie', 'élégant'],
    description: 'Parez-vous de nos bijoux élégants et tendance'
  },
  cadeau: {
    keywords: ['cadeau', 'offrir', 'anniversaire', 'fête', 'fete', 'noël', 'noel'],
    categories: ['cadeau', 'tous'],
    tags: ['cadeau', 'offrir', 'spécial'],
    description: 'Trouvez le cadeau parfait pour vos proches'
  },
  été: {
    keywords: ['été', 'ete', 'plage', 'vacances', 'soleil', 'été', 'saison'],
    categories: ['mode', 'accessoires', 'décoration'],
    tags: ['été', 'plage', 'vacances', 'saison'],
    description: 'Préparez-vous pour l\'été avec nos produits de saison'
  },
  hiver: {
    keywords: ['hiver', 'froid', 'chaud', 'chaleur', 'doudou', 'couverture'],
    categories: ['mode', 'décoration', 'accessoires'],
    tags: ['hiver', 'chaud', 'confort', 'saison'],
    description: 'Restez au chaud avec nos produits d\'hiver'
  },
  noël: {
    keywords: ['noël', 'noel', 'sapin', 'décembre', 'decembre', 'fête', 'fete'],
    categories: ['décoration', 'cadeau', 'artisanat'],
    tags: ['noël', 'fête', 'décembre', 'spécial'],
    description: 'Décorez et offrez pour Noël avec nos créations festives'
  },
  romantique: {
    keywords: ['romantique', 'amour', 'coeur', 'cœur', 'valentin', 'romance'],
    categories: ['bijoux', 'décoration', 'cadeau'],
    tags: ['romantique', 'amour', 'cœur', 'tendre'],
    description: 'Exprimez votre amour avec nos créations romantiques'
  }
};

/**
 * Trouve la recherche pré-configurée la plus proche d'une requête
 */
function findBestMatch(query: string): string | null {
  const normalizedQuery = query.toLowerCase().trim();

  // Chercher une correspondance exacte ou partielle
  for (const [key, config] of Object.entries(PREPARED_SEARCHES)) {
    // Vérifier si un mot-clé correspond
    const hasMatch = config.keywords.some(keyword =>
      normalizedQuery.includes(keyword) || keyword.includes(normalizedQuery)
    );

    if (hasMatch) {
      return key;
    }
  }

  // Si pas de correspondance, retourner null
  return null;
}

/**
 * Génère des suggestions intelligentes basées sur la requête
 */
export async function getSmartSuggestions(query: string): Promise<{
  suggestions: Array<{
    title: string;
    description: string;
    searchQuery: string;
    products: any[];
  }>;
  relatedSearches: string[];
}> {
  const normalizedQuery = query.toLowerCase().trim();

  // Trouver la meilleure correspondance
  const bestMatch = findBestMatch(normalizedQuery);

  const suggestions: Array<{
    title: string;
    description: string;
    searchQuery: string;
    products: any[];
  }> = [];

  const relatedSearches: string[] = [];

  // Si on a une correspondance, utiliser cette recherche pré-configurée
  if (bestMatch) {
    const config = PREPARED_SEARCHES[bestMatch as keyof typeof PREPARED_SEARCHES];

    // Chercher des produits dans les catégories/tags correspondants
    try {
      const productsResult = await getProducts({
        category: config.categories[0],
        limit: 8
      });

      // Filtrer par tags côté application si nécessaire
      let filteredProducts = productsResult.products;
      if (config.tags.length > 0) {
        filteredProducts = filteredProducts.filter((p: any) =>
          p.tags && config.tags.some(tag => p.tags.includes(tag))
        );
      }

      if (filteredProducts.length > 0) {
        suggestions.push({
          title: `Suggestions ${config.description}`,
          description: config.description,
          searchQuery: config.keywords[0],
          products: filteredProducts.slice(0, 8)
        });
      }
    } catch (error) {
      logger.warn('Error fetching products for suggestions', { error, bestMatch });
    }

    // Ajouter des recherches liées
    relatedSearches.push(...config.keywords.slice(0, 5));
  } else {
    // Si pas de correspondance, proposer des recherches populaires
    const popularSearches = ['crochet', 'mode', 'beauté', 'décoration', 'bijoux'];

    for (const search of popularSearches.slice(0, 3)) {
      const config = PREPARED_SEARCHES[search as keyof typeof PREPARED_SEARCHES];
      if (config) {
        try {
          const productsResult = await getProducts({
            category: config.categories[0],
            limit: 4
          });

          if (productsResult.products.length > 0) {
            suggestions.push({
              title: `Découvrez nos ${search}`,
              description: config.description,
              searchQuery: search,
              products: productsResult.products.slice(0, 4)
            });
          }
        } catch (error) {
          logger.warn('Error fetching popular products', { error, search });
        }

        relatedSearches.push(...config.keywords.slice(0, 3));
      }
    }
  }

  // Toujours ajouter des suggestions générales si on n'a pas assez
  if (suggestions.length < 2) {
    const generalSearches = ['crochet', 'mode', 'beauté'];
    for (const search of generalSearches) {
      if (suggestions.length >= 3) break;

      const config = PREPARED_SEARCHES[search as keyof typeof PREPARED_SEARCHES];
      if (config && !suggestions.find(s => s.searchQuery === search)) {
        try {
          const productsResult = await getProducts({
            limit: 4
          });

          if (productsResult.products.length > 0) {
            suggestions.push({
              title: `Produits populaires`,
              description: 'Découvrez nos produits les plus appréciés',
              searchQuery: search,
              products: productsResult.products.slice(0, 4)
            });
          }
        } catch (error) {
          logger.warn('Error fetching general products', { error });
        }
      }
    }
  }

  // Dédupliquer les recherches liées
  const uniqueRelatedSearches = Array.from(new Set(relatedSearches)).slice(0, 8);

  return {
    suggestions: suggestions.slice(0, 3), // Max 3 suggestions
    relatedSearches: uniqueRelatedSearches // Max 8 recherches liées
  };
}

/**
 * Obtient toutes les recherches pré-configurées disponibles
 */
export function getPreparedSearches(): Array<{
  key: string;
  keywords: string[];
  description: string;
}> {
  return Object.entries(PREPARED_SEARCHES).map(([key, config]) => ({
    key,
    keywords: config.keywords,
    description: config.description
  }));
}
