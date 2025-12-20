/**
 * Routes pour tags et notes sur commandes
 */
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';

const router = Router();

/**
 * GET /api/order-tags/:orderId - Récupérer tags d'une commande
 */
router.get(
  '/:orderId',
  requireAdminAuth,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { data, error } = await supabase
      .from('order_tags')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ tags: data || [] });
  })
);

/**
 * POST /api/order-tags/:orderId - Ajouter un tag
 */
router.post(
  '/:orderId',
  requireAdminAuth,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  validate(z.object({ tag: z.string().min(1).max(50), color: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { tag, color } = req.body;

    const { data, error } = await supabase
      .from('order_tags')
      .insert({ order_id: orderId, tag, color })
      .select()
      .single();

    if (error) {
      // Si tag déjà existant (unique violation), retourner l'existant
      if ((error as any).code === '23505') {
        const { data: existing } = await supabase
          .from('order_tags')
          .select('*')
          .eq('order_id', orderId)
          .eq('tag', tag)
          .single();
        return res.json({ tag: existing });
      }
      throw error;
    }

    return res.json({ tag: data });
  })
);

/**
 * DELETE /api/order-tags/:orderId/:tag - Supprimer un tag
 */
router.delete(
  '/:orderId/:tag',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const { orderId, tag } = req.params;
    const { error } = await supabase
      .from('order_tags')
      .delete()
      .eq('order_id', orderId)
      .eq('tag', tag);

    if (error) throw error;
    return res.json({ ok: true });
  })
);

/**
 * GET /api/order-tags/notes/:orderId - Récupérer notes d'une commande
 */
router.get(
  '/notes/:orderId',
  requireAdminAuth,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { data, error } = await supabase
      .from('order_notes')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ notes: data || [] });
  })
);

/**
 * POST /api/order-tags/notes/:orderId - Ajouter une note
 */
router.post(
  '/notes/:orderId',
  requireAdminAuth,
  validate(z.object({ orderId: z.string().uuid() }), 'params'),
  validate(z.object({ note: z.string().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { note } = req.body;

    const { data, error } = await supabase
      .from('order_notes')
      .insert({ order_id: orderId, note, created_by: (req as any)?.user?.id || 'admin' })
      .select()
      .single();

    if (error) throw error;
    return res.json({ note: data });
  })
);

/**
 * DELETE /api/order-tags/notes/:noteId - Supprimer une note
 */
router.delete(
  '/notes/:noteId',
  requireAdminAuth,
  validate(z.object({ noteId: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const { noteId } = req.params;
    const { error } = await supabase.from('order_notes').delete().eq('id', noteId);

    if (error) throw error;
    return res.json({ ok: true });
  })
);

export default router;


