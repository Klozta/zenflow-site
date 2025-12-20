/**
 * Service de recherche automatique sur AliExpress
 * Version améliorée avec extraction JSON + Playwright fallback
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { load } from 'cheerio';
import fs from 'fs/promises';
import { chromium } from 'playwright';
import { getCache, setCache } from '../utils/cache.js';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';
import { extractBySiteType } from './siteSpecificExtractors.js';

function isComplianceStrict(): boolean {
  const mode = (process.env.COMPLIANCE_MODE || 'strict').toLowerCase().trim();
  return mode !== 'off' && mode !== 'permissive';
}

export interface AliExpressSearchResult {
  productId: string;
  title: string;
  price: number;
  originalPrice?: number;
  image: string;
  rating?: number;
  orders?: number;
  url: string;
  category?: string;
  description?: string;
  images?: string[];
}

export interface AliExpressSearchOptions {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  minOrders?: number;
  sortBy?: 'price' | 'rating' | 'orders' | 'relevance';
  limit?: number;
}

export type SearchStatusCode =
  | 'OK'
  | 'BLOCKED'
  | 'PARSING_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'EMPTY_RESULTS';

export interface SearchStatus {
  status: SearchStatusCode;
  message?: string;
  httpCode?: number;
  detectedAntiBot?: boolean;
}

/**
 * Recherche intelligente pour femmes 20-45 ans
 * Remplace les recherches non pertinentes par des produits ciblés
 */
function getSmartSearchQuery(query: string): string {
  const lowerQuery = query.toLowerCase().trim();

  // Produits populaires pour femmes 20-45 ans
  const womenProducts = [
    'jewelry', 'necklace', 'earrings', 'bracelet', 'ring',
    'handbag', 'purse', 'wallet', 'makeup bag',
    'cosmetic', 'skincare', 'beauty', 'makeup',
    'fashion', 'dress', 'blouse', 'scarf', 'shawl',
    'home decor', 'candle', 'vase', 'pillow',
    'accessories', 'hair clip', 'hair band', 'hairpin',
    'perfume', 'fragrance', 'body mist',
    'nail art', 'nail polish', 'nail sticker',
    'phone case', 'phone accessory',
    'watch', 'fitness tracker',
  ];

  // Recherches non pertinentes à remplacer
  const irrelevantQueries = ['couteau', 'knife', 'couteaux', 'knives', 'weapon', 'tool'];

  // Si recherche non pertinente, utiliser produits femmes
  if (irrelevantQueries.some(irrelevant => lowerQuery.includes(irrelevant))) {
    const randomProduct = womenProducts[Math.floor(Math.random() * womenProducts.length)];
    logger.info('Recherche intelligente activée', {
      original: query,
      replaced: randomProduct,
      reason: 'Recherche non pertinente pour cible femmes 20-45 ans'
    });
    return randomProduct;
  }

  // Traductions français -> anglais
  const translations: Record<string, string> = {
    'écharpe': 'scarf',
    'echarpe': 'scarf',
    'foulard': 'scarf',
    'châle': 'shawl',
    'chale': 'shawl',
    'crochet': 'crochet',
    'tricot': 'knitting',
    'aiguille': 'needle',
    'aiguilles': 'needles',
    'fil': 'yarn',
    'laine': 'wool',
    'bouton': 'button',
    'boutons': 'buttons',
    'perle': 'bead',
    'perles': 'beads',
    'bijou': 'jewelry',
    'bijoux': 'jewelry',
    'collier': 'necklace',
    'boucle': 'earring',
    'boucles': 'earrings',
    'bracelet': 'bracelet',
    'bague': 'ring',
    'bagues': 'rings',
    'sac': 'handbag',
    'sacs': 'handbag',
    'maquillage': 'makeup',
    'cosmétique': 'cosmetic',
    'mode': 'fashion',
    'robe': 'dress',
    'décoration': 'home decor',
  };

  // Vérifier traduction directe
  if (translations[lowerQuery]) {
    return translations[lowerQuery];
  }

  // Vérifier si le mot contient un mot français connu
  for (const [french, english] of Object.entries(translations)) {
    if (lowerQuery.includes(french)) {
      return english;
    }
  }

  // Si pas de traduction, retourner tel quel
  return query;
}

