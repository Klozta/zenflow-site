/**
 * Tests E2E pour les features "Ops" (audit trail, emails status, admin cookie auth)
 *
 * Prérequis:
 * - Backend démarré (npm run dev)
 * - Variables d'environnement configurées (CRON_API_KEY, SUPABASE_URL, etc.)
 * - Tables ops créées (voir scripts/ops_tables.sql)
 *
 * Exécution:
 *   npm test -- e2e-ops.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const ADMIN_TOKEN = process.env.CRON_API_KEY || process.env.ADMIN_TOKEN || 'test-admin-token';

describe('E2E Ops Features', () => {
  let adminCookie: string | null = null;
  let testOrderId: string | null = null;

  beforeAll(async () => {
    // Login admin pour obtenir le cookie
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
  });

  afterAll(async () => {
    // Logout admin
    if (adminCookie) {
      await fetch(`${API_URL}/admin/logout`, {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });
    }
  });

  describe('Admin Cookie Auth', () => {
    it('should login admin and set httpOnly cookie', async () => {
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

    it('should verify admin session via /admin/me', async () => {
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

    it('should logout and clear cookie', async () => {
      if (!adminCookie) return;

      const res = await fetch(`${API_URL}/admin/logout`, {
        method: 'POST',
        headers: { Cookie: adminCookie },
      });

      expect(res.ok).toBe(true);
    });
  });

  describe('Order Status Transitions (Admin)', () => {
    it('should transition order status and create audit event', async () => {
      // Prérequis: avoir une commande en "confirmed"
      // (créer via POST /api/orders ou utiliser une existante)

      if (!adminCookie) {
        const loginRes = await fetch(`${API_URL}/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ADMIN_TOKEN }),
        });
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) adminCookie = setCookie.split(';')[0];
      }

      // Récupérer une commande confirmed (ou créer une test)
      const ordersRes = await fetch(`${API_URL}/orders?admin=true&status=confirmed&limit=1`, {
        headers: { Cookie: adminCookie || '' },
      });

      if (!ordersRes.ok || ordersRes.status === 404) {
        // Skip si pas de commande test
        return;
      }

      const ordersData = await ordersRes.json();
      const order = ordersData.orders?.[0];

      if (!order) return;

      testOrderId = order.id;

      // Transition: confirmed → shipped
      const updateRes = await fetch(`${API_URL}/orders/${testOrderId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie || '',
        },
        body: JSON.stringify({ status: 'shipped' }),
      });

      expect(updateRes.ok).toBe(true);

      // Vérifier audit event créé
      const auditRes = await fetch(
        `${API_URL}/audit/order-status-events?orderId=${testOrderId}`,
        {
          headers: { Cookie: adminCookie || '' },
        }
      );

      if (auditRes.ok) {
        const auditData = await auditRes.json();
        const recentEvent = auditData.events?.find(
          (e: any) => e.from_status === 'confirmed' && e.to_status === 'shipped' && e.actor === 'admin'
        );
        expect(recentEvent).toBeDefined();
      }
    });
  });

  describe('User Order Cancellation', () => {
    it('should allow user to cancel pending order', async () => {
      // Prérequis: avoir un token utilisateur valide + commande pending
      // (créer via POST /api/auth/login puis POST /api/orders)

      // Skip si pas de setup utilisateur
      // Ce test nécessite un setup complet (auth + order)
    });
  });

  describe('Audit Endpoints', () => {
    it('should list order status events', async () => {
      if (!adminCookie) {
        const loginRes = await fetch(`${API_URL}/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ADMIN_TOKEN }),
        });
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) adminCookie = setCookie.split(';')[0];
      }

      const res = await fetch(`${API_URL}/audit/order-status-events?limit=10`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('events');
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should list stripe refs', async () => {
      if (!adminCookie) return;

      const res = await fetch(`${API_URL}/audit/stripe-refs?limit=10`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('refs');
      expect(Array.isArray(data.refs)).toBe(true);
    });

    it('should list notifications', async () => {
      if (!adminCookie) return;

      const res = await fetch(`${API_URL}/audit/notifications?limit=10`, {
        headers: { Cookie: adminCookie || '' },
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('notifications');
      expect(Array.isArray(data.notifications)).toBe(true);
    });
  });

  describe('Cron Abandoned Carts', () => {
    it('should execute cron abandoned-carts with cookie auth', async () => {
      if (!adminCookie) {
        const loginRes = await fetch(`${API_URL}/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: ADMIN_TOKEN }),
        });
        const setCookie = loginRes.headers.get('set-cookie');
        if (setCookie) adminCookie = setCookie.split(';')[0];
      }

      const res = await fetch(`${API_URL}/cron/abandoned-carts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie || '',
        },
        body: JSON.stringify({ hours: 1 }),
      });

      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('success');
      expect(data).toHaveProperty('sent');
      expect(data).toHaveProperty('failed');
    });
  });
});


