/**
 * Extracteurs spécialisés par site e-commerce
 * Améliore la précision d'extraction pour les sites populaires
 */
import { load } from 'cheerio';

interface ExtractionResult {
  title: string;
  description: string;
  price: number;
  images: string[];
  category?: string;
}

/**
 * Détecte le type de site depuis l'URL
 */
export function detectSiteType(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();

  if (hostname.includes('aliexpress.com') || hostname.includes('aliexpress')) {
    return 'aliexpress';
  }
  if (hostname.includes('amazon.') || hostname.includes('amazon')) {
    return 'amazon';
  }
  if (hostname.includes('etsy.com') || hostname.includes('etsy')) {
    return 'etsy';
  }
  if (hostname.includes('shopify') || hostname.includes('myshopify.com')) {
    return 'shopify';
  }
  if (hostname.includes('ebay.') || hostname.includes('ebay')) {
    return 'ebay';
  }
  if (hostname.includes('cdiscount.com') || hostname.includes('cdiscount')) {
    return 'cdiscount';
  }
  if (hostname.includes('fnac.com') || hostname.includes('fnac')) {
    return 'fnac';
  }

  return 'generic';
}

/**
 * Extrait les données depuis AliExpress
 * Version améliorée avec extraction JSON + sélecteurs multiples
 * @param jsonDataFromScraper - Données JSON extraites directement depuis window.runParams (priorité)
 */
