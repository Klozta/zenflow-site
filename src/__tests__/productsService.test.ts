/**
 * Tests unitaires pour productsService
 * Tests de logique métier (validation, calculs, transformations)
 */
import { describe, it, expect } from '@jest/globals';
import { productSchema, updateProductSchema } from '../validations/schemas.js';

describe('ProductsService - Validation', () => {
  describe('productSchema', () => {
    it('devrait valider un produit valide', () => {
      const validProduct = {
        title: 'Produit Test',
        description: 'Description du produit',
        price: 29.99,
        category: 'Bijoux',
        stock: 10,
        images: ['https://example.com/image.jpg'],
        tags: ['tag1', 'tag2'],
      };

      const result = productSchema.safeParse(validProduct);
      expect(result.success).toBe(true);
    });

    it('devrait rejeter un titre trop court', () => {
      const invalidProduct = {
        title: 'AB', // < 3 caractères
        price: 29.99,
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un prix négatif', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: -10,
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un prix trop élevé', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: 1000000, // > 999999.99
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un stock négatif', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: 29.99,
        stock: -1,
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter trop d\'images', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: 29.99,
        images: Array(11).fill('https://example.com/image.jpg'), // > 10
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter trop de tags', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: 29.99,
        tags: Array(21).fill('tag'), // > 20
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter une URL image invalide', () => {
      const invalidProduct = {
        title: 'Produit Test',
        price: 29.99,
        images: ['not-a-url'],
      };

      const result = productSchema.safeParse(invalidProduct);
      expect(result.success).toBe(false);
    });
  });

  describe('updateProductSchema', () => {
    it('devrait valider une mise à jour partielle', () => {
      const partialUpdate = {
        price: 39.99,
      };

      const result = updateProductSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });

    it('devrait valider une mise à jour complète', () => {
      const fullUpdate = {
        title: 'Nouveau Titre',
        price: 49.99,
        stock: 20,
      };

      const result = updateProductSchema.safeParse(fullUpdate);
      expect(result.success).toBe(true);
    });

    it('devrait rejeter une mise à jour avec prix invalide', () => {
      const invalidUpdate = {
        price: -10,
      };

      const result = updateProductSchema.safeParse(invalidUpdate);
      expect(result.success).toBe(false);
    });
  });
});