// Fonction translateQueryToEnglish supprimée - utiliser getSmartSearchQuery à la place

/**
 * Rechercher des produits sur AliExpress avec status détaillé
 * Méthode 1: Extraction depuis JSON embarqué (rapide, fiable)
 * Méthode 2: Playwright fallback pour contenu dynamique
 */
export async function searchAliExpressProducts(
  options: AliExpressSearchOptions
): Promise<AliExpressSearchResult[]>;

export async function searchAliExpressProducts(
  options: AliExpressSearchOptions,
  returnStatus: true
): Promise<{ results: AliExpressSearchResult[]; status: SearchStatus }>;

export async function searchAliExpressProducts(
  options: AliExpressSearchOptions,
  returnStatus?: boolean
): Promise<AliExpressSearchResult[] | { results: AliExpressSearchResult[]; status: SearchStatus }> {
  const startTime = Date.now();
  try {
    if (isComplianceStrict()) {
      const status: SearchStatus = {
        status: 'BLOCKED',
        message: 'Recherche AliExpress désactivée (COMPLIANCE_MODE=strict). Préférez une API/flux partenaire.',
        detectedAntiBot: false,
      };
      if (returnStatus) return { results: [], status };
      return [];
    }

    const { query, minPrice, maxPrice, minRating, minOrders, sortBy = 'relevance', limit = 20 } = options;

    // Recherche intelligente pour femmes 20-45 ans
    const translatedQuery = getSmartSearchQuery(query);
    const useTranslation = translatedQuery !== query;

    // Cache (TTL 5 min) - accélère fortement et réduit les hits scraping
    const cacheKey = `aliexpress:search:${translatedQuery}:${limit}:${minRating || ''}:${minOrders || ''}:${minPrice || ''}:${maxPrice || ''}:${sortBy}`;
    const cached = await getCache<AliExpressSearchResult[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      logger.info('Cache hit AliExpress', { query: translatedQuery, resultsCount: cached.length });
      if (returnStatus) {
        return { results: cached.slice(0, limit), status: { status: 'OK' } };
      }
      return cached.slice(0, limit);
    }

    if (useTranslation) {
      logger.info('Recherche intelligente activée', {
        original: query,
        translated: translatedQuery,
        reason: useTranslation ? 'Recherche optimisée pour cible femmes 20-45 ans' : undefined
      });
    }

    logger.info('Début recherche AliExpress', { query: translatedQuery, originalQuery: useTranslation ? query : undefined, limit });

    // Utiliser la requête traduite pour la recherche
    const searchOptions = { ...options, query: translatedQuery };

    // Méthode 1: Extraction depuis HTML/JSON (rapide, fiable) avec status
    const { results: htmlResults, status: htmlStatus } = await extractFromHtmlWithStatus(searchOptions);

    // Filtrer selon critères
    let filteredResults = htmlResults.filter(product => {
      if (minPrice && product.price < minPrice) return false;
      if (maxPrice && product.price > maxPrice) return false;
      if (minRating && (!product.rating || product.rating < minRating)) return false;
      if (minOrders && (!product.orders || product.orders < minOrders)) return false;
      return true;
    });

    // Si assez de résultats, retourner
    if (filteredResults.length >= (limit || 10)) {
      const results = sortProducts(filteredResults, sortBy).slice(0, limit);
      if (returnStatus) {
        return { results, status: { status: 'OK' } };
      }
      return results;
    }

    // Méthode 2: Playwright fallback pour contenu dynamique
    logger.info('Tentative Playwright pour résultats supplémentaires', {
      currentCount: filteredResults.length,
      target: limit
    });

    const playwrightResults = await extractWithPlaywright(searchOptions);

    // Filtrer et fusionner
    const playwrightFiltered = playwrightResults.filter(product => {
      if (minPrice && product.price < minPrice) return false;
      if (maxPrice && product.price > maxPrice) return false;
      if (minRating && (!product.rating || product.rating < minRating)) return false;
      if (minOrders && (!product.orders || product.orders < minOrders)) return false;
      return true;
    });

    // Fusionner en évitant les doublons (par URL)
    const urlSet = new Set(filteredResults.map(p => p.url));
    for (const product of playwrightFiltered) {
      if (!urlSet.has(product.url)) {
        filteredResults.push(product);
        urlSet.add(product.url);
      }
    }

    logger.info('Produits extraits', {
      htmlCount: htmlResults.length,
      playwrightCount: playwrightResults.length,
      total: filteredResults.length
    });

    // Finaliser les résultats
    const results = sortProducts(filteredResults, sortBy).slice(0, limit);

    // Déterminer le status final
    const finalStatus: SearchStatus = results.length > 0
      ? { status: 'OK' }
      : htmlStatus.status === 'BLOCKED'
        ? { status: 'BLOCKED', message: 'AliExpress bloque les requêtes. Utilisez ScraperAPI.', detectedAntiBot: true }
        : htmlStatus.status === 'PARSING_ERROR'
          ? { status: 'PARSING_ERROR', message: 'Structure HTML/JSON changée. Mise à jour nécessaire.' }
          : htmlStatus.status === 'NETWORK_ERROR'
            ? { status: 'NETWORK_ERROR', message: 'Erreur réseau lors de la recherche.' }
            : { status: 'EMPTY_RESULTS', message: 'Aucun produit trouvé pour cette recherche.' };

    // Si aucun résultat et pas de ScraperAPI, logger un avertissement
    if (results.length === 0 && !process.env.SCRAPER_API_KEY) {
      logger.warn('Aucun produit trouvé - ScraperAPI recommandé', {
        query: translatedQuery,
        originalQuery: useTranslation ? query : undefined,
        status: finalStatus,
        suggestion: 'Configurez SCRAPER_API_KEY dans .env pour contourner le blocage anti-bot',
      });
    }

    const duration = Date.now() - startTime;
    logger.info('Recherche AliExpress terminée', {
      query: translatedQuery,
      resultsCount: results.length,
      status: finalStatus.status,
      duration: `${duration}ms`
    });

    // Cache si OK (5 minutes)
    if (results.length > 0) {
      await setCache(cacheKey, results, 300);
    }

    // Retourner avec ou sans status selon le paramètre
    if (returnStatus) {
      return { results, status: finalStatus };
    }
    return results;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Gérer les timeouts spécifiquement (augmenté le seuil à 85s)
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout') || errorMessage.includes('too long') || duration > 85000) {
      logger.warn('Timeout recherche AliExpress', {
        query: options.query,
        duration: `${duration}ms`,
        suggestion: 'La recherche prend trop de temps. Vérifiez SCRAPER_API_KEY ou réessayez plus tard.'
      });
      throw new Error('La recherche AliExpress prend trop de temps. Configurez SCRAPER_API_KEY pour améliorer les performances ou réessayez dans quelques instants.');
    }

    logger.error('Erreur recherche AliExpress', error instanceof Error ? error : new Error(errorMessage), {
      query: options.query,
      duration: `${duration}ms`
    });

    // Message d'erreur plus clair
    if (errorMessage.includes('block') || errorMessage.includes('bloque') || errorMessage.includes('403')) {
      throw new Error('AliExpress bloque temporairement les requêtes. Configurez SCRAPER_API_KEY pour contourner le blocage.');
    }

    throw new Error(`Erreur recherche AliExpress: ${errorMessage}`);
  }
}

