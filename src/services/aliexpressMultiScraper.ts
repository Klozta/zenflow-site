/**
 * Scraper AliExpress Multi-Méthodes
 * Essaie plusieurs méthodes gratuites avant ScraperAPI
 * Basé sur recherches Perplexity 2025
 */
import axios from 'axios';
import { Browser, chromium, Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';

interface ScrapeResult {
  html: string;
  success: boolean;
  method: 'playwright' | 'apify' | 'zenrows' | 'scraperapi' | 'direct';
  jsonData?: any; // Données JSON extraites depuis window.runParams (plus fiable)
  extractedData?: { // Données extraites directement depuis le DOM (alternative)
    title?: string;
    price?: number;
    images?: string[];
  };
}

function isComplianceStrict(): boolean {
  const mode = (process.env.COMPLIANCE_MODE || 'strict').toLowerCase().trim();
  return mode !== 'off' && mode !== 'permissive';
}

/**
 * Méthode 1 : Apify AliExpress Scraper (GRATUIT avec essai)
 * Alternative gratuite à ScraperAPI
 */
export async function scrapeWithApify(url: string, apiKey?: string): Promise<ScrapeResult> {
  // Si pas de clé, on ne peut pas utiliser Apify
  if (!apiKey) {
    return { html: '', success: false, method: 'apify' };
  }

  try {
    if (isComplianceStrict()) {
      logger.warn('Apify désactivé (COMPLIANCE_MODE=strict)', { url });
      return { html: '', success: false, method: 'apify' };
    }

    logger.info('Tentative scraping avec Apify', { url });

    // Apify Actor pour AliExpress
    const actorId = 'logical_scrapers/aliexpress-scraper';
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs`;

    // Démarrer un run
    const runResponse = await axios.post(
      runUrl,
      {
        startUrls: [{ url }],
        maxItems: 1,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const runId = runResponse.data.data.id;
    logger.debug('Run Apify démarré', { runId });

    // Attendre que le run se termine (max 60s)
    let attempts = 0;
    while (attempts < 12) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Attendre 5s

      const statusResponse = await axios.get(
        `https://api.apify.com/v2/actor-runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );

      const status = statusResponse.data.data.status;
      if (status === 'SUCCEEDED') {
        // Récupérer les résultats
        const resultsResponse = await axios.get(
          `https://api.apify.com/v2/datasets/${runResponse.data.data.defaultDatasetId}/items`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          }
        );

        const product = resultsResponse.data[0];
        if (product) {
          // Convertir en HTML simulé pour compatibilité
          const html = `
            <html>
              <head><title>${product.title || ''}</title></head>
              <body>
                <h1 data-pl="product-title">${product.title || ''}</h1>
                <div data-pl="price" class="price-current">${product.price || ''}</div>
                <div data-pl="product-description">${product.description || ''}</div>
                ${product.images?.map((img: string) => `<img src="${img}" />`).join('') || ''}
              </body>
            </html>
          `;
          logger.info('Scraping Apify réussi', { url });
          return { html, success: true, method: 'apify' };
        }
      } else if (status === 'FAILED' || status === 'ABORTED') {
        break;
      }

      attempts++;
    }

    return { html: '', success: false, method: 'apify' };
  } catch (error: unknown) {
    logger.warn('Erreur scraping Apify', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return { html: '', success: false, method: 'apify' };
  }
}

/**
 * Méthode 2 : ZenRows (GRATUIT avec essai)
 * Alternative gratuite à ScraperAPI
 */