export async function extractFromAliExpress(_url: string, $: ReturnType<typeof load>, jsonDataFromScraper?: any): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};
  const html = $.html();

  // Méthode 1 : Extraction depuis JSON embarqué (plus fiable)
  // Priorité : jsonDataFromScraper (extrait directement depuis Playwright) > parsing HTML
  try {
    let jsonData: any = null;

    // Priorité 1 : Données JSON passées directement depuis le scraper
    if (jsonDataFromScraper) {
      jsonData = jsonDataFromScraper;
    } else {
      // Priorité 2 : Parser depuis HTML
      const scriptMatches = html.match(/window\.runParams\s*=\s*({[\s\S]*?});/);
      if (scriptMatches) {
        try {
          jsonData = JSON.parse(scriptMatches[1]);
        } catch (jsonError) {
          // Continuer avec sélecteurs CSS si JSON échoue
        }
      }
    }

    // Extraire depuis différentes structures possibles (basé sur recherches Perplexity)
    if (jsonData) {
      const productData = jsonData.data?.productInfoComponent?.productDO ||
                        jsonData.data?.priceComponent?.price?.value ||
                        jsonData.data?.priceComponent?.price ||
                        jsonData.product ||
                        jsonData.data?.product ||
                        jsonData;

      // Essayer aussi priceComponent directement
      const priceComponent = jsonData.data?.priceComponent;

      if (productData || priceComponent) {
        // Titre
        if (productData) {
          if (productData.subject || productData.title || productData.productTitle) {
            result.title = (productData.subject || productData.title || productData.productTitle).trim();
          }
        }

        // Prix - PRIORISER salePrice (prix réel de vente) au lieu de originalPrice
        // Chercher dans plusieurs structures et prendre le prix le plus bas (le réel)
        const allPrices: number[] = [];

        // Structure 1 : priceComponent (PRIORISER salePrice)
        if (priceComponent) {
          const prices = [
            priceComponent.salePrice?.value,
            priceComponent.salePrice,
            priceComponent.price?.value,
            priceComponent.price,
            // Éviter originalPrice (prix barré)
          ];
          for (const p of prices) {
            if (p) {
              const price = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^\d,.]/g, '').replace(',', '.'));
              if (!isNaN(price) && price > 0 && price < 100000) {
                allPrices.push(price);
              }
            }
          }
        }

        // Structure 2 : productData (PRIORISER salePrice)
        if (productData) {
          const prices = [
            productData.salePrice?.value,
            productData.salePrice,
            productData.price?.value,
            productData.price,
            // Éviter originalPrice (prix barré)
          ];
          for (const p of prices) {
            if (p) {
              const price = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^\d,.]/g, '').replace(',', '.'));
              if (!isNaN(price) && price > 0 && price < 100000) {
                allPrices.push(price);
              }
            }
          }
        }

        // Structure 3 : Niveau racine (PRIORISER salePrice)
        const rootPrices = [
          jsonData.salePrice?.value,
          jsonData.salePrice,
          jsonData.price?.value,
          jsonData.price,
        ];
        for (const p of rootPrices) {
          if (p) {
            const price = typeof p === 'number' ? p : parseFloat(String(p).replace(/[^\d,.]/g, '').replace(',', '.'));
            if (!isNaN(price) && price > 0 && price < 100000) {
              allPrices.push(price);
            }
          }
        }

        // Prendre le prix le plus bas (le prix réel de vente, pas le prix original)
        if (allPrices.length > 0) {
          result.price = Math.min(...allPrices);
        }

        // Images
        if (productData) {
          if (productData.imageList || productData.images || productData.imageUrlList) {
            const imageList = productData.imageList || productData.images || productData.imageUrlList || [];
            result.images = imageList
              .slice(0, 5)
              .map((img: string) => img.startsWith('http') ? img : `https:${img}`)
              .filter((img: string) => img.includes('alicdn.com'));
          }
        }
      }
    }
  } catch (error) {
    // Continuer avec sélecteurs CSS
  }

  // Méthode 2 : Sélecteurs CSS (fallback si JSON échoue)

  // Titre - Sélecteurs étendus
  if (!result.title) {
    const titleSelectors = [
      'h1[data-pl="product-title"]',
      'h1.product-title-text',
      'h1[class*="product-title"]',
      'h1[class*="title"]',
      '.product-title-text',
      '[data-pl="product-title"]',
      'h1',
      'meta[property="og:title"]',
      'title',
    ];
    for (const selector of titleSelectors) {
      let title: string | undefined;
      if (selector.startsWith('meta')) {
        title = $(selector).attr('content')?.trim();
      } else {
        title = $(selector).first().text().trim();
      }
      if (title && title.length > 0 && title.length < 300 && !title.includes('AliExpress')) {
        result.title = title;
        break;
      }
    }
  }

  // Prix - Sélecteurs étendus
  if (!result.price || result.price === 0) {
    const priceSelectors = [
      '[data-pl="price"] .price-current',
      '[data-pl="price"] .notranslate',
      '.product-price-current span',
      '.product-price-current',
      '.price-current',
      '[class*="price-current"]',
      '.notranslate[data-pl="price"]',
      '[data-pl="price"]',
      '.price-value',
      '.price',
      'meta[property="product:price:amount"]',
    ];
    for (const selector of priceSelectors) {
      let priceText: string | undefined;
      if (selector.startsWith('meta')) {
        priceText = $(selector).attr('content')?.trim();
      } else {
        priceText = $(selector).first().text().trim();
      }
      if (priceText) {
        // Extraire prix depuis texte (gère €, $, etc.)
        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[0].replace(',', '.'));
          if (!isNaN(price) && price > 0 && price < 100000) {
            result.price = price;
            break;
          }
        }
      }
    }
  }

  // Images - Sélecteurs étendus
  if (!result.images || result.images.length === 0) {
    const images: string[] = [];

    // Images produit principales
    $('img[data-src], img[src]').each((_, el) => {
      const src = $(el).attr('data-src') || $(el).attr('src') || $(el).attr('data-lazy-src') || '';
      if (src && (src.includes('alicdn.com') || src.includes('ae01') || src.includes('ae02'))) {
        const fullUrl = src.startsWith('http') ? src : (src.startsWith('//') ? `https:${src}` : `https:${src}`);
        if (!images.includes(fullUrl) && !fullUrl.includes('logo') && !fullUrl.includes('icon')) {
          images.push(fullUrl);
        }
      }
    });

    // Meta og:image
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage && !images.includes(ogImage)) {
      images.unshift(ogImage);
    }

    result.images = images.slice(0, 5);
  }

  // Description - Sélecteurs étendus
  if (!result.description) {
    const descSelectors = [
      '[data-pl="product-description"]',
      '.product-description',
      '[class*="product-description"]',
      '[class*="description"]',
      'meta[name="description"]',
      'meta[property="og:description"]',
    ];
    for (const selector of descSelectors) {
      let desc: string | undefined;
      if (selector.startsWith('meta')) {
        desc = $(selector).attr('content')?.trim();
      } else {
        desc = $(selector).first().text().trim();
      }
      if (desc && desc.length > 20 && desc.length < 2000) {
        result.description = desc.substring(0, 1000);
        break;
      }
    }
  }

  return result;
}

