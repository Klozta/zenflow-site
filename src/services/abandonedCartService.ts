/**
 * Service de gestion des paniers abandonnés
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { sendAbandonedCartEmail } from './emailService.js';
import { getProductById } from './productsService.js';
import { generatePromoCodeForAbandonedCart } from './promoCodeService.js';

export interface AbandonedCart {
  id: string;
  userId?: string;
  sessionId: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  email?: string;
  createdAt: string;
  lastActivity: string;
  emailSent: boolean;
  firstEmailSentAt?: string;
  secondEmailSentAt?: string;
  recovered: boolean;
}

/**
 * Enregistrer un panier abandonné
 */
export async function saveAbandonedCart(
  sessionId: string,
  items: AbandonedCart['items'],
  total: number,
  userId?: string,
  email?: string
): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      logger.warn('Supabase non configuré - panier abandonné non sauvegardé');
      return;
    }

    // Vérifier si un panier existe déjà pour cette session
    const { data: existing } = await supabase
      .from('abandoned_carts')
      .select('id')
      .eq('session_id', sessionId)
      .eq('recovered', false)
      .single();

    if (existing) {
      // Mettre à jour le panier existant
      await supabase
        .from('abandoned_carts')
        .update({
          items,
          total,
          last_activity: new Date().toISOString(),
          email: email || null,
          user_id: userId || null,
        })
        .eq('id', existing.id);
    } else {
      // Créer un nouveau panier abandonné
      await supabase
        .from('abandoned_carts')
        .insert({
          session_id: sessionId,
          user_id: userId || null,
          items,
          total,
          email: email || null,
          email_sent: false,
          recovered: false,
        });
    }
  } catch (error: any) {
    logger.error('Erreur sauvegarde panier abandonné', error, { sessionId });
  }
}

/**
 * Récupérer les paniers abandonnés à envoyer par email
 * @param hoursSinceAbandonment - Heures depuis l'abandon (24 pour premier email, 48 pour second)
 * @param emailType - 'first' pour premier email (24h), 'second' pour rappel (48h)
 */
export async function getAbandonedCartsToEmail(
  hoursSinceAbandonment: number = 24,
  emailType: 'first' | 'second' = 'first'
): Promise<AbandonedCart[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return [];
    }

    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursSinceAbandonment);

    let query = supabase
      .from('abandoned_carts')
      .select('*')
      .eq('recovered', false)
      .lt('last_activity', cutoffTime.toISOString())
      .not('email', 'is', null);

    if (emailType === 'first') {
      // Premier email : pas encore d'email envoyé
      query = query.eq('email_sent', false);
    } else {
      // Second email : premier email déjà envoyé, mais pas le second
      query = query
        .eq('email_sent', true)
        .is('second_email_sent_at', null);
    }

    const { data, error } = await query;

    if (error) throw error;
    return (data || []) as AbandonedCart[];
  } catch (error: any) {
    logger.error('Erreur récupération paniers abandonnés', error);
    return [];
  }
}

/**
 * Marquer un panier comme récupéré (commande créée)
 */
export async function markCartAsRecovered(sessionId: string): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return;
    }

    await supabase
      .from('abandoned_carts')
      .update({ recovered: true })
      .eq('session_id', sessionId)
      .eq('recovered', false);
  } catch (error: any) {
    logger.error('Erreur marquage panier récupéré', error, { sessionId });
  }
}

/**
 * Marquer un email comme envoyé
 * @param cartId - ID du panier
 * @param emailType - 'first' pour premier email, 'second' pour rappel
 */
export async function markEmailAsSent(cartId: string, emailType: 'first' | 'second' = 'first'): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return;
    }

    const now = new Date().toISOString();
    const updateData: any = {};

    if (emailType === 'first') {
      updateData.email_sent = true;
      updateData.first_email_sent_at = now;
    } else {
      updateData.second_email_sent_at = now;
    }

    await supabase
      .from('abandoned_carts')
      .update(updateData)
      .eq('id', cartId);
  } catch (error: any) {
    logger.error('Erreur marquage email envoyé', error, { cartId, emailType });
  }
}

/**
 * Envoie les emails pour les paniers abandonnés
 * À appeler périodiquement (cron job ou scheduler)
 * @param hoursSinceAbandonment - Heures depuis l'abandon (24 pour premier, 48 pour second)
 * @param emailType - 'first' pour premier email (24h), 'second' pour rappel (48h)
 */
export async function sendAbandonedCartEmails(
  hoursSinceAbandonment: number = 24,
  emailType: 'first' | 'second' = 'first'
): Promise<{ sent: number; failed: number }> {
  try {
    const carts = await getAbandonedCartsToEmail(hoursSinceAbandonment, emailType);
    let sent = 0;
    let failed = 0;

    for (const cart of carts) {
      if (!cart.email) {
        logger.warn('Panier sans email', { cartId: cart.id });
        continue;
      }

      try {
        // Récupérer les détails des produits pour l'email
        const itemsWithDetails = await Promise.all(
          cart.items.map(async (item) => {
            const product = await getProductById(item.productId);
            return {
              productId: item.productId,
              title: product?.title || 'Produit',
              quantity: item.quantity,
              price: item.price,
            };
          })
        );

        // Générer code promo automatique pour second email (rappel)
        let promoCode: string | null = null;
        if (emailType === 'second') {
          try {
            // Générer un code promo de 10% valable 7 jours
            promoCode = await generatePromoCodeForAbandonedCart(cart.email, cart.total);
            if (promoCode) {
              logger.info('Code promo généré pour panier abandonné', {
                cartId: cart.id,
                email: cart.email,
                promoCode,
              });
            }
          } catch (error: any) {
            logger.warn('Erreur génération code promo (non-blocking)', {
              cartId: cart.id,
              error: error.message,
            });
            // Continue sans code promo si génération échoue
          }
        }

        // Envoyer l'email avec message adapté selon le type
        const emailSent = await sendAbandonedCartEmail(
          cart.email,
          itemsWithDetails,
          cart.total,
          cart.sessionId,
          emailType,
          promoCode,
          cart.userId || undefined // Passer userId pour vérifier les préférences
        );

        if (emailSent) {
          await markEmailAsSent(cart.id, emailType);
          sent++;
          logger.info('Email panier abandonné envoyé', {
            cartId: cart.id,
            email: cart.email,
            emailType,
            hoursSinceAbandonment,
          });
        } else {
          failed++;
          logger.warn('Échec envoi email panier abandonné', {
            cartId: cart.id,
            email: cart.email,
            emailType,
          });
        }
      } catch (error: any) {
        failed++;
        logger.error('Erreur traitement panier abandonné', error, { cartId: cart.id, emailType });
      }
    }

    return { sent, failed };
  } catch (error: any) {
    logger.error('Erreur envoi emails paniers abandonnés', error);
    return { sent: 0, failed: 0 };
  }
}
