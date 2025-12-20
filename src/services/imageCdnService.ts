/**
 * Service CDN pour gestion et optimisation des images
 * Supporte Cloudinary, Cloudflare Images, et Supabase Storage
 */

import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

export type CdnProvider = 'cloudinary' | 'cloudflare' | 'supabase' | 'local';

export interface ImageUploadOptions {
  folder?: string;
  transformation?: {
    width?: number;
    height?: number;
    quality?: number;
    format?: 'auto' | 'webp' | 'avif' | 'jpg' | 'png';
    crop?: 'fill' | 'fit' | 'scale' | 'thumb';
  };
}

export interface ImageUploadResult {
  url: string;
  publicId?: string;
  width?: number;
  height?: number;
  format?: string;
  size?: number;
  provider: CdnProvider;
}

/**
 * Service CDN pour images
 */
export class ImageCdnService {
  private provider: CdnProvider;

  constructor() {
    // Déterminer le provider depuis les variables d'environnement
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      this.provider = 'cloudinary';
    } else if (process.env.CLOUDFLARE_ACCOUNT_ID) {
      this.provider = 'cloudflare';
    } else if (process.env.SUPABASE_URL) {
      this.provider = 'supabase';
    } else {
      this.provider = 'local';
    }
  }

  /**
   * Upload une image vers le CDN
   */
  async uploadImage(
    fileBuffer: Buffer,
    filename: string,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    try {
      switch (this.provider) {
        case 'cloudinary':
          return await this.uploadToCloudinary(fileBuffer, filename, options);
        case 'cloudflare':
          return await this.uploadToCloudflare(fileBuffer, filename, options);
        case 'supabase':
          return await this.uploadToSupabase(fileBuffer, filename, options);
        default:
          return await this.uploadLocal(fileBuffer, filename, options);
      }
    } catch (error) {
      throw handleServiceError(error, 'uploadImage', 'Erreur upload image CDN');
    }
  }

  /**
   * Génère une URL optimisée pour une image
   */
  getOptimizedUrl(
    imageUrl: string,
    options?: {
      width?: number;
      height?: number;
      quality?: number;
      format?: 'auto' | 'webp' | 'avif';
    }
  ): string {
    // Si l'image est déjà sur Cloudinary
    if (imageUrl.includes('res.cloudinary.com')) {
      return this.optimizeCloudinaryUrl(imageUrl, options);
    }

    // Si l'image est sur Cloudflare Images
    if (imageUrl.includes('imagedelivery.net')) {
      return this.optimizeCloudflareUrl(imageUrl, options);
    }

    // Pour Supabase ou autres, retourner l'URL originale
    // Next.js Image component s'occupera de l'optimisation
    return imageUrl;
  }

  /**
   * Upload vers Cloudinary
   */
  private async uploadToCloudinary(
    fileBuffer: Buffer,
    _filename: string,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    try {
      // @ts-ignore - Package optionnel, peut ne pas être installé
      const cloudinary = await import('cloudinary').catch(() => null);
      if (!cloudinary) {
        throw new Error('Cloudinary package not installed. Run: npm install cloudinary');
      }

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Cloudinary credentials not configured');
      }

      const v2 = (cloudinary as any).v2 || cloudinary.default?.v2;
      if (!v2) {
        throw new Error('Cloudinary v2 not available');
      }

      v2.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });

      return new Promise((resolve, reject) => {
        const uploadStream = v2.uploader.upload_stream(
          {
            folder: options?.folder || 'zenflow',
            format: options?.transformation?.format || 'auto',
            transformation: options?.transformation
              ? [
                  {
                    width: options.transformation.width,
                    height: options.transformation.height,
                    quality: options.transformation.quality || 'auto',
                    crop: options.transformation.crop || 'fill',
                    fetch_format: options.transformation.format || 'auto',
                  },
                ]
              : [],
          },
          (error: any, result: any) => {
            if (error) {
              reject(error);
              return;
            }

            if (!result) {
              reject(new Error('Cloudinary upload returned no result'));
              return;
            }

            resolve({
              url: result.secure_url,
              publicId: result.public_id,
              width: result.width,
              height: result.height,
              format: result.format,
              size: result.bytes,
              provider: 'cloudinary',
            });
          }
        );

        uploadStream.end(fileBuffer);
      });
    } catch (error) {
      throw handleServiceError(error, 'uploadToCloudinary', 'Erreur upload Cloudinary');
    }
  }

  /**
   * Upload vers Cloudflare Images
   */
  private async uploadToCloudflare(
    fileBuffer: Buffer,
    filename: string,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      throw new Error('Cloudflare credentials not configured');
    }

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
    formData.append('file', blob, filename);

    if (options?.transformation) {
      if (options.transformation.width) {
        formData.append('metadata', JSON.stringify({ width: options.transformation.width }));
      }
      if (options.transformation.height) {
        formData.append('metadata', JSON.stringify({ height: options.transformation.height }));
      }
    }

    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: formData as any,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloudflare upload failed: ${error}`);
    }

    const data = (await response.json()) as {
      result?: { variants?: string[]; id?: string };
    };
    const imageUrl = data.result?.variants?.[0] || data.result?.id;

    if (!imageUrl) {
      throw new Error('Cloudflare upload returned no image URL');
    }

    return {
      url: imageUrl,
      publicId: data.result?.id,
      provider: 'cloudflare',
    };
  }

  /**
   * Upload vers Supabase Storage
   */
  private async uploadToSupabase(
    fileBuffer: Buffer,
    filename: string,
    options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    const { supabase } = await import('../config/supabase.js');
    const bucket = options?.folder || 'products';

    // Créer le bucket s'il n'existe pas (silencieusement)
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {
      // Bucket existe déjà, ignorer
    });

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, fileBuffer, {
        contentType: 'image/jpeg',
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(filename);

    if (!urlData) {
      throw new Error('Failed to get public URL from Supabase');
    }

    return {
      url: urlData.publicUrl,
      publicId: filename,
      provider: 'supabase',
    };
  }

  /**
   * Upload local (fallback)
   */
  private async uploadLocal(
    fileBuffer: Buffer,
    filename: string,
    _options?: ImageUploadOptions
  ): Promise<ImageUploadResult> {
    // En local, on stocke dans Supabase Storage par défaut
    logger.warn('No CDN configured, using Supabase Storage as fallback');
    return this.uploadToSupabase(fileBuffer, filename);
  }

  /**
   * Optimise une URL Cloudinary
   */
  private optimizeCloudinaryUrl(
    url: string,
    options?: {
      width?: number;
      height?: number;
      quality?: number;
      format?: 'auto' | 'webp' | 'avif';
    }
  ): string {
    if (!options) return url;

    // Extraire l'URL de base et les transformations existantes
    const urlParts = url.split('/upload/');
    if (urlParts.length !== 2) return url;

    const baseUrl = urlParts[0] + '/upload';
    const rest = urlParts[1];

    // Construire les transformations
    const transformations: string[] = [];

    if (options.width) transformations.push(`w_${options.width}`);
    if (options.height) transformations.push(`h_${options.height}`);
    if (options.quality) transformations.push(`q_${options.quality}`);
    if (options.format && options.format !== 'auto') {
      transformations.push(`f_${options.format}`);
    }

    if (transformations.length === 0) return url;

    return `${baseUrl}/${transformations.join(',')}/${rest}`;
  }

  /**
   * Optimise une URL Cloudflare Images
   */
  private optimizeCloudflareUrl(
    url: string,
    options?: {
      width?: number;
      height?: number;
      quality?: number;
      format?: 'auto' | 'webp' | 'avif';
    }
  ): string {
    if (!options) return url;

    const params = new URLSearchParams();
    if (options.width) params.set('width', options.width.toString());
    if (options.height) params.set('height', options.height.toString());
    if (options.quality) params.set('quality', options.quality.toString());
    if (options.format && options.format !== 'auto') {
      params.set('format', options.format);
    }

    const separator = url.includes('?') ? '&' : '?';
    return params.toString() ? `${url}${separator}${params.toString()}` : url;
  }

  /**
   * Supprime une image du CDN
   */
  async deleteImage(publicId: string): Promise<void> {
    try {
      switch (this.provider) {
        case 'cloudinary':
          await this.deleteFromCloudinary(publicId);
          break;
        case 'cloudflare':
          await this.deleteFromCloudflare(publicId);
          break;
        case 'supabase':
          await this.deleteFromSupabase(publicId);
          break;
        default:
          logger.warn('No CDN configured, cannot delete image', { publicId });
      }
    } catch (error) {
      throw handleServiceError(error, 'deleteImage', 'Erreur suppression image CDN');
    }
  }

  private async deleteFromCloudinary(publicId: string): Promise<void> {
    try {
      // @ts-ignore - Package optionnel, peut ne pas être installé
      const cloudinary = await import('cloudinary');
      const v2 = (cloudinary as any).v2 || cloudinary.default?.v2;
      if (v2) {
        await v2.uploader.destroy(publicId);
      }
    } catch {
      // Cloudinary non disponible, ignorer silencieusement
    }
  }

  private async deleteFromCloudflare(imageId: string): Promise<void> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) return;

    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${imageId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    });
  }

  private async deleteFromSupabase(filename: string): Promise<void> {
    const { supabase } = await import('../config/supabase.js');
    await supabase.storage.from('products').remove([filename]);
  }
}

// Instance singleton
export const imageCdnService = new ImageCdnService();

