import type { Request, Response } from 'express';
import { Router } from 'express';
import Stripe from 'stripe';
import { supabase } from '../config/supabase.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validateCsrfToken } from '../middleware/csrf.middleware.js';
import { ipBasedRateLimiter } from '../middleware/rateLimit.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { auditOrderStatusTransition, upsertStripeOrderRef } from '../services/auditService.js';
import { sendOrderConfirmationEmail } from '../services/emailService.js';
import { createOrder } from '../services/ordersService.js';
import { incPaymentsCounter } from '../services/paymentsMetrics.js';
import { getProductById } from '../services/productsService.js';
import { logger } from '../utils/logger.js';
import { canTransition, type OrderStatus } from '../utils/orderStatus.js';
import { structuredLogger } from '../utils/structuredLogger.js';
import { createOrderSchema } from '../validations/schemas.js';

const router = Router();

function getFrontendBaseUrl(): string {
  return (
    process.env.SITE_URL ||
    process.env.FRONTEND_URL ||
    process.env.CORS_ORIGIN ||
    'http://localhost:3002'
  );
}

function toStripeAmountCents(amountEuros: number): number {
  return Math.max(0, Math.round(amountEuros * 100));
}

const SHIPPING_COST = 5.0;
const FREE_SHIPPING_THRESHOLD = 40.0;
const STRIPE_CURRENCY = 'eur' as const;
const MAX_CHECKOUT_ITEMS = 50;
const MAX_ITEM_QUANTITY = 10;

function safeProductName(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  // Sanitize: remove control chars, normalize whitespace
  const cleaned = raw
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ')
    .trim();
  // Stripe product name max 500 chars, but we limit to 120 for safety
  return cleaned.slice(0, 120) || 'Produit';
}

function safeProductImage(imageUrl: unknown): string | undefined {
  if (!imageUrl || typeof imageUrl !== 'string') {
    return undefined;
  }

  // Sanitize: validate URL format
  try {
    const url = new URL(imageUrl);
    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return undefined;
    }
    // Limit length (Stripe image URL max ~2048 chars)
    if (imageUrl.length > 2000) {
      return undefined;
    }
    return imageUrl;
  } catch {
    // Invalid URL
    return undefined;
  }
}

