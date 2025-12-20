// backend/src/routes/orders.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../config/supabase.js';
import { isAdminAuthorized, requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validateCsrfToken } from '../middleware/csrf.middleware.js';
import { ipBasedRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { auditOrderStatusTransition, reserveOrderNotification } from '../services/auditService.js';
import { sendOrderDeliveredEmail, sendOrderShippedEmail } from '../services/emailService.js';
import {
    createOrder,
    getAllOrders,
    getOrderById,
    getUserOrders
} from '../services/ordersService.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { escapeCsvValue } from '../utils/metricsHelpers.js';
import { canTransition, type OrderStatus } from '../utils/orderStatus.js';
import { createOrderSchema } from '../validations/schemas.js';

const router = Router();

const publicStatusRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 600 : 60,
  60 * 1000
);

/**
 * @swagger
 * /api/orders:
 *   post:
 *     summary: Créer une nouvelle commande
 *     description: Crée une nouvelle commande avec les items, informations de livraison et total
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - items
 *               - shipping
 *               - total
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/OrderItem'
 *               shipping:
 *                 type: object
 *                 properties:
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   address:
 *                     type: string
 *                   city:
 *                     type: string
 *                   postalCode:
 *                     type: string
 *                   country:
 *                     type: string
 *               total:
 *                 type: number
 *     responses:
 *       201:
 *         description: Commande créée
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order:
 *                   $ref: '#/components/schemas/Order'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post(
  '/',
  validateCsrfToken,
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    // Extraire userId depuis le token JWT (si authentifié) ou header temporaire
    const userId = (req as any).user?.id || req.headers['x-user-id'] as string | undefined;

    const order = await createOrder(req.body, userId || null);

    return res.status(201).json(order);
  })
);

/**
 * GET /api/orders/public-status?orderId=...&orderNumber=...
 * Endpoint public minimal (sans PII) pour afficher le statut sur la page succès.
 * Ne retourne rien si orderId+orderNumber ne matchent pas.
 */
router.get(
  '/public-status',
  publicStatusRateLimiter,
  validate(
    z.object({
      orderId: z.string().uuid(),
      orderNumber: z.string().min(3).max(64),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const orderId = req.query.orderId as string;
    const orderNumber = req.query.orderNumber as string;

    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, total, created_at')
      .eq('id', orderId)
      .eq('order_number', orderNumber)
      .single();

    if (error || !data) {
      // Réponse homogène pour réduire l'énumération
      return res.status(404).json({ error: 'Not found' });
    }

    // Best-effort: retourner les items (sans PII) pour enrichir le tracking purchase
    type OrderItemRow = { quantity: number | null; price: number | null; product_id: string | null };
    type ProductRow = { id: string; title: string | null };

    const { data: itemsRows } = await supabase
      .from('order_items')
      .select('quantity, price, product_id')
      .eq('order_id', orderId);

    let items:
      | Array<{ id: string; name: string; price: number; quantity: number }>
      | undefined;

    if (Array.isArray(itemsRows) && itemsRows.length > 0) {
      const typedItemsRows = itemsRows as OrderItemRow[];
      const productIds = Array.from(
        new Set(typedItemsRows.map((it) => it.product_id).filter((id): id is string => Boolean(id)))
      );

      const { data: productsRows } = await supabase
        .from('products')
        .select('id, title')
        .in('id', productIds);

      const titleById = new Map<string, string>();
      (productsRows as ProductRow[] | null | undefined)?.forEach((p) => {
        if (p?.id) titleById.set(p.id, p.title || 'Produit');
      });

      items = typedItemsRows
        .filter((it): it is OrderItemRow & { product_id: string } => Boolean(it.product_id))
        .map((it) => ({
          id: it.product_id,
          name: titleById.get(it.product_id) || 'Produit',
          price: Number(it.price || 0),
          quantity: Number(it.quantity || 0),
        }));
    }

    return res.json({
      ok: true,
      orderId: data.id,
      orderNumber: data.order_number,
      status: data.status,
      total: data.total,
      createdAt: data.created_at,
      items,
    });
  })
);

/**
 * @swagger
 * /api/orders/{id}:
 *   get:
 *     summary: Récupérer une commande par ID
 *     description: Retourne les détails d'une commande. Les utilisateurs ne peuvent voir que leurs propres commandes, sauf si admin.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de la commande
 *     responses:
 *       200:
 *         description: Détails de la commande
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Order'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         $ref: '#/components/responses/ForbiddenError'
 *       404:
 *         $ref: '#/components/responses/NotFoundError'
 */
router.get(
  '/:id',
  authMiddleware,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    const order = await getOrderById(req.params.id, userId || null);

    if (!order) {
      throw createError.notFound('Order');
    }

    res.json(order);
  })
);

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Liste des commandes
 *     description: Retourne la liste des commandes. Pour utilisateurs authentifiés, leurs propres commandes. Pour admins, toutes les commandes avec ?admin=true
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: admin
 *         schema:
 *           type: string
 *           enum: [true, false]
 *         description: Si true et utilisateur admin, retourne toutes les commandes
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Numéro de page
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Nombre de résultats par page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, processing, shipped, delivered, cancelled, refunded]
 *         description: Filtrer par statut
 *     responses:
 *       200:
 *         description: Liste des commandes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orders:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Order'
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const isAdmin = req.query.admin === 'true' || (req as any).user?.role === 'admin';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;

    // Si admin, retourner toutes les commandes
    if (isAdmin) {
      // ⚠️ admin=true ne doit jamais exposer toutes les commandes sans secret en prod
      // (les pages admin du front étant masquées en LEGAL_CATALOG_MODE, ceci protège aussi les accès directs).
      if (!isAdminAuthorized(req as any)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const searchOrderNumber = req.query.search as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const minAmount = req.query.minAmount ? parseFloat(req.query.minAmount as string) : undefined;
      const maxAmount = req.query.maxAmount ? parseFloat(req.query.maxAmount as string) : undefined;
      const customerSearch = req.query.customerSearch as string | undefined;
      const result = await getAllOrders(page, limit, status, searchOrderNumber, dateFrom, dateTo, minAmount, maxAmount, customerSearch);
      return res.json(result);
    }

    // Sinon, retourner les commandes de l'utilisateur
    // Exiger un token valide (cookie HTTP-only) pour éviter l'usurpation via headers/params.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    authMiddleware(req as any, res, () => {});
    if (res.headersSent) return;

    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Missing authentication token' });
    }

    const result = await getUserOrders(userId, page, limit);
    return res.json(result);
  })
);

