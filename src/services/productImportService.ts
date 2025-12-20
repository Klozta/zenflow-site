/**
 * Service d'import automatique de produits depuis un lien
 * Analyse prix, extrait infos, organise automatiquement
 */
import axios from 'axios';
import { load } from 'cheerio';
import { getSourcePolicy } from '../config/sourcePolicies.js';
import { ProductInput } from '../types/products.types.js';
import { getCachedAnalysis, setCachedAnalysis } from '../utils/cacheAnalysis.js';
import { cleanProductData, validateProductData } from '../utils/dataCleaning.js';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';
import { ComplianceLogger } from './compliance/complianceLogger.js';
import { enforceImportedProductWhitelist } from './compliance/productWhitelist.js';
import { RobotsValidator } from './compliance/robotsValidator.js';
import { downloadAndStoreImages } from './imageStorageService.js';
import { checkUrlAlreadyImported, createImportHistory } from './importHistoryService.js';
import { createProduct } from './productsService.js';
import { detectSiteType, extractBySiteType } from './siteSpecificExtractors.js';

interface ProductAnalysis {
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  images: string[];
  category?: string;
  tags: string[];
  suggestedPrice: number;
  margin: number;
  sourceUrl: string;
}

type ComplianceMode = 'strict' | 'permissive' | 'off';
type ComplianceDataScope = 'minimal' | 'full';

function getComplianceMode(): ComplianceMode {
  const raw = (process.env.COMPLIANCE_MODE || 'strict').toLowerCase().trim();
  if (raw === 'off') return 'off';
  if (raw === 'permissive') return 'permissive';
  return 'strict';
}

function getComplianceDataScope(): ComplianceDataScope {
  const raw = (process.env.COMPLIANCE_DATA_SCOPE || 'minimal').toLowerCase().trim();
  return raw === 'full' ? 'full' : 'minimal';
}

function getComplianceUserAgent(): string {
  // User-Agent clair = signal de bonne foi (pas de bot masqué)
  return (process.env.COMPLIANCE_USER_AGENT || 'ZenFlowProductImporter/1.0').trim();
}

function getComplianceDefaultCurrency(): string {
  return (process.env.COMPLIANCE_DEFAULT_CURRENCY || 'EUR').trim().slice(0, 8) || 'EUR';
}

function getComplianceDefaultAvailability(): string {
  return (process.env.COMPLIANCE_DEFAULT_AVAILABILITY || 'unknown').trim().slice(0, 64) || 'unknown';
}

const robotsValidator = new RobotsValidator({
  enabled: (process.env.COMPLIANCE_ROBOTS_ENABLED || 'true') === 'true',
  ttlSeconds: 86400,
});
const complianceLogger = new ComplianceLogger();

// Rate-limit très simple côté sorties HTTP (politesse)
const lastRequestByHost = new Map<string, number>();
async function politeDelayForHost(hostname: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const last = lastRequestByHost.get(hostname) || 0;
  const wait = Math.max(0, minIntervalMs - (now - last));
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastRequestByHost.set(hostname, Date.now());
}

/**
 * Analyse un lien produit et extrait toutes les informations
 */
