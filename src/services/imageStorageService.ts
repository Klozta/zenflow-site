/**
 * Service de téléchargement et stockage d'images
 * Télécharge les images depuis des URLs externes et les stocke dans Supabase Storage
 */
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

const BUCKET_NAME = 'product-images';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

interface ImageUploadResult {
  url: string;
  originalUrl: string;
  size: number;
  type: string;
}

/**
 * Télécharge une image depuis une URL et la stocke dans Supabase Storage
 */
export async function downloadAndStoreImage(
  imageUrl: string,
  productId?: string
): Promise<ImageUploadResult> {
  try {
    // Télécharger l'image
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      maxContentLength: MAX_IMAGE_SIZE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*',
      },
    });

    const buffer = Buffer.from(response.data);
    const contentType = response.headers['content-type'] || 'image/jpeg';
    const size = buffer.length;

    // Vérifier la taille
    if (size > MAX_IMAGE_SIZE) {
      throw new Error(`Image trop grande: ${size} bytes (max: ${MAX_IMAGE_SIZE})`);
    }

    // Vérifier le type
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw new Error(`Type d'image non supporté: ${contentType}`);
    }

    // Générer un nom de fichier unique
    const extension = contentType.split('/')[1] || 'jpg';
    const fileName = productId
      ? `${productId}/${uuidv4()}.${extension}`
      : `temp/${uuidv4()}.${extension}`;

    // Vérifier si le bucket existe, sinon le créer
    await ensureBucketExists();

    // Upload vers Supabase Storage
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, buffer, {
        contentType,
        upsert: false,
      });

    if (error) {
      // Si Supabase n'est pas configuré, retourner l'URL originale
      if (error.message.includes('non configuré') || error.message.includes('not configured')) {
        logger.warn('Supabase Storage not configured, using original URL', {
          imageUrl,
        });
        return {
          url: imageUrl,
          originalUrl: imageUrl,
          size,
          type: contentType,
        };
      }
      throw new Error(`Erreur upload image: ${error.message}`);
    }

    // Récupérer l'URL publique
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    return {
      url: publicUrlData.publicUrl,
      originalUrl: imageUrl,
      size,
      type: contentType,
    };
  } catch (error: any) {
    // En cas d'erreur, retourner l'URL originale comme fallback
    logger.warn('Error downloading image, using original URL', {
      imageUrl,
      error: error.message,
    });
    return {
      url: imageUrl,
      originalUrl: imageUrl,
      size: 0,
      type: 'unknown',
    };
  }
}

/**
 * Télécharge plusieurs images en parallèle
 */
export async function downloadAndStoreImages(
  imageUrls: string[],
  productId?: string
): Promise<ImageUploadResult[]> {
  // Limiter à 5 images max pour éviter la surcharge
  const urls = imageUrls.slice(0, 5);

  // Télécharger en parallèle (max 3 à la fois pour éviter la surcharge)
  const results: ImageUploadResult[] = [];
  const batchSize = 3;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(url => downloadAndStoreImage(url, productId))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * S'assure que le bucket existe dans Supabase Storage
 */
async function ensureBucketExists(): Promise<void> {
  try {
    // Vérifier si le bucket existe
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      // Si Supabase n'est pas configuré, on continue quand même
      if (listError.message.includes('non configuré') || listError.message.includes('not configured')) {
        return;
      }
      throw listError;
    }

    const bucketExists = buckets?.some((bucket: { name: string }) => bucket.name === BUCKET_NAME);

    if (!bucketExists) {
      // Créer le bucket
      const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: MAX_IMAGE_SIZE,
        allowedMimeTypes: ALLOWED_TYPES,
      });

      if (createError) {
        // Si le bucket ne peut pas être créé (permissions, etc.), on continue
        console.warn(`⚠️  Impossible de créer le bucket ${BUCKET_NAME}: ${createError.message}`);
      } else {
        console.log(`✅ Bucket ${BUCKET_NAME} créé avec succès`);
      }
    }
  } catch (error: any) {
    // En cas d'erreur, on continue quand même (fallback vers URLs originales)
    console.warn(`⚠️  Erreur vérification bucket: ${error.message}`);
  }
}

/**
 * Supprime une image du storage
 */
export async function deleteImage(filePath: string): Promise<void> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.warn(`⚠️  Erreur suppression image ${filePath}: ${error.message}`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Erreur suppression image: ${error.message}`);
  }
}

/**
 * Supprime toutes les images d'un produit
 */
export async function deleteProductImages(productId: string): Promise<void> {
  try {
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list(productId);

    if (listError) {
      console.warn(`⚠️  Erreur liste images produit ${productId}: ${listError.message}`);
      return;
    }

    if (files && files.length > 0) {
      const filePaths = files.map((file: { name: string }) => `${productId}/${file.name}`);
      const { error: deleteError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove(filePaths);

      if (deleteError) {
        console.warn(`⚠️  Erreur suppression images produit ${productId}: ${deleteError.message}`);
      }
    }
  } catch (error: any) {
    console.warn(`⚠️  Erreur suppression images produit: ${error.message}`);
  }
}
