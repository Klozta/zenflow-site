/**
 * Routes pour la gestion des préférences emails utilisateur
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    getOrCreateEmailPreferences,
    updateEmailPreferences,
    type UpdateEmailPreferencesInput,
} from '../services/emailPreferencesService.js';

const router = Router();

/**
 * Schéma de validation pour la mise à jour des préférences
 */
const updateEmailPreferencesSchema = z.object({
  order_confirmation: z.boolean().optional(),
  order_shipped: z.boolean().optional(),
  order_delivered: z.boolean().optional(),
  abandoned_cart: z.boolean().optional(),
  newsletter: z.boolean().optional(),
  promotions: z.boolean().optional(),
  product_recommendations: z.boolean().optional(),
  loyalty_updates: z.boolean().optional(),
  frequency: z.enum(['immediate', 'daily', 'weekly', 'monthly', 'never']).optional(),
});

/**
 * GET /api/email-preferences - Obtenir les préférences emails de l'utilisateur connecté
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const preferences = await getOrCreateEmailPreferences(userId);
    if (!preferences) {
      return res.status(500).json({ error: 'Erreur récupération préférences' });
    }

    return res.json({ preferences });
  })
);

/**
 * PUT /api/email-preferences - Mettre à jour les préférences emails
 */
router.put(
  '/',
  authMiddleware,
  validate(updateEmailPreferencesSchema),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const updated = await updateEmailPreferences(userId, req.body as UpdateEmailPreferencesInput);
    if (!updated) {
      return res.status(500).json({ error: 'Erreur mise à jour préférences' });
    }

    return res.json({
      success: true,
      preferences: updated,
      message: 'Préférences emails mises à jour avec succès',
    });
  })
);

/**
 * POST /api/email-preferences/unsubscribe - Se désabonner de tous les emails (sauf transactionnels)
 */
router.post(
  '/unsubscribe',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    // Désactiver tous les emails marketing mais garder les transactionnels
    const updated = await updateEmailPreferences(userId, {
      newsletter: false,
      promotions: false,
      product_recommendations: false,
      loyalty_updates: false,
      frequency: 'never',
      // Garder les emails transactionnels activés (order_confirmation, order_shipped, etc.)
    });

    if (!updated) {
      return res.status(500).json({ error: 'Erreur désabonnement' });
    }

    return res.json({
      success: true,
      message: 'Vous êtes désormais désabonné des emails marketing. Vous continuerez à recevoir les emails transactionnels (commandes, livraisons).',
      preferences: updated,
    });
  })
);

/**
 * POST /api/email-preferences/resubscribe - Réabonner à tous les emails
 */
router.post(
  '/resubscribe',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    // Réactiver tous les emails avec fréquence hebdomadaire
    const updated = await updateEmailPreferences(userId, {
      order_confirmation: true,
      order_shipped: true,
      order_delivered: true,
      abandoned_cart: true,
      newsletter: true,
      promotions: true,
      product_recommendations: true,
      loyalty_updates: true,
      frequency: 'weekly',
    });

    if (!updated) {
      return res.status(500).json({ error: 'Erreur réabonnement' });
    }

    return res.json({
      success: true,
      message: 'Vous êtes réabonné à tous les emails.',
      preferences: updated,
    });
  })
);

export default router;