export async function analyzeProductUrl(url: string): Promise<ProductAnalysis> {
  // Vérifier le cache
  const cached = getCachedAnalysis(url);
  if (cached) {
    logger.debug('Analyse récupérée depuis le cache', { url });
    return cached;
  }

  try {
    const siteType = detectSiteType(url);
    const isAliExpress = siteType === 'aliexpress';
    const complianceMode = getComplianceMode();
    const dataScope = getComplianceDataScope();
    const complianceUserAgent = getComplianceUserAgent();
    const hostname = new URL(url).hostname;
    const policy = getSourcePolicy(url);

    const checksBase = {
      complianceMode,
      dataScope,
      policy: {
        hostPattern: policy.hostPattern,
        cguStatus: policy.cguStatus,
        allowHtmlCrawl: policy.allowHtmlCrawl,
        apiOnly: policy.apiOnly,
      },
    };

    let htmlContent: string;
    let response: any;

    let jsonDataFromScraper: any = undefined;
    let extractedDataFromScraper: any = undefined;
    if (isAliExpress) {
      // Policy enforcement: si API-only, on bloque l'HTML crawl en mode conformité.
      if (policy.apiOnly && complianceMode !== 'off') {
        await complianceLogger.log({
          eventType: 'crawl_blocked_policy',
          sourceHost: hostname,
          userAgent: complianceUserAgent,
          complianceChecks: checksBase,
          errorMessage: 'Policy apiOnly: HTML crawl blocked (use Affiliate API)',
        });
        throw new Error('Source policy: AliExpress HTML crawl interdit. Utilisez une API/affiliation.');
      }

      // Conformité : en mode strict, on refuse les techniques anti-bot/stealth/fingerprint.
      // On tente au mieux une requête directe "polie" (souvent insuffisante sur AliExpress).
      if (complianceMode === 'strict') {
        // Si CGU inconnues, on interdit aussi le HTML crawl (default deny).
        if (policy.cguStatus !== 'allowed' || policy.allowHtmlCrawl !== true) {
          await complianceLogger.log({
            eventType: 'crawl_blocked_policy',
            sourceHost: hostname,
            userAgent: complianceUserAgent,
            complianceChecks: checksBase,
            errorMessage: 'Policy denies HTML crawl (CGU not allowed or allowHtmlCrawl=false)',
          });
          throw new Error('Source policy: crawling HTML interdit (CGU non validées).');
        }

        const robots = await robotsValidator.canFetch(url);
        await complianceLogger.log({
          eventType: 'crawl_attempt',
          sourceHost: hostname,
          userAgent: complianceUserAgent,
          cacheStatus: robots.cacheStatus,
          complianceChecks: { ...checksBase, robots },
        });
        if (!robots.allowed) {
          await complianceLogger.log({
            eventType: 'crawl_blocked_robots',
            sourceHost: hostname,
            userAgent: complianceUserAgent,
            cacheStatus: robots.cacheStatus,
            complianceChecks: { ...checksBase, robots },
            errorMessage: `robots.txt disallows: ${robots.reason}`,
          });
          throw new Error('Robots.txt interdit le crawl de cette URL.');
        }

        await politeDelayForHost(hostname, 1000);
        const start = Date.now();
        response = await retryNetwork(
          () => axios.get(url, {
            headers: {
              'User-Agent': complianceUserAgent,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
              'DNT': '1',
              'Cache-Control': 'no-cache',
            },
            timeout: 15000,
          }),
          { maxRetries: 2, initialDelay: 1500 }
        );
        await complianceLogger.log({
          eventType: 'crawl_success',
          sourceHost: hostname,
          userAgent: complianceUserAgent,
          httpStatus: response?.status,
          durationMs: Date.now() - start,
          complianceChecks: checksBase,
        });
        htmlContent = response.data;
      } else {
        // Pour AliExpress : utiliser le scraper multi-méthodes (zone grise / à risque)
        const { smartMultiScrape } = await import('./aliexpressMultiScraper.js');
        const scrapeResult = await smartMultiScrape(url);

        // Stocker les données JSON et extraites pour l'extracteur
        jsonDataFromScraper = scrapeResult.jsonData;
        extractedDataFromScraper = scrapeResult.extractedData;

        // Si on a des données extraites directement, les utiliser en priorité
        if (extractedDataFromScraper && (extractedDataFromScraper.title || extractedDataFromScraper.price)) {
          logger.info('Données extraites directement depuis le DOM (priorité)', {
            hasTitle: !!extractedDataFromScraper.title,
            hasPrice: !!extractedDataFromScraper.price,
            hasImages: (extractedDataFromScraper.images && extractedDataFromScraper.images.length > 0) || false,
          });
        }

        if (!scrapeResult.success) {
          // Construire message d'erreur détaillé
          const availableServices: string[] = [];
          if (process.env.APIFY_API_KEY) availableServices.push('Apify');
          if (process.env.ZENROWS_API_KEY) availableServices.push('ZenRows');
          if (process.env.SCRAPER_API_KEY) availableServices.push('ScraperAPI');

          let errorMsg = 'AliExpress bloque la requête. ';

          // Indiquer quelles méthodes ont été essayées
          const methodNames: Record<string, string> = {
            'playwright': 'Playwright ultra-amélioré',
            'apify': 'Apify',
            'zenrows': 'ZenRows',
            'scraperapi': 'ScraperAPI'
          };

          const triedMethodName = methodNames[scrapeResult.method] || 'Playwright';
          errorMsg += `Méthode essayée : ${triedMethodName}. `;

          // Suggestions basées sur ce qui est disponible
          if (availableServices.length === 0) {
            errorMsg += 'Solutions : 1) Réessayez dans quelques minutes 2) Configurez des alternatives gratuites : ./scripts/CONFIGURER-ALTERNATIVES-GRATUITES.sh 3) Configurez ScraperAPI : ./scripts/CONFIGURER-SCRAPERAPI-SIMPLE.sh';
          } else {
            errorMsg += `Autres méthodes configurées mais échouées : ${availableServices.join(', ')}. `;
            errorMsg += 'Solutions : 1) Réessayez dans quelques minutes 2) Vérifiez les clés API 3) Consultez les logs : tail -f /tmp/backend-start.log';
          }

          throw new Error(errorMsg);
        }

        htmlContent = scrapeResult.html;
        // Créer un objet response compatible
        response = { data: htmlContent };
      }
    } else {
      // Pour les autres sites : requête directe classique
      // En conformité, n'autoriser HTML crawl que si policy validée.
      if (complianceMode !== 'off') {
        if (policy.cguStatus !== 'allowed' || policy.allowHtmlCrawl !== true) {
          await complianceLogger.log({
            eventType: 'crawl_blocked_policy',
            sourceHost: hostname,
            userAgent: complianceUserAgent,
            complianceChecks: checksBase,
            errorMessage: 'Policy denies HTML crawl (CGU not allowed or allowHtmlCrawl=false)',
          });
          throw new Error('Source policy: crawling HTML interdit (CGU non validées).');
        }

        const robots = await robotsValidator.canFetch(url);
        await complianceLogger.log({
          eventType: 'crawl_attempt',
          sourceHost: hostname,
          userAgent: complianceUserAgent,
          cacheStatus: robots.cacheStatus,
          complianceChecks: { ...checksBase, robots },
        });
        if (!robots.allowed) {
          await complianceLogger.log({
            eventType: 'crawl_blocked_robots',
            sourceHost: hostname,
            userAgent: complianceUserAgent,
            cacheStatus: robots.cacheStatus,
            complianceChecks: { ...checksBase, robots },
            errorMessage: `robots.txt disallows: ${robots.reason}`,
          });
          throw new Error('Robots.txt interdit le crawl de cette URL.');
        }
      }

      await politeDelayForHost(hostname, 1000);
      const start = Date.now();
      response = await retryNetwork(
        () => axios.get(url, {
          headers: {
            // User-Agent clair (évite le bot masqué)
            'User-Agent': complianceUserAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'DNT': '1',
          },
          timeout: 15000,
        }),
        {
          maxRetries: 3,
          initialDelay: 1000,
        }
      );
      await complianceLogger.log({
        eventType: 'crawl_success',
        sourceHost: hostname,
        userAgent: complianceUserAgent,
        httpStatus: response?.status,
        durationMs: Date.now() - start,
        complianceChecks: checksBase,
      });
      htmlContent = response.data;
    }

    // Vérifier si c'est une page de blocage (déjà fait dans smartScrape pour AliExpress)
    if (typeof htmlContent === 'string') {
      // Vérification supplémentaire pour les autres sites
      if (!isAliExpress && htmlContent.length < 5000) {
        if (htmlContent.includes('captcha') || htmlContent.includes('blocked') || htmlContent.includes('Access Denied')) {
          throw new Error('Page de blocage détectée. Le site a bloqué la requête.');
        }
      }

      // Vérifier si c'est une page d'erreur (seulement si vraiment une erreur)
      if (htmlContent.includes('Sorry, we can\'t find that page') ||
          htmlContent.includes('Page Not Found') ||
          (htmlContent.includes('404') && htmlContent.length < 10000)) {
        throw new Error('Produit non trouvé. Vérifiez que l\'URL est correcte.');
      }
    }

    const $ = load(htmlContent);

    // PRIORITÉ 1 : Données extraites directement depuis le DOM (plus fiable)
    let rawTitle: string | undefined;
    let rawPrice: number | undefined;
    let rawImages: string[] | undefined;

    if (extractedDataFromScraper) {
      rawTitle = extractedDataFromScraper.title;
      rawPrice = extractedDataFromScraper.price;
      rawImages = extractedDataFromScraper.images;
      logger.debug('Utilisation données extraites depuis DOM', {
        hasTitle: !!rawTitle,
        hasPrice: !!rawPrice,
        hasImages: (rawImages && rawImages.length > 0) || false,
      });
    }

    // PRIORITÉ 2 : Extracteur spécialisé (JSON + sélecteurs CSS)
    if (!rawTitle || !rawPrice) {
      const siteSpecificData = await extractBySiteType(url, $, jsonDataFromScraper);
      rawTitle = rawTitle || siteSpecificData.title;
      rawPrice = rawPrice || siteSpecificData.price;
      rawImages = rawImages || (siteSpecificData.images && siteSpecificData.images.length > 0 ? siteSpecificData.images : undefined);
    }

    // PRIORITÉ 3 : Extracteurs génériques (fallback)
    rawTitle = rawTitle || extractTitle($);
    const rawDescription = extractDescription($);

    // Essayer extractPrice seulement si pas déjà trouvé (ne pas lancer d'erreur)
    if (!rawPrice || rawPrice === 0) {
      try {
        rawPrice = extractPrice($);
      } catch (error) {
        // Si extractPrice échoue, essayer une extraction plus permissive
        logger.debug('extractPrice a échoué, tentative extraction permissive', { url });
        // Ne pas lancer d'erreur, continuer avec rawPrice undefined
      }
    }

    rawImages = rawImages || extractImages($, url);

    // Mode conformité "minimal" : ne pas importer de description/images (PI + contenu protégé)
    const complianceMode2 = complianceMode;
    const dataScope2 = dataScope;
    if (complianceMode2 !== 'off' && dataScope2 === 'minimal') {
      rawImages = [];
    }

    // Log pour debugging si extraction échoue
    if (isAliExpress && (!rawTitle || rawTitle === 'Produit sans titre' || !rawPrice || rawPrice === 0)) {
      logger.warn('Extraction AliExpress partielle', {
        url,
        hasTitle: !!rawTitle,
        hasPrice: !!rawPrice && rawPrice > 0,
        hasImages: rawImages.length > 0,
        htmlLength: htmlContent.length,
      });
    }

    // Analyser et suggérer une catégorie (avant nettoyage pour meilleure détection)
    const category = analyzeCategory(rawTitle, rawDescription);

    // Générer des tags (avant nettoyage)
    const tags = generateTags(rawTitle, rawDescription, category);

    // Nettoyer toutes les données
    const cleaned = cleanProductData({
      title: rawTitle,
      description: (complianceMode !== 'off' && dataScope === 'minimal')
        ? 'Description non importée (mode conformité minimal).'
        : rawDescription,
      price: rawPrice,
      images: rawImages,
      category,
      tags,
      sourceUrl: url,
    });

    // Valider les données nettoyées (mais être plus tolérant pour le prix)
    const validation = validateProductData({
      title: cleaned.title,
      price: cleaned.price,
      images: cleaned.images,
    });

    // Si seulement le prix manque, logger un avertissement mais continuer avec 0
    if (!validation.valid) {
      const priceError = validation.errors.find(e => e.includes('prix') || e.includes('price'));
      if (priceError && validation.errors.length === 1) {
        logger.warn('Prix non trouvé, utilisation valeur par défaut 0', {
          url,
          title: cleaned.title,
          errors: validation.errors,
        });
        // Continuer avec prix = 0 (sera peut-être mis à jour plus tard)
        cleaned.price = 0;
      } else {
        // Si d'autres erreurs ou plusieurs erreurs, lancer l'erreur
        throw new Error(`Données invalides: ${validation.errors.join(', ')}`);
      }
    }

    // Analyser le prix et suggérer un prix de vente
    const priceAnalysis = analyzePrice(cleaned.price, cleaned.category || undefined);

    const result = {
      title: cleaned.title,
      description: cleaned.description,
      price: cleaned.price,
      originalPrice: cleaned.price,
      images: cleaned.images,
      category: cleaned.category || undefined,
      tags: cleaned.tags,
      suggestedPrice: priceAnalysis.suggestedPrice,
      margin: priceAnalysis.margin,
      sourceUrl: url,
    };

    // Whitelist hard-check (mode conformité): on valide une projection minimaliste des champs autorisés.
    // Si un champ interdit apparaît (images/description/PII), on stoppe net.
    if (complianceMode !== 'off') {
      const defaultCurrency = getComplianceDefaultCurrency();
      const defaultAvailability = getComplianceDefaultAvailability();
      const safeProjection = {
        productId: (() => {
          try {
            // Tentative d'extraction d'un ID stable depuis l'URL (fallback: hash côté DB si besoin).
            const u = new URL(url);
            const m = u.pathname.match(/(\d+)\.html/);
            return m?.[1] || `${u.hostname}${u.pathname}`.slice(0, 128);
          } catch {
            return url.slice(0, 128);
          }
        })(),
        title: cleaned.title.slice(0, 140),
        price: cleaned.price,
        currency: defaultCurrency,
        availability: defaultAvailability,
        sourceUrl: url,
        category: (cleaned.category || undefined) as string | undefined,
      };

      // En mode "minimal", description/images ne doivent pas sortir.
      // Note: safeProjection n'inclut pas ces champs, mais ce check protège aussi contre des injections accidentelles.
      enforceImportedProductWhitelist(safeProjection);
    }

    // Mettre en cache
    setCachedAnalysis(url, result);
    logger.info('Produit analysé avec succès', { url, title: cleaned.title });

    return result;
  } catch (error: any) {
    try {
      const hostname = new URL(url).hostname;
      await complianceLogger.log({
        eventType: 'crawl_error',
        sourceHost: hostname,
        userAgent: getComplianceUserAgent(),
        errorMessage: error?.message || 'unknown error',
        complianceChecks: {
          complianceMode: getComplianceMode(),
          dataScope: getComplianceDataScope(),
        },
      });
    } catch {
      // ignore non-blocking
    }
    logger.error('Erreur lors de l\'analyse du produit', error, { url });
    throw new Error(`Erreur lors de l'analyse du produit: ${error.message}`);
  }
}

