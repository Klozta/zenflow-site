// backend/src/services/ordersService.ts
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../config/supabase.js';
import {
    CreateOrderInput,
    Order,
    OrderResponse
} from '../types/orders.types.js';
import {
    applyCursorPagination,
    CursorPaginationParams,
    processCursorResults,
} from '../utils/cursorPagination.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { gamificationService } from './gamificationService.js';
import { getProductById } from './productsService.js';
import { incrementPromoCodeUsage, validatePromoCode } from './promoCodeService.js';

/**
 * Calcule le total côté serveur à partir des produits en DB.
 * IMPORTANT: on ignore item.price et data.total envoyés par le frontend.
 *
 * Pour l’instant: pas de promo côté serveur (à ajouter avec un service promo),
 * shipping = 0 si subtotal >= FREE_SHIPPING_THRESHOLD sinon SHIPPING_COST.
 */
const SHIPPING_COST = 5.0;
const FREE_SHIPPING_THRESHOLD = 40.0;

// Anti-fraude: limites
const MAX_QUANTITY_PER_PRODUCT = 50; // Quantité max par produit par commande
const MAX_ORDER_TOTAL = 10000.0; // Total max par commande (€)
const MIN_ORDER_TOTAL = 0.01; // Total min par commande (€)

// Cache court pour les prix produits (30s TTL) - évite requêtes DB multiples pour même produit
interface PriceCacheEntry {
  price: number;
  timestamp: number;
}
const priceCache = new Map<string, PriceCacheEntry>();
const PRICE_CACHE_TTL_MS = 30 * 1000; // 30 secondes

function getCachedPrice(productId: string): number | null {
  const entry = priceCache.get(productId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PRICE_CACHE_TTL_MS) {
    priceCache.delete(productId);
    return null;
  }
  return entry.price;
}

function setCachedPrice(productId: string, price: number): void {
  priceCache.set(productId, { price, timestamp: Date.now() });
  // Nettoyer le cache si trop grand (max 1000 entrées)
  if (priceCache.size > 1000) {
    const oldestKey = Array.from(priceCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
    if (oldestKey) priceCache.delete(oldestKey);
  }
}

async function computeServerTotal(
  items: CreateOrderInput['items'],
  promoCode?: string | null
): Promise<{
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  serverItems: Array<{ productId: string; quantity: number; unitPrice: number }>;
  appliedPromoCode?: string;
}> {
  const serverItems: Array<{ productId: string; quantity: number; unitPrice: number }> = [];

  // Récupérer les prix (avec cache)
  for (const item of items) {
    // Vérifier le cache d'abord
    let unitPrice: number | null = getCachedPrice(item.productId);

    if (unitPrice === null) {
      // Cache miss: récupérer depuis DB
      const product = await getProductById(item.productId);
      if (!product) {
        throw createError.notFound(`Produit ${item.productId}`);
      }
      unitPrice = Number(product.price);
      // Mettre en cache
      setCachedPrice(item.productId, unitPrice);
    }

    serverItems.push({
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
    });
  }

  const subtotal = serverItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_COST;
  const preDiscountTotal = Math.max(0, subtotal + shipping);

  let discount = 0;
  let appliedPromoCode: string | undefined;

  // Promo côté serveur (source de vérité)
  const code = promoCode?.trim() ? promoCode.trim().toUpperCase() : null;
  if (code) {
    const promo = await validatePromoCode(code, preDiscountTotal);
    if (promo.valid) {
      discount = promo.discount;
      appliedPromoCode = code;
      // Best-effort: incrément usage (ne bloque pas la commande si ça échoue)
      if (promo.promoCode?.id) {
        incrementPromoCodeUsage(promo.promoCode.id).catch(() => {});
      }
    }
  }

  const total = Math.max(0, preDiscountTotal - discount);

  return { subtotal, shipping, discount, total, serverItems, appliedPromoCode };
}

/**
 * Génère un numéro de commande unique
 */
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `GC-${timestamp}-${random}`;
}

