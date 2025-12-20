/**
 * Scraper AliExpress avancé avec techniques anti-détection
 * Essaie d'abord sans service externe, utilise ScraperAPI en dernier recours
 */
import axios from 'axios';
import { Browser, chromium, Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { retryNetwork } from '../utils/retry.js';

interface ScrapeResult {
  html: string;
  success: boolean;
  method: 'playwright' | 'scraperapi' | 'direct';
  jsonData?: any; // Données JSON extraites depuis window.runParams
}

function isComplianceStrict(): boolean {
  const mode = (process.env.COMPLIANCE_MODE || 'strict').toLowerCase().trim();
  return mode !== 'off' && mode !== 'permissive';
}

/**
 * User agents réalistes pour rotation
 */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/**
 * Obtenir un user agent aléatoire
 */
function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Délai aléatoire pour simuler comportement humain
 */
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Simuler comportement humain sur la page
 */
async function simulateHumanBehavior(page: Page): Promise<void> {
  try {
    // Délai initial aléatoire
    await randomDelay(1000, 3000);

    // Scroll progressif comme un humain
    const scrollSteps = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < scrollSteps; i++) {
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).window.scrollBy(0, Math.random() * 500 + 200);
      });
      await randomDelay(300, 800);
    }

    // Mouvement souris aléatoire
    const viewport = page.viewportSize();
    if (viewport) {
      const x = Math.random() * viewport.width;
      const y = Math.random() * viewport.height;
      await page.mouse.move(x, y, { steps: 5 });
      await randomDelay(200, 500);
    }

    // Retour en haut
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).window.scrollTo(0, 0);
    });
    await randomDelay(500, 1000);
  } catch (error) {
    // Ignorer erreurs de simulation
    logger.debug('Erreur simulation comportement humain', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Configurer Playwright avec anti-détection avancée
 */
async function createStealthBrowser(): Promise<Browser> {
  const browser = await chromium.launch({
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
    ],
  });

  return browser;
}

/**
 * Créer un contexte avec fingerprinting aléatoire
 */
async function createStealthContext(browser: Browser) {
  const userAgent = getRandomUserAgent();
  const viewportWidth = Math.floor(Math.random() * 400) + 1280; // 1280-1680
  const viewportHeight = Math.floor(Math.random() * 200) + 720; // 720-920

  const context = await browser.newContext({
    userAgent,
    viewport: { width: viewportWidth, height: viewportHeight },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    permissions: [],
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
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
    },
  });

  // Masquer les signaux d'automatisation
  await context.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = globalThis as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = win.navigator as any;

    // Masquer webdriver
    Object.defineProperty(nav, 'webdriver', {
      get: () => false,
    });

    // Masquer chrome
    win.chrome = {
      runtime: {},
    };

    // Permissions API
    const originalQuery = nav.permissions?.query;
    if (nav.permissions) {
      nav.permissions.query = (parameters: any) => {
        if (parameters.name === 'notifications') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return Promise.resolve({ state: (win.Notification as any)?.permission || 'default' });
        }
        return originalQuery ? originalQuery(parameters) : Promise.resolve({ state: 'granted' });
      };
    }

    // Plugins
    Object.defineProperty(nav, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Languages
    Object.defineProperty(nav, 'languages', {
      get: () => ['fr-FR', 'fr', 'en-US', 'en'],
    });
  });

  return context;
}

/**
 * Scraper avec Playwright (méthode principale - sans service externe)
 */