export async function scrapeWithZenRows(url: string, apiKey?: string): Promise<ScrapeResult> {
  if (!apiKey) {
    return { html: '', success: false, method: 'zenrows' };
  }

  try {
    if (isComplianceStrict()) {
      logger.warn('ZenRows désactivé (COMPLIANCE_MODE=strict)', { url });
      return { html: '', success: false, method: 'zenrows' };
    }

    logger.info('Tentative scraping avec ZenRows', { url });

    const zenRowsUrl = `https://api.zenrows.com/v1/?apikey=${apiKey}&url=${encodeURIComponent(url)}&js_render=true&premium_proxy=true`;

    const response = await retryNetwork(
      () => axios.get(zenRowsUrl, {
        timeout: 30000,
      }),
      {
        maxRetries: 3,
        initialDelay: 2000,
      }
    );

    const html = typeof response.data === 'string' ? response.data : '';

    if (html.length < 5000 || html.includes('captcha') || html.includes('blocked')) {
      return { html, success: false, method: 'zenrows' };
    }

    logger.info('Scraping ZenRows réussi', { url, contentLength: html.length });
    return { html, success: true, method: 'zenrows' };
  } catch (error: unknown) {
    logger.warn('Erreur scraping ZenRows', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return { html: '', success: false, method: 'zenrows' };
  }
}

/**
 * Méthode 3 : Playwright Ultra-Amélioré avec techniques avancées
 * Basé sur recherches Perplexity (DMTG, mouvements souris réalistes)
 */
export async function scrapeWithPlaywrightAdvanced(url: string): Promise<ScrapeResult> {
  let browser: Browser | null = null;

  try {
    if (isComplianceStrict()) {
      logger.warn('Playwright ultra-stealth désactivé (COMPLIANCE_MODE=strict)', { url });
      return { html: '', success: false, method: 'playwright' };
    }

    logger.info('Tentative scraping Playwright ultra-amélioré', { url });

    // Configuration browser ultra-stealth
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--disable-notifications',
        '--window-size=1920,1080',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      permissions: [],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });

    // Masquer tous les signaux d'automatisation
    await context.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = globalThis as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = win.navigator as any;

      // Masquer webdriver
      Object.defineProperty(nav, 'webdriver', {
        get: () => false,
        configurable: true,
      });

      // Masquer chrome
      win.chrome = {
        runtime: {},
        loadTimes: function() {},
        csi: function() {},
        app: {},
      };

      // Permissions
      if (nav.permissions) {
        const originalQuery = nav.permissions.query;
        nav.permissions.query = (parameters: any) => {
          if (parameters.name === 'notifications') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return Promise.resolve({ state: (win.Notification as any)?.permission || 'default' });
          }
          return originalQuery ? originalQuery(parameters) : Promise.resolve({ state: 'granted' });
        };
      }

      // Plugins réalistes
      Object.defineProperty(nav, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      // Languages
      Object.defineProperty(nav, 'languages', {
        get: () => ['fr-FR', 'fr', 'en-US', 'en'],
      });

      // Hardware concurrency
      Object.defineProperty(nav, 'hardwareConcurrency', {
        get: () => 8,
      });

      // Platform
      Object.defineProperty(nav, 'platform', {
        get: () => 'Win32',
      });
    });

    const page = await context.newPage();

    // Aller sur la page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Attendre chargement initial
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Simulation comportement humain avancée (basé sur DMTG)
    await simulateAdvancedHumanBehavior(page);

    // Attendre que le contenu soit chargé
    try {
      await Promise.race([
        page.waitForSelector('h1, [data-pl="product-title"], .product-title, body', { timeout: 10000 }).catch(() => null),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // Continuer
    }

    // Extraire données JSON depuis window.runParams (plus fiable que parsing HTML)
    let jsonData: any = null;
    try {
      jsonData = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis as any;
        // Essayer window.runParams (structure principale AliExpress)
        if (win.runParams) {
          return win.runParams;
        }
        // Essayer aussi window.__INITIAL_STATE__ ou autres structures
        if (win.__INITIAL_STATE__) {
          return win.__INITIAL_STATE__;
        }
        // Essayer window.__PRELOADED_STATE__
        if (win.__PRELOADED_STATE__) {
          return win.__PRELOADED_STATE__;
        }
        return null;
      });
      if (jsonData) {
        logger.debug('Données JSON extraites depuis window.runParams', { hasData: !!jsonData });
      }
    } catch (error) {
      logger.debug('Impossible d\'extraire JSON depuis window.runParams', { error: (error as Error).message });
    }

    // NOUVELLE MÉTHODE : Extraire directement depuis le DOM (plus fiable que parsing HTML)
    let extractedData: { title?: string; price?: number; images?: string[] } | undefined;
    try {
      extractedData = await page.evaluate(() => {
        // Code s'exécute dans le navigateur - TypeScript ignore les types DOM
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = win.document as any;
        const result: { title?: string; price?: number; images?: string[] } = {};

        // Titre - Chercher dans plusieurs sélecteurs
        const titleSelectors = [
          'h1[data-pl="product-title"]',
          'h1.product-title-text',
          'h1[class*="product-title"]',
          'h1',
        ];
        for (const selector of titleSelectors) {
          const el = doc.querySelector(selector);
          if (el && el.textContent && el.textContent.trim().length > 0 && el.textContent.trim().length < 300) {
            result.title = el.textContent.trim();
            break;
          }
        }

        // Prix - PRIORISER le prix de vente réel (pas le prix original)
        // Sélecteurs pour prix de vente (priorité)
        const salePriceSelectors = [
          '[data-pl="price"] .price-current', // Prix actuel (priorité)
          '.product-price-current span', // Prix actuel produit
          '.product-price-current', // Prix actuel produit
          '.price-current', // Prix actuel général
          '[class*="price-current"]', // Toute classe avec price-current
          '.sale-price', // Prix de vente explicite
          '[class*="sale-price"]', // Classe avec sale-price
          '.price-sale', // Prix de vente
          '[data-pl="price"] .notranslate', // Prix dans notranslate
        ];

        // Sélecteurs génériques (fallback)
        const genericPriceSelectors = [
          '.notranslate[data-pl="price"]',
          '[data-pl="price"]',
          '.price-value',
          '.price',
          '[itemprop="price"]',
          'meta[property="product:price:amount"]',
        ];

        // Éviter ces sélecteurs (prix original/barre)
        const avoidSelectors = [
          '.price-original',
          '.price-before',
          '[class*="price-original"]',
          '[class*="price-before"]',
          '.original-price',
        ];

        // Fonction pour extraire prix depuis un élément
        const extractPriceFromElement = (el: any, selector: string): number | null => {
          let priceText = '';
          if (selector.startsWith('meta')) {
            priceText = el.getAttribute('content')?.trim() || '';
          } else {
            priceText = el.textContent?.trim() || '';
          }
          if (priceText) {
            const priceMatch = priceText.match(/[\d,]+\.?\d*/);
            if (priceMatch) {
              const price = parseFloat(priceMatch[0].replace(',', '.').replace(/\s/g, ''));
              if (!isNaN(price) && price > 0 && price < 100000) {
                return price;
              }
            }
          }
          return null;
        };

        // PRIORITÉ 1 : Chercher prix de vente (le plus bas, le réel)
        let foundPrices: number[] = [];
        for (const selector of salePriceSelectors) {
          const el = doc.querySelector(selector);
          if (el) {
            const price = extractPriceFromElement(el, selector);
            if (price) {
              foundPrices.push(price);
            }
          }
        }

        // Prendre le prix le plus bas (le prix réel de vente)
        if (foundPrices.length > 0) {
          result.price = Math.min(...foundPrices);
        } else {
          // PRIORITÉ 2 : Sélecteurs génériques (mais éviter prix original)
          for (const selector of genericPriceSelectors) {
            const el = doc.querySelector(selector);
            if (el) {
              // Vérifier que ce n'est pas un prix original
              let isOriginalPrice = false;
              for (const avoidSelector of avoidSelectors) {
                if (el.matches && el.matches(avoidSelector)) {
                  isOriginalPrice = true;
                  break;
                }
              }
              if (!isOriginalPrice) {
                const price = extractPriceFromElement(el, selector);
                if (price) {
                  foundPrices.push(price);
                }
              }
            }
          }

          // Prendre le prix le plus bas trouvé
          if (foundPrices.length > 0) {
            result.price = Math.min(...foundPrices);
          }
        }

        // Si toujours pas de prix, chercher dans tous les éléments avec "price" dans la classe
        if (!result.price) {
          const allPriceElements = doc.querySelectorAll('[class*="price"], [id*="price"]');
          for (let i = 0; i < allPriceElements.length; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const el = allPriceElements[i] as any;
            const priceText = el.textContent?.trim() || '';
            if (priceText) {
              const priceMatch = priceText.match(/[\d,]+\.?\d*/);
              if (priceMatch) {
                const price = parseFloat(priceMatch[0].replace(',', '.').replace(/\s/g, ''));
                if (!isNaN(price) && price > 0.01 && price < 100000) {
                  result.price = price;
                  break;
                }
              }
            }
          }
        }

        // Si prix non trouvé, essayer depuis window.runParams directement dans le navigateur
        // PRIORISER salePrice (prix réel) au lieu de originalPrice
        if (!result.price) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win = globalThis as any;
          if (win.runParams) {
            const data = win.runParams;
            const jsonPrices: number[] = [];

            // PRIORITÉ : Chercher salePrice d'abord (prix réel de vente)
            const salePricePaths = [
              data?.data?.priceComponent?.salePrice?.value,
              data?.data?.priceComponent?.salePrice,
              data?.data?.productInfoComponent?.productDO?.salePrice?.value,
              data?.data?.productInfoComponent?.productDO?.salePrice,
              data?.product?.salePrice?.value,
              data?.product?.salePrice,
              data?.salePrice?.value,
              data?.salePrice,
            ];

            // Fallback : price (peut être le prix actuel)
            const pricePaths = [
              data?.data?.priceComponent?.price?.value,
              data?.data?.priceComponent?.price,
              data?.data?.productInfoComponent?.productDO?.price?.value,
              data?.product?.price?.value,
              data?.product?.price,
              data?.price?.value,
              data?.price,
            ];

            // Extraire tous les prix valides
            for (const priceValue of [...salePricePaths, ...pricePaths]) {
              if (priceValue) {
                const price = typeof priceValue === 'number' ? priceValue : parseFloat(String(priceValue).replace(/[^\d,.]/g, '').replace(',', '.'));
                if (!isNaN(price) && price > 0 && price < 100000) {
                  jsonPrices.push(price);
                }
              }
            }

            // Prendre le prix le plus bas (le prix réel de vente)
            if (jsonPrices.length > 0) {
              result.price = Math.min(...jsonPrices);
            }
          }
        }

        // Images - Extraire URLs images
        const images: string[] = [];
        const imgElements = doc.querySelectorAll('img[data-src], img[src]');
        for (let i = 0; i < imgElements.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const img = imgElements[i] as any;
          const src = img.getAttribute('data-src') || img.src || '';
          if (src && (src.includes('alicdn.com') || src.includes('ae01') || src.includes('ae02'))) {
            const fullUrl = src.startsWith('http') ? src : (src.startsWith('//') ? `https:${src}` : `https:${src}`);
            if (!images.includes(fullUrl) && !fullUrl.includes('logo') && !fullUrl.includes('icon')) {
              images.push(fullUrl);
            }
          }
        }
        result.images = images.slice(0, 5);

        return result;
      });

      if (extractedData && (extractedData.title || extractedData.price)) {
        logger.debug('Données extraites directement depuis le DOM', {
          hasTitle: !!extractedData.title,
          hasPrice: !!extractedData.price,
          hasImages: (extractedData.images && extractedData.images.length > 0) || false,
        });
      }
    } catch (error) {
      logger.debug('Impossible d\'extraire depuis le DOM', { error: (error as Error).message });
    }

    // Vérifier si c'est une page de blocage
    const content = await page.content();

    // Vérifier si le contenu contient des données produit (signe que ce n'est pas un blocage)
    const hasProductData = content.includes('product-title') ||
                          content.includes('data-pl="product-title"') ||
                          content.includes('price-current') ||
                          content.includes('product-description') ||
                          (content.length > 100000 && !content.includes('captcha') && !content.includes('punish'));

    // Si HTML est très court OU contient des signes de blocage ET pas de données produit
    if ((content.length < 5000 ||
         content.includes('captcha') ||
         content.includes('punish') ||
         content.includes('_config_') ||
         content.includes('blocked') ||
         content.includes('Access Denied')) && !hasProductData) {
      logger.warn('Page de blocage détectée avec Playwright avancé', { url, contentLength: content.length });
      return { html: content, success: false, method: 'playwright' };
    }

    // Si on a beaucoup de contenu et des données produit, considérer comme succès même si certains sélecteurs échouent
    if (hasProductData || content.length > 50000) {
      logger.info('Contenu valide détecté (peut contenir des données produit)', {
        url,
        contentLength: content.length,
        hasProductData,
        hasJsonData: !!jsonData,
        hasExtractedData: !!(extractedData?.title || extractedData?.price),
      });
      // Retourner le contenu même si certains sélecteurs ne matchent pas - l'extraction se fera côté extracteur
      return {
        html: content,
        success: true,
        method: 'playwright',
        jsonData: jsonData || undefined,
        extractedData: extractedData || undefined,
      };
    }

    logger.info('Scraping Playwright avancé réussi', {
      url,
      contentLength: content.length,
      hasJsonData: !!jsonData,
      hasExtractedData: !!(extractedData?.title || extractedData?.price),
    });
    return {
      html: content,
      success: true,
      method: 'playwright',
      jsonData: jsonData || undefined,
      extractedData: extractedData || undefined,
    };

  } catch (error: unknown) {
    logger.warn('Erreur scraping Playwright avancé', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return { html: '', success: false, method: 'playwright' };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Simulation comportement humain avancée (basé sur DMTG)
 * Mouvements souris réalistes avec trajectoires naturelles
 */
async function simulateAdvancedHumanBehavior(page: Page): Promise<void> {
  try {
    const viewport = page.viewportSize();
    if (!viewport) return;

    // Délai initial
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

    // Mouvement souris avec trajectoire naturelle (courbe de Bézier simulée)
    const startX = Math.random() * viewport.width;
    const startY = Math.random() * viewport.height;
    const endX = Math.random() * viewport.width;
    const endY = Math.random() * viewport.height;

    // Points de contrôle pour courbe naturelle
    const controlX = (startX + endX) / 2 + (Math.random() - 0.5) * 200;
    const controlY = (startY + endY) / 2 + (Math.random() - 0.5) * 200;

    // Mouvement en plusieurs étapes (trajectoire naturelle)
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Courbe de Bézier quadratique
      const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * endX;
      const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * endY;
      await page.mouse.move(x, y);
      await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 10));
    }

    // Scroll progressif avec accélération/décélération
    const scrollDistance = Math.random() * 500 + 300;
    const scrollSteps = 15;
    for (let i = 0; i < scrollSteps; i++) {
      const progress = i / scrollSteps;
      // Easing function (ease-in-out)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const scrollAmount = eased * scrollDistance / scrollSteps;

      await page.evaluate((amount) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).window.scrollBy(0, amount);
      }, scrollAmount);

      await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 30));
    }

    // Retour en haut avec scroll fluide
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Petit mouvement souris final
    await page.mouse.move(
      Math.random() * viewport.width,
      Math.random() * viewport.height,
      { steps: 5 }
    );

    // Délai final
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

  } catch (error) {
    // Ignorer erreurs
    logger.debug('Erreur simulation comportement avancé', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Scraper intelligent multi-méthodes
 * Essaie toutes les méthodes gratuites avant ScraperAPI
 */
export async function smartMultiScrape(url: string): Promise<ScrapeResult> {
  if (isComplianceStrict()) {
    logger.warn('smartMultiScrape désactivé en conformité stricte (AliExpress)', { url });
    return { html: '', success: false, method: 'playwright' };
  }

  logger.info('Démarrage scraping multi-méthodes', { url });

  const triedMethods: string[] = [];
  const availableMethods: string[] = [];

  // Méthode 1 : Playwright ultra-amélioré (GRATUIT, priorité)
  logger.info('Méthode 1/4 : Playwright ultra-amélioré', { url });
  triedMethods.push('Playwright ultra-amélioré');
  const playwrightResult = await scrapeWithPlaywrightAdvanced(url);
  if (playwrightResult.success) {
    logger.info('✅ Succès avec Playwright (gratuit, sans service externe)', { url });
    return playwrightResult;
  }
  logger.warn('Playwright a échoué, passage aux méthodes suivantes', { url });

  // Méthode 2 : Apify (GRATUIT avec essai)
  const apifyKey = process.env.APIFY_API_KEY;
  if (apifyKey) {
    availableMethods.push('Apify');
    logger.info('Méthode 2/4 : Apify (gratuit avec essai)', { url });
    triedMethods.push('Apify (gratuit)');
    const apifyResult = await scrapeWithApify(url, apifyKey);
    if (apifyResult.success) {
      logger.info('✅ Succès avec Apify', { url });
      return apifyResult;
    }
    logger.warn('Apify a échoué, passage à ZenRows', { url });
  } else {
    logger.debug('Apify non configuré (APIFY_API_KEY manquant)', { url });
  }

  // Méthode 3 : ZenRows (GRATUIT avec essai)
  const zenRowsKey = process.env.ZENROWS_API_KEY;
  if (zenRowsKey) {
    availableMethods.push('ZenRows');
    logger.info('Méthode 3/4 : ZenRows (gratuit avec essai)', { url });
    triedMethods.push('ZenRows (gratuit)');
    const zenRowsResult = await scrapeWithZenRows(url, zenRowsKey);
    if (zenRowsResult.success) {
      logger.info('✅ Succès avec ZenRows', { url });
      return zenRowsResult;
    }
    logger.warn('ZenRows a échoué, passage à ScraperAPI', { url });
  } else {
    logger.debug('ZenRows non configuré (ZENROWS_API_KEY manquant)', { url });
  }

  // Méthode 4 : ScraperAPI (Fallback si configuré)
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (scraperApiKey) {
    availableMethods.push('ScraperAPI');
    logger.info('Méthode 4/4 : ScraperAPI (fallback)', { url });
    triedMethods.push('ScraperAPI (fallback)');
    const scraperApiUrl = `http://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(url)}&render=true`;

    try {
      const response = await retryNetwork(
        () => axios.get(scraperApiUrl, { timeout: 30000 }),
        { maxRetries: 3, initialDelay: 2000 }
      );

      const html = typeof response.data === 'string' ? response.data : '';
      if (html.length > 5000 && !html.includes('captcha') && !html.includes('blocked')) {
        logger.info('✅ Succès avec ScraperAPI', { url });
        return { html, success: true, method: 'scraperapi' };
      }
      logger.warn('ScraperAPI a retourné une page de blocage', { url });
    } catch (error) {
      logger.warn('Erreur ScraperAPI', { error: error instanceof Error ? error.message : String(error) });
    }
  } else {
    logger.debug('ScraperAPI non configuré (SCRAPER_API_KEY manquant)', { url });
  }

  // Toutes les méthodes ont échoué
  logger.error('Toutes les méthodes de scraping ont échoué', new Error('Scraping failed'), {
    url,
    triedMethods: triedMethods.join(', '),
    availableMethods: availableMethods.length,
    notConfigured: availableMethods.length === 0 ? 'Aucune méthode alternative configurée' : 'Certaines méthodes alternatives non configurées'
  });

  return { html: '', success: false, method: 'playwright' };
}

