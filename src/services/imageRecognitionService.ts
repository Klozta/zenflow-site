/**
 * Service de reconnaissance d'image et identification de produit
 */
import axios from 'axios';
import { logger } from '../utils/logger.js';

export interface ImageRecognitionResult {
  productName: string;
  brand?: string;
  model?: string;
  category: string;
  confidence: number;
  keywords: string[];
}

/**
 * Reconnaître un produit depuis une image
 * Utilise Google Vision API ou alternative
 */
export async function recognizeProductFromImage(
  imageUrl: string | Buffer
): Promise<ImageRecognitionResult> {
  try {
    // Option 1: Google Vision API (si configuré)
    if (process.env.GOOGLE_VISION_API_KEY) {
      return await recognizeWithGoogleVision(imageUrl);
    }

    // Option 2: OpenAI Vision API
    if (process.env.OPENAI_API_KEY) {
      return await recognizeWithOpenAI(imageUrl);
    }

    // Option 3: Fallback - extraction depuis URL/filename
    return await recognizeFromFilename(imageUrl);
  } catch (error: any) {
    logger.error('Erreur reconnaissance image', error);
    throw new Error('Impossible de reconnaître le produit depuis l\'image');
  }
}

/**
 * Reconnaissance avec Google Vision API
 */
async function recognizeWithGoogleVision(
  imageUrl: string | Buffer
): Promise<ImageRecognitionResult> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY!;
  const imageBase64 = typeof imageUrl === 'string'
    ? await urlToBase64(imageUrl)
    : imageUrl.toString('base64');

  const response = await axios.post(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      requests: [
        {
          image: { content: imageBase64 },
          features: [
            { type: 'LABEL_DETECTION', maxResults: 10 },
            { type: 'TEXT_DETECTION', maxResults: 10 },
            { type: 'OBJECT_LOCALIZATION', maxResults: 5 },
          ],
        },
      ],
    }
  );

  const annotations = response.data.responses[0];
  const labels = annotations.labelAnnotations || [];
  const texts = annotations.textAnnotations || [];
  const objects = annotations.localizedObjectAnnotations || [];

  // Extraire nom du produit
  const productName = extractProductName(labels, texts, objects);
  const category = detectCategory(labels);
  const keywords = labels.map((l: any) => l.description).slice(0, 5);

  return {
    productName,
    category,
    confidence: 0.8,
    keywords,
  };
}

/**
 * Reconnaissance avec OpenAI Vision
 */
async function recognizeWithOpenAI(
  imageUrl: string | Buffer
): Promise<ImageRecognitionResult> {
  const apiKey = process.env.OPENAI_API_KEY!;
  const imageUrlStr = typeof imageUrl === 'string' ? imageUrl : 'data:image/jpeg;base64,' + imageUrl.toString('base64');

  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyse cette image de produit et identifie:
1. Le nom exact du produit
2. La marque
3. Le modèle
4. La catégorie (ex: Imprimante 3D, Bijoux, etc.)
5. Les mots-clés principaux

Réponds en JSON: {"productName": "...", "brand": "...", "model": "...", "category": "...", "keywords": [...]}`,
            },
            {
              type: 'image_url',
              image_url: { url: imageUrlStr },
            },
          ],
        },
      ],
      max_tokens: 500,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const content = response.data.choices[0].message.content;
  const parsed = JSON.parse(content);

  return {
    productName: parsed.productName || 'Produit non identifié',
    brand: parsed.brand,
    model: parsed.model,
    category: parsed.category || 'Autre',
    confidence: 0.9,
    keywords: parsed.keywords || [],
  };
}

/**
 * Fallback: extraction depuis nom de fichier/URL
 */
async function recognizeFromFilename(
  imageUrl: string | Buffer
): Promise<ImageRecognitionResult> {
  if (typeof imageUrl !== 'string') {
    return {
      productName: 'Produit',
      category: 'Autre',
      confidence: 0.3,
      keywords: [],
    };
  }

  const url = new URL(imageUrl);
  const filename = url.pathname.split('/').pop() || '';
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // Extraire informations depuis le nom
  const parts = nameWithoutExt.split(/[-_\s]+/);
  const productName = parts.join(' ');

  // Détecter catégorie depuis le nom
  const category = detectCategoryFromName(productName);

  return {
    productName: productName || 'Produit',
    category,
    confidence: 0.5,
    keywords: parts.filter(p => p.length > 3),
  };
}

/**
 * Recherche web automatique pour compléter les infos
 */
export async function searchProductInfo(
  productName: string,
  brand?: string,
  model?: string
): Promise<{
  description: string;
  price?: number;
  specifications: Record<string, string>;
  images: string[];
}> {
  try {
    const searchQuery = [brand, model, productName].filter(Boolean).join(' ');

    // Option 1: SerpAPI (si configuré)
    if (process.env.SERP_API_KEY) {
      return await searchWithSerpAPI(searchQuery);
    }

    // Option 2: Google Custom Search
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      return await searchWithGoogleCustomSearch(searchQuery);
    }

    // Option 3: Web scraping direct (fallback) - utiliser service existant
    return await searchWithScraping(searchQuery);
  } catch (error: any) {
    logger.error('Erreur recherche produit', error);
    // Générer description basique si recherche échoue
    return {
      description: generateBasicDescription(productName, brand, model),
      specifications: {},
      images: [],
    };
  }
}

/**
 * Générer description basique si recherche échoue
 */
function generateBasicDescription(productName: string, brand?: string, model?: string): string {
  const parts: string[] = [];

  // Introduction accrocheuse
  if (brand) {
    parts.push(`Découvrez ce magnifique ${productName} de la marque ${brand}, un produit soigneusement sélectionné pour sa qualité exceptionnelle et son design raffiné.`);
  } else {
    parts.push(`Découvrez ce magnifique ${productName}, un produit soigneusement sélectionné pour sa qualité premium et son design élégant.`);
  }

  if (model) {
    parts.push(`Modèle ${model} - une référence qui allie performance et esthétique.`);
  }

  // Description détaillée avec arguments
  parts.push(`Ce produit allie esthétique et fonctionnalité pour répondre à tous vos besoins au quotidien.`);
  parts.push(`✨ Qualité exceptionnelle, design soigné, et rapport qualité-prix imbattable.`);
  parts.push(`💎 Un choix parfait pour celles qui recherchent l'excellence et le raffinement.`);
  parts.push(`Commandez dès maintenant et profitez d'une expérience d'achat exceptionnelle !`);

  return parts.join(' ');
}

