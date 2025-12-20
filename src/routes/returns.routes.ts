/**
 * Routes pour la gestion des retours/remboursements
 */
import { Router } from 'express';
import Stripe from 'stripe';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../middleware/errorHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-12-15.clover',
    })
  : null;

/**
 * POST /api/returns - Demander un retour (client)
 */
const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({
    orderItemId: z.string().uuid(),
    quantity: z.number().int().positive(),
    reason: z.string().min(10).max(500),
  })).min(1),
});

router.post(
  '/',
  authMiddleware,
  validate(createReturnSchema, 'body'),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { orderId, items } = req.body;

    // Vérifier que la commande appartient à l'utilisateur
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total, stripe_checkout_session_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    if (order.user_id !== userId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    // Vérifier que la commande peut être retournée (delivered ou shipped)
    if (!['delivered', 'shipped'].includes(order.status)) {
      return res.status(400).json({
        error: `Les retours ne sont possibles que pour les commandes expédiées ou livrées. Statut actuel: ${order.status}`
      });
    }

    // Vérifier les items de la commande
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('id, product_id, quantity, price')
      .eq('order_id', orderId);

    if (itemsError || !orderItems) {
      return res.status(500).json({ error: 'Erreur récupération items' });
    }

    // Valider que les items demandés existent et que les quantités sont valides
    for (const returnItem of items) {
      const orderItem = orderItems.find((oi: any) => oi.id === returnItem.orderItemId);
      if (!orderItem) {
        return res.status(400).json({ error: `Item ${returnItem.orderItemId} introuvable` });
      }
      if (returnItem.quantity > orderItem.quantity) {
        return res.status(400).json({ error: `Quantité demandée supérieure à la quantité commandée` });
      }
    }

    // Créer la demande de retour
    const { data: returnRequest, error: returnError } = await supabase
      .from('return_requests')
      .insert({
        order_id: orderId,
        user_id: userId,
        status: 'pending',
        items: items,
        total_refund: 0, // Calculé après validation admin
      })
      .select()
      .single();

    if (returnError) {
      logger.error('Erreur création retour', returnError);
      return res.status(500).json({ error: 'Erreur création demande de retour' });
    }

    return res.status(201).json({
      success: true,
      returnRequest,
      message: 'Demande de retour créée. Elle sera traitée sous 48h.'
    });
  })
);

/**
 * GET /api/returns - Liste des retours (client)
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { data, error } = await supabase
      .from('return_requests')
      .select(`
        *,
        orders (
          order_number,
          total
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Erreur récupération retours', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    return res.json({ returns: data || [] });
  })
);

/**
 * GET /api/returns/:id - Détail d'un retour (client)
 */
router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const { id } = req.params;

    const { data, error } = await supabase
      .from('return_requests')
      .select(`
        *,
        orders (
          order_number,
          total,
          shipping_email,
          shipping_first_name,
          shipping_last_name
        )
      `)
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Retour introuvable' });
    }

    return res.json({ returnRequest: data });
  })
);

/**
 * PATCH /api/admin/returns/:id/status - Mettre à jour le statut (admin)
 */
const updateReturnStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'refunded', 'completed']),
  adminNotes: z.string().optional(),
});

router.patch(
  '/:id/status',
  requireAdminAuth,
  validate(updateReturnStatusSchema, 'body'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    // Récupérer le retour
    const { data: returnRequest, error: fetchError } = await supabase
      .from('return_requests')
      .select(`
        *,
        orders (
          id,
          stripe_checkout_session_id,
          total,
          user_id
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError || !returnRequest) {
      return res.status(404).json({ error: 'Retour introuvable' });
    }

    const order = returnRequest.orders;

    // Si approuvé, calculer le remboursement
    if (status === 'approved' && returnRequest.status === 'pending') {
      // Calculer le total à rembourser
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('id, price, quantity')
        .eq('order_id', order.id);

      let totalRefund = 0;
      for (const returnItem of returnRequest.items) {
        const orderItem = orderItems?.find((oi: any) => oi.id === returnItem.orderItemId);
        if (orderItem) {
          totalRefund += orderItem.price * returnItem.quantity;
        }
      }

      // Mettre à jour le retour avec le montant calculé
      const { error: updateError } = await supabase
        .from('return_requests')
        .update({
          status: 'approved',
          total_refund: totalRefund,
          admin_notes: adminNotes,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) {
        logger.error('Erreur mise à jour retour', updateError);
        return res.status(500).json({ error: 'Erreur mise à jour' });
      }

      return res.json({
        success: true,
        returnRequest: { ...returnRequest, status: 'approved', total_refund: totalRefund },
        message: 'Retour approuvé. Le remboursement sera effectué sous 5-7 jours ouvrés.'
      });
      return;
    }

    // Si remboursé, effectuer le remboursement Stripe
    if (status === 'refunded' && returnRequest.status === 'approved') {
      if (!stripe || !order.stripe_checkout_session_id) {
        return res.status(400).json({ error: 'Stripe non configuré ou session introuvable' });
      }

      try {
        // Récupérer la session Stripe
        const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
        const paymentIntentId = session.payment_intent as string;

        if (!paymentIntentId) {
          return res.status(400).json({ error: 'Payment Intent introuvable' });
        }

        // Créer le remboursement (montant partiel)
        const refund = await stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: Math.round(returnRequest.total_refund * 100), // Convertir en centimes
          reason: 'requested_by_customer',
          metadata: {
            return_request_id: id,
            order_id: order.id,
          },
        });

        // Mettre à jour le retour
        const { error: updateError } = await supabase
          .from('return_requests')
          .update({
            status: 'refunded',
            stripe_refund_id: refund.id,
            refunded_at: new Date().toISOString(),
            admin_notes: adminNotes,
          })
          .eq('id', id);

        if (updateError) {
          logger.error('Erreur mise à jour après remboursement', updateError);
          return res.status(500).json({ error: 'Erreur mise à jour' });
        }

        // Restaurer le stock des produits
        for (const returnItem of returnRequest.items) {
          const { data: orderItem } = await supabase
            .from('order_items')
            .select('product_id, quantity')
            .eq('id', returnItem.orderItemId)
            .single();

          if (orderItem) {
            await supabase.rpc('increment_product_stock', {
              product_id: orderItem.product_id,
              quantity: returnItem.quantity,
            });
          }
        }

        return res.json({
          success: true,
          returnRequest: { ...returnRequest, status: 'refunded', stripe_refund_id: refund.id },
          message: 'Remboursement effectué avec succès.'
        });
      } catch (stripeError: any) {
        logger.error('Erreur remboursement Stripe', stripeError);
        return res.status(500).json({ error: `Erreur Stripe: ${stripeError.message}` });
      }
      return;
    }

    // Autres statuts (rejected, completed)
    const { error: updateError } = await supabase
      .from('return_requests')
      .update({
        status,
        admin_notes: adminNotes,
        ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', id);

    if (updateError) {
      logger.error('Erreur mise à jour retour', updateError);
      return res.status(500).json({ error: 'Erreur mise à jour' });
    }

    return res.json({ success: true, returnRequest: { ...returnRequest, status } });
  })
);

/**
 * GET /api/returns/admin/all - Liste tous les retours (admin)
 */
router.get(
  '/admin/all',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('return_requests')
      .select(`
        *,
        orders (
          order_number,
          total,
          shipping_email
        ),
        users (
          email
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Erreur récupération retours admin', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    return res.json({
      returns: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  })
);

export default router;