/**
 * Extraire le titre du produit
 */
function extractTitle($: ReturnType<typeof load>): string {
  // Essayer plusieurs sélecteurs courants
  const selectors = [
    'h1.product-title',
    'h1[data-product-title]',
    'h1.product-name',
    '.product-title h1',
    'h1',
    'meta[property="og:title"]',
    'title',
  ];

  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length) {
      const text = selector.startsWith('meta')
        ? element.attr('content')
        : element.text().trim();
      if (text && text.length > 0 && text.length < 200) {
        return text;
      }
    }
  }

  return 'Produit sans titre';
}

/**
 * Extraire la description
 */
function extractDescription($: ReturnType<typeof load>): string {
  const selectors = [
    '.product-description',
    '.description',
    '[data-product-description]',
    'meta[name="description"]',
    'meta[property="og:description"]',
    'p.description',
  ];

  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length) {
      const text = selector.startsWith('meta')
        ? element.attr('content')
        : element.text().trim();
      if (text && text.length > 20) {
        return text.substring(0, 1000); // Limiter à 1000 caractères
      }
    }
  }

  return 'Description non disponible';
}

/**
 * Extraire le prix
 */
function extractPrice($: ReturnType<typeof load>): number {
  const selectors = [
    '.price',
    '.product-price',
    '[data-price]',
    '.current-price',
    'meta[property="product:price:amount"]',
    '.price-current',
  ];

  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length) {
      let priceText = selector.startsWith('meta')
        ? element.attr('content')
        : element.text().trim();

      if (priceText) {
        // Nettoyer le texte du prix
        priceText = priceText.replace(/[^\d,.]/g, '').replace(',', '.');
        const price = parseFloat(priceText);
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
  }

  throw new Error('Prix non trouvé');
}