/**
 * Extraction depuis HTML avec JSON embarqué (méthode principale)
 * Utilise ScraperAPI si disponible pour contourner le blocage anti-bot
 * Retourne maintenant un status détaillé pour diagnostiquer les problèmes
 */
async function extractFromHtmlWithStatus(
  options: AliExpressSearchOptions
): Promise<{ results: AliExpressSearchResult[]; status: SearchStatus }> {
  const { query, limit = 20 } = options;

  // URL de recherche AliExpress (format moderne)
  const searchUrl = `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(query)}.html?spm=a2g0o.productlist.0.0`;

  try {
    // Cascade Perplexity: Direct → ScraperAPI → (caller will do Playwright)
    const scraperApiKey = process.env.SCRAPER_API_KEY;
    let response;
    let status: SearchStatus = { status: 'OK' };

    // Headers (optimisés 2025)
    const realisticHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'Referer': 'https://www.aliexpress.com/',
    };

    const detectAntiBot = (httpCode?: number, body?: unknown) => {
      if (httpCode === 403 || httpCode === 429) return true;
      if (typeof body !== 'string') return false;
      const lower = body.toLowerCase();
      return (
        lower.includes('captcha') ||
        lower.includes('robot') ||
        lower.includes('anti-bot') ||
        lower.includes('access denied') ||
        lower.includes('blocked') ||
        lower.includes('challenge') ||
        lower.includes('cloudflare') ||
        lower.includes('verify')
      );
    };

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Perplexity: retry 3x avec backoff 1s/2s/4s sur BLOCKED/EMPTY (ScraperAPI)
    const backoffs = [0, 1000, 2000, 4000];

    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      if (attempt > 0) {
        await sleep(backoffs[attempt]);
      }

      // 1) Direct (cheapest) - seulement au 1er essai
      if (attempt === 0) {
        logger.info('AliExpress direct scrape', { query, url: searchUrl });
        try {
          response = await axios.get(searchUrl, {
            headers: realisticHeaders,
            timeout: 15000,
            maxRedirects: 5,
          });
          status = { status: 'OK' };
        } catch (directError: any) {
          const httpCode = directError.response?.status;
          const responseData = directError.response?.data;
          const isBlocked = detectAntiBot(httpCode, responseData);

          logger.warn('Direct AliExpress failed', {
            query,
            httpCode,
            isBlocked,
            hasScraperAPI: !!scraperApiKey,
          });

          status = {
            status: isBlocked ? 'BLOCKED' : 'NETWORK_ERROR',
            message: isBlocked ? 'AliExpress bloque les requêtes directes.' : `Erreur réseau: ${directError.message}`,
            httpCode,
            detectedAntiBot: isBlocked,
          };
        }
      }

      // 2) ScraperAPI (si direct KO / bloqué / vide) - retry avec sessions 1..5
      const needsScraper =
        !response || status.status === 'BLOCKED' || status.status === 'NETWORK_ERROR';

      if (needsScraper) {
        if (!scraperApiKey) {
          return { results: [], status };
        }

        const sessionNumber = Math.floor(Math.random() * 5) + 1; // 1..5
        const premium = process.env.SCRAPER_API_PREMIUM === 'true' ? 'true' : 'false';
        const scraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}` +
          `&url=${encodeURIComponent(searchUrl)}` +
          `&render=true&country_code=us&session_number=${sessionNumber}&premium=${premium}`;

        logger.info('AliExpress ScraperAPI fallback', { query, sessionNumber, premium, attempt });

        try {
          response = await retryNetwork(
            () =>
              axios.get(scraperApiUrl, {
                timeout: 30000,
                headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
              }),
            { maxRetries: 1, initialDelay: 1000 }
          );
          status = { status: 'OK' };
        } catch (scraperError: any) {
          status = {
            status: 'NETWORK_ERROR',
            message: `ScraperAPI error: ${scraperError.message}`,
            httpCode: scraperError.response?.status,
          };
          response = undefined;
        }
      }

      if (!response) {
        // On retente (backoff) si possible, sinon on sort
        if (!scraperApiKey) return { results: [], status };
        continue;
      }

    // Logger détails de la réponse pour diagnostic
    const statusCode = response.status;
    const responseHeaders = response.headers;
    const bodyLength = typeof response.data === 'string' ? response.data.length : 0;

    logger.info('Réponse AliExpress reçue', {
      query,
      statusCode,
      bodyLength,
      contentType: responseHeaders['content-type'],
      cfRay: responseHeaders['cf-ray'], // Cloudflare
      server: responseHeaders['server'],
      hasAntiBot: typeof response.data === 'string' && (
        response.data.includes('robot') ||
        response.data.includes('captcha') ||
        response.data.includes('anti-bot') ||
        response.data.includes('access denied')
      ),
    });

      // Détecter anti-bot dans le body
      if (detectAntiBot(statusCode, response.data)) {
        logger.warn('Anti-bot détecté dans la réponse', {
          query,
          statusCode,
          bodyPreview: typeof response.data === 'string' ? response.data.substring(0, 300) : '',
        });
        status = {
          status: 'BLOCKED',
          message: 'Page anti-bot détectée.',
          httpCode: statusCode,
          detectedAntiBot: true,
        };
        response = undefined;
        continue; // retry backoff
      }

    // Sauvegarder HTML pour debugging (premiers 500KB)
    try {
      await fs.writeFile('/tmp/aliexpress-debug.html', response.data.substring(0, 500000));
      logger.debug('HTML sauvegardé pour debugging', { path: '/tmp/aliexpress-debug.html' });
    } catch {
      // Ignorer erreur sauvegarde
    }

    const $ = cheerio.load(response.data);
    const products: AliExpressSearchResult[] = [];

    logger.debug('HTML reçu', { length: response.data.length, url: searchUrl });

    // Méthode 1: Extraire depuis scripts JSON embarqués
    $('script').each((_i, elem) => {
      const content = $(elem).html();
      if (content?.includes('productId') || content?.includes('titleModule') || content?.includes('window.runParams')) {
        try {
          // Chercher données JSON dans les scripts
          // AliExpress stocke souvent les données dans window.runParams ou similaire
          const jsonMatches = content.match(/window\.runParams\s*=\s*({.+?});/s) ||
                             content.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s) ||
                             content.match(/\{[\s\S]*?"productId"[\s\S]*?\}/g);

          if (jsonMatches) {
            for (const match of jsonMatches.slice(0, 3)) {
              try {
                const jsonData = JSON.parse(match.replace(/window\.runParams\s*=\s*/, '').replace(/;$/, ''));

                // Chercher les produits dans différentes structures possibles
                const items = jsonData.items ||
                             jsonData.data?.items ||
                             jsonData.modules?.find((m: any) => m.items)?.items ||
                             (Array.isArray(jsonData) ? jsonData : []);

                if (Array.isArray(items) && items.length > 0) {
                  items.slice(0, limit * 2).forEach((item: any) => {
                    try {
                      const productId = item.productId || item.id || item.itemId || '';
                      const title = item.title || item.subject || item.titleModule?.subject || '';
                      const priceText = item.salePrice || item.price || item.priceModule?.formatedPrice || '';
                      const image = item.imageUrl || item.image || item.imageModule?.imagePathList?.[0] || '';
                      const url = item.productUrl || item.url || `https://www.aliexpress.com/item/${productId}.html`;
                      const rating = item.feedbackRating || item.rating || item.ratingModule?.averageStar || undefined;
                      const orders = item.soldQuantity || item.orders || item.tradeCount || undefined;

                      if (productId && title && priceText && image) {
                        const price = extractPriceFromText(String(priceText));
                        if (price > 0) {
                          products.push({
                            productId: String(productId),
                            title: cleanTitle(title),
                            price,
                            image: image.startsWith('//') ? `https:${image}` : (image.startsWith('http') ? image : `https:${image}`),
                            url: url.startsWith('http') ? url : `https://www.aliexpress.com${url}`,
                            rating: rating ? parseFloat(String(rating)) : undefined,
                            orders: orders ? parseOrders(String(orders)) : undefined,
                          });
                        }
                      }
                    } catch (itemError) {
                      // Ignorer erreurs d'extraction d'un item
                    }
                  });
                }
              } catch (parseError) {
                // Ignorer erreurs de parsing JSON
              }
            }
          }
        } catch (e) {
          // Ignorer erreurs d'extraction
        }
      }
    });

    // Méthode 2: Sélecteurs CSS modernes (fallback)
    if (products.length < limit) {
      const modernSelectors = [
        '.list--gallery--C2f2tM1 .list--gallery--item--Yx9dL2',
        '[data-spm-anchor-id="a2g0o.searchlist.0"] .manhattan--container--1tGJuI7',
        '.product-item',
        '.search-product-item',
        '.list--gallery--item--Yx9dL2',
      ];

      for (const selector of modernSelectors) {
        const items = $(selector);
        logger.debug(`Sélecteur testé: ${selector}`, { count: items.length });

        if (items.length > 0) {
          items.slice(0, limit * 2).each((_i, el) => {
            try {
              const $el = $(el);
              const title = $el.find('.title-link, h3, .product-title, [title]').first().text().trim() || '';
              const priceText = $el.find('.price, .price-current, .price-value').first().text().trim() || '';
              const image = $el.find('img').first().attr('src') ||
                          $el.find('img').first().attr('data-src') ||
                          $el.find('img').first().attr('data-lazy-src') || '';
              const link = $el.find('a').first().attr('href');
              const ratingText = $el.find('.rating-value, .rating').first().text().trim() || '';
              const ordersText = $el.find('.order-num, .orders').first().text().trim() || '';

              if (title && priceText && image && link) {
                const price = extractPriceFromText(priceText);
                if (price > 0) {
                  const fullUrl = link.startsWith('http') ? link : `https://www.aliexpress.com${link}`;
                  const productId = extractProductIdFromUrl(fullUrl);

                  // Éviter doublons
                  if (!products.find(p => p.url === fullUrl || p.productId === productId)) {
                    products.push({
                      productId,
                      title: cleanTitle(title),
                      price,
                      image: image.startsWith('//') ? `https:${image}` : (image.startsWith('http') ? image : `https:${image}`),
                      url: fullUrl,
                      rating: ratingText ? extractRating(ratingText) : undefined,
                      orders: ordersText ? parseOrders(ordersText) : undefined,
                    });
                  }
                }
              }
            } catch (itemError) {
              // Ignorer erreurs d'extraction
            }
          });

          if (products.length >= limit) break;
        }
      }
    }

      logger.info('Extraction HTML terminée', { count: products.length });

      // Si vide, retenter (Perplexity: retry sur empty)
      if (products.length === 0) {
        status = { status: 'EMPTY_RESULTS', message: 'Aucun produit extrait' };
        response = undefined;
        continue;
      }

      return { results: products, status: { status: 'OK' } };
    }

    return { results: [], status: status.status === 'OK' ? { status: 'EMPTY_RESULTS', message: 'Aucun produit trouvé' } : status };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('Erreur extraction HTML', {
      error: errorMessage,
      query,
    });

    return {
      results: [],
      status: {
        status: 'PARSING_ERROR',
        message: `Erreur extraction: ${errorMessage}`,
      },
    };
  }
}

