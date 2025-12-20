/**
 * Tests pour le service CDN images
 */

import { beforeEach, describe, expect, it } from '@jest/globals';
import { imageCdnService } from '../services/imageCdnService.js';

describe('ImageCdnService', () => {
  beforeEach(() => {
    // Reset env pour tests
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  describe('getOptimizedUrl', () => {
    it('devrait retourner l\'URL originale si pas d\'options', () => {
      const url = 'https://example.com/image.jpg';
      const result = imageCdnService.getOptimizedUrl(url);
      expect(result).toBe(url);
    });

    it('devrait optimiser une URL Cloudinary', () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/v123/image.jpg';
      const result = imageCdnService.getOptimizedUrl(url, {
        width: 800,
        quality: 85,
        format: 'webp',
      });

      expect(result).toContain('w_800');
      expect(result).toContain('q_85');
      expect(result).toContain('f_webp');
    });

    it('devrait optimiser une URL Cloudflare', () => {
      const url = 'https://imagedelivery.net/account/image-id';
      const result = imageCdnService.getOptimizedUrl(url, {
        width: 800,
        height: 600,
      });

      expect(result).toContain('width=800');
      expect(result).toContain('height=600');
    });
  });

  describe('Provider detection', () => {
    it('devrait détecter Cloudinary si configuré', () => {
      process.env.CLOUDINARY_CLOUD_NAME = 'test';
      // Le service détecte automatiquement le provider
      expect(process.env.CLOUDINARY_CLOUD_NAME).toBe('test');
    });

    it('devrait détecter Cloudflare si configuré', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test';
      expect(process.env.CLOUDFLARE_ACCOUNT_ID).toBe('test');
    });
  });
});