/**
 * Extraire les images
 */
function extractImages($: ReturnType<typeof load>, baseUrl: string): string[] {
  const images: string[] = [];

  // Essayer les images produit
  const selectors = [
    '.product-image img',
    '.product-gallery img',
    '[data-product-image]',
    'meta[property="og:image"]',
    '.main-image img',
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const src = selector.startsWith('meta')
        ? $(el).attr('content')
        : $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');

      if (src) {
        const fullUrl = src.startsWith('http') ? src : new URL(src, baseUrl).toString();
        if (!images.includes(fullUrl)) {
          images.push(fullUrl);
        }
      }
    });

    if (images.length > 0) break;
  }

  // Si aucune image trouvée, essayer og:image
  if (images.length === 0) {
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) {
      images.push(ogImage.startsWith('http') ? ogImage : new URL(ogImage, baseUrl).toString());
    }
  }

  return images.slice(0, 5); // Limiter à 5 images
}

/**
 * Analyser et suggérer une catégorie
 */
function analyzeCategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();

  const categories: Record<string, string[]> = {
    'Imprimante 3D': ['imprimante 3d', '3d printer', 'imprimante3d', 'printer 3d', 'fuseur', 'fused deposition', 'fdm', 'sla', 'resin', 'impression 3d'],
    'Bijoux': ['bijou', 'collier', 'bracelet', 'boucle', 'bague', 'pendentif', 'piercing'],
    'Accessoires': ['sac', 'porte-clés', 'porte-monnaie', 'ceinture', 'chapeau', 'écharpe'],
    'Décoration': ['déco', 'décoration', 'tableau', 'cadre', 'vase', 'bougie', 'luminaires'],
    'Textile': ['tissu', 'tissus', 'tissu', 'linge', 'serviette', 'coussins'],
    'Cosmétique': ['maquillage', 'cosmétique', 'crème', 'savon', 'shampooing', 'parfum'],
    'Maison': ['maison', 'cuisine', 'ménage', 'nettoyage', 'organisateur'],
    'Mode': ['vêtement', 'vêtements', 'robe', 'pantalon', 'chemise', 't-shirt'],
    'Noël': ['noël', 'sapin', 'déco noël', 'guirlande', 'boules'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return category;
    }
  }

  return 'Autre';
}

