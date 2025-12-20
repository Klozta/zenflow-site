/**
 * Routes pour l'historique de navigation (produits récemment consultés)
 */
import { Router } from 'express';
import { supabase } from '../config/supabase.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import type { RequestWithUser } from '../types/auth.types.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/user/view-history - Sauvegarder l'historique (si connecté)
 */
router.post(
  '/view-history',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items doit être un tableau' });
    }

    try {
      // Supprimer l'ancien historique
      await supabase
        .from('user_view_history')
        .delete()
        .eq('user_id', userId);

      // Insérer le nouvel historique (max 20 items)
      const toInsert = items.slice(0, 20).map((item: any) => ({
        user_id: userId,
        product_id: item.id,
        viewed_at: item.viewedAt || new Date().toISOString(),
      }));

      if (toInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('user_view_history')
          .insert(toInsert);

        if (insertError) {
          logger.error('Erreur sauvegarde historique', insertError);
          return res.status(500).json({ error: 'Erreur sauvegarde' });
        }
      }

      return res.json({ success: true });
    } catch (error: any) {
      logger.error('Erreur view-history', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

/**
 * GET /api/user/view-history - Récupérer l'historique (si connecté)
 */
router.get(
  '/view-history',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    try {
      const { data, error } = await supabase
        .from('user_view_history')
        .select(`
          product_id,
          viewed_at,
          products (
            id,
            title,
            price,
            images
          )
        `)
        .eq('user_id', userId)
        .order('viewed_at', { ascending: false })
        .limit(20);

      if (error) {
        logger.error('Erreur récupération historique', error);
        return res.status(500).json({ error: 'Erreur serveur' });
      }

      const items = (data || [])
        .filter((item: any) => item.products) // Filtrer produits supprimés
        .map((item: any) => ({
          id: item.product_id,
          title: item.products.title,
          price: item.products.price,
          image: item.products.images?.[0] || '/placeholder-product.jpg',
          viewedAt: item.viewed_at,
        }));

      return res.json({ items });
    } catch (error: any) {
      logger.error('Erreur view-history GET', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  })
);

export default router;

