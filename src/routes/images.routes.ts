/**
 * Routes pour l'upload et la gestion d'images via CDN
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { imageCdnService } from '../services/imageCdnService.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Configuration Multer pour upload de fichiers
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    // Accepter seulement les images
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé. Seules les images sont acceptées.'));
    }
  },
});

/**
 * POST /api/images/upload - Upload une image vers le CDN (admin only)
 * Body: multipart/form-data avec champ 'image'
 * Query params:
 *   - folder: Dossier de stockage (défaut: 'products')
 *   - width: Largeur cible (optionnel)
 *   - height: Hauteur cible (optionnel)
 *   - quality: Qualité 1-100 (défaut: 80)
 */
router.post(
  '/upload',
  requireAdminAuth,
  upload.single('image'),
  asyncHandler(async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier fourni' });
      }

      const folder = (req.query.folder as string) || 'products';
      const width = req.query.width ? parseInt(req.query.width as string) : undefined;
      const height = req.query.height ? parseInt(req.query.height as string) : undefined;
      const quality = req.query.quality ? parseInt(req.query.quality as string) : 80;

      // Générer un nom de fichier unique
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).substring(2, 15);
      const extension = req.file.originalname.split('.').pop() || 'jpg';
      const filename = `${folder}/${timestamp}-${randomStr}.${extension}`;

      const result = await imageCdnService.uploadImage(req.file.buffer as Buffer, filename, {
        folder,
        transformation: {
          width,
          height,
          quality,
          format: 'auto', // WebP/AVIF automatique
          crop: width && height ? 'fill' : 'fit',
        },
      });

      logger.info('Image uploaded to CDN', {
        filename,
        provider: result.provider,
        size: result.size,
      });

      return res.json({
        success: true,
        image: {
          url: result.url,
          publicId: result.publicId,
          width: result.width,
          height: result.height,
          format: result.format,
          size: result.size,
          provider: result.provider,
        },
      });
    } catch (error) {
      throw handleServiceError(error, 'uploadImage', 'Erreur upload image');
    }
  })
);

/**
 * POST /api/images/optimize - Optimise une URL d'image existante
 * Body: { url: string, width?: number, height?: number, quality?: number }
 */
router.post(
  '/optimize',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const { url, width, height, quality, format } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL requise' });
      }

      const optimizedUrl = imageCdnService.getOptimizedUrl(url, {
        width: width ? parseInt(width) : undefined,
        height: height ? parseInt(height) : undefined,
        quality: quality ? parseInt(quality) : undefined,
        format: format || 'auto',
      });

      return res.json({
        success: true,
        originalUrl: url,
        optimizedUrl,
      });
    } catch (error) {
      throw handleServiceError(error, 'optimizeImage', 'Erreur optimisation image');
    }
  })
);

/**
 * DELETE /api/images/:publicId - Supprime une image du CDN (admin only)
 */
router.delete(
  '/:publicId',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const { publicId } = req.params;

      await imageCdnService.deleteImage(publicId);

      logger.info('Image deleted from CDN', { publicId });

      return res.json({
        success: true,
        message: 'Image supprimée avec succès',
      });
    } catch (error) {
      throw handleServiceError(error, 'deleteImage', 'Erreur suppression image');
    }
  })
);

export default router;