/**
 * Wrapper pour compatibilité (ancienne signature)
 */
// NOTE: kept for reference; not used by current pipeline
async function _extractFromHtml(options: AliExpressSearchOptions): Promise<AliExpressSearchResult[]> {
  const { results } = await extractFromHtmlWithStatus(options);
  return results;
}

// Évite warning TS "declared but never read" (compat wrapper gardé pour référence)
void _extractFromHtml;

/**
 * Extraction avec Playwright (fallback pour contenu dynamique)
 */
async function extractWithPlaywright(options: AliExpressSearchOptions): Promise<AliExpressSearchResult[]> {
  const { query, limit = 20 } = options;
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const page = await context.newPage();

    const searchUrl = `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(query)}.html`;
    logger.debug('Playwright: Chargement page', { url: searchUrl });

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Attendre que les résultats se chargent
    try {
      await page.waitForSelector('.list--gallery--item--Yx9dL2, .product-item, [data-spm-anchor-id]', { timeout: 10000 });
    } catch {
      // Continuer même si le sélecteur n'est pas trouvé
      logger.warn('Playwright: Sélecteur de résultats non trouvé, extraction quand même');
    }

    // Extraire avec sélecteurs modernes
    // Le code dans evaluate() s'exécute dans le contexte du navigateur où document existe
    const products = await page.evaluate((maxLimit) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = (globalThis as any).document;
      const items: any[] = [];
      const selectors = [
        '.list--gallery--item--Yx9dL2',
        '.manhattan--container--1tGJuI7',
        '.product-item',
        '[data-spm-anchor-id]',
      ];

      for (const sel of selectors) {
        const elements = doc.querySelectorAll(sel);
        elements.forEach((el: any) => {
          try {
            const titleEl = el.querySelector('.title-link, h3, .product-title, [title]');
            const priceEl = el.querySelector('.price, .price-current, .price-value');
            const imgEl = el.querySelector('img');
            const linkEl = el.querySelector('a');
            const ratingEl = el.querySelector('.rating-value, .rating');
            const ordersEl = el.querySelector('.order-num, .orders');

            if (titleEl && priceEl && imgEl && linkEl) {
              items.push({
                title: titleEl.textContent?.trim() || titleEl.getAttribute('title') || '',
                price: priceEl.textContent?.trim() || '',
                image: imgEl.src || imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy-src') || '',
                url: linkEl.href || linkEl.getAttribute('href') || '',
                rating: ratingEl?.textContent?.trim() || undefined,
                orders: ordersEl?.textContent?.trim() || undefined,
              });
            }
          } catch {
            // Ignorer erreurs
          }
        });
        if (items.length >= maxLimit) break;
      }
      return items.slice(0, maxLimit);
    }, limit * 2);

    // Sauvegarder HTML pour debugging
    try {
      const html = await page.content();
      await fs.writeFile('/tmp/aliexpress-playwright.html', html.substring(0, 500000));
      logger.debug('HTML Playwright sauvegardé', { path: '/tmp/aliexpress-playwright.html' });
    } catch {
      // Ignorer erreur sauvegarde
    }

    // Convertir en format AliExpressSearchResult
    const results: AliExpressSearchResult[] = [];
    for (const item of products) {
      const price = extractPriceFromText(item.price);
      if (price > 0 && item.title && item.image && item.url) {
        const fullUrl = item.url.startsWith('http') ? item.url : `https://www.aliexpress.com${item.url}`;
        const productId = extractProductIdFromUrl(fullUrl);

        results.push({
          productId,
          title: cleanTitle(item.title),
          price,
          image: item.image.startsWith('//') ? `https:${item.image}` : (item.image.startsWith('http') ? item.image : `https:${item.image}`),
          url: fullUrl,
          rating: item.rating ? extractRating(item.rating) : undefined,
          orders: item.orders ? parseOrders(item.orders) : undefined,
        });
      }
    }

    logger.info('Extraction Playwright terminée', { count: results.length });
    return results;
  } catch (error: unknown) {
    logger.warn('Erreur extraction Playwright', {
      error: error instanceof Error ? error.message : String(error),
      query,
    });
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Analyser un produit AliExpress en détail
 */
export async function analyzeAliExpressProduct(
  productUrl: string
): Promise<{
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  images: string[];
  category?: string;
  specifications: Record<string, string>;
  rating?: number;
  reviews?: number;
}> {
  try {
    if (isComplianceStrict()) {
      throw new Error('Analyse produit AliExpress désactivée (COMPLIANCE_MODE=strict).');
    }

    // Scraper la page produit
    const html = await retryNetwork(() => axios.get(productUrl, {
      headers: {
        'User-Agent': (process.env.COMPLIANCE_USER_AGENT || 'ZenFlowProductImporter/1.0').trim(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'DNT': '1',
      },
      timeout: 15000,
    }));

    const $ = load(html.data);

    // Utiliser l'extracteur AliExpress existant
    const extracted = await extractBySiteType(productUrl, $) as {
      title?: string;
      description?: string;
      price?: number;
      originalPrice?: number;
      images?: string[];
      category?: string;
      rating?: number;
      reviews?: number;
    };

    return {
      title: extracted.title || '',
      description: extracted.description || '',
      price: extracted.price || 0,
      originalPrice: extracted.originalPrice,
      images: extracted.images || [],
      category: extracted.category,
      specifications: {},
      rating: extracted.rating,
      reviews: extracted.reviews,
    };
  } catch (error: unknown) {
    logger.error('Erreur analyse produit AliExpress', error instanceof Error ? error : new Error(String(error)), {
      url: productUrl,
    });
    throw error;
  }
}

/**
 * Recherche intelligente avec scoring
 */
export async function smartAliExpressSearch(
  query: string,
  options?: {
    category?: string;
    maxPrice?: number;
    minRating?: number;
  }
): Promise<AliExpressSearchResult[]> {
  const results = await searchAliExpressProducts({
    query,
    maxPrice: options?.maxPrice,
    minRating: options?.minRating || 4.0,
    sortBy: 'rating',
    limit: 10,
  });

  // Scorer les résultats
  const scored = results.map(product => ({
    ...product,
    score: calculateProductScore(product, options),
  }));

  // Trier par score
  interface ScoredProduct extends AliExpressSearchResult {
    score: number;
  }
  return (scored as ScoredProduct[])
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score: _score, ...product }) => product);
}