/**
 * Recherche avec SerpAPI
 */
async function searchWithSerpAPI(query: string) {
  const apiKey = process.env.SERP_API_KEY!;
  const response = await axios.get('https://serpapi.com/search', {
    params: {
      engine: 'google',
      q: query,
      api_key: apiKey,
      num: 5,
    },
  });

  const results = response.data.organic_results || [];
  const firstResult = results[0];

  return {
    description: firstResult?.snippet || '',
    price: extractPrice(firstResult?.price),
    specifications: {},
    images: [firstResult?.thumbnail || ''],
  };
}

/**
 * Recherche avec Google Custom Search
 */
async function searchWithGoogleCustomSearch(query: string) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY!;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID!;

  const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
    params: {
      key: apiKey,
      cx: engineId,
      q: query,
      num: 5,
    },
  });

  const results = response.data.items || [];
  const firstResult = results[0];

  return {
    description: firstResult?.snippet || '',
    specifications: {},
    images: [],
  };
}

/**
 * Web scraping fallback - recherche intelligente
 */
async function searchWithScraping(query: string) {
  try {
    // Utiliser le service d'import existant pour scraper
    const { detectSiteType } = await import('./siteSpecificExtractors.js');
    const { analyzeProductUrl } = await import('./productImportService.js');

    // Essayer plusieurs sites e-commerce
    const searchSites = [
      `https://www.amazon.fr/s?k=${encodeURIComponent(query)}`,
      `https://www.cdiscount.com/search/10/${encodeURIComponent(query)}.html`,
      `https://www.fnac.com/SearchResult/ResultList.aspx?SCat=0&SearchText=${encodeURIComponent(query)}`,
    ];

    for (const url of searchSites) {
      try {
        const siteType = detectSiteType(url);
        if (siteType === 'unknown') continue;

        // Essayer d'extraire depuis la page de recherche
        const analysis = await analyzeProductUrl(url);
        if (analysis && analysis.title) {
          return {
            description: analysis.description || generateBasicDescription(query),
            price: analysis.price,
            specifications: {},
            images: analysis.images || [],
          };
        }
      } catch {
        continue;
      }
    }

    // Si aucun site ne fonctionne, retourner description basique
    return {
      description: generateBasicDescription(query),
      specifications: {},
      images: [],
    };
  } catch (error: any) {
    logger.warn('Erreur scraping recherche', { query, error: error.message });
    return {
      description: generateBasicDescription(query),
      specifications: {},
      images: [],
    };
  }
}

/**
 * Générer automatiquement une fiche produit complète
 */
export async function generateProductFromImage(
  imageUrl: string | Buffer
): Promise<{
  title: string;
  description: string;
  price: number;
  category: string;
  tags: string[];
  images: string[];
  specifications: Record<string, string>;
}> {
  // 1. Reconnaître le produit depuis l'image
  const recognition = await recognizeProductFromImage(imageUrl);

  // 2. Rechercher les infos sur internet
  const searchInfo = await searchProductInfo(
    recognition.productName,
    recognition.brand,
    recognition.model
  );

  // 3. Générer le titre
  const title = [recognition.brand, recognition.model, recognition.productName]
    .filter(Boolean)
    .join(' ') || recognition.productName;

  // 4. Générer la description enrichie
  const description = generateDescription(recognition, searchInfo);

  // 5. Estimer le prix (si non trouvé)
  const price = searchInfo.price || estimatePrice(recognition.category);

  // 6. Générer les tags
  const tags = generateTags(recognition, searchInfo);

  // 7. Si imprimante 3D, extraire specs depuis recherche
  let specifications: Record<string, string> = searchInfo.specifications;
  if (recognition.category === 'Imprimante 3D' && Object.keys(specifications).length === 0) {
    // Essayer d'extraire specs depuis la description
    specifications = extract3DPrinterSpecsFromText(description);
  }

  return {
    title,
    description,
    price,
    category: recognition.category,
    tags,
    images: searchInfo.images.length > 0 ? searchInfo.images : [],
    specifications,
  };
}