/**
 * Valide les règles anti-fraude (quantités, totaux)
 */
function validateAntiFraud(items: CreateOrderInput['items'], computedTotal: number): void {
  // 1. Limiter quantité par produit
  for (const item of items) {
    if (item.quantity <= 0) {
      throw createError.badRequest(`Quantité invalide pour le produit ${item.productId}: ${item.quantity}`);
    }

    if (item.quantity > MAX_QUANTITY_PER_PRODUCT) {
      logger.warn('Quantity exceeds limit', {
        productId: item.productId,
        requested: item.quantity,
        max: MAX_QUANTITY_PER_PRODUCT,
      });
      throw createError.badRequest(
        `Quantité maximale par produit dépassée: ${item.quantity} (max: ${MAX_QUANTITY_PER_PRODUCT})`
      );
    }
  }

  // 2. Bloquer totaux aberrants
  if (computedTotal < MIN_ORDER_TOTAL) {
    logger.warn('Order total too low', { total: computedTotal, min: MIN_ORDER_TOTAL });
    throw createError.badRequest(`Total de commande trop faible: ${computedTotal}€ (minimum: ${MIN_ORDER_TOTAL}€)`);
  }

  if (computedTotal > MAX_ORDER_TOTAL) {
    logger.warn('Order total too high (potential fraud)', {
      total: computedTotal,
      max: MAX_ORDER_TOTAL,
    });
    throw createError.badRequest(
      `Total de commande trop élevé: ${computedTotal}€ (maximum: ${MAX_ORDER_TOTAL}€). Veuillez contacter le support pour les commandes importantes.`
    );
  }

  // 3. Limiter nombre d'items par commande
  if (items.length > 50) {
    logger.warn('Too many items in order', { count: items.length });
    throw createError.badRequest(`Trop d'articles dans la commande: ${items.length} (maximum: 50)`);
  }
}

/**
 * Vérifie le stock disponible pour tous les produits
 */
async function validateStock(items: CreateOrderInput['items']): Promise<void> {
  for (const item of items) {
    const product = await getProductById(item.productId);

    if (!product) {
      logger.warn('Product not found during stock validation', { productId: item.productId });
      throw createError.notFound(`Produit ${item.productId}`);
    }

    if (product.stock < item.quantity) {
      logger.warn('Insufficient stock', {
        productId: item.productId,
        productTitle: product.title,
        available: product.stock,
        requested: item.quantity,
      });
      throw createError.conflict(
        `Stock insuffisant pour ${product.title}. Stock disponible: ${product.stock}, demandé: ${item.quantity}`
      );
    }
  }
}

/**
 * Met à jour le stock des produits après commande
 */
async function updateProductStock(items: CreateOrderInput['items']): Promise<void> {
  for (const item of items) {
    const product = await getProductById(item.productId);
    if (!product) continue;

    // Décrément atomique côté DB (évite oversell si commandes concurrentes)
    const { data, error } = await supabase.rpc('decrement_product_stock', {
      p_product_id: item.productId,
      p_quantity: item.quantity,
    });

    if (error) {
      const msg = error.message || 'stock_update_failed';
      logger.error('Failed to decrement product stock', new Error(msg), {
        productId: item.productId,
        productTitle: product.title,
        requested: item.quantity,
      });

      // Exposer un conflit clair si stock insuffisant
      if (msg.includes('insufficient_stock')) {
        throw createError.conflict(
          `Stock insuffisant pour ${product.title}. Stock disponible: ${product.stock}, demandé: ${item.quantity}`
        );
      }

      throw createError.database(`Erreur lors de la mise à jour du stock pour ${product.title}`, new Error(msg));
    }

    logger.info('Stock decremented', {
      productId: item.productId,
      productTitle: product.title,
      newStock: data,
    });
  }
}

/**
 * Restaure le stock des produits lors de l'annulation d'une commande
 */