/**
 * Générer des tags automatiques
 */
function generateTags(title: string, description: string, category: string): string[] {
  const tags: string[] = [category];
  const text = `${title} ${description}`.toLowerCase();

  // Tags par mots-clés
  const tagKeywords: Record<string, string[]> = {
    'fait-main': ['fait main', 'artisanal', 'artisan', 'création'],
    'personnalisable': ['personnalisé', 'personnalisable', 'gravure', 'nom'],
    'cadeau': ['cadeau', 'offrir', 'idée cadeau'],
    'tendance': ['tendance', 'mode', 'style', 'fashion'],
    'écologique': ['bio', 'écologique', 'éco', 'durable', 'recyclé'],
  };

  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      tags.push(tag);
    }
  }

  // Extraire quelques mots-clés du titre
  const titleWords = title.toLowerCase().split(/\s+/).filter(word => word.length > 4);
  tags.push(...titleWords.slice(0, 3));

  return [...new Set(tags)].slice(0, 10); // Limiter à 10 tags
}

/**
 * Analyser le prix et suggérer un prix de vente
 */
function analyzePrice(originalPrice: number, category?: string): { suggestedPrice: number; margin: number } {
  // Marges par catégorie (en pourcentage)
  const margins: Record<string, number> = {
    'Imprimante 3D': 30,  // 30% de marge (produits techniques)
    'Bijoux': 150,      // 150% de marge
    'Accessoires': 100,  // 100% de marge
    'Décoration': 80,    // 80% de marge
    'Textile': 70,      // 70% de marge
    'Cosmétique': 120,  // 120% de marge
    'Maison': 90,       // 90% de marge
    'Mode': 100,        // 100% de marge
    'Noël': 100,        // 100% de marge
    'Autre': 80,        // 80% de marge par défaut
  };

  const marginPercent = category ? margins[category] || 80 : 80;
  const margin = (originalPrice * marginPercent) / 100;
  const suggestedPrice = Math.round((originalPrice + margin) * 100) / 100;

  return {
    suggestedPrice,
    margin: marginPercent,
  };
}