/**
 * Extraire specs imprimante 3D depuis texte
 */
function extract3DPrinterSpecsFromText(text: string): Record<string, string> {
  const specs: Record<string, string> = {};
  const lower = text.toLowerCase();

  // Volume d'impression (220x220x250mm, 250x210x210mm, etc.)
  const volumeMatch = text.match(/(\d+x\d+x\d+)\s*mm/i) || text.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*mm/i);
  if (volumeMatch) {
    if (volumeMatch[1] && volumeMatch[1].includes('x')) {
      specs['Volume d\'impression'] = volumeMatch[1] + 'mm';
    } else if (volumeMatch[1] && volumeMatch[2] && volumeMatch[3]) {
      specs['Volume d\'impression'] = `${volumeMatch[1]}x${volumeMatch[2]}x${volumeMatch[3]}mm`;
    }
  }

  // Filament (PLA, ABS, PETG, TPU, etc.)
  const filamentKeywords = ['pla', 'abs', 'petg', 'tpu', 'asa', 'nylon', 'wood', 'carbon'];
  const foundFilaments: string[] = [];
  filamentKeywords.forEach(filament => {
    if (lower.includes(filament)) {
      foundFilaments.push(filament.toUpperCase());
    }
  });
  if (foundFilaments.length > 0) {
    specs['Type de filament'] = foundFilaments.join(', ');
  }

  // Diamètre filament (1.75mm ou 3mm)
  const diameterMatch = text.match(/(1\.75|3)\s*mm/i) || lower.match(/filament.*?(1\.75|3)\s*mm/i);
  if (diameterMatch) {
    specs['Diamètre filament'] = diameterMatch[1] + 'mm';
  }

  // Hauteur de couche (0.1mm, 0.05-0.3mm, etc.)
  const layerMatch = text.match(/(\d+\.?\d*)\s*-\s*(\d+\.?\d*)\s*mm/i) || text.match(/layer.*?(\d+\.?\d*)\s*mm/i);
  if (layerMatch) {
    if (layerMatch[2]) {
      specs['Hauteur de couche'] = `${layerMatch[1]}-${layerMatch[2]}mm`;
    } else {
      specs['Hauteur de couche'] = layerMatch[1] + 'mm';
    }
  }

  // Diamètre buse (0.4mm, 0.3mm, etc.)
  const nozzleMatch = text.match(/nozzle.*?(\d+\.?\d*)\s*mm/i) || text.match(/(0\.\d+)\s*mm.*?nozzle/i);
  if (nozzleMatch) {
    specs['Diamètre buse'] = nozzleMatch[1] + 'mm';
  }

  // Vitesse d'impression
  const speedMatch = text.match(/(\d+)\s*-\s*(\d+)\s*mm\/s/i) || text.match(/speed.*?(\d+)\s*mm\/s/i);
  if (speedMatch) {
    if (speedMatch[2]) {
      specs['Vitesse d\'impression'] = `${speedMatch[1]}-${speedMatch[2]}mm/s`;
    } else {
      specs['Vitesse d\'impression'] = speedMatch[1] + 'mm/s';
    }
  }

  // Température buse
  const hotendMatch = text.match(/(\d+)[°-](\d+)\s*°?c/i) || text.match(/hotend.*?(\d+)\s*°c/i);
  if (hotendMatch) {
    if (hotendMatch[2]) {
      specs['Température buse'] = `${hotendMatch[1]}-${hotendMatch[2]}°C`;
    } else {
      specs['Température buse'] = hotendMatch[1] + '°C';
    }
  }

  // Température plateau
  const bedMatch = text.match(/bed.*?(\d+)[°-](\d+)\s*°?c/i) || text.match(/plateau.*?(\d+)\s*°c/i);
  if (bedMatch) {
    if (bedMatch[2]) {
      specs['Température plateau'] = `${bedMatch[1]}-${bedMatch[2]}°C`;
    } else {
      specs['Température plateau'] = bedMatch[1] + '°C';
    }
  }

  // Connectivité
  const connectivity: string[] = [];
  if (lower.includes('usb') || lower.includes('cable usb')) connectivity.push('USB');
  if (lower.includes('wifi') || lower.includes('wi-fi')) connectivity.push('WiFi');
  if (lower.includes('sd card') || lower.includes('carte sd')) connectivity.push('SD Card');
  if (lower.includes('ethernet') || lower.includes('rj45')) connectivity.push('Ethernet');
  if (lower.includes('bluetooth')) connectivity.push('Bluetooth');
  if (connectivity.length > 0) {
    specs['Connectivité'] = connectivity.join(', ');
  }

  // Nivellement automatique
  if (lower.includes('auto level') || lower.includes('nivellement auto') || lower.includes('abl')) {
    specs['Nivellement automatique'] = 'Oui';
  }

  // Reprise d'impression
  if (lower.includes('resume print') || lower.includes('reprise') || lower.includes('power recovery')) {
    specs['Reprise d\'impression'] = 'Oui';
  }

  // Consommation
  const powerMatch = text.match(/(\d+)\s*w/i) || text.match(/power.*?(\d+)\s*w/i);
  if (powerMatch) {
    specs['Consommation'] = powerMatch[1] + 'W';
  }

  // Poids
  const weightMatch = text.match(/(\d+\.?\d*)\s*kg/i) || text.match(/weight.*?(\d+\.?\d*)\s*kg/i);
  if (weightMatch) {
    specs['Poids'] = weightMatch[1] + 'kg';
  }

  // Dimensions
  const dimMatch = text.match(/(\d+x\d+x\d+)\s*mm/i);
  if (dimMatch && !specs['Volume d\'impression']) {
    specs['Dimensions'] = dimMatch[1] + 'mm';
  }

  return specs;
}