export async function scrapeWithPlaywright(url: string): Promise<ScrapeResult> {
  let browser: Browser | null = null;

  try {
    if (isComplianceStrict()) {
      logger.warn('Scraping AliExpress stealth désactivé (COMPLIANCE_MODE=strict)', { url });
      return { html: '', success: false, method: 'playwright' };
    }

    logger.info('Tentative scraping avec Playwright (anti-détection)', { url });

    browser = await createStealthBrowser();
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    // Aller sur la page avec délai
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Attendre un peu pour que le contenu se charge
    await randomDelay(2000, 4000);

    // Simuler comportement humain
    await simulateHumanBehavior(page);

    // Attendre que le contenu soit chargé
    try {
      // Essayer plusieurs sélecteurs possibles
      await Promise.race([
        page.waitForSelector('h1, [data-pl="product-title"], .product-title', { timeout: 5000 }).catch(() => null),
        page.waitForSelector('body', { timeout: 5000 }),
      ]);
    } catch {
      // Continuer même si les sélecteurs ne sont pas trouvés
    }

    // Vérifier si c'est une page de blocage
    const content = await page.content();

    if (content.length < 5000 ||
        content.includes('captcha') ||
        content.includes('punish') ||
        content.includes('_config_') ||
        content.includes('blocked') ||
        content.includes('Access Denied')) {
      logger.warn('Page de blocage détectée avec Playwright', { url, contentLength: content.length });
      return { html: content, success: false, method: 'playwright' };
    }

    logger.info('Scraping Playwright réussi', { url, contentLength: content.length });
    return { html: content, success: true, method: 'playwright' };

  } catch (error: unknown) {
    logger.warn('Erreur scraping Playwright', {
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
 * Scraper avec ScraperAPI (fallback)
 */
export async function scrapeWithScraperAPI(url: string, apiKey: string): Promise<ScrapeResult> {
  try {
    if (isComplianceStrict()) {
      logger.warn('ScraperAPI désactivé (COMPLIANCE_MODE=strict)', { url });
      return { html: '', success: false, method: 'scraperapi' };
    }

    logger.info('Tentative scraping avec ScraperAPI', { url });

    const scraperApiUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(url)}&render=true`;

    const response = await retryNetwork(
      () => axios.get(scraperApiUrl, {
        timeout: 30000,
      }),
      {
        maxRetries: 3,
        initialDelay: 2000,
      }
    );

    const html = typeof response.data === 'string' ? response.data : '';

    if (html.length < 5000 || html.includes('captcha') || html.includes('blocked')) {
      return { html, success: false, method: 'scraperapi' };
    }

    logger.info('Scraping ScraperAPI réussi', { url, contentLength: html.length });
    return { html, success: true, method: 'scraperapi' };

  } catch (error: unknown) {
    logger.warn('Erreur scraping ScraperAPI', {
      error: error instanceof Error ? error.message : String(error),
      url,
    });
    return { html: '', success: false, method: 'scraperapi' };
  }
}

/**
 * Scraper intelligent : essaie Playwright d'abord, puis ScraperAPI si disponible
 */
export async function smartScrape(url: string): Promise<ScrapeResult> {
  if (isComplianceStrict()) {
    logger.warn('smartScrape désactivé en conformité stricte (AliExpress)', { url });
    return { html: '', success: false, method: 'playwright' };
  }

  // Méthode 1 : Playwright avec anti-détection (gratuit, pas de service externe)
  logger.info('Tentative méthode 1 : Playwright anti-détection', { url });
  const playwrightResult = await scrapeWithPlaywright(url);

  if (playwrightResult.success) {
    logger.info('✅ Succès avec Playwright (sans service externe)', { url });
    return playwrightResult;
  }

  logger.warn('Playwright a échoué, tentative ScraperAPI', { url });

  // Méthode 2 : ScraperAPI si disponible (fallback)
  const scraperApiKey = process.env.SCRAPER_API_KEY;
  if (scraperApiKey) {
    logger.info('Tentative méthode 2 : ScraperAPI', { url });
    const scraperApiResult = await scrapeWithScraperAPI(url, scraperApiKey);

    if (scraperApiResult.success) {
      logger.info('✅ Succès avec ScraperAPI', { url });
      return scraperApiResult;
    }
  } else {
    logger.warn('ScraperAPI non configuré - Playwright était la seule option', { url });
  }

  // Toutes les méthodes ont échoué
  logger.error('Toutes les méthodes de scraping ont échoué', new Error('Scraping failed'), { url });
  return { html: '', success: false, method: 'playwright' };
}