export async function restoreProductStock(orderId: string): Promise<void> {
  // Récupérer les items de la commande
  const { data: orderItems, error: itemsError } = await supabase
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', orderId);

  if (itemsError || !orderItems || orderItems.length === 0) {
    logger.warn('No order items found for stock restoration', { orderId });
    return;
  }

  // Restaurer le stock pour chaque produit
  for (const item of orderItems) {
    const product = await getProductById(item.product_id);
    if (!product) {
      logger.warn('Product not found during stock restoration', { productId: item.product_id, orderId });
      continue;
    }

    // Incrémenter le stock (UPDATE direct)
    const { error: updateError } = await supabase
      .from('products')
      .update({ stock: (product.stock || 0) + (item.quantity || 0) })
      .eq('id', item.product_id);

    if (updateError) {
      logger.error('Failed to restore product stock', new Error(updateError.message), {
        productId: item.product_id,
        productTitle: product.title,
        quantity: item.quantity,
        orderId,
      });
      // Ne pas throw: on continue pour les autres produits
    } else {
      logger.info('Stock restored', {
        productId: item.product_id,
        productTitle: product.title,
        quantity: item.quantity,
        newStock: (product.stock || 0) + (item.quantity || 0),
        orderId,
      });
    }
  }
}

/**
 * Crée une nouvelle commande
 */
export async function createOrder(
  data: CreateOrderInput,
  userId?: string | null
): Promise<OrderResponse> {
  const LEGAL_CONSENT_VERSION = 'v1';

  // 0. Calculer le total côté serveur (ignore data.total et item.price)
  const computed = await computeServerTotal(data.items, data.shipping?.promoCode || null);

  // 0.5. Valider anti-fraude (quantités, totaux)
  validateAntiFraud(data.items, computed.total);

  // 1. Valider le stock
  await validateStock(data.items);

  // 2. Générer numéro de commande
  const orderNumber = generateOrderNumber();
  const orderId = uuidv4();

  // 3. Créer la commande
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      id: orderId,
      order_number: orderNumber,
      user_id: userId || null,
      status: 'pending',
      total: computed.total,
      shipping_first_name: data.shipping.firstName,
      shipping_last_name: data.shipping.lastName,
      shipping_email: data.shipping.email,
      shipping_phone: data.shipping.phone,
      shipping_address: data.shipping.address,
      shipping_city: data.shipping.city,
      shipping_postal_code: data.shipping.postalCode,
      shipping_country: data.shipping.country,
      promo_code: computed.appliedPromoCode || null,
      legal_consent_at: data.shipping.acceptTerms ? new Date().toISOString() : null,
      legal_consent_version: data.shipping.acceptTerms ? LEGAL_CONSENT_VERSION : null,
      // Attribution marketing (UTM, referrer)
      utm_source: data.attribution?.utm_source || null,
      utm_medium: data.attribution?.utm_medium || null,
      utm_campaign: data.attribution?.utm_campaign || null,
      utm_term: data.attribution?.utm_term || null,
      utm_content: data.attribution?.utm_content || null,
      referrer: data.attribution?.referrer || null,
      landing_page: data.attribution?.landing_page || null,
    })
    .select()
    .single();

  if (orderError || !order) {
    logger.error('Failed to create order', orderError ? new Error(orderError.message) : new Error('No order returned'), {
      orderNumber,
      userId,
    });
    throw createError.database(
      `Erreur lors de la création de la commande: ${orderError?.message || 'Aucune donnée retournée'}`,
      orderError ? new Error(orderError.message) : undefined
    );
  }

  // 4. Créer les order_items
  // On stocke le prix serveur dans order_items (pas celui envoyé par le client)
  const orderItems = computed.serverItems.map((item) => ({
    id: uuidv4(),
    order_id: orderId,
    product_id: item.productId,
    quantity: item.quantity,
    price: item.unitPrice,
  }));

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItems);

  if (itemsError) {
    // Rollback: supprimer la commande si les items échouent
    logger.error('Failed to create order items, rolling back order', new Error(itemsError.message), {
      orderId,
      orderNumber,
    });
    await supabase.from('orders').delete().eq('id', orderId);
    throw createError.database(`Erreur lors de la création des articles: ${itemsError.message}`, new Error(itemsError.message));
  }

  // 5. Mettre à jour le stock (après création commande réussie)
  try {
    await updateProductStock(data.items);
    logger.info('Order created successfully', { orderId, orderNumber, userId });
  } catch (error: any) {
    // Rollback: supprimer commande et items
    logger.error('Failed to update stock, rolling back order', error instanceof Error ? error : new Error(String(error)), {
      orderId,
      orderNumber,
    });
    await supabase.from('order_items').delete().eq('order_id', orderId);
    await supabase.from('orders').delete().eq('id', orderId);
    throw error;
  }

  // 5.5. Ajouter des points de fidélité si utilisateur connecté (non-bloquant)
  if (userId) {
    try {
      const { addLoyaltyPoints } = await import('./loyaltyService.js');
      await addLoyaltyPoints(userId, orderId, computed.total, `Points gagnés sur la commande ${orderNumber}`);
    } catch (error: any) {
      // Non-bloquant: on log mais on ne fait pas échouer la commande
      logger.warn('Failed to add loyalty points (non-blocking)', { userId, orderId, error: error?.message });
    }

    // 5.6. Traiter les récompenses de parrainage (non-bloquant)
    try {
      const { processReferralReward } = await import('./referralService.js');
      await processReferralReward(orderId, userId, computed.total);
    } catch (error: any) {
      logger.warn('Failed to process referral reward (non-blocking)', { userId, orderId, error: error?.message });
    }

    // 5.7. Gamification - Points et badges (non-bloquant)
    try {
      // Points pour la commande (1 point par euro)
      const pointsEarned = Math.floor(computed.total);
      await gamificationService.addPoints(userId, pointsEarned, `Commande ${orderNumber}`);

      // Vérifier si c'est la première commande (badge)
      const { count: ordersCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (ordersCount === 1) {
        await gamificationService.unlockBadge(userId, 'first_order').catch(() => {
          // Ignorer si déjà débloqué
        });
      } else if (ordersCount === 10) {
        await gamificationService.unlockBadge(userId, 'power_buyer').catch(() => {
          // Ignorer si déjà débloqué
        });
      }

      // Badge "Early Bird" si commande avant 10h
      const currentHour = new Date().getHours();
      if (currentHour < 10) {
        await gamificationService.unlockBadge(userId, 'early_bird').catch(() => {
          // Ignorer si déjà débloqué
        });
      }
    } catch (error: any) {
      logger.warn('Failed to process gamification (non-blocking)', { userId, orderId, error: error?.message });
    }
  }

  // 6. Retourner la réponse
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    total: order.total,
    createdAt: order.created_at,
  };
}