/**
 * Importer un produit depuis un lien
 */
export async function importProductFromUrl(
  url: string,
  options?: {
    useSuggestedPrice?: boolean;
    customPrice?: number;
    customCategory?: string;
    stock?: number;
  }
): Promise<ProductInput> {
  // En mode conformité "minimal", on interdit la création de produit complet (description/images)
  // pour éviter toute réutilisation non autorisée (PI/CGU). Utiliser l'analyse uniquement.
  if (getComplianceMode() !== 'off' && getComplianceDataScope() === 'minimal') {
    throw new Error(
      "Mode conformité actif (dataScope=minimal) : création de produit désactivée. Utilisez l'analyse (/import/analyze) ou passez COMPLIANCE_DATA_SCOPE=full / COMPLIANCE_MODE=off."
    );
  }

  // Analyser le produit
  const analysis = await analyzeProductUrl(url);

  // Préparer les données du produit
  const productData: ProductInput = {
    title: analysis.title,
    description: analysis.description,
    price: options?.customPrice || (options?.useSuggestedPrice ? analysis.suggestedPrice : analysis.price),
    category: options?.customCategory || analysis.category || 'Autre',
    stock: options?.stock || 10, // Stock par défaut
    images: analysis.images,
    tags: analysis.tags,
  };

  return productData;
}