/**
 * Calculer un score de qualité pour un produit
 */
function calculateProductScore(
  product: AliExpressSearchResult,
  options?: { category?: string; maxPrice?: number }
): number {
  let score = 0;

  // Rating (0-50 points)
  if (product.rating) {
    score += product.rating * 10;
  }

  // Orders (0-30 points)
  if (product.orders) {
    score += Math.min(30, Math.log10(product.orders + 1) * 10);
  }

  // Prix raisonnable (0-20 points)
  if (options?.maxPrice && product.price <= options.maxPrice) {
    score += 20;
  } else if (product.price < 100) {
    score += 10;
  }

  // Titre complet (0-10 points)
  if (product.title.length > 20) {
    score += 10;
  }

  return score;
}

// Helpers
function extractPriceFromText(text: string): number {
  if (!text) return 0;
  // Extraire prix depuis texte (ex: "€12.99", "12,99€", "$12.99", "US $12.99")
  const match = text.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(',', '.'));
  }
  return 0;
}

function extractRating(text: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(\d+\.?\d*)/);
  if (match) {
    const rating = parseFloat(match[1]);
    return rating > 0 && rating <= 5 ? rating : undefined;
  }
  return undefined;
}

function parseOrders(text: string): number | undefined {
  if (!text) return undefined;
  // Extraire nombre de commandes (ex: "1.2k", "500+", "1234", "1.2k orders")
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*([km]?)\+?/i);
  if (match) {
    let num = parseFloat(match[1].replace(',', ''));
    const unit = match[2].toLowerCase();
    if (unit === 'k') num *= 1000;
    if (unit === 'm') num *= 1000000;
    return Math.floor(num);
  }
  return undefined;
}

function extractProductIdFromUrl(url: string): string {
  // Extraire ID produit depuis URL AliExpress
  const match = url.match(/item\/(\d+)\.html/) || url.match(/product\/(\d+)/) || url.match(/\/(\d+)\.html/);
  return match ? match[1] : url.split('/').pop()?.replace('.html', '') || '';
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 200);
}

function sortProducts(
  products: AliExpressSearchResult[],
  sortBy: string
): AliExpressSearchResult[] {
  const sorted = [...products];

  switch (sortBy) {
    case 'price':
      return sorted.sort((a, b) => a.price - b.price);
    case 'rating':
      return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    case 'orders':
      return sorted.sort((a, b) => (b.orders || 0) - (a.orders || 0));
    default:
      return sorted;
  }
}

