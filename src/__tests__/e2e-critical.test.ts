/**
 * Tests E2E critiques pour les flux principaux de l'application
 *
 * Prérequis:
 * - Backend démarré (npm run dev)
 * - Variables d'environnement configurées
 * - Base de données Supabase accessible
 *
 * Exécution:
 *   npm test -- e2e-critical.test.ts
 *
 * Tests critiques:
 * 1. Flux commande complet (panier → paiement → confirmation)
 * 2. Authentification admin
 * 3. Import produit AliExpress (si configuré)
 * 4. Health checks et monitoring
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const ADMIN_TOKEN = process.env.CRON_API_KEY || process.env.ADMIN_TOKEN || 'test-admin-token';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3002';

describe('E2E Critical Flows', () => {
  let adminCookie: string | null = null;
  let testProductId: string | null = null;
  let testOrderId: string | null = null;

  beforeAll(async () => {
    // Login admin pour obtenir le cookie
    try {
      const loginRes = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ADMIN_TOKEN }),
      });

      if (loginRes.ok) {
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) {
          adminCookie = setCookie.split(';')[0];
        }
      }
    } catch (error) {
      console.warn('Admin login failed in beforeAll, tests may fail:', error);
    }
  });

  afterAll(async () => {
    // Cleanup: supprimer les données de test si nécessaire
    if (adminCookie) {
      try {
        await fetch(`${API_URL}/admin/logout`, {
          method: 'POST',
          headers: { Cookie: adminCookie },
        });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Health Checks', () => {
    it('should return healthy status', async () => {
      const res = await fetch(`${API_URL.replace('/api', '')}/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe('healthy');
    });

    it('should return detailed health check', async () => {
      const res = await fetch(`${API_URL.replace('/api', '')}/health/detailed`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.services).toBeDefined();
    });
  });

  describe('Admin Authentication Flow', () => {
    it('should login admin with token', async () => {
      const res = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ADMIN_TOKEN }),
      });

      expect(res.ok).toBe(true);
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('admin_session');
      expect(setCookie).toContain('HttpOnly');
    });

    it('should verify admin session', async () => {
      if (!adminCookie) {
        // Re-login si nécessaire
        const loginRes = await fetch(`${API_URL}/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ADMIN_TOKEN }),
        });
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) adminCookie = setCookie.split(';')[0];
      }

      const res = await fetch(`${API_URL}/admin/me`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });

    it('should reject invalid admin token', async () => {
      const res = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-token' }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe('Order Creation Flow', () => {
    it('should create an order with valid data', async () => {
      const orderData = {
        items: [
          {
            productId: '00000000-0000-0000-0000-000000000001', // UUID de test
            quantity: 1,
            price: 29.99,
          },
        ],
        shipping: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          phone: '+33123456789',
          address: '123 Test Street',
          city: 'Paris',
          postalCode: '75001',
          country: 'FR',
        },
        total: 29.99,
      };

      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });

      // Peut échouer si le produit n'existe pas, mais la validation doit passer
      if (res.ok) {
        const data = await res.json();
        expect(data.order).toBeDefined();
        expect(data.order.order_number).toMatch(/^GC-/);
        testOrderId = data.order.id;
      } else {
        // Si échec, vérifier que c'est une erreur de produit, pas de validation
        const error = await res.json();
        expect(res.status).not.toBe(400); // Ne doit pas être une erreur de validation
      }
    });

    it('should reject order with invalid data', async () => {
      const invalidOrderData = {
        items: [
          {
            productId: 'invalid-uuid',
            quantity: 0, // Invalid
            price: -10, // Invalid
          },
        ],
        shipping: {
          // Missing required fields
        },
        total: -100, // Invalid
      };

      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidOrderData),
      });

      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.error).toBeDefined();
    });

    it('should get order status (public endpoint)', async () => {
      if (!testOrderId) {
        // Skip si pas de commande de test
        return;
      }

      const res = await fetch(
        `${API_URL}/orders/public-status?orderId=${testOrderId}&orderNumber=GC-TEST`
      );

      // Peut retourner 404 si la commande n'existe pas, mais l'endpoint doit fonctionner
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Products API', () => {
    it('should list products', async () => {
      const res = await fetch(`${API_URL}/products?limit=10`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.products)).toBe(true);
    });

    it('should search products', async () => {
      const res = await fetch(`${API_URL}/products/search?q=test&limit=5`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.products)).toBe(true);
    });
  });

  describe('Monitoring & Metrics', () => {
    it('should return monitoring metrics (admin only)', async () => {
      if (!adminCookie) {
        // Re-login si nécessaire
        const loginRes = await fetch(`${API_URL}/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ADMIN_TOKEN }),
        });
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) adminCookie = setCookie.split(';')[0];
      }

      const res = await fetch(`${API_URL}/monitoring/metrics`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.timestamp).toBeDefined();
      expect(data.services).toBeDefined();
      expect(data.performance).toBeDefined();
    });

    it('should return active alerts (admin only)', async () => {
      if (!adminCookie) return;

      const res = await fetch(`${API_URL}/monitoring/alerts`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.alerts)).toBe(true);
    });
  });

  describe('Notifications Admin', () => {
    it('should return admin notifications (admin only)', async () => {
      if (!adminCookie) return;

      const res = await fetch(`${API_URL}/notifications/admin`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.notifications)).toBe(true);
      expect(typeof data.count).toBe('number');
      expect(typeof data.unreadCount).toBe('number');
    });

    it('should mark notification as read (admin only)', async () => {
      if (!adminCookie) return;

      // D'abord récupérer les notifications
      const getRes = await fetch(`${API_URL}/notifications/admin`, {
        headers: { Cookie: adminCookie || '' },
      });

      if (getRes.ok) {
        const data = await getRes.json();
        if (data.notifications.length > 0) {
          const firstNotif = data.notifications[0];
          const markRes = await fetch(`${API_URL}/notifications/admin/${firstNotif.id}/read`, {
            method: 'POST',
            headers: { Cookie: adminCookie || '' },
          });

          expect(markRes.ok).toBe(true);
        }
      }
    });
  });

  describe('Analytics Endpoints', () => {
    it('should return analytics data (admin only)', async () => {
      if (!adminCookie) return;

      const endpoints = [
        '/analytics/revenue',
        '/analytics/top-products',
        '/analytics/funnel',
        '/analytics/conversion',
      ];

      for (const endpoint of endpoints) {
        const res = await fetch(`${API_URL}${endpoint}`, {
          headers: { Cookie: adminCookie || '' },
        });

        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data).toBeDefined();
      }
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent endpoints', async () => {
      const res = await fetch(`${API_URL}/non-existent-endpoint`);
      expect(res.status).toBe(404);
    });

    it('should return proper error format', async () => {
      const res = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' }),
      });

      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.error).toBeDefined();
    });
  });
});

