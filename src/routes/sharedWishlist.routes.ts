/**
 * Routes pour le système de wishlist partagée / listes de cadeaux
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { sharedWishlistService } from '../services/sharedWishlistService.js';
import { handleServiceError } from '../utils/errorHandlers.js';

const router = Router();

/**
 * POST /api/wishlists - Créer une nouvelle wishlist
 * Body: { name, description?, type, isPublic, eventDate? }
 */
router.post(
  '/',
  authMiddleware,
  validate(
    z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      type: z.enum(['personal', 'gift', 'wedding', 'birthday', 'anniversary', 'custom']),
      isPublic: z.boolean(),
      eventDate: z.string().optional(),
    })
  ),
  asyncHandler(async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const wishlist = await sharedWishlistService.createWishlist(userId, req.body);
      return res.status(201).json(wishlist);
    } catch (error) {
      throw handleServiceError(error, 'createWishlist', 'Erreur création wishlist');
    }
  })
);

/**
 * GET /api/wishlists - Récupérer les wishlists de l'utilisateur connecté
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const wishlists = await sharedWishlistService.getUserWishlists(userId);
      return res.json({ wishlists, count: wishlists.length });
    } catch (error) {
      throw handleServiceError(error, 'getUserWishlists', 'Erreur récupération wishlists');
    }
  })
);

/**
 * GET /api/wishlists/:id - Récupérer une wishlist par ID ou token
 */
router.get(
  '/:id',
  asyncHandler(async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const wishlist = await sharedWishlistService.getWishlist(id, userId);
      if (!wishlist) {
        return res.status(404).json({ error: 'Wishlist non trouvée' });
      }

      return res.json(wishlist);
    } catch (error) {
      throw handleServiceError(error, 'getWishlist', 'Erreur récupération wishlist');
    }
  })
);

/**
 * POST /api/wishlists/:id/items - Ajouter un produit à une wishlist
 * Body: { productId, quantity?, priority?, notes? }
 */
router.post(
  '/:id/items',
  authMiddleware,
  validate(
    z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive().optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
      notes: z.string().optional(),
    })
  ),
  asyncHandler(async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      // Vérifier que l'utilisateur est propriétaire ou que la wishlist est publique
      const wishlist = await sharedWishlistService.getWishlist(id, userId);
      if (!wishlist) {
        return res.status(404).json({ error: 'Wishlist non trouvée' });
      }

      if (wishlist.userId !== userId && !wishlist.isPublic) {
        return res.status(403).json({ error: 'Vous n\'avez pas accès à cette wishlist' });
      }

      const item = await sharedWishlistService.addItemToWishlist(id, req.body.productId, {
        quantity: req.body.quantity,
        priority: req.body.priority,
        notes: req.body.notes,
      });

      return res.status(201).json(item);
    } catch (error) {
      throw handleServiceError(error, 'addItemToWishlist', 'Erreur ajout item');
    }
  })
);

/**
 * POST /api/wishlists/items/:itemId/reserve - Réserver un item
 */
router.post(
  '/items/:itemId/reserve',
  authMiddleware,
  validate(z.object({ itemId: z.string().uuid() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const item = await sharedWishlistService.reserveItem(itemId, userId);
      return res.json(item);
    } catch (error: any) {
      if (error.message?.includes('déjà réservé') || error.message?.includes('déjà acheté')) {
        return res.status(409).json({ error: error.message });
      }
      throw handleServiceError(error, 'reserveItem', 'Erreur réservation item');
    }
  })
);

/**
 * POST /api/wishlists/items/:itemId/purchase - Marquer un item comme acheté
 */
router.post(
  '/items/:itemId/purchase',
  authMiddleware,
  validate(z.object({ itemId: z.string().uuid() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      const item = await sharedWishlistService.markItemAsPurchased(itemId, userId);
      return res.json(item);
    } catch (error) {
      throw handleServiceError(error, 'markItemAsPurchased', 'Erreur marquage achat');
    }
  })
);

/**
 * DELETE /api/wishlists/items/:itemId/reserve - Annuler une réservation
 */
router.delete(
  '/items/:itemId/reserve',
  authMiddleware,
  validate(z.object({ itemId: z.string().uuid() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { itemId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      await sharedWishlistService.cancelReservation(itemId, userId);
      return res.json({ success: true });
    } catch (error) {
      throw handleServiceError(error, 'cancelReservation', 'Erreur annulation réservation');
    }
  })
);

/**
 * DELETE /api/wishlists/:id/items/:itemId - Supprimer un item d'une wishlist
 */
router.delete(
  '/:id/items/:itemId',
  authMiddleware,
  validate(z.object({ id: z.string().uuid(), itemId: z.string().uuid() }), 'params'),
  asyncHandler(async (req: any, res) => {
    try {
      const { id, itemId } = req.params;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'Non authentifié' });
      }

      await sharedWishlistService.removeItemFromWishlist(itemId, id, userId);
      return res.json({ success: true });
    } catch (error: any) {
      if (error.message?.includes('propriétaire')) {
        return res.status(403).json({ error: error.message });
      }
      throw handleServiceError(error, 'removeItemFromWishlist', 'Erreur suppression item');
    }
  })
);

export default router;