// Helpers
async function urlToBase64(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data).toString('base64');
}

function extractProductName(labels: any[], texts: any[], objects: any[]): string {
  // Prioriser les objets détectés
  if (objects.length > 0) {
    return objects[0].name;
  }

  // Sinon utiliser les textes détectés
  if (texts.length > 0) {
    return texts[0].description;
  }

  // Sinon utiliser les labels
  return labels[0]?.description || 'Produit';
}

function detectCategory(labels: any[]): string {
  const labelTexts = labels.map(l => l.description.toLowerCase()).join(' ');

  if (labelTexts.includes('3d printer') || labelTexts.includes('imprimante')) {
    return 'Imprimante 3D';
  }
  if (labelTexts.includes('jewelry') || labelTexts.includes('bijou')) {
    return 'Bijoux';
  }
  if (labelTexts.includes('accessory') || labelTexts.includes('accessoire')) {
    return 'Accessoires';
  }

  return 'Autre';
}

function detectCategoryFromName(name: string): string {
  const lower = name.toLowerCase();

  if (lower.includes('3d') || lower.includes('printer') || lower.includes('imprimante')) {
    return 'Imprimante 3D';
  }
  if (lower.includes('jewelry') || lower.includes('bijou')) {
    return 'Bijoux';
  }

  return 'Autre';
}

function extractPrice(priceStr?: string): number | undefined {
  if (!priceStr) return undefined;
  const match = priceStr.match(/[\d,]+\.?\d*/);
  if (match) {
    return parseFloat(match[0].replace(',', '.'));
  }
  return undefined;
}

function generateDescription(
  recognition: ImageRecognitionResult,
  searchInfo: any
): string {
  const parts: string[] = [];
  const productName = recognition.productName || 'produit';
  const category = recognition.category || 'produit';
  const brand = recognition.brand;
  const model = recognition.model;
  const keywords = recognition.keywords || [];

  // Extraire des détails spécifiques depuis le nom du produit
  const productDetails = extractProductDetails(productName, keywords);

  // Utiliser la description trouvée si elle est naturelle et suffisamment détaillée (MINIMUM 200 caractères)
  if (searchInfo.description && searchInfo.description.length > 200 && !isAILikeDescription(searchInfo.description)) {
    // Nettoyer et améliorer la description trouvée
    const cleaned = cleanDescription(searchInfo.description);
    parts.push(cleaned);
  } else {
    // Générer description naturelle et spécifique au produit (moins "IA-like") - MINIMUM 50 mots
    const naturalDescription = generateNaturalDescription(productName, category, keywords, productDetails, brand, model);
    parts.push(naturalDescription);
  }

  // Ajouter détails techniques de manière naturelle (sans emojis si possible)
  if (productDetails.materials.length > 0) {
    parts.push(`Fabriqué en ${productDetails.materials.join(', ').toLowerCase()}.`);
  }
  if (productDetails.sizes.length > 0) {
    parts.push(`Disponible en ${productDetails.sizes.join(', ')}.`);
  }
  if (productDetails.colors.length > 0) {
    parts.push(`Couleurs disponibles : ${productDetails.colors.join(', ').toLowerCase()}.`);
  }

  // Points clés naturels (sans emojis, phrases courtes)
  if (keywords.length > 0) {
    const keyFeatures = keywords
      .filter(k => k.length > 3 && !['produit', 'article', 'item', 'accessoire', 'bijou', 'object'].includes(k.toLowerCase()))
      .slice(0, 3);
    if (keyFeatures.length > 0) {
      const featuresText = keyFeatures.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ');
      parts.push(`${featuresText}.`);
    }
  }

  return parts.join(' ');
}

/**
 * Détecter si une description sonne trop "IA-like"
 */
function isAILikeDescription(text: string): boolean {
  const aiPatterns = [
    /découvrez.*magnifique/i,
    /soigneusement sélectionné/i,
    /qualité exceptionnelle/i,
    /expérience d'achat exceptionnelle/i,
    /rapport qualité-prix imbattable/i,
    /satisfaction garantie/i,
    /produit authentique/i,
    /savoir-faire artisanal/i,
  ];
  return aiPatterns.some(pattern => pattern.test(text));
}