/**
 * Importer et créer un produit directement
 */
export async function importAndCreateProduct(
  url: string,
  options?: {
    useSuggestedPrice?: boolean;
    customPrice?: number;
    customCategory?: string;
    stock?: number;
    downloadImages?: boolean; // Nouvelle option pour télécharger les images
  }
) {
  // En mode conformité "minimal", on interdit la création de produit complet (description/images)
  // pour éviter toute réutilisation non autorisée (PI/CGU). Utiliser l'analyse uniquement.
  if (getComplianceMode() !== 'off' && getComplianceDataScope() === 'minimal') {
    throw new Error(
      "Mode conformité actif (dataScope=minimal) : création de produit désactivée. Utilisez l'analyse (/import/analyze) ou passez COMPLIANCE_DATA_SCOPE=full / COMPLIANCE_MODE=off."
    );
  }

  const siteType = detectSiteType(url);
  let product: any = null;
  let errorMessage: string | null = null;
  // const startTime = Date.now(); // Non utilisé

  try {
    // Vérifier si déjà importé
    const alreadyImported = await checkUrlAlreadyImported(url);
    if (alreadyImported.imported && alreadyImported.productId) {
      logger.info('Produit déjà importé', { url, productId: alreadyImported.productId });
      // Retourner le produit existant
      const { getProductById } = await import('./productsService.js');
      const existingProduct = await getProductById(alreadyImported.productId);
      if (existingProduct) {
        return {
          product: existingProduct,
          analysis: {
            originalPrice: 0,
            suggestedPrice: 0,
            margin: 0,
          },
          alreadyImported: true,
        };
      }
    }

    // Analyser le produit pour obtenir toutes les infos
    const analysis = await analyzeProductUrl(url);

    // Télécharger et stocker les images si demandé
    let imageUrls = analysis.images;
    const complianceMode = getComplianceMode();
    const allowDownloadImages =
      options?.downloadImages === true &&
      complianceMode === 'off' &&
      process.env.NODE_ENV !== 'production'; // sécurité: jamais télécharger d'images en prod
    if (allowDownloadImages) { // En conformité, téléchargement d'images doit être explicitement activé + mode off
      try {
        const storedImages = await downloadAndStoreImages(analysis.images);
        imageUrls = storedImages.map(img => img.url);
      } catch (error: any) {
        logger.warn('Erreur téléchargement images, utilisation URLs originales', { url, error: error.message });
        // En cas d'erreur, utiliser les URLs originales
        imageUrls = analysis.images;
      }
    }

    // Préparer les données du produit
    const productData: ProductInput = {
      title: analysis.title,
      description: analysis.description,
      price: options?.customPrice || (options?.useSuggestedPrice ? analysis.suggestedPrice : analysis.price),
      category: options?.customCategory || analysis.category || 'Autre',
      stock: options?.stock || 10,
      images: imageUrls,
      tags: analysis.tags,
    };

    product = await createProduct(productData);

    // Si les images ont été téléchargées, mettre à jour avec l'ID du produit
    if (allowDownloadImages && product.id) {
      try {
        const storedImages = await downloadAndStoreImages(analysis.images, product.id);
        const finalImageUrls = storedImages.map(img => img.url);

        // Mettre à jour le produit avec les bonnes URLs
        if (JSON.stringify(finalImageUrls) !== JSON.stringify(imageUrls)) {
          // Les URLs ont changé, mettre à jour le produit
          const { updateProduct } = await import('./productsService.js');
          await updateProduct(product.id, { images: finalImageUrls });
          product.images = finalImageUrls;
        }
      } catch (error: any) {
        logger.warn('Erreur mise à jour images avec ID produit', { productId: product.id, error: error.message });
      }
    }

    // Enregistrer dans l'historique (succès)
    try {
      await createImportHistory({
        url,
        productId: product.id,
        status: 'success',
        originalPrice: analysis.price,
        finalPrice: productData.price,
        suggestedPrice: analysis.suggestedPrice,
        margin: analysis.margin,
        category: productData.category || null,
        sourceSite: siteType,
      });
    } catch (error: any) {
      logger.warn('Erreur enregistrement historique', { url, error: error.message });
    }

    return {
      product,
      analysis: {
        originalPrice: analysis.price,
        suggestedPrice: analysis.suggestedPrice,
        margin: analysis.margin,
      },
    };
  } catch (error: any) {
    errorMessage = error.message || 'Erreur inconnue';

    // Enregistrer dans l'historique (échec)
    try {
      await createImportHistory({
        url,
        productId: null,
        status: 'failed',
        originalPrice: 0,
        finalPrice: 0,
        suggestedPrice: 0,
        margin: 0,
        category: null,
        sourceSite: siteType,
        errorMessage,
      });
    } catch (histError: any) {
      logger.warn('Erreur enregistrement historique', { url, error: histError.message });
    }

    throw error;
  }
}
