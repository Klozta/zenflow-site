/**
 * Service de gestion des codes promo
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export interface PromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  min_purchase?: number;
  max_discount?: number;
  valid_from: string;
  valid_until: string;
  usage_limit?: number;
  usage_count: number;
  is_active: boolean;
}

export interface PromoCodeInput {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minPurchase?: number;
  maxDiscount?: number;
  validFrom: string;
  validUntil: string;
  usageLimit?: number;
  isActive?: boolean;
}

/**
 * Vérifier et appliquer un code promo
 */
export async function validatePromoCode(
  code: string,
  totalAmount: number
): Promise<{
  valid: boolean;
  discount: number;
  finalAmount: number;
  promoCode?: PromoCode;
  error?: string;
}> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return {
        valid: false,
        discount: 0,
        finalAmount: totalAmount,
        error: 'Service non disponible',
      };
    }

    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return {
        valid: false,
        discount: 0,
        finalAmount: totalAmount,
        error: 'Code promo invalide',
      };
    }

    const promo = data as PromoCode;
    const now = new Date();
    const validFrom = new Date(promo.valid_from);
    const validUntil = new Date(promo.valid_until);

    // Vérifier dates
    if (now < validFrom || now > validUntil) {
      return {
        valid: false,
        discount: 0,
        finalAmount: totalAmount,
        error: 'Code promo expiré',
      };
    }

    // Vérifier limite d'utilisation
    if (promo.usage_limit && promo.usage_count >= promo.usage_limit) {
      return {
        valid: false,
        discount: 0,
        finalAmount: totalAmount,
        error: 'Code promo épuisé',
      };
    }

    // Vérifier montant minimum
    if (promo.min_purchase && totalAmount < promo.min_purchase) {
      return {
        valid: false,
        discount: 0,
        finalAmount: totalAmount,
        error: `Montant minimum: ${promo.min_purchase}€`,
      };
    }

    // Calculer la réduction
    let discount = 0;
    if (promo.discount_type === 'percentage') {
      discount = (totalAmount * promo.discount_value) / 100;
      if (promo.max_discount) {
        discount = Math.min(discount, promo.max_discount);
      }
    } else {
      discount = promo.discount_value;
    }

    const finalAmount = Math.max(0, totalAmount - discount);

    return {
      valid: true,
      discount,
      finalAmount,
      promoCode: promo,
    };
  } catch (error: any) {
    logger.error('Erreur validation code promo', error, { code });
    return {
      valid: false,
      discount: 0,
      finalAmount: totalAmount,
      error: 'Erreur lors de la validation',
    };
  }
}

/**
 * Incrémenter le compteur d'utilisation
 */
export async function incrementPromoCodeUsage(codeId: string): Promise<void> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return;
    }

    await supabase.rpc('increment_promo_code_usage', { code_id: codeId });
  } catch (error: any) {
    logger.warn('Erreur incrément usage code promo', { codeId, error: error.message });
  }
}

/**
 * Créer un code promo (admin)
 */
/**
 * Génère automatiquement un code promo pour panier abandonné
 * Format: ABANDON-XXXX (10% de réduction, valable 7 jours)
 */
export async function generatePromoCodeForAbandonedCart(
  email: string,
  cartTotal: number
): Promise<string | null> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      logger.warn('Supabase non configuré - code promo non généré');
      return null;
    }

    // Générer un code unique
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `ABANDON-${randomSuffix}`;

    // Vérifier que le code n'existe pas déjà
    const { data: existing } = await supabase
      .from('promo_codes')
      .select('code')
      .eq('code', code)
      .single();

    if (existing) {
      // Si code existe, générer un nouveau
      return generatePromoCodeForAbandonedCart(email, cartTotal);
    }

    // Dates : valable 7 jours à partir de maintenant
    const now = new Date();
    const validUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Créer le code promo : 10% de réduction, min purchase = 80% du panier
    const minPurchase = Math.max(10, cartTotal * 0.8);

    const { data, error } = await supabase
      .from('promo_codes')
      .insert({
        code,
        discount_type: 'percentage',
        discount_value: 10,
        min_purchase: minPurchase,
        max_discount: null,
        valid_from: now.toISOString(),
        valid_until: validUntil.toISOString(),
        usage_limit: 1, // Usage unique
        usage_count: 0,
        is_active: true,
      })
      .select()
      .single();

    if (error || !data) {
      logger.error('Erreur création code promo abandonné', error);
      return null;
    }

    logger.info('Code promo généré pour panier abandonné', {
      code,
      email,
      cartTotal,
      minPurchase,
    });

    return code;
  } catch (error: any) {
    logger.error('Erreur génération code promo abandonné', error);
    return null;
  }
}

export async function createPromoCode(input: PromoCodeInput): Promise<PromoCode> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('Supabase non configuré');
    }

    const { data, error } = await supabase
      .from('promo_codes')
      .insert({
        code: input.code.toUpperCase(),
        discount_type: input.discountType,
        discount_value: input.discountValue,
        min_purchase: input.minPurchase || null,
        max_discount: input.maxDiscount || null,
        valid_from: input.validFrom,
        valid_until: input.validUntil,
        usage_limit: input.usageLimit || null,
        usage_count: 0,
        is_active: input.isActive !== false,
      })
      .select()
      .single();

    if (error) throw error;
    return data as PromoCode;
  } catch (error: any) {
    logger.error('Erreur création code promo', error, { code: input.code });
    throw error;
  }
}









