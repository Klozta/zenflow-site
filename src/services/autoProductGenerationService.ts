/**
 * Service de génération automatique de fiche produit
 * Combine reconnaissance d'image + recherche web + génération de fiche
 */
import { recognizeProductFromImage } from './imageRecognitionService.js';
import { convertPrinter3DSpecsToGeneric } from './productSpecsService.js';
import { createProduct } from './productsService.js';
import { logger } from '../utils/logger.js';
import type { ProductInput } from '../types/products.types.js';
import type { Printer3DSpecs } from '../types/productSpecs.types.js';

export interface AutoProductGenerationResult {
  product: any;
  confidence: number;
  source: {
    imageRecognition: boolean;
    webSearch: boolean;
    manualReview: boolean;
  };
  suggestions: {
    title?: string;
    description?: string;
    price?: number;
    category?: string;
    specifications?: Record<string, string>;
  };
}

/**
 * Générer automatiquement une fiche produit depuis une image
 */
export async function generateProductFromImage(
  imageUrl: string | Buffer,
  options?: {
    autoCreate?: boolean;
    category?: string;
    stock?: number;
  }
): Promise<AutoProductGenerationResult> {
  try {
    logger.info('Début génération auto produit depuis image');

    // Étape 1: Reconnaissance d'image
    const recognition = await recognizeProductFromImage(imageUrl);
    logger.info('Reconnaissance image terminée', {
      productName: recognition.productName,
      confidence: recognition.confidence
    });

    if (recognition.confidence < 0.3) {
      return {
        product: null,
        confidence: recognition.confidence,
        source: {
          imageRecognition: false,
          webSearch: false,
          manualReview: true,
        },
        suggestions: {
          title: 'Produit à identifier',
          description: 'Veuillez renseigner les informations manuellement',
          category: options?.category || 'Imprimante 3D',
        },
      };
    }

    // Étape 2: Recherche web pour les spécifications
    let webData: any = null;
    let webSearchSuccess = false;

    // Recherche web désactivée - fonction searchProductSpecs non disponible
    // if (recognition.productName || recognition.model) {
    //   try {
    //     webData = await searchProductSpecs(
    //       recognition.productName || recognition.model || '',
    //       recognition.brand,
    //       recognition.model
    //     );
    //     webSearchSuccess = !!webData.title;
    //     logger.info('Recherche web terminée', { found: webSearchSuccess });
    //   } catch (error: any) {
    //     logger.warn('Recherche web échouée', { error: error.message });
    //   }
    // }

    // Étape 3: Combiner les données
    const finalTitle = webData?.title || recognition.productName || recognition.model || 'Imprimante 3D';
    const finalDescription = webData?.description ||
      `Imprimante 3D ${recognition.brand || ''} ${recognition.model || ''}`.trim();
    const finalPrice = webData?.price;
    const finalCategory = options?.category || 'Imprimante 3D';
    const finalImages = webData?.images && webData.images.length > 0
      ? webData.images
      : (typeof imageUrl === 'string' ? [imageUrl] : []);

    // Étape 4: Convertir les spécifications web en format Printer3DSpecs
    const printerSpecs: Printer3DSpecs = {};
    if (webData?.specifications) {
      const specs = webData.specifications;

      // Mapping des clés communes
      if (specs['Volume d\'impression'] || specs['Build Volume'] || specs['Volume']) {
        printerSpecs.buildVolume = specs['Volume d\'impression'] || specs['Build Volume'] || specs['Volume'];
      }
      if (specs['Type de filament'] || specs['Filament Type']) {
        printerSpecs.filamentType = (specs['Type de filament'] || specs['Filament Type']).split(',').map((s: string) => s.trim());
      }
      if (specs['Diamètre filament'] || specs['Filament Diameter']) {
        printerSpecs.filamentDiameter = specs['Diamètre filament'] || specs['Filament Diameter'];
      }
      if (specs['Hauteur de couche'] || specs['Layer Height']) {
        printerSpecs.layerHeight = specs['Hauteur de couche'] || specs['Layer Height'];
      }
      if (specs['Diamètre buse'] || specs['Nozzle Size']) {
        printerSpecs.nozzleSize = specs['Diamètre buse'] || specs['Nozzle Size'];
      }
      if (specs['Vitesse'] || specs['Print Speed']) {
        printerSpecs.printSpeed = specs['Vitesse'] || specs['Print Speed'];
      }
      if (specs['Température buse'] || specs['Hotend Temp']) {
        printerSpecs.hotendTemp = specs['Température buse'] || specs['Hotend Temp'];
      }
      if (specs['Température plateau'] || specs['Bed Temp']) {
        printerSpecs.bedTemp = specs['Température plateau'] || specs['Bed Temp'];
      }
      if (specs['Connectivité'] || specs['Connectivity']) {
        printerSpecs.connectivity = (specs['Connectivité'] || specs['Connectivity']).split(',').map((s: string) => s.trim());
      }
      if (specs['Écran'] || specs['Display']) {
        printerSpecs.display = specs['Écran'] || specs['Display'];
      }
      if (specs['Poids'] || specs['Weight']) {
        printerSpecs.weight = specs['Poids'] || specs['Weight'];
      }
      if (specs['Dimensions']) {
        printerSpecs.dimensions = specs['Dimensions'];
      }
      if (specs['Consommation'] || specs['Power']) {
        printerSpecs.powerConsumption = specs['Consommation'] || specs['Power'];
      }
    }

    const suggestions = {
      title: finalTitle,
      description: finalDescription,
      price: finalPrice,
      category: finalCategory,
      specifications: webData?.specifications || {},
    };

    // Étape 5: Créer le produit si demandé
    let product = null;
    if (options?.autoCreate) {
      const productData: ProductInput = {
        title: finalTitle,
        description: finalDescription,
        price: finalPrice || 0,
        category: finalCategory,
        stock: options?.stock || 0,
        images: finalImages,
        tags: recognition.keywords.slice(0, 10),
      };

      product = await createProduct(productData);

      // Ajouter les spécifications si disponibles
      if (Object.keys(printerSpecs).length > 0) {
        try {
          const { upsertProductSpecifications } = await import('./productSpecsService.js');
          const genericSpecs = convertPrinter3DSpecsToGeneric(printerSpecs);
          await upsertProductSpecifications(product.id, genericSpecs);
        } catch (error: any) {
          logger.warn('Erreur ajout spécifications', { error: error.message });
        }
      }
    }

    return {
      product,
      confidence: Math.max(recognition.confidence, webSearchSuccess ? 0.8 : 0.5),
      source: {
        imageRecognition: recognition.confidence > 0.3,
        webSearch: webSearchSuccess,
        manualReview: recognition.confidence < 0.5 || !webSearchSuccess,
      },
      suggestions,
    };
  } catch (error: any) {
    logger.error('Erreur génération auto produit', error);
    throw error;
  }
}
