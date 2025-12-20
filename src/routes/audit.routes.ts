import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { escapeCsvValue } from '../utils/metricsHelpers.js';

const router = Router();

/**
 * GET /api/audit/order-status-events?orderId=...&limit=...
 * Liste des transitions de statut pour une commande (ou toutes)
 */
router.get(
  '/order-status-events',
  requireAdminAuth,
  validate(
    z.object({
      orderId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    'query'
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.query.orderId as string | undefined;
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);

    let query = supabase.from('order_status_events').select('*', { count: 'exact' });

    if (orderId) {
      query = query.eq('order_id', orderId);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      events: data || [],
      total: count || 0,
      limit,
      offset,
    });
  })
);

/**
 * GET /api/audit/stripe-refs?orderId=...
 * Références Stripe pour une commande (ou toutes)
 */
router.get(
  '/stripe-refs',
  requireAdminAuth,
  validate(
    z.object({
      orderId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    'query'
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.query.orderId as string | undefined;
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);

    let query = supabase.from('stripe_order_refs').select('*', { count: 'exact' });

    if (orderId) {
      query = query.eq('order_id', orderId);
    }

    query = query.order('updated_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      refs: data || [],
      total: count || 0,
      limit,
      offset,
    });
  })
);

/**
 * GET /api/audit/notifications?orderId=...
 * Notifications envoyées (idempotence)
 */
router.get(
  '/notifications',
  requireAdminAuth,
  validate(
    z.object({
      orderId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional().default(100),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
    'query'
  ),
  asyncHandler(async (req: Request, res: Response) => {
    const orderId = req.query.orderId as string | undefined;
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);

    let query = supabase.from('order_notifications').select('*', { count: 'exact' });

    if (orderId) {
      query = query.eq('order_id', orderId);
    }

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      notifications: data || [],
      total: count || 0,
      limit,
      offset,
    });
  })
);

/**
 * GET /api/audit/export?type=events|stripe|notifications - Export CSV des données d'audit
 * Query params:
 *   - type: 'events' | 'stripe' | 'notifications' (requis)
 *   - orderId (optionnel) pour filtrer par commande
 *   - dateFrom (optionnel) date de début (ISO)
 *   - dateTo (optionnel) date de fin (ISO)
 */
router.get(
  '/export',
  requireAdminAuth,
  validate(
    z.object({
      type: z.enum(['events', 'stripe', 'notifications']),
      orderId: z.string().uuid().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
    'query'
  ),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const type = req.query.type as 'events' | 'stripe' | 'notifications';
      const orderId = req.query.orderId as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      let query: any;
      let headers: string[];
      let filename: string;

      switch (type) {
        case 'events': {
          query = supabase.from('order_status_events').select('*');
          if (orderId) query = query.eq('order_id', orderId);
          if (dateFrom) query = query.gte('created_at', dateFrom);
          if (dateTo) query = query.lte('created_at', dateTo);
          query = query.order('created_at', { ascending: false });

          const { data, error } = await query;
          if (error) throw error;

          headers = ['ID', 'Order ID', 'From Status', 'To Status', 'Actor', 'Stripe Event ID', 'Request ID', 'Created At'];
          filename = `audit-events-${new Date().toISOString().split('T')[0]}.csv`;

          const csv = [
            headers.map(escapeCsvValue).join(','),
            ...(data || []).map((e: any) => [
              e.id,
              e.order_id,
              e.from_status,
              e.to_status,
              e.actor,
              e.stripe_event_id || '',
              e.request_id || '',
              e.created_at,
            ].map(escapeCsvValue).join(',')),
          ].join('\n');

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send('\ufeff' + csv);
        }

        case 'stripe': {
          query = supabase.from('stripe_order_refs').select('*');
          if (orderId) query = query.eq('order_id', orderId);
          if (dateFrom) query = query.gte('updated_at', dateFrom);
          if (dateTo) query = query.lte('updated_at', dateTo);
          query = query.order('updated_at', { ascending: false });

          const { data, error } = await query;
          if (error) throw error;

          headers = ['Order ID', 'Stripe Event ID', 'Stripe Event Type', 'Checkout Session ID', 'Payment Intent ID', 'Updated At'];
          filename = `audit-stripe-${new Date().toISOString().split('T')[0]}.csv`;

          const csv = [
            headers.map(escapeCsvValue).join(','),
            ...(data || []).map((r: any) => [
              r.order_id,
              r.stripe_event_id,
              r.stripe_event_type,
              r.checkout_session_id || '',
              r.payment_intent_id || '',
              r.updated_at,
            ].map(escapeCsvValue).join(',')),
          ].join('\n');

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send('\ufeff' + csv);
        }

        case 'notifications': {
          query = supabase.from('order_notifications').select('*');
          if (orderId) query = query.eq('order_id', orderId);
          if (dateFrom) query = query.gte('created_at', dateFrom);
          if (dateTo) query = query.lte('created_at', dateTo);
          query = query.order('created_at', { ascending: false });

          const { data, error } = await query;
          if (error) throw error;

          headers = ['ID', 'Order ID', 'Notification Type', 'Email Sent At', 'Created At'];
          filename = `audit-notifications-${new Date().toISOString().split('T')[0]}.csv`;

          const csv = [
            headers.map(escapeCsvValue).join(','),
            ...(data || []).map((n: any) => [
              n.id,
              n.order_id,
              n.notification_type,
              n.email_sent_at || '',
              n.created_at,
            ].map(escapeCsvValue).join(',')),
          ].join('\n');

          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send('\ufeff' + csv);
        }

        default:
          return res.status(400).json({ error: `Invalid type: ${type}. Valid types: events, stripe, notifications` });
      }
    } catch (error) {
      throw handleServiceError(error, 'exportAudit', 'Erreur export CSV audit');
    }
  })
);

export default router;

