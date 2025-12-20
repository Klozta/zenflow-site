/**
 * Routes pour les notifications push web
 */
import { Router } from 'express';
import webpush from 'web-push';
import { supabase } from '../config/supabase.js';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Configuration VAPID
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@zenflow.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

/**
 * POST /api/notifications/subscribe - S'abonner aux notifications
 */
router.post(
  '/subscribe',
  authMiddleware,
  asyncHandler(async (req: any, res) => {
    const userId = (req as any).user?.id;
    const { subscription, userId: bodyUserId } = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Subscription requise' });
    }

    const targetUserId = userId || bodyUserId;

    try {
      // Vérifier si l'abonnement existe déjà
      const { data: existing } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('endpoint', subscription.endpoint)
        .single();

      if (existing) {
        // Mettre à jour
        await supabase
          .from('push_subscriptions')
          .update({
            user_id: targetUserId,
            p256dh_key: subscription.keys.p256dh,
            auth_key: subscription.keys.auth,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        // Créer
        await supabase
          .from('push_subscriptions')
          .insert({
            user_id: targetUserId,
            endpoint: subscription.endpoint,
            p256dh_key: subscription.keys.p256dh,
            auth_key: subscription.keys.auth,
          });
      }

      return res.json({ success: true });
    } catch (error: any) {
      logger.error('Erreur abonnement push', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

/**
 * POST /api/notifications/unsubscribe - Se désabonner
 */
router.post(
  '/unsubscribe',
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint requis' });
    }

    try {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);

      return res.json({ success: true });
    } catch (error: any) {
      logger.error('Erreur désabonnement push', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

/**
 * POST /api/notifications/send - Envoyer une notification (admin)
 */
router.post(
  '/send',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const { title, body, url, userId, tag, icon, image } = req.body;

    if (!title || !body) {
      return res.status(400).json({ error: 'title et body requis' });
    }

    try {
      let query = supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh_key, auth_key');

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data: subscriptions, error: fetchError } = await query;

      if (fetchError || !subscriptions || subscriptions.length === 0) {
        return res.json({ success: true, sent: 0, message: 'Aucun abonnement trouvé' });
      }

      const payload = JSON.stringify({
        title,
        body,
        url: url || '/',
        icon: icon || '/icon-192x192.png',
        image,
        tag: tag || 'notification',
      });

      let sent = 0;
      let failed = 0;

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh_key,
                auth: sub.auth_key,
              },
            },
            payload
          );
          sent++;
        } catch (error: any) {
          logger.error('Erreur envoi notification', error);
          failed++;

          // Si l'abonnement est invalide, le supprimer
          if (error.statusCode === 410 || error.statusCode === 404) {
            await supabase
              .from('push_subscriptions')
              .delete()
              .eq('endpoint', sub.endpoint);
          }
        }
      }

      return res.json({ success: true, sent, failed });
    } catch (error: any) {
      logger.error('Erreur envoi notifications', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

export default router;
