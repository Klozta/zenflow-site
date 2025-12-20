/**
 * Tests unitaires pour l'endpoint orders
 * Tests de validation et structure sans nécessiter Supabase
 */

import { describe, it, expect } from '@jest/globals';
import { createOrderSchema, orderItemSchema, shippingInfoSchema } from '../validations/schemas.js';

describe('Orders Validation', () => {
  describe('orderItemSchema', () => {
    it('devrait valider un item valide', () => {
      const validItem = {
        productId: '123e4567-e89b-12d3-a456-426614174000',
        quantity: 2,
        price: 29.99,
      };

      const result = orderItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it('devrait rejeter un item avec quantity < 1', () => {
      const invalidItem = {
        productId: '123e4567-e89b-12d3-a456-426614174000',
        quantity: 0,
        price: 29.99,
      };

      const result = orderItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un item avec price négatif', () => {
      const invalidItem = {
        productId: '123e4567-e89b-12d3-a456-426614174000',
        quantity: 1,
        price: -10,
      };

      const result = orderItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });
  });

  describe('shippingInfoSchema', () => {
    it('devrait valider des infos de livraison valides', () => {
      const validShipping = {
        firstName: 'Marie',
        lastName: 'Dupont',
        email: 'marie@example.com',
        phone: '0612345678',
        address: '123 Rue Example',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
      };

      const result = shippingInfoSchema.safeParse(validShipping);
      expect(result.success).toBe(true);
    });

    it('devrait rejeter un email invalide', () => {
      const invalidShipping = {
        firstName: 'Marie',
        lastName: 'Dupont',
        email: 'email-invalide',
        phone: '0612345678',
        address: '123 Rue Example',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
      };

      const result = shippingInfoSchema.safeParse(invalidShipping);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un code postal invalide', () => {
      const invalidShipping = {
        firstName: 'Marie',
        lastName: 'Dupont',
        email: 'marie@example.com',
        phone: '0612345678',
        address: '123 Rue Example',
        city: 'Paris',
        postalCode: '123', // Trop court
        country: 'France',
      };

      const result = shippingInfoSchema.safeParse(invalidShipping);
      expect(result.success).toBe(false);
    });
  });

  describe('createOrderSchema', () => {
    it('devrait valider une commande complète valide', () => {
      const validOrder = {
        items: [
          {
            productId: '123e4567-e89b-12d3-a456-426614174000',
            quantity: 2,
            price: 29.99,
          },
        ],
        shipping: {
          firstName: 'Marie',
          lastName: 'Dupont',
          email: 'marie@example.com',
          phone: '0612345678',
          address: '123 Rue Example',
          city: 'Paris',
          postalCode: '75001',
          country: 'France',
        },
        total: 64.98,
      };

      const result = createOrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
    });

    it('devrait rejeter une commande sans items', () => {
      const invalidOrder = {
        items: [],
        shipping: {
          firstName: 'Marie',
          lastName: 'Dupont',
          email: 'marie@example.com',
          phone: '0612345678',
          address: '123 Rue Example',
          city: 'Paris',
          postalCode: '75001',
          country: 'France',
        },
        total: 0,
      };

      const result = createOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });

    it('devrait rejeter un total négatif', () => {
      const invalidOrder = {
        items: [
          {
            productId: '123e4567-e89b-12d3-a456-426614174000',
            quantity: 1,
            price: 29.99,
          },
        ],
        shipping: {
          firstName: 'Marie',
          lastName: 'Dupont',
          email: 'marie@example.com',
          phone: '0612345678',
          address: '123 Rue Example',
          city: 'Paris',
          postalCode: '75001',
          country: 'France',
        },
        total: -10,
      };

      const result = createOrderSchema.safeParse(invalidOrder);
      expect(result.success).toBe(false);
    });
  });
});








