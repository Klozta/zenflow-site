/**
 * Routes admin - Authentification et actions admin
 */
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { generateOrdersExcel } from '../services/excelExportService.js';
import { createAdminSessionToken } from '../utils/adminSession.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post(
  '/login',
  validate(z.object({ token: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    const expected = process.env.CRON_API_KEY || process.env.ADMIN_TOKEN;

    if (!expected) {
      logger.warn('Admin login attempted but no ADMIN_TOKEN configured');
      return res.status(503).json({
        error: 'Admin authentication not configured. Please set ADMIN_TOKEN in .env'
      });
    }

    if (token !== expected) {
      logger.warn('Invalid admin login attempt', { ip: req.ip });
      return res.status(401).json({ error: 'Token invalide' });
    }

    const sessionToken = createAdminSessionToken();
    res.cookie('admin_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
      path: '/',
    });

    logger.info('Admin login successful', { ip: req.ip });
    return res.json({ ok: true, message: 'Connexion réussie' });
  })
);

router.post('/logout', asyncHandler(async (_req, res) => {
  res.clearCookie('admin_session', { path: '/' });
  return res.json({ ok: true });
}));

router.get('/me', requireAdminAuth, asyncHandler(async (_req, res) => {
  return res.json({ ok: true });
}));

/**
 * POST /api/admin/orders/export - Export CSV des commandes
 */
router.post(
  '/orders/export',
  requireAdminAuth,
  validate(z.object({
    status: z.string().optional(),
    search: z.string().optional(),
  })),
  asyncHandler(async (req, res) => {
    const { status, search } = req.body;

    let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('order_number', `%${search}%`);

    const { data: orders, error } = await query;
    if (error) throw error;

    // Générer CSV
    const headers = ['N° Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'UTM Source', 'UTM Campaign'];
    const rows = (orders || []).map((o: any) => [
      o.order_number || '',
      new Date(o.created_at).toLocaleDateString('fr-FR'),
      `${o.shipping_first_name || ''} ${o.shipping_last_name || ''}`.trim(),
      o.shipping_email || '',
      (o.total || 0).toFixed(2),
      o.status || '',
      o.utm_source || '',
      o.utm_campaign || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((r: string[]) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="commandes-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send('\ufeff' + csv); // BOM UTF-8 pour Excel
  })
);

/**
 * PATCH /api/admin/orders/bulk-status - Actions bulk sur commandes
 */
router.patch(
  '/orders/bulk-status',
  requireAdminAuth,
  validate(z.object({
    orderIds: z.array(z.string().uuid()).min(1),
    status: z.enum(['confirmed', 'shipped', 'delivered', 'cancelled']),
  })),
  asyncHandler(async (req, res) => {
    const { orderIds, status } = req.body;

    const { data: updated, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .in('id', orderIds)
      .select();

    if (error) {
      logger.error('Bulk status update error', error);
      throw new Error(`Erreur lors de la mise à jour: ${error.message}`);
    }

    // Audit trail (best-effort)
    try {
      const { auditOrderStatusTransition } = await import('../services/auditService.js');
      await Promise.all(
        orderIds.map((orderId: string) =>
          auditOrderStatusTransition({
            orderId,
            from: 'pending' as any, // On ne connaît pas l'ancien statut
            to: status as any,
            actor: 'admin',
            requestId: (req as any)?.requestId,
          }).catch(() => {}) // Non-blocking
        )
      );
    } catch {
      // Ignore audit errors
    }

    return res.json({ ok: true, updated: updated?.length || 0 });
  })
);

/**
 * GET /api/admin/orders/export-excel - Export Excel des commandes
 */
router.get(
  '/orders/export-excel',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    try {
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const status = req.query.status as string | undefined;
      const includeItems = req.query.includeItems === 'true';
      const includeStats = req.query.includeStats === 'true';

      const buffer = await generateOrdersExcel({
        dateFrom,
        dateTo,
        status,
        includeItems,
        includeStats,
      });

      const filename = `commandes-export-${new Date().toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    } catch (error: any) {
      logger.error('Erreur export Excel', error);
      return res.status(500).json({ error: error.message || 'Erreur export Excel' });
    }
  })
);

/**
 * GET /api/admin/email-preview - Prévisualisation template email
 */
router.get(
  '/email-preview',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const template = req.query.template as 'confirmation' | 'shipped' | 'delivered' | 'abandoned';
    const { generateOrderConfirmationEmailHTML, generateOrderStatusEmailHTML, generateAbandonedCartEmailHTML } = await import('../services/emailService.js');

    let html = '';
    switch (template) {
      case 'confirmation':
        html = generateOrderConfirmationEmailHTML({
          orderNumber: 'GC-EXAMPLE-123',
          total: 49.99,
          createdAt: new Date().toISOString(),
          shippingName: 'Marie Dupont',
          shippingAddressLine: '123 Rue Example, 75001 Paris',
          items: [
            { title: 'Produit Exemple 1', quantity: 2, unitPrice: 19.99 },
            { title: 'Produit Exemple 2', quantity: 1, unitPrice: 10.01 },
          ],
        });
        break;
      case 'shipped':
        html = generateOrderStatusEmailHTML({
          title: 'Commande expédiée 📦',
          orderNumber: 'GC-EXAMPLE-123',
          message: 'Bonne nouvelle ! Votre commande a été expédiée. Vous la recevrez très bientôt.',
          items: [
            { title: 'Produit Exemple 1', quantity: 2, unitPrice: 19.99 },
            { title: 'Produit Exemple 2', quantity: 1, unitPrice: 10.01 },
          ],
        });
        break;
      case 'delivered':
        html = generateOrderStatusEmailHTML({
          title: 'Commande livrée ✅',
          orderNumber: 'GC-EXAMPLE-123',
          message: 'Votre commande est indiquée comme livrée. Nous espérons que tout est parfait !',
          items: [
            { title: 'Produit Exemple 1', quantity: 2, unitPrice: 19.99 },
            { title: 'Produit Exemple 2', quantity: 1, unitPrice: 10.01 },
          ],
        });
        break;
      case 'abandoned':
        html = generateAbandonedCartEmailHTML(
          [
            { productId: '1', title: 'Produit Exemple 1', quantity: 2, price: 19.99 },
            { productId: '2', title: 'Produit Exemple 2', quantity: 1, price: 10.01 },
          ],
          49.99,
          'https://example.com/cart?recover=session-id-example'
        );
        break;
      default:
        return res.status(400).json({ error: 'Invalid template' });
    }

    return res.json({ html });
  })
);

export default router;
