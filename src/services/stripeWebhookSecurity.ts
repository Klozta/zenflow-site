/**
 * Sécurisation des webhooks Stripe
 * Basé sur recommandations Perplexity - Protection contre attaques webhook
 */

import type { NextFunction, Response } from 'express';
import Stripe from 'stripe';
import { logger } from '../utils/logger.js';
import { securityLogger } from '../utils/securityLogger.js';

/**
 * Vérifier la signature d'un webhook Stripe
 * CRITIQUE : Protège contre les requêtes forgées
 */
export function verifyStripeWebhookSignature(
  payload: string | Buffer,
  signature: string | string[] | undefined,
  webhookSecret: string
): Stripe.Event {
  if (!signature) {
    throw new Error('Missing Stripe signature header');
  }

  const sig = Array.isArray(signature) ? signature[0] : signature;

  try {
    // Vérifier signature avec HMAC SHA-256
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
        apiVersion: '2025-12-15.clover',
      });

    const event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    return event;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Logger TOUS les échecs pour détecter les tentatives d'attaque
    logger.error('Stripe webhook signature verification failed', error instanceof Error ? error : new Error(errorMessage), {
      signature: sig,
      error: errorMessage,
    });

    securityLogger.suspiciousActivity(
      'webhook_verification_failed',
      'Stripe webhook signature verification failed',
      {
        signature: sig,
        error: errorMessage,
      }
    );

    throw new Error(`Webhook signature verification failed: ${errorMessage}`);
  }
}

/**
 * Valider les données d'un PaymentIntent Stripe
 * Vérifications de sécurité critiques
 */
export async function validatePaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  expectedOrderId: string,
  expectedAmount: number
): Promise<{ valid: boolean; error?: string }> {
  // 1. Vérifier que le montant correspond exactement
  const expectedAmountCents = Math.round(expectedAmount * 100);
  if (paymentIntent.amount !== expectedAmountCents) {
    logger.error('PaymentIntent amount mismatch', new Error('Amount mismatch'), {
      expected: expectedAmountCents,
      received: paymentIntent.amount,
      orderId: expectedOrderId,
    });
    return {
      valid: false,
      error: `Amount mismatch: expected ${expectedAmountCents}, received ${paymentIntent.amount}`,
    };
  }

  // 2. Vérifier que la commande existe et correspond
  // (Cette logique devrait être dans ordersService, mais on la mentionne ici)
  // const order = await getOrderById(expectedOrderId);
  // if (!order) {
  //   return { valid: false, error: 'Order not found' };
  // }

  // 3. Vérifier que le PaymentIntent n'a pas été modifié
  if (paymentIntent.status === 'canceled') {
    return {
      valid: false,
      error: 'PaymentIntent has been canceled',
    };
  }

  return { valid: true };
}

/**
 * Middleware Express pour sécuriser les webhooks Stripe
 * IMPORTANT: Ne pas utiliser bodyParser.json() sur cette route
 * Stripe a besoin du raw body pour vérifier la signature
 */
export function stripeWebhookMiddleware(webhookSecret: string) {
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Le body doit être le raw body (Buffer), pas JSON parsé
      const sig = req.headers['stripe-signature'];

      if (!sig) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }

      // req.body devrait être un Buffer si middleware raw body est utilisé
      const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);

      // Vérifier la signature
      const event = verifyStripeWebhookSignature(payload, sig as string, webhookSecret);

      // Ajouter l'événement vérifié à la requête
      (req as any).stripeEvent = event;

      next();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Stripe webhook middleware error', error instanceof Error ? error : new Error(errorMessage));
      res.status(400).json({
        error: 'Webhook verification failed',
        message: errorMessage,
      });
    }
  };
}