/**
 * PATCH /api/orders/:id/status - Mise à jour du statut (admin)
 */
router.patch(
  '/:id/status',
  requireAdminAuth,
  validate(
    z.object({
      id: z.string().uuid(),
    }),
    'params'
  ),
  validate(
    z.object({
      status: z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']),
    })
  ),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id;
    const nextStatus = req.body.status as OrderStatus;

    const { data: currentRow, error: readErr } = await supabase
      .from('orders')
      .select('id, status, order_number, shipping_email, user_id')
      .eq('id', orderId)
      .single();

    if (readErr || !currentRow) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const from = currentRow.status as OrderStatus;
    const to = nextStatus;
    if (!canTransition(from, to)) {
      return res.status(400).json({ error: `Invalid transition: ${from} -> ${to}` });
    }

    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({ status: to })
      .eq('id', orderId)
      .select('id, order_number, status, updated_at')
      .single();

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    // Audit trail (non-bloquant)
    await auditOrderStatusTransition({
      orderId,
      from,
      to,
      actor: 'admin',
      requestId: (req as any)?.requestId,
    });

    // Emails "expédiée" / "livrée" (idempotent via table)
    try {
      if (currentRow.shipping_email && updated?.order_number) {
        if (to === 'shipped') {
          const allowed = await reserveOrderNotification({ orderId, type: 'shipped' });
          if (allowed) {
            await sendOrderShippedEmail({
              to: currentRow.shipping_email,
              orderNumber: updated.order_number,
              userId: currentRow.user_id || undefined,
            });
          }
        }
        if (to === 'delivered') {
          const allowed = await reserveOrderNotification({ orderId, type: 'delivered' });
          if (allowed) {
            await sendOrderDeliveredEmail({
              to: currentRow.shipping_email,
              orderNumber: updated.order_number,
              userId: currentRow.user_id || undefined,
            });
          }
        }
      }
    } catch {
      // non-bloquant
    }

    return res.json({ ok: true, order: updated });
  })
);

/**
 * POST /api/orders/:id/cancel - Annuler une commande (utilisateur, si pending)
 */