/**
 * Nettoyer une description pour la rendre plus naturelle
 */
function cleanDescription(text: string): string {
  // Supprimer les phrases trop génériques
  let cleaned = text
    .replace(/Découvrez (ce|cette) magnifique /gi, '')
    .replace(/soigneusement sélectionné/gi, '')
    .replace(/qualité exceptionnelle/gi, 'qualité')
    .replace(/expérience d'achat exceptionnelle/gi, '')
    .replace(/rapport qualité-prix imbattable/gi, 'bon rapport qualité-prix')
    .replace(/satisfaction garantie/gi, '')
    .replace(/produit authentique/gi, 'produit')
    .replace(/savoir-faire artisanal/gi, 'fabrication soignée');

  // Nettoyer les espaces multiples
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Générer une description naturelle et moins "IA-like" (MINIMUM 50 mots)
 */
function generateNaturalDescription(
  productName: string,
  category: string,
  keywords: string[],
  productDetails: any,
  brand?: string,
  model?: string
): string {
  const lowerName = productName.toLowerCase();
  const parts: string[] = [];

  // Introduction naturelle selon le type de produit (plus détaillée)
  if (lowerName.includes('collier') || lowerName.includes('necklace')) {
    if (productDetails.materials.includes('Perle')) {
      parts.push(`Collier de perles ${brand ? brand : ''} qui s'adapte à tous les styles, du casual au plus habillé.`);
      parts.push(`Les perles sont soigneusement sélectionnées pour leur qualité et leur éclat.`);
      parts.push(`Ce collier peut être porté seul pour un look minimaliste ou associé à d'autres bijoux pour un style plus affirmé.`);
    } else if (productDetails.materials.includes('Or') || productDetails.materials.includes('Argent')) {
      parts.push(`Collier en ${productDetails.materials[0].toLowerCase()} ${brand ? brand : ''}, design intemporel qui complète toutes vos tenues.`);
      parts.push(`La chaîne est solide et résistante, parfaite pour un usage quotidien.`);
      parts.push(`Le fermoir sécurisé garantit que votre bijou reste en place toute la journée.`);
    } else {
      parts.push(`Collier ${brand ? brand : ''} au design moderne, parfait pour ajouter une touche d'élégance à votre look.`);
      parts.push(`Ce bijou s'adapte à toutes les occasions, que ce soit pour le travail ou les sorties entre amies.`);
      parts.push(`La longueur ajustable permet de l'adapter à votre morphologie et à votre style personnel.`);
    }
  } else if (lowerName.includes('boucle') || lowerName.includes('earring')) {
    if (productDetails.materials.includes('Pierre')) {
      parts.push(`Boucles d'oreilles ${brand ? brand : ''} avec pierres, légères et confortables pour un port quotidien.`);
      parts.push(`Les pierres captent la lumière et illuminent votre visage naturellement.`);
      parts.push(`Le design est pensé pour être élégant sans être trop imposant, parfait pour toutes les occasions.`);
    } else {
      parts.push(`Boucles d'oreilles ${brand ? brand : ''}, finitions soignées et style raffiné.`);
      parts.push(`Légères et confortables, elles peuvent être portées toute la journée sans gêne.`);
      parts.push(`Le design intemporel s'adapte à tous vos looks, du plus décontracté au plus habillé.`);
    }
  } else if (lowerName.includes('bracelet')) {
    parts.push(`Bracelet ${brand ? brand : ''}, taille ajustable et résistant pour un usage quotidien.`);
    parts.push(`Le design moderne s'adapte à tous les styles et complète parfaitement vos autres bijoux.`);
    parts.push(`La solidité de la chaîne garantit une longue durée de vie, même avec un port intensif.`);
  } else if (lowerName.includes('bague') || lowerName.includes('ring')) {
    parts.push(`Bague ${brand ? brand : ''}, design intemporel qui sublime vos mains.`);
    parts.push(`Cette bague peut être portée seule pour un look minimaliste ou empilée avec d'autres bagues pour un style plus affirmé.`);
    parts.push(`La finition soignée et les détails raffinés en font un bijou de qualité qui durera dans le temps.`);
  } else if (lowerName.includes('sac') || lowerName.includes('bag')) {
    parts.push(`Sac ${brand ? brand : ''}, compartiments pratiques et design tendance.`);
    parts.push(`Parfait pour transporter vos affaires au quotidien tout en gardant un style élégant.`);
    parts.push(`Les compartiments multiples permettent d'organiser vos affaires efficacement.`);
  } else if (lowerName.includes('écharpe') || lowerName.includes('scarf')) {
    parts.push(`Écharpe ${brand ? brand : ''}, douce et polyvalente pour toutes les saisons.`);
    parts.push(`Cette écharpe peut être portée de multiples façons pour s'adapter à votre style et à la météo.`);
    parts.push(`La matière douce au toucher garantit un confort optimal tout au long de la journée.`);
  } else {
    // Description générique mais naturelle et détaillée
    parts.push(`${productName}${brand ? ` ${brand}` : ''}${model ? ` ${model}` : ''}, ${getNaturalProductDescription(category)}.`);
    parts.push(`Ce produit allie qualité et design pour répondre à vos besoins au quotidien.`);
    parts.push(`La fabrication soignée garantit une longue durée de vie et une satisfaction optimale.`);
  }

  // Ajouter détails spécifiques de manière naturelle (plus de détails)
  if (keywords.length > 0) {
    const relevantKeywords = keywords
      .filter(k => k.length > 4 && !['produit', 'article', 'item', 'accessoire', 'bijou', 'object', 'thing'].includes(k.toLowerCase()))
      .slice(0, 4);
    if (relevantKeywords.length > 0) {
      parts.push(`Caractéristiques principales : ${relevantKeywords.join(', ')}.`);
    }
  }

  // Ajouter informations sur l'utilisation si disponibles
  if (productDetails.materials.length > 0) {
    parts.push(`Matériaux utilisés : ${productDetails.materials.join(', ').toLowerCase()}.`);
  }

  const description = parts.join(' ');

  // S'assurer que la description fait au moins 50 mots (environ 300 caractères)
  if (description.split(' ').length < 50) {
    // Ajouter des détails supplémentaires
    parts.push(`Idéal pour compléter votre collection et exprimer votre personnalité unique.`);
    parts.push(`Un choix parfait pour celles qui recherchent qualité et style dans leurs accessoires.`);
  }

  return parts.join(' ');
}

/**
 * Obtenir une description naturelle par catégorie (sans phrases "IA-like")
 */
function getNaturalProductDescription(category: string): string {
  const descriptions: Record<string, string> = {
    'Bijoux': 'fabrication soignée et design élégant',
    'Accessoires': 'pratique et tendance',
    'Mode': 'confortable et stylé',
    'Beauté': 'formule douce et efficace',
    'Décoration': 'design moderne qui s\'adapte à tous les intérieurs',
  };
  return descriptions[category] || 'qualité et design soigné';
}

/**
 * Extraire des détails spécifiques depuis le nom du produit et keywords
 */
function extractProductDetails(productName: string, keywords: string[]): {
  intro: string;
  materials: string[];
  sizes: string[];
  colors: string[];
} {
  const lowerName = productName.toLowerCase();
  const lowerKeywords = keywords.map(k => k.toLowerCase());
  const allText = (lowerName + ' ' + lowerKeywords.join(' ')).toLowerCase();

  const materials: string[] = [];
  const sizes: string[] = [];
  const colors: string[] = [];
  let intro = '';

  // Détecter matériaux
  const materialKeywords: Record<string, string> = {
    'or': 'Or',
    'argent': 'Argent',
    'acier': 'Acier inoxydable',
    'plaqué': 'Plaqué or',
    'verre': 'Verre',
    'cristal': 'Cristal',
    'perle': 'Perle',
    'diamant': 'Diamant',
    'cuir': 'Cuir',
    'tissu': 'Tissu',
    'coton': 'Coton',
    'soie': 'Soie',
    'plastique': 'Plastique',
    'métal': 'Métal',
    'bois': 'Bois',
  };
  for (const [key, value] of Object.entries(materialKeywords)) {
    if (allText.includes(key)) {
      materials.push(value);
    }
  }

  // Détecter tailles
  const sizePatterns = [
    /\b(s|m|l|xl|xxl)\b/i,
    /\b(\d+)\s*(cm|mm|inch)\b/i,
    /\b(one\s*size|taille\s*unique)\b/i,
  ];
  for (const pattern of sizePatterns) {
    const match = allText.match(pattern);
    if (match) {
      sizes.push(match[0]);
    }
  }

  // Détecter couleurs
  const colorKeywords = ['rouge', 'bleu', 'vert', 'jaune', 'noir', 'blanc', 'rose', 'violet', 'orange', 'doré', 'argenté', 'multicolore'];
  for (const color of colorKeywords) {
    if (allText.includes(color)) {
      colors.push(color.charAt(0).toUpperCase() + color.slice(1));
    }
  }

  // Introduction spécifique selon le type de produit
  if (lowerName.includes('collier') || lowerName.includes('necklace')) {
    intro = 'un collier élégant qui met en valeur votre décolleté et ajoute une touche de sophistication à toutes vos tenues';
  } else if (lowerName.includes('boucle') || lowerName.includes('earring')) {
    intro = 'des boucles d\'oreilles raffinées qui illuminent votre visage et complètent parfaitement votre style';
  } else if (lowerName.includes('bracelet')) {
    intro = 'un bracelet élégant qui s\'adapte à tous vos looks et exprime votre personnalité unique';
  } else if (lowerName.includes('bague') || lowerName.includes('ring')) {
    intro = 'une bague intemporelle qui sublime vos mains et ajoute une touche d\'élégance à votre style';
  } else if (lowerName.includes('sac') || lowerName.includes('bag')) {
    intro = 'un sac tendance qui allie praticité et style pour accompagner toutes vos sorties';
  } else if (lowerName.includes('écharpe') || lowerName.includes('scarf')) {
    intro = 'une écharpe douce et polyvalente qui réchauffe vos tenues tout en ajoutant une note de style';
  }

  return { intro, materials, sizes, colors };
}

/**
 * Obtenir une introduction ultra-spécifique selon le produit
 */
function getProductSpecificIntro(productName: string, category: string, keywords: string[]): string {
  const lowerName = productName.toLowerCase();
  const allKeywords = keywords.map(k => k.toLowerCase()).join(' ');

  // Introductions ultra-spécifiques selon le nom exact du produit
  if (lowerName.includes('collier') || lowerName.includes('necklace')) {
    if (allKeywords.includes('perle') || allKeywords.includes('pearl')) {
      return `Adoptez ce ${productName}, un collier de perles intemporel qui apporte élégance et raffinement à votre tenue.`;
    } else if (allKeywords.includes('chaine') || allKeywords.includes('chain')) {
      return `Découvrez ce ${productName}, un collier à chaîne moderne qui s'adapte à tous vos looks, du casual au plus habillé.`;
    } else {
      return `Adoptez ce ${productName}, un collier élégant qui met en valeur votre décolleté et ajoute une touche de sophistication.`;
    }
  } else if (lowerName.includes('boucle') || lowerName.includes('earring')) {
    if (allKeywords.includes('pierre') || allKeywords.includes('stone')) {
      return `Illuminez votre visage avec ces ${productName}, des boucles d'oreilles ornées de pierres qui captent la lumière et subliment votre regard.`;
    } else if (allKeywords.includes('pendant') || allKeywords.includes('drop')) {
      return `Adoptez ces ${productName}, des boucles d'oreilles pendantes qui ajoutent mouvement et élégance à votre silhouette.`;
    } else {
      return `Illuminez votre visage avec ces ${productName}, des boucles d'oreilles raffinées qui complètent parfaitement votre style.`;
    }
  } else if (lowerName.includes('bracelet')) {
    return `Portez ce ${productName}, un bracelet élégant qui s'adapte à tous vos looks et exprime votre personnalité unique.`;
  } else if (lowerName.includes('bague') || lowerName.includes('ring')) {
    return `Sublimez vos mains avec cette ${productName}, une bague intemporelle qui ajoute une touche d'élégance à votre style.`;
  }

  // Fallback par catégorie
  const categoryIntros: Record<string, string> = {
    'Bijoux': `Adoptez ce ${productName}, un bijou unique qui sublime votre personnalité et ajoute une touche d'élégance à votre style.`,
    'Accessoires': `Offrez-vous ce ${productName}, l'accessoire tendance qui complète parfaitement votre look et exprime votre personnalité.`,
    'Mode': `Portez ce ${productName}, une pièce mode qui allie confort et style pour vous accompagner au quotidien avec élégance.`,
    'Beauté': `Prenez soin de vous avec ce ${productName}, un produit de beauté soigneusement formulé pour révéler votre éclat naturel.`,
    'Décoration': `Transformez votre intérieur avec ce ${productName}, une décoration qui reflète votre personnalité et crée une atmosphère chaleureuse.`,
    'Imprimante 3D': `Explorez la créativité avec cette ${productName}, une imprimante 3D performante qui transforme vos idées en réalité.`,
  };

  return categoryIntros[category] || `Découvrez ce ${productName}, un produit soigneusement sélectionné pour sa qualité exceptionnelle et son design raffiné.`;
}

/**
 * Générer une description spécifique et détaillée
 */
function generateSpecificDescription(
  productName: string,
  category: string,
  keywords: string[],
  _productDetails: any
): string {
  const lowerName = productName.toLowerCase();
  const parts: string[] = [];

  // Description spécifique selon le type de produit
  if (lowerName.includes('collier') || lowerName.includes('necklace')) {
    parts.push(`Ce collier se distingue par sa chaîne ajustable, son fermoir sécurisé et son design intemporel qui s'adapte à toutes les occasions.`);
    parts.push(`Parfait pour compléter une tenue décontractée ou habillée, il ajoute une touche d'élégance à votre style.`);
  } else if (lowerName.includes('boucle') || lowerName.includes('earring')) {
    parts.push(`Ces boucles d'oreilles se caractérisent par leurs finitions soignées, leur confort optimal et leur style raffiné.`);
    parts.push(`Légères et confortables à porter toute la journée, elles illuminent votre visage et complètent parfaitement votre look.`);
  } else if (lowerName.includes('bracelet')) {
    parts.push(`Ce bracelet se distingue par sa taille ajustable, sa résistance et son design moderne.`);
    parts.push(`Idéal pour un usage quotidien, il s'adapte à tous vos looks et exprime votre personnalité unique.`);
  } else {
    // Description générique mais avec détails spécifiques
    const specificFeatures = getSpecificFeatures(productName, category, keywords);
    if (specificFeatures.length > 0) {
      parts.push(`Ce ${productName} se distingue par ${specificFeatures.join(', ')}.`);
    } else {
      parts.push(`Ce ${productName} allie esthétique et fonctionnalité pour répondre à tous vos besoins.`);
    }
  }

  // Ajouter avantages spécifiques
  const benefits = getCategoryBenefits(category);
  if (benefits.length > 0) {
    parts.push(`✨ Avantages exclusifs : ${benefits.slice(0, 3).join(', ')}.`);
  }

  return parts.join(' ');
}

/**
 * Obtenir des caractéristiques spécifiques selon le nom du produit
 */
function getSpecificFeatures(productName: string, _category: string, keywords: string[]): string[] {
  const lowerName = productName.toLowerCase();
  const features: string[] = [];

  // Caractéristiques selon le nom du produit
  if (lowerName.includes('collier') || lowerName.includes('necklace')) {
    features.push('sa chaîne ajustable', 'son fermoir sécurisé', 'son design intemporel');
  } else if (lowerName.includes('boucle') || lowerName.includes('earring')) {
    features.push('ses finitions soignées', 'son confort optimal', 'son style raffiné');
  } else if (lowerName.includes('bracelet')) {
    features.push('sa taille ajustable', 'sa résistance', 'son design moderne');
  } else if (lowerName.includes('bag') || lowerName.includes('sac')) {
    features.push('ses compartiments pratiques', 'sa solidité', 'son design tendance');
  } else if (lowerName.includes('scarf') || lowerName.includes('écharpe')) {
    features.push('sa douceur', 'sa polyvalence', 'son style élégant');
  } else if (lowerName.includes('3d') || lowerName.includes('printer')) {
    features.push('sa précision', 'sa facilité d\'utilisation', 'sa compatibilité');
  }

  // Ajouter des caractéristiques depuis les keywords si pertinentes
  const relevantKeywords = keywords.filter(k =>
    k.length > 3 &&
    !['produit', 'article', 'item', 'accessoire'].includes(k.toLowerCase())
  );
  if (relevantKeywords.length > 0 && features.length < 3) {
    features.push(...relevantKeywords.slice(0, 3 - features.length).map(k => `son ${k}`));
  }

  return features.slice(0, 3);
}

/**
 * Obtenir les avantages par catégorie
 */
function getCategoryBenefits(category: string): string[] {
  const benefits: Record<string, string[]> = {
    'Bijoux': [
      'Design élégant et intemporel',
      'Qualité premium garantie',
      'Parfait pour toutes les occasions',
      'Style unique et raffiné'
    ],
    'Accessoires': [
      'Pratique et fonctionnel',
      'Design moderne et tendance',
      'Haute qualité de fabrication',
      'Idéal pour compléter votre style'
    ],
    'Mode': [
      'Taille universelle',
      'Matériaux de qualité supérieure',
      'Style tendance et intemporel',
      'Confort optimal garanti'
    ],
    'Beauté': [
      'Formule douce et efficace',
      'Résultats visibles rapidement',
      'Composition naturelle',
      'Testé dermatologiquement'
    ],
    'Décoration': [
      'Design moderne et élégant',
      'S\'adapte à tous les intérieurs',
      'Qualité premium',
      'Facile à intégrer'
    ],
  };

  return benefits[category] || [
    'Qualité exceptionnelle',
    'Design soigné',
    'Rapport qualité-prix imbattable',
    'Satisfaction garantie'
  ];
}

/**
 * Obtenir les arguments de vente par catégorie
 */
function getSellingPoints(category?: string): string[] {
  const points: Record<string, string[]> = {
    'Bijoux': [
      'Un bijou qui sublime votre personnalité et ajoute une touche d\'élégance à toutes vos tenues.',
    ],
    'Accessoires': [
      'L\'accessoire parfait pour compléter votre look et exprimer votre style unique.',
    ],
    'Mode': [
      'Une pièce mode qui allie confort et style pour vous accompagner au quotidien.',
    ],
    'Beauté': [
      'Prenez soin de vous avec un produit de beauté qui respecte votre peau et révèle votre éclat naturel.',
    ],
    'Décoration': [
      'Transformez votre intérieur avec une décoration qui reflète votre personnalité et crée une atmosphère chaleureuse.',
    ],
  };

  return points[category || ''] || [
    'Un produit soigneusement sélectionné pour sa qualité et son design, qui saura répondre à vos attentes.',
  ];
}

// Ces helpers sont conservés pour enrichissement futur (évite warnings TS noUnusedLocals)
void getProductSpecificIntro;
void generateSpecificDescription;
void getSellingPoints;

function estimatePrice(category: string): number {
  const prices: Record<string, number> = {
    'Imprimante 3D': 299.99,
    'Bijoux': 29.99,
    'Accessoires': 19.99,
    'Autre': 49.99,
  };

  return prices[category] || 49.99;
}

function generateTags(
  recognition: ImageRecognitionResult,
  _searchInfo: any
): string[] {
  const tags: string[] = [];

  if (recognition.brand) tags.push(recognition.brand);
  if (recognition.category) tags.push(recognition.category);
  tags.push(...recognition.keywords.slice(0, 5));

  return [...new Set(tags)].slice(0, 10);
}