async function buildStripeLineItemsFromDb(items: Array<{ productId: string; quantity: number }>) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('INVALID_ITEMS:empty');
  }
  if (items.length > MAX_CHECKOUT_ITEMS) {
    throw new Error('INVALID_ITEMS:too_many');
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  for (const item of items) {
    if (!item?.productId || typeof item.productId !== 'string') {
      throw new Error('INVALID_ITEMS:productId');
    }
    if (!Number.isFinite(item.quantity) || item.quantity < 1 || item.quantity > MAX_ITEM_QUANTITY) {
      throw new Error(`INVALID_ITEMS:quantity:${item.productId}`);
    }

    const product = await getProductById(item.productId);
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND:${item.productId}`);
    }

    const unitPrice = Number(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`INVALID_PRICE:${item.productId}`);
    }
    const productName = safeProductName(product.title);
    const productImage = product.images?.[0] ? safeProductImage(product.images[0]) : undefined;

    lineItems.push({
      quantity: item.quantity,
      price_data: {
        currency: STRIPE_CURRENCY,
        unit_amount: toStripeAmountCents(unitPrice),
        product_data: {
          name: productName,
          images: productImage ? [productImage] : undefined,
        },
      },
    });
  }

  // Shipping line (doit matcher la règle serveur côté createOrder)
  const subtotal = lineItems.reduce((sum, li) => {
    const qty = typeof li.quantity === 'number' ? li.quantity : 0;
    const unit = typeof li.price_data?.unit_amount === 'number' ? li.price_data.unit_amount : 0;
    return sum + qty * unit;
  }, 0);

  if (subtotal < toStripeAmountCents(FREE_SHIPPING_THRESHOLD)) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: STRIPE_CURRENCY,
        unit_amount: toStripeAmountCents(SHIPPING_COST),
        product_data: { name: 'Livraison' },
      },
    });
  }

  return lineItems;
}

function getStripeClient(): Stripe {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
  // Api version: alignée avec le package Stripe installé (types)
  return new Stripe(stripeSecretKey, { apiVersion: '2025-12-15.clover' });
}

/**
 * GET /api/payments/health
 * Permet de vérifier la config Stripe côté serveur (sans exposer les secrets).
 */
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const hasSecretKey = Boolean(process.env.STRIPE_SECRET_KEY);
    const hasWebhookSecret = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    return res.json({
      ok: hasSecretKey,
      stripe: {
        configured: hasSecretKey,
        webhookConfigured: hasWebhookSecret,
      },
    });
  })
);

// Rate limit dédié webhook (laisser Stripe retry sans exploser le serveur)
export const stripeWebhookRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 1000 : 200,
  60 * 1000
);

export const stripeSessionStatusRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 300 : 60,
  60 * 1000
);

export const stripeCheckoutSessionRateLimiter = ipBasedRateLimiter(
  process.env.NODE_ENV === 'development' ? 120 : 20,
  60 * 1000
);

/**
 * POST /api/payments/stripe/checkout-session
 * Crée une commande (status=pending) puis une session Stripe Checkout.
 */
router.post(
  '/stripe/checkout-session',
  stripeCheckoutSessionRateLimiter,
  validateCsrfToken,
  validate(createOrderSchema),
  asyncHandler(async (req, res) => {
    let stripe: Stripe;
    try {
      stripe = getStripeClient();
    } catch (e: any) {
      if (e?.message === 'STRIPE_NOT_CONFIGURED') {
        return res.status(501).json({ error: 'Stripe non configuré' });
      }
      throw e;
    }

    // Extraire userId depuis le token JWT (si authentifié) ou header temporaire
    const userId = (req as any).user?.id || (req.headers['x-user-id'] as string | undefined);

    // Construire les line_items depuis les prix en DB (ne pas faire confiance au client)
    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
    try {
      lineItems = await buildStripeLineItemsFromDb(
        (req.body?.items || []).map((it: any) => ({
          productId: it.productId,
          quantity: it.quantity,
        }))
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('PRODUCT_NOT_FOUND:')) {
        return res.status(400).json({ error: 'Produit introuvable' });
      }
      if (msg.startsWith('INVALID_ITEMS:') || msg.startsWith('INVALID_PRICE:')) {
        return res.status(400).json({ error: 'Panier invalide' });
      }
      throw e;
    }

    const order = await createOrder(req.body, userId || null);

    const frontendBase = getFrontendBaseUrl();
    const successUrl = `${frontendBase}/checkout/success?orderId=${order.id}&orderNumber=${encodeURIComponent(order.orderNumber)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${frontendBase}/checkout?cancelled=true`;

    // Session expires in 30 minutes (default Stripe is 24h, but we want shorter for better UX)
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60; // 30 minutes from now

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: (req.body?.shipping?.email as string | undefined) || undefined,
      expires_at: expiresAt,
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber,
      },
    });

    if (!session.url) {
      return res.status(500).json({ error: 'Stripe session URL missing' });
    }

    incPaymentsCounter('checkoutSessionCreated');

    return res.status(201).json({
      checkoutUrl: session.url,
      orderId: order.id,
      orderNumber: order.orderNumber,
    });
  })
);

/**
 * GET /api/payments/stripe/session-status?session_id=...
 * Permet au frontend de vérifier qu'une session Stripe est bien payée.
 */
router.get(
  '/stripe/session-status',
  stripeSessionStatusRateLimiter,
  asyncHandler(async (req, res) => {
    const sessionId = (req.query.session_id as string | undefined) || undefined;
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    let stripe: Stripe;
    try {
      stripe = getStripeClient();
    } catch (e: any) {
      if (e?.message === 'STRIPE_NOT_CONFIGURED') {
        return res.status(501).json({ error: 'Stripe non configuré' });
      }
      throw e;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';
    const expired = session.expires_at ? session.expires_at * 1000 < Date.now() : false;
    const orderId = (session.metadata as any)?.orderId as string | undefined;
    const orderNumber = (session.metadata as any)?.orderNumber as string | undefined;

    return res.json({
      ok: true,
      paid,
      expired,
      orderId,
      orderNumber,
      currency: session.currency || 'eur',
      amount_total: typeof session.amount_total === 'number' ? session.amount_total : null,
      expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    });
  })
);

/**
 * Handler webhook Stripe.
 * NOTE: Doit être monté avec express.raw({ type: 'application/json' }) avant express.json().
 */
type StripeWebhookRequest = Request & {
  // express.raw({ type: 'application/json' }) => Buffer
  body: Buffer;
  // middleware interne du projet
  requestId?: string;
};

export async function stripeWebhookHandler(req: StripeWebhookRequest, res: Response) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecretKey || !webhookSecret) {
    return res.status(501).send('Stripe not configured');
  }

  // Security: Validate raw body exists and is Buffer
  if (!Buffer.isBuffer(req.body)) {
    logger.warn('Stripe webhook: invalid body type', {
      type: typeof req.body,
      requestId: req.requestId,
    });
    return res.status(400).send('Invalid request body');
  }

  // Security: Validate body size (max 500KB)
  const MAX_WEBHOOK_BODY_SIZE = 500 * 1024; // 500KB
  if (req.body.length > MAX_WEBHOOK_BODY_SIZE) {
    logger.warn('Stripe webhook: body too large', {
      size: req.body.length,
      max: MAX_WEBHOOK_BODY_SIZE,
      requestId: req.requestId,
    });
    return res.status(413).send('Request entity too large');
  }

  // Security: Set minimal headers (no sensitive data)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-12-15.clover' });

  // Security: Validate required Stripe headers
  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    logger.warn('Stripe webhook: missing signature header', {
      requestId: req.requestId,
      ip: req.ip,
    });
    return res.status(400).send('Missing stripe-signature');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    incPaymentsCounter('webhookReceived');
    // Idempotence durable via table (si dispo). Si déjà vu: répondre 200 sans retraiter.
    const initialOrderId =
      (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired')
        ? ((event.data.object as Stripe.Checkout.Session).metadata?.orderId as string | undefined)
        : event.type === 'payment_intent.payment_failed'
          ? (((event.data.object as Stripe.PaymentIntent).metadata as any)?.orderId as string | undefined)
          : undefined;

    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('stripe_webhook_events')
        .insert({
          stripe_event_id: event.id,
          event_type: event.type,
          order_id: initialOrderId || null,
          raw: event as any,
        })
        .select('stripe_event_id')
        .single();

      if (insertErr) {
        // Si l'event est déjà enregistré (unique violation), on stop.
        const msg = (insertErr as any)?.message || '';
        const code = (insertErr as any)?.code || '';
        if (code === '23505' || /duplicate/i.test(msg) || /unique/i.test(msg)) {
          incPaymentsCounter('duplicateWebhookIgnored');
          structuredLogger.info('Stripe webhook duplicate ignored', {
            stripeEventId: event.id,
            stripeEventType: event.type,
            orderId: initialOrderId,
            requestId: req.requestId,
          });
          return res.json({ received: true, duplicate: true });
        }
        // Table pas encore migrée / pas d'accès: on continue sans bloquer.
        structuredLogger.warn('Stripe webhook audit insert failed (non-blocking)', {
          stripeEventId: event.id,
          stripeEventType: event.type,
          orderId: initialOrderId,
          requestId: req.requestId,
          code,
          message: msg,
        });
      } else if (inserted?.stripe_event_id) {
        structuredLogger.info('Stripe webhook audited', {
          stripeEventId: event.id,
          stripeEventType: event.type,
          orderId: initialOrderId,
          requestId: req.requestId,
        });
      }
    } catch (auditErr) {
      structuredLogger.warn('Stripe webhook audit exception (non-blocking)', {
        stripeEventId: event.id,
        stripeEventType: event.type,
        orderId: initialOrderId,
        requestId: req.requestId,
        message: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        await upsertStripeOrderRef({
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          checkoutSessionId: session.id,
          paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
        });

        // Important: idempotence.
        // On ne veut confirmer + envoyer l’email qu’une seule fois, même si Stripe rejoue le webhook.
        // Transition sécurisée: pending -> confirmed uniquement
        const from: OrderStatus = 'pending';
        const to: OrderStatus = 'confirmed';
        if (!canTransition(from, to)) {
          return res.status(500).send('Invalid order transition');
        }

        const { data: updatedRows, error } = await supabase
          .from('orders')
          .update({ status: to })
          .select('id')
          .eq('id', orderId)
          .in('status', [from]);

        if (error) {
          logger.error('Failed to mark order confirmed (Stripe webhook)', new Error(error.message), {
            orderId,
            stripeEventId: event.id,
          });
          // Important: répondre 200 pour éviter retries infinis si c'est une erreur logique/DB temporaire?
          // Ici on renvoie 500 pour déclencher retry Stripe (plus safe pour ne pas perdre l'event).
          return res.status(500).send('Failed to update order');
        }

        const didTransitionToConfirmed = (updatedRows?.length || 0) > 0;

        if (didTransitionToConfirmed) {
          await auditOrderStatusTransition({
            orderId,
            from,
            to,
            actor: 'stripe',
            stripeEventId: event.id,
            requestId: req.requestId,
          });
          incPaymentsCounter('orderConfirmed');
          // Email confirmation (si provider configuré)
          try {
            const { data: orderRow, error: orderReadError } = await supabase
              .from('orders')
              .select(
                'order_number,total,created_at,shipping_email,shipping_first_name,shipping_last_name,shipping_address,shipping_postal_code,shipping_city,shipping_country,email_sent_at,user_id'
              )
              .eq('id', orderId)
              .single();

            if (orderReadError) {
              logger.warn('Unable to fetch order for confirmation email', {
                orderId,
                message: orderReadError.message,
              });
            } else if (orderRow?.shipping_email) {
              // Idempotence email: ne pas renvoyer si déjà envoyé
              if (orderRow.email_sent_at) {
                structuredLogger.info('Order confirmation email skipped (already sent)', {
                  orderId,
                  orderNumber: orderRow.order_number,
                  requestId: req.requestId,
                });
              } else {
              const shippingName =
                `${orderRow.shipping_first_name || ''} ${orderRow.shipping_last_name || ''}`.trim() ||
                undefined;
              const shippingAddressLine = [
                orderRow.shipping_address,
                `${orderRow.shipping_postal_code || ''} ${orderRow.shipping_city || ''}`.trim(),
                orderRow.shipping_country,
              ]
                .filter(Boolean)
                .join(', ');

              // Récupérer les items (best-effort) pour enrichir l'email
              const { data: itemsRows } = await supabase
                .from('order_items')
                .select('quantity, price, product_id')
                .eq('order_id', orderId);

              let items: Array<{ title: string; quantity: number; unitPrice: number }> | undefined = undefined;
              if (itemsRows && Array.isArray(itemsRows) && itemsRows.length > 0) {
                const productIds = Array.from(new Set(itemsRows.map((it: any) => it.product_id).filter(Boolean)));
                const { data: productsRows } = await supabase
                  .from('products')
                  .select('id, title')
                  .in('id', productIds);

                const titleById = new Map<string, string>();
                (productsRows || []).forEach((p: any) => {
                  if (p?.id) titleById.set(p.id, p.title || 'Produit');
                });

                items = itemsRows.map((it: any) => ({
                  title: titleById.get(it.product_id) || 'Produit',
                  quantity: Number(it.quantity || 0),
                  unitPrice: Number(it.price || 0),
                }));
              }

              // Calculer subtotal, shipping, discount pour PDF
              const subtotal = items
                ? items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0)
                : Number(orderRow.total || 0);
              const shipping = Number(orderRow.total || 0) - subtotal;
              const discount = 0; // À calculer si promo code appliqué

              await sendOrderConfirmationEmail({
                to: orderRow.shipping_email,
                orderNumber: orderRow.order_number,
                total: Number(orderRow.total || 0),
                createdAt: orderRow.created_at,
                shippingName,
                shippingAddressLine,
                items,
                subtotal,
                shipping: shipping > 0 ? shipping : 0,
                discount,
                promoCode: orderRow.promo_code,
                userId: orderRow.user_id || undefined,
                shippingAddress: orderRow.shipping_address
                  ? {
                      firstName: orderRow.shipping_first_name || '',
                      lastName: orderRow.shipping_last_name || '',
                      address: orderRow.shipping_address || '',
                      city: orderRow.shipping_city || '',
                      postalCode: orderRow.shipping_postal_code || '',
                      country: orderRow.shipping_country || 'France',
                    }
                  : undefined,
                includePDF: true, // Générer PDF si données disponibles
              });

              // Marquer comme envoyé (best-effort)
              const { error: markErr } = await supabase
                .from('orders')
                .update({ email_sent_at: new Date().toISOString() })
                .eq('id', orderId)
                .is('email_sent_at', null);
              if (markErr) {
                structuredLogger.warn('Failed to set email_sent_at (non-blocking)', {
                  orderId,
                  requestId: req.requestId,
                  message: markErr.message,
                });
              }
              }
            }
          } catch (emailErr) {
            logger.warn('Order confirmation email failed (non-blocking)', {
              orderId,
              message: emailErr instanceof Error ? emailErr.message : String(emailErr),
            });
          }
        } else {
          logger.info('Stripe webhook ignored (already confirmed or not pending)', {
            orderId,
            stripeEventId: event.id,
          });
        }

        structuredLogger.info('Order marked confirmed via Stripe webhook', {
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          requestId: req.requestId,
        });
      } else {
        structuredLogger.warn('Stripe checkout.session.completed missing orderId metadata', {
          stripeEventId: event.id,
          stripeEventType: event.type,
          requestId: req.requestId,
        });
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await upsertStripeOrderRef({
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          checkoutSessionId: session.id,
          paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
        });
        const from: OrderStatus = 'pending';
        const to: OrderStatus = 'cancelled';
        if (!canTransition(from, to)) {
          return res.status(500).send('Invalid order transition');
        }

        const { error } = await supabase
          .from('orders')
          .update({ status: to })
          .eq('id', orderId)
          .in('status', [from]);
        if (error) {
          logger.error('Failed to mark order cancelled (Stripe session expired)', new Error(error.message), {
            orderId,
            stripeEventId: event.id,
          });
          return res.status(500).send('Failed to update order');
        }
        await auditOrderStatusTransition({
          orderId,
          from,
          to,
          actor: 'stripe',
          stripeEventId: event.id,
          requestId: req.requestId,
        });
        incPaymentsCounter('orderCancelled');
        structuredLogger.info('Order marked cancelled via Stripe session expired', {
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          requestId: req.requestId,
        });
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const orderId = (pi.metadata as any)?.orderId as string | undefined;
      if (orderId) {
        await upsertStripeOrderRef({
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          paymentIntentId: pi.id,
        });
        const from: OrderStatus = 'pending';
        const to: OrderStatus = 'cancelled';
        if (!canTransition(from, to)) {
          return res.status(500).send('Invalid order transition');
        }

        const { error } = await supabase
          .from('orders')
          .update({ status: to })
          .eq('id', orderId)
          .in('status', [from]);
        if (error) {
          logger.error('Failed to mark order cancelled (Stripe payment failed)', new Error(error.message), {
            orderId,
            stripeEventId: event.id,
          });
          return res.status(500).send('Failed to update order');
        }
        await auditOrderStatusTransition({
          orderId,
          from,
          to,
          actor: 'stripe',
          stripeEventId: event.id,
          requestId: req.requestId,
        });
        incPaymentsCounter('orderCancelled');
        structuredLogger.info('Order marked cancelled via Stripe payment failed', {
          orderId,
          stripeEventId: event.id,
          stripeEventType: event.type,
          requestId: req.requestId,
        });
      }
    }

    return res.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook handler error', err instanceof Error ? err : new Error(String(err)), {
      stripeEventId: event.id,
      stripeEventType: event.type,
    });
    return res.status(500).send('Webhook handler error');
  }
}

export default router;