router.post(
  '/:id/cancel',
  authMiddleware,
  validate(
    z.object({
      id: z.string().uuid(),
    }),
    'params'
  ),
  asyncHandler(async (req, res) => {
    const orderId = req.params.id;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Vérifier que la commande appartient à l'utilisateur et est en pending
    const { data: order, error: readErr } = await supabase
      .from('orders')
      .select('id, status, user_id')
      .eq('id', orderId)
      .single();

    if (readErr || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Vérifier propriétaire
    if (order.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden: not your order' });
    }

    // Vérifier statut pending
    if (order.status !== 'pending') {
      return res.status(400).json({
        error: `Cannot cancel order with status: ${order.status}. Only pending orders can be cancelled.`,
      });
    }

    // Transition vers cancelled
    const from: OrderStatus = 'pending';
    const to: OrderStatus = 'cancelled';
    if (!canTransition(from, to)) {
      return res.status(400).json({ error: `Invalid transition: ${from} -> ${to}` });
    }

    // Mettre à jour le statut
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({ status: to })
      .eq('id', orderId)
      .eq('status', from) // Double vérification atomique
      .select('id, order_number, status, updated_at')
      .single();

    if (updateErr || !updated) {
      return res.status(500).json({ error: 'Failed to cancel order' });
    }

    // Restaurer le stock (non-bloquant)
    try {
      const { restoreProductStock } = await import('../services/ordersService.js');
      await restoreProductStock(orderId);
    } catch (restoreErr) {
      logger.warn('Failed to restore stock on order cancellation (non-blocking)', {
        orderId,
        error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
      });
    }

    // Audit trail (non-bloquant)
    try {
      await auditOrderStatusTransition({
        orderId,
        from,
        to,
        actor: 'user',
        requestId: (req as any)?.requestId,
      });
    } catch {
      // ignore
    }

    return res.json({ ok: true, order: updated });
  })
);

/**
 * GET /api/orders/export - Export toutes les commandes en CSV (admin only)
 * Query params: orderId (optionnel) pour exporter une seule commande
 */
router.get(
  '/export',
  requireAdminAuth,
  asyncHandler(async (req, res) => {
    const orderId = req.query.orderId as string | undefined;
    // Récupérer les commandes (toutes ou une seule selon orderId)
    let query = supabase.from('orders').select('*');
    if (orderId) {
      query = query.eq('id', orderId);
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data: orders, error: ordersError } = await query;

    if (ordersError) {
      throw createError.database(`Erreur récupération commandes: ${ordersError.message}`);
    }

    if (!orders || orders.length === 0) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="orders-export.csv"');
      return res.send('No orders found\n');
    }

    // Récupérer tous les items pour les commandes
    const orderIds = orders.map((o: any) => o.id);
    const { data: allItems, error: itemsError } = await supabase
      .from('order_items')
      .select('order_id, product_id, quantity, price')
      .in('order_id', orderIds);

    if (itemsError) {
      logger.warn('Failed to fetch order items for CSV export (non-blocking)', {
        message: itemsError.message,
      });
    }

    // Créer un map order_id -> items
    const itemsByOrderId = new Map<string, Array<{ product_id: string; quantity: number; price: number }>>();
    (allItems || []).forEach((item: any) => {
      const existing = itemsByOrderId.get(item.order_id) || [];
      existing.push({
        product_id: item.product_id,
        quantity: Number(item.quantity || 0),
        price: Number(item.price || 0),
      });
      itemsByOrderId.set(item.order_id, existing);
    });

    // En-têtes CSV
    const headers = [
      'Order Number',
      'Status',
      'Total (€)',
      'Created At',
      'Shipping First Name',
      'Shipping Last Name',
      'Shipping Email',
      'Shipping Phone',
      'Shipping Address',
      'Shipping City',
      'Shipping Postal Code',
      'Shipping Country',
      'Promo Code',
      'UTM Source',
      'UTM Campaign',
      'Items Count',
      'Items Details',
    ];

    // Générer les lignes CSV
    const rows = orders.map((order: any) => {
      const items = itemsByOrderId.get(order.id) || [];
      const itemsDetails = items
        .map((item) => `Product ${item.product_id}: ${item.quantity}x ${item.price.toFixed(2)}€`)
        .join('; ');

      return [
        escapeCsvValue(order.order_number),
        escapeCsvValue(order.status),
        escapeCsvValue(Number(order.total || 0).toFixed(2)),
        escapeCsvValue(order.created_at),
        escapeCsvValue(order.shipping_first_name),
        escapeCsvValue(order.shipping_last_name),
        escapeCsvValue(order.shipping_email),
        escapeCsvValue(order.shipping_phone),
        escapeCsvValue(order.shipping_address),
        escapeCsvValue(order.shipping_city),
        escapeCsvValue(order.shipping_postal_code),
        escapeCsvValue(order.shipping_country),
        escapeCsvValue(order.promo_code),
        escapeCsvValue(order.utm_source),
        escapeCsvValue(order.utm_campaign),
        escapeCsvValue(items.length),
        escapeCsvValue(itemsDetails),
      ];
    });

    // Construire le CSV
    const csvLines = [
      headers.join(','),
      ...rows.map((row: string[]) => row.join(',')),
    ];
    const csv = csvLines.join('\n');

    // Retourner le CSV avec les bons headers
    const filename = orderId && orders && orders.length === 1
      ? `commande-${orders[0].order_number}.csv`
      : `orders-export-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send('\ufeff' + csv); // BOM UTF-8 pour Excel
  })
);

export default router;