/**
 * Récupère une commande par ID
 */
export async function getOrderById(orderId: string, userId?: string | null): Promise<Order | null> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('id', orderId);

  // Si userId fourni, filtrer par user_id (RLS)
  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return data as Order;
}

/**
 * Récupère les commandes d'un utilisateur
 * Supporte pagination cursor-based (recommandé) et offset-based (rétrocompatibilité)
 */
export async function getUserOrders(
  userId: string,
  pageOrCursor?: number | CursorPaginationParams,
  limit: number = 20
): Promise<{ orders: Order[]; pagination: { page: number; limit: number; total: number; totalPages: number; nextCursor?: string | null; prevCursor?: string | null; hasMore?: boolean } }> {
  // Détecter si on utilise cursor ou offset
  const useCursor = typeof pageOrCursor === 'object' && pageOrCursor !== null;

  if (useCursor) {
    // Pagination cursor-based (optimisée)
    const cursorParams = pageOrCursor as CursorPaginationParams;
    const actualLimit = cursorParams.limit || limit;

    let query = supabase
      .from('orders')
      .select('id,created_at,*') // Inclure id et created_at pour le cursor
      .eq('user_id', userId);

    query = applyCursorPagination(query, cursorParams, 'created_at', 'desc');

    const { data, error } = await query;

    if (error) {
      throw new Error(`Erreur lors de la récupération des commandes: ${error.message}`);
    }

    const orders = (data || []) as Order[];
    const result = processCursorResults(orders, actualLimit);

    // Récupérer le total pour compatibilité (optionnel, peut être coûteux)
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return {
      orders: result.items,
      pagination: {
        page: 1, // Non applicable avec cursor
        limit: result.limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / result.limit) : 0,
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor,
        hasMore: result.hasMore,
      },
    };
  }

  // Pagination offset-based (rétrocompatibilité)
  const page = typeof pageOrCursor === 'number' ? pageOrCursor : 1;
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Erreur lors de la récupération des commandes: ${error.message}`);
  }

  const orders = (data || []) as Order[];
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    orders,
    pagination: { page, limit, total, totalPages },
  };
}

/**
 * Récupère toutes les commandes (admin)
 * Supporte pagination cursor-based (recommandé) et offset-based (rétrocompatibilité)
 */
export async function getAllOrders(
  pageOrCursor: number | CursorPaginationParams = 1,
  limit: number = 20,
  status?: string,
  searchOrderNumber?: string,
  dateFrom?: string,
  dateTo?: string,
  minAmount?: number,
  maxAmount?: number,
  customerSearch?: string
): Promise<{ orders: Order[]; pagination: { page: number; limit: number; total?: number; totalPages?: number; nextCursor?: string | null; prevCursor?: string | null; hasMore?: boolean } }> {
  // Détecter si on utilise cursor ou offset
  const useCursor = typeof pageOrCursor === 'object' && pageOrCursor !== null;

  let query = supabase
    .from('orders')
    .select(useCursor ? 'id,created_at,*' : '*', useCursor ? undefined : { count: 'exact' })
    .order('created_at', { ascending: false });

  // Appliquer les filtres (commun aux deux modes)
  if (status) {
    query = query.eq('status', status);
  }

  if (searchOrderNumber && searchOrderNumber.trim()) {
    query = query.ilike('order_number', `%${searchOrderNumber.trim()}%`);
  }

  if (dateFrom) {
    query = query.gte('created_at', dateFrom);
  }

  if (dateTo) {
    query = query.lte('created_at', dateTo);
  }

  if (minAmount !== undefined) {
    query = query.gte('total', minAmount);
  }

  if (maxAmount !== undefined) {
    query = query.lte('total', maxAmount);
  }

  if (customerSearch && customerSearch.trim()) {
    const search = customerSearch.trim();
    query = query.or(`shipping_email.ilike.%${search}%,shipping_first_name.ilike.%${search}%,shipping_last_name.ilike.%${search}%`);
  }

  if (useCursor) {
    // Pagination cursor-based (optimisée)
    const cursorParams = pageOrCursor as CursorPaginationParams;
    const actualLimit = cursorParams.limit || limit;

    query = applyCursorPagination(query, cursorParams, 'created_at', 'desc');

    const { data, error } = await query;

    if (error) {
      throw new Error(`Erreur lors de la récupération des commandes: ${error.message}`);
    }

    const orders = (data || []) as Order[];
    const result = processCursorResults(orders, actualLimit);

    // Optionnel: récupérer le total (peut être coûteux avec beaucoup de filtres)
    // On le fait seulement si nécessaire pour compatibilité
    let total: number | undefined;
    try {
      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true });
      total = count || undefined;
    } catch {
      // Ignorer l'erreur de count si trop coûteux
    }

    return {
      orders: result.items,
      pagination: {
        page: 1, // Non applicable avec cursor
        limit: result.limit,
        total,
        totalPages: total ? Math.ceil(total / result.limit) : undefined,
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor,
        hasMore: result.hasMore,
      },
    };
  }

  // Pagination offset-based (rétrocompatibilité)
  const page = typeof pageOrCursor === 'number' ? pageOrCursor : 1;
  const offset = (page - 1) * limit;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Erreur lors de la récupération des commandes: ${error.message}`);
  }

  const orders = (data || []) as Order[];
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    orders,
    pagination: { page, limit, total, totalPages },
  };
}
