/**
 * Routes génération automatique de produits depuis images
 */
import { Router } from 'express';
import { isLegalCatalogModeEnabled } from '../config/legalCatalog.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { upload, validateUploadedFile } from '../middleware/uploadValidation.middleware.js';
import { generateProductFromImage, recognizeProductFromImage } from '../services/imageRecognitionService.js';
import { upsertProductSpecifications } from '../services/productSpecsService.js';
import { createProduct } from '../services/productsService.js';
import { logger } from '../utils/logger.js';

const router = Router();

// POST /api/products/auto-generate - Générer produit depuis image
router.post(
  '/auto-generate',
  requireAdminAuth,
  upload.single('image'),
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    try {
      // 1. Générer la fiche produit depuis l'image
      const generated = await generateProductFromImage(req.file.buffer);

      // 2. Retourner la fiche générée (sans créer le produit)
      return res.json({
        success: true,
        product: generated,
        message: 'Fiche produit générée avec succès',
      });
    } catch (error: any) {
      logger.error('Erreur génération auto produit', error, {
        filename: req.file?.originalname,
        size: req.file?.size,
      });

      // Messages d'erreur plus clairs
      let errorMessage = 'Erreur lors de la génération';
      let statusCode = 500;

      if (error.message?.includes('Validation failed') || error.message?.includes('ZodError')) {
        errorMessage = 'Les données générées ne sont pas valides. Veuillez réessayer avec une autre image.';
        statusCode = 400;
      } else if (error.message?.includes('timeout') || error.message?.includes('Timeout')) {
        errorMessage = 'La génération prend trop de temps. Réessayez dans quelques instants.';
        statusCode = 504;
      } else if (error.message?.includes('reconnaître') || error.message?.includes('reconnaissance')) {
        errorMessage = 'Impossible de reconnaître le produit depuis l\'image. Vérifiez que l\'image contient bien un produit visible.';
        statusCode = 400;
      } else if (error.message) {
        errorMessage = error.message;
      }

      return res.status(statusCode).json({
        error: 'Erreur lors de la génération',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  })
);

// POST /api/products/auto-generate/create - Générer ET créer le produit
router.post(
  '/auto-generate/create',
  requireAdminAuth,
  upload.single('image'),
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    if (isLegalCatalogModeEnabled()) {
      return res.status(403).json({
        error: 'LEGAL_CATALOG_MODE',
        message: 'Création automatique de produit désactivée (mode catalogue légal).',
        hint: 'Utilise la génération (sans créer) ou crée manuellement des produits issus de sources autorisées.',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    try {
      // 1. Générer la fiche produit
      const generated = await generateProductFromImage(req.file.buffer);

      // 2. Valider et nettoyer les données générées
      let description = generated.description ? generated.description.trim() : undefined;

      // S'assurer que la description fait au moins 20 mots (évite descriptions trop courtes)
      if (description && description.split(/\s+/).length < 20) {
        logger.warn('Description générée trop courte, enrichissement automatique', {
          originalLength: description.split(/\s+/).length,
          originalDescription: description.substring(0, 100),
        });
        // Enrichir la description avec des informations supplémentaires
        const category = generated.category || 'produit';
        const additionalInfo = `Ce ${category.toLowerCase()} allie qualité et design pour répondre à vos besoins au quotidien. La fabrication soignée garantit une longue durée de vie et une satisfaction optimale. Idéal pour compléter votre collection et exprimer votre personnalité unique.`;
        description = description + ' ' + additionalInfo;
      }

      const productData = {
        title: (generated.title || 'Produit sans titre').trim(),
        description: description,
        price: typeof req.body.customPrice === 'number' && req.body.customPrice > 0
          ? req.body.customPrice
          : (typeof generated.price === 'number' && generated.price > 0 ? generated.price : 19.99),
        category: (generated.category || 'Autre').trim(),
        stock: typeof req.body.stock === 'number' && req.body.stock >= 0 ? Math.floor(req.body.stock) : 0,
        images: Array.isArray(generated.images) && generated.images.length > 0
          ? generated.images.filter((img: string) => typeof img === 'string' && img.length > 0 && (img.startsWith('http://') || img.startsWith('https://')))
          : [],
        tags: Array.isArray(generated.tags) ? generated.tags.filter((tag: string) => typeof tag === 'string' && tag.length > 0 && tag.length <= 50).slice(0, 20) : [],
      };

      // 3. Validation manuelle avec messages clairs
      if (!productData.title || productData.title.length < 3) {
        return res.status(400).json({
          error: 'Validation failed',
          message: 'Le titre généré est invalide ou trop court. Veuillez réessayer avec une autre image.',
          details: {
            title: productData.title,
            titleLength: productData.title.length,
          }
        });
      }

      if (productData.title.length > 255) {
        productData.title = productData.title.substring(0, 252) + '...';
      }

      if (productData.description && productData.description.length > 5000) {
        productData.description = productData.description.substring(0, 4997) + '...';
      }

      if (productData.price <= 0 || productData.price > 999999.99) {
        return res.status(400).json({
          error: 'Validation failed',
          message: `Le prix généré (${productData.price}€) est invalide. Veuillez spécifier un prix personnalisé entre 0.01€ et 999999.99€.`,
          details: {
            price: productData.price,
            suggestion: 'Utilisez le paramètre customPrice dans le body de la requête',
          }
        });
      }

      if (!productData.category || productData.category.length < 2) {
        productData.category = 'Autre';
      }

      if (productData.category.length > 100) {
        productData.category = productData.category.substring(0, 100);
      }

      // 4. Créer le produit
      let product;
      try {
        product = await createProduct(productData);
        logger.info('Produit créé avec succès depuis image', { productId: product.id, title: product.title });
      } catch (createError: any) {
        // Logger TOUTES les informations disponibles pour diagnostic
        const errorDetails: any = {
          productData: {
            title: productData.title,
            titleLength: productData.title?.length || 0,
            price: productData.price,
            priceType: typeof productData.price,
            category: productData.category,
            categoryLength: productData.category?.length || 0,
            stock: productData.stock,
            stockType: typeof productData.stock,
            hasDescription: !!productData.description,
            descriptionLength: productData.description?.length || 0,
            descriptionWordCount: productData.description ? productData.description.split(/\s+/).length : 0,
            imagesCount: productData.images.length,
            imagesType: Array.isArray(productData.images),
            imagesSample: productData.images.slice(0, 2),
            tagsCount: productData.tags.length,
            tagsType: Array.isArray(productData.tags),
            tagsSample: productData.tags.slice(0, 5),
          },
          errorMessage: createError.message,
          errorStack: createError.stack,
        };

        // Ajouter détails Supabase si disponibles
        if (createError.code) {
          errorDetails.errorCode = createError.code;
        }
        if (createError.details) {
          errorDetails.errorDetails = createError.details;
        }
        if (createError.hint) {
          errorDetails.errorHint = createError.hint;
        }

        logger.error('Erreur création produit depuis image', createError instanceof Error ? createError : new Error(String(createError)), errorDetails);

        // Message d'erreur plus clair pour l'utilisateur
        let userMessage = 'Erreur lors de l\'enregistrement en base de données. Vérifiez les logs.';
        const rawMessage = (createError?.message || '').toString();

        // Cas le plus fréquent en dev: Supabase non configuré (mock client)
        if (rawMessage.toLowerCase().includes('supabase non configur')) {
          userMessage =
            'Supabase n’est pas configuré sur le backend. Renseignez SUPABASE_URL et SUPABASE_KEY (service role) dans l’environnement, puis redémarrez le backend.';
        }
        if (createError.code === '23505' || createError.message?.includes('duplicate') || createError.message?.includes('unique')) {
          userMessage = 'Un produit avec ce titre existe déjà. Modifiez le titre et réessayez.';
        } else if (createError.code === '23503' || createError.message?.includes('foreign key')) {
          userMessage = 'Erreur de référence. Vérifiez que la catégorie existe.';
        } else if (createError.code === '23502' || createError.message?.includes('not null')) {
          userMessage = 'Des champs obligatoires sont manquants. Vérifiez le titre, le prix et la catégorie.';
        } else if (createError.code === '22P02' || createError.message?.includes('invalid input') || createError.message?.includes('syntax')) {
          userMessage = 'Format de données invalide. Vérifiez que le prix est un nombre valide et que les arrays (images, tags) sont correctement formatés.';
        } else if (createError.message?.includes('validation') || createError.message?.includes('required')) {
          userMessage = 'Les données générées ne sont pas valides. Veuillez réessayer avec une autre image.';
        } else if (createError.message?.includes('database') || createError.message?.includes('connection') || createError.message?.includes('timeout')) {
          userMessage = 'Erreur de connexion à la base de données. Vérifiez que Supabase est configuré correctement et que la connexion est stable.';
        } else if (createError.hint) {
          userMessage = `Erreur base de données: ${createError.message}. Indice: ${createError.hint}`;
        }

        // 503 si Supabase non configuré, sinon 500
        const statusCode = rawMessage.toLowerCase().includes('supabase non configur') ? 503 : 500;
        return res.status(statusCode).json({
          error: 'Erreur création produit',
          message: userMessage,
          errorCode: createError.code || undefined,
          errorHint: createError.hint || undefined,
          details: process.env.NODE_ENV === 'development' ? {
            message: createError.message,
            code: createError.code,
            details: createError.details,
            hint: createError.hint,
            productData: {
              title: productData.title,
              price: productData.price,
              category: productData.category,
              descriptionLength: productData.description?.length || 0,
              imagesCount: productData.images.length,
              tagsCount: productData.tags.length,
            },
          } : undefined,
        });
      }

      // 3. Si c'est une imprimante 3D, créer les spécifications automatiquement
      if (generated.category === 'Imprimante 3D' && Object.keys(generated.specifications).length > 0) {
        try {
          const specs = Object.entries(generated.specifications).map(([key, value], index) => ({
            key,
            value: String(value),
            category: '3d-printer',
            displayOrder: index,
          }));

          await upsertProductSpecifications(product.id, specs);
          logger.info('Spécifications 3D créées automatiquement', { productId: product.id, count: specs.length });
        } catch (specError: any) {
          logger.warn('Erreur création specs', { productId: product.id, error: specError.message });
          // Ne pas faire échouer la création du produit si les specs échouent
        }
      }

      return res.status(201).json({
        success: true,
        product,
        message: 'Produit créé automatiquement avec succès',
      });
    } catch (error: any) {
      // Déclarer generated dans le scope du catch
      const errorGenerated = (error as any).generated || null;
      logger.error('Erreur création auto produit', error, {
        generated: errorGenerated ? {
          title: errorGenerated.title,
          price: errorGenerated.price,
          category: errorGenerated.category,
        } : null,
      });

      // Messages d'erreur plus clairs avec détails de validation
      let errorMessage = 'Erreur lors de la création';
      let statusCode = 500;

      if (error.message?.includes('Validation failed') || error.message?.includes('ZodError')) {
        errorMessage = 'Les données générées ne passent pas la validation. Veuillez réessayer avec une autre image.';
        statusCode = 400;
      } else if (error.message?.includes('database') || error.message?.includes('Supabase')) {
        errorMessage = 'Erreur lors de l\'enregistrement en base de données. Vérifiez les logs.';
        statusCode = 500;
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'La création prend trop de temps. Réessayez dans quelques instants.';
        statusCode = 504;
      } else if (error.message) {
        errorMessage = error.message;
      }

      return res.status(statusCode).json({
        error: 'Erreur lors de la création',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  })
);

// POST /api/products/auto-generate/recognize - Juste reconnaître l'image
router.post(
  '/auto-generate/recognize',
  requireAdminAuth,
  upload.single('image'),
  validateUploadedFile,
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    try {
      const recognition = await recognizeProductFromImage(req.file.buffer);
      return res.json({
        success: true,
        recognition,
      });
    } catch (error: any) {
      logger.error('Erreur reconnaissance image', error);
      return res.status(500).json({
        error: 'Erreur lors de la reconnaissance',
        message: error.message,
      });
    }
  })
);

export default router;