/**
 * Extrait les données depuis Amazon
 */
export async function extractFromAmazon(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const titleSelectors = [
    '#productTitle',
    'h1.a-size-large',
    'h1[data-automation-id="title"]',
    'h1',
  ];
  for (const selector of titleSelectors) {
    const title = $(selector).first().text().trim();
    if (title && title.length > 0) {
      result.title = title;
      break;
    }
  }

  // Prix
  const priceSelectors = [
    '.a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.a-price-whole',
    '[data-a-color="price"] .a-offscreen',
  ];
  for (const selector of priceSelectors) {
    const priceText = $(selector).first().text().trim();
    if (priceText) {
      const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
      if (!isNaN(price) && price > 0) {
        result.price = price;
        break;
      }
    }
  }

  // Images
  const images: string[] = [];
  $('#landingImage, #imgBlkFront, .a-dynamic-image').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && src.includes('images-na.ssl-images-amazon.com') || src.includes('images-eu.ssl-images-amazon.com')) {
      if (!images.includes(src)) {
        images.push(src);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const descSelectors = [
    '#productDescription',
    '#feature-bullets',
    '.a-unordered-list',
  ];
  for (const selector of descSelectors) {
    const desc = $(selector).first().text().trim();
    if (desc && desc.length > 20) {
      result.description = desc.substring(0, 1000);
      break;
    }
  }

  return result;
}

/**
 * Extrait les données depuis Etsy
 */
export async function extractFromEtsy(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const title = $('h1[data-buy-box-listing-title]').first().text().trim() ||
                $('h1').first().text().trim();
  if (title) result.title = title;

  // Prix
  const priceText = $('.currency-value').first().text().trim() ||
                   $('[data-buy-box-regional-price]').first().text().trim();
  if (priceText) {
    const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Images
  const images: string[] = [];
  $('img[data-src], img[src]').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src') || '';
    if (src && (src.includes('etsy.com') || src.includes('etsystatic.com'))) {
      const fullUrl = src.startsWith('http') ? src : `https:${src}`;
      if (!images.includes(fullUrl)) {
        images.push(fullUrl);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const desc = $('#listing-page-cart .wt-text-body-01').first().text().trim() ||
               $('[data-id="description-text"]').first().text().trim();
  if (desc) result.description = desc.substring(0, 1000);

  // Catégorie pour Etsy (fait-main)
  result.category = 'Bijoux'; // Etsy = souvent fait-main

  return result;
}

/**
 * Extrait les données depuis Shopify
 */
export async function extractFromShopify(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const title = $('h1.product__title').first().text().trim() ||
                $('h1[class*="product-title"]').first().text().trim() ||
                $('h1').first().text().trim();
  if (title) result.title = title;

  // Prix
  const priceText = $('.price__regular .money').first().text().trim() ||
                   $('[class*="price"] .money').first().text().trim() ||
                   $('meta[property="product:price:amount"]').attr('content');
  if (priceText) {
    const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Images
  const images: string[] = [];
  $('img[data-src], img[src]').each((_, el) => {
    const src = $(el).attr('data-src') || $(el).attr('src') || '';
    if (src && (src.includes('cdn.shopify.com') || src.includes('shopify'))) {
      const fullUrl = src.startsWith('http') ? src : `https:${src}`;
      if (!images.includes(fullUrl)) {
        images.push(fullUrl);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const desc = $('.product__description').first().text().trim() ||
               $('[class*="description"]').first().text().trim();
  if (desc) result.description = desc.substring(0, 1000);

  return result;
}

/**
 * Extrait les données depuis eBay
 */
export async function extractFromEbay(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const title = $('#x-item-title-label + h1').first().text().trim() ||
                $('h1[class*="title"]').first().text().trim() ||
                $('h1').first().text().trim();
  if (title) result.title = title;

  // Prix
  const priceText = $('.notranslate[itemprop="price"]').first().text().trim() ||
                   $('.u-flL.condText').first().text().trim();
  if (priceText) {
    const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Images
  const images: string[] = [];
  $('#vi_main_img_fs img, #icImg').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && src.includes('ebayimg.com')) {
      if (!images.includes(src)) {
        images.push(src);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const desc = $('#viTabs_0_is').first().text().trim();
  if (desc) result.description = desc.substring(0, 1000);

  return result;
}

/**
 * Extrait les données depuis Cdiscount
 */
export async function extractFromCdiscount(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const title = $('h1[itemprop="name"]').first().text().trim() ||
                $('h1.fpDes').first().text().trim();
  if (title) result.title = title;

  // Prix
  const priceText = $('.fpPrice.price').first().text().trim() ||
                   $('[itemprop="price"]').first().text().trim();
  if (priceText) {
    const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Images
  const images: string[] = [];
  $('.fpImage img, #mainImage').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && src.includes('cdiscount.com')) {
      const fullUrl = src.startsWith('http') ? src : `https:${src}`;
      if (!images.includes(fullUrl)) {
        images.push(fullUrl);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const desc = $('.fpDescProduct').first().text().trim();
  if (desc) result.description = desc.substring(0, 1000);

  return result;
}

/**
 * Extrait les données depuis Fnac
 */
export async function extractFromFnac(_url: string, $: ReturnType<typeof load>): Promise<Partial<ExtractionResult>> {
  const result: Partial<ExtractionResult> = {};

  // Titre
  const title = $('h1[itemprop="name"]').first().text().trim() ||
                $('h1.f-productHeader-Title').first().text().trim();
  if (title) result.title = title;

  // Prix
  const priceText = $('.f-priceBox-price').first().text().trim() ||
                   $('[itemprop="price"]').first().text().trim();
  if (priceText) {
    const price = parseFloat(priceText.replace(/[^\d,.]/g, '').replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      result.price = price;
    }
  }

  // Images
  const images: string[] = [];
  $('.f-productImage img, #productMainImage').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && src.includes('fnac-static.com')) {
      const fullUrl = src.startsWith('http') ? src : `https:${src}`;
      if (!images.includes(fullUrl)) {
        images.push(fullUrl);
      }
    }
  });
  result.images = images.slice(0, 5);

  // Description
  const desc = $('.f-productDescription').first().text().trim();
  if (desc) result.description = desc.substring(0, 1000);

  return result;
}

/**
 * Routeur d'extraction selon le type de site
 */
export async function extractBySiteType(
  url: string,
  $: ReturnType<typeof load>,
  jsonDataFromScraper?: any
): Promise<Partial<ExtractionResult>> {
  const siteType = detectSiteType(url);

  switch (siteType) {
    case 'aliexpress':
      return extractFromAliExpress(url, $, jsonDataFromScraper);
    case 'amazon':
      return extractFromAmazon(url, $);
    case 'etsy':
      return extractFromEtsy(url, $);
    case 'shopify':
      return extractFromShopify(url, $);
    case 'ebay':
      return extractFromEbay(url, $);
    case 'cdiscount':
      return extractFromCdiscount(url, $);
    case 'fnac':
      return extractFromFnac(url, $);
    default:
      return {}; // Utiliser l'extraction générique
  }
}
