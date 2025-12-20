import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { ipBasedRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { markCartAsRecovered, saveAbandonedCart } from '../services/abandonedCartService.js';
import { abandonedCartSchema } from '../validations/additionalSchemas.js';

const router = Router();

// Endpoint public: limiter fort pour éviter spam / abuse
export const abandonedCartRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 120 : 30,
  60 * 1000
);

/**
 * POST /api/abandoned-carts
 * Enregistre (ou met à jour) un panier abandonné pour une session.
 * Aucune PII autre que l'email, best-effort.
 */
router.post(
  '/',
  abandonedCartRateLimiter,
  validate(abandonedCartSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      sessionId: string;
      items: Array<{ productId: string; quantity: number; price: number }>;
      total: number;
      email?: string;
    };

    await saveAbandonedCart(body.sessionId, body.items, body.total, undefined, body.email);

    return res.json({ ok: true });
  })
);

const abandonedCartRecoverRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 300 : 60,
  60 * 1000
);

/**
 * GET /api/abandoned-carts/recover?sessionId=...
 * Récupère les items du panier abandonné et le marque comme "recovered".
 * Best-effort (si pas trouvé → 404).
 */
router.get(
  '/recover',
  abandonedCartRecoverRateLimiter,
  validate(z.object({ sessionId: z.string().min(8).max(128) }), 'query'),
  asyncHandler(async (req, res) => {
    const sessionId = req.query.sessionId as string;

    const { data: cartRow, error: cartErr } = await supabase
      .from('abandoned_carts')
      .select('items,total')
      .eq('session_id', sessionId)
      .eq('recovered', false)
      .single();

    if (cartErr || !cartRow) {
      return res.status(404).json({ error: 'Not found' });
    }

    const rawItems = Array.isArray((cartRow as any).items) ? ((cartRow as any).items as any[]) : [];
    const productIds = Array.from(new Set(rawItems.map((it) => it?.productId).filter(Boolean)));

    const { data: productsRows } = await supabase
      .from('products')
      .select('id,title,price,image_url,stock')
      .in('id', productIds);

    const byId = new Map<string, any>();
    (productsRows || []).forEach((p: any) => {
      if (p?.id) byId.set(p.id, p);
    });

    const items = rawItems
      .filter((it) => it?.productId)
      .map((it) => {
        const p = byId.get(it.productId);
        return {
          id: String(it.productId),
          title: String(p?.title || 'Produit'),
          price: Number(p?.price ?? it.price ?? 0),
          image: String(p?.image_url || ''),
          quantity: Number(it.quantity || 1),
          stock: Number(p?.stock ?? 9999),
        };
      });

    await markCartAsRecovered(sessionId);

    return res.json({ ok: true, sessionId, total: Number((cartRow as any).total || 0), items });
  })
);

export default router;


