/**
 * Service de gestion du système de parrainage
 * Gère les codes de parrainage, le tracking et les récompenses
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';
import { addLoyaltyPoints } from './loyaltyService.js';

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  isActive: boolean;
  totalReferrals: number;
  totalRewardsEarned: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralTracking {
  id: string;
  referrerId: string;
  referredId: string;
  referralCodeId: string;
  referralCode: string;
  status: 'pending' | 'completed' | 'rewarded' | 'cancelled';
  referrerRewardType?: 'points' | 'discount' | 'cashback' | null;
  referrerRewardAmount: number;
  referredRewardType?: 'points' | 'discount' | 'cashback' | null;
  referredRewardAmount: number;
  firstOrderId?: string | null;
  rewardGivenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Configuration des récompenses
const REFERRER_REWARD_POINTS = 500; // Points pour le parrain
const REFERRED_REWARD_POINTS = 200; // Points pour le parrainé
const MIN_ORDER_AMOUNT_FOR_REWARD = 20.0; // Montant minimum de commande pour déclencher la récompense

/**
 * Génère ou récupère le code de parrainage d'un utilisateur
 */
export async function getOrCreateReferralCode(userId: string, userName: string): Promise<ReferralCode | null> {
  try {
    // Vérifier si un code existe déjà
    const { data: existing, error: _fetchError } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existing) {
      return mapReferralCodeFromDb(existing);
    }

    // Générer un nouveau code via fonction SQL
    const { data: generatedCode, error: generateError } = await supabase.rpc('generate_referral_code', {
      user_name: userName || 'User',
    });

    if (generateError) {
      logger.error('Erreur génération code via RPC', generateError, { userName });
      // Fallback: générer un code simple
      const fallbackCode = `REF${userId.substring(0, 8).toUpperCase()}`;
      const { data: newCode, error: createError } = await supabase
        .from('referral_codes')
        .insert({
          user_id: userId,
          code: fallbackCode,
          is_active: true,
          total_referrals: 0,
          total_rewards_earned: 0,
        })
        .select('*')
        .single();
      if (createError) throw createError;
      return mapReferralCodeFromDb(newCode);
    }

    // Créer le code de parrainage
    const { data: newCode, error: createError } = await supabase
      .from('referral_codes')
      .insert({
        user_id: userId,
        code: generatedCode as string,
        is_active: true,
        total_referrals: 0,
        total_rewards_earned: 0,
      })
      .select('*')
      .single();

    if (createError) throw createError;
    return mapReferralCodeFromDb(newCode);
  } catch (error: any) {
    logger.error('Erreur génération code parrainage', error, { userId, userName });
    return null;
  }
}

/**
 * Valide un code de parrainage
 */
export async function validateReferralCode(code: string): Promise<{ valid: boolean; referrerId?: string; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('referral_codes')
      .select('user_id, is_active')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return { valid: false, error: 'Code de parrainage invalide' };
    }

    return { valid: true, referrerId: data.user_id };
  } catch (error: any) {
    logger.error('Erreur validation code parrainage', error, { code });
    return { valid: false, error: 'Erreur lors de la validation' };
  }
}

/**
 * Enregistre un parrainage lors de l'inscription
 */
export async function trackReferral(
  referrerId: string,
  referredId: string,
  referralCode: string
): Promise<boolean> {
  try {
    // Récupérer l'ID du code de parrainage
    const { data: codeData, error: codeError } = await supabase
      .from('referral_codes')
      .select('id')
      .eq('code', referralCode.toUpperCase())
      .eq('user_id', referrerId)
      .single();

    if (codeError || !codeData) {
      logger.warn('Code de parrainage introuvable pour tracking', { referrerId, referralCode });
      return false;
    }

    // Vérifier si ce parrainage existe déjà
    const { data: existing } = await supabase
      .from('referral_tracking')
      .select('id')
      .eq('referred_id', referredId)
      .single();

    if (existing) {
      logger.warn('Parrainage déjà enregistré', { referredId });
      return false;
    }

    // Créer l'enregistrement de tracking
    const { error: trackingError } = await supabase
      .from('referral_tracking')
      .insert({
        referrer_id: referrerId,
        referred_id: referredId,
        referral_code_id: codeData.id,
        referral_code: referralCode.toUpperCase(),
        status: 'pending',
        referrer_reward_type: 'points',
        referrer_reward_amount: 0, // Sera mis à jour après première commande
        referred_reward_type: 'points',
        referred_reward_amount: REFERRED_REWARD_POINTS, // Points immédiats pour le parrainé
      });

    if (trackingError) throw trackingError;

    // Donner les points de bienvenue au parrainé immédiatement
    try {
      // Créer une transaction de points bonus
      const { error: pointsError } = await supabase
        .from('loyalty_transactions')
        .insert({
          user_id: referredId,
          points: REFERRED_REWARD_POINTS,
          transaction_type: 'bonus',
          description: `Points de bienvenue parrainage (code: ${referralCode.toUpperCase()})`,
        });

      if (pointsError) {
        logger.warn('Erreur ajout points bienvenue parrainage (non-blocking)', { referredId, pointsError });
      }
    } catch (error: any) {
      logger.warn('Erreur ajout points bienvenue parrainage (non-blocking)', { referredId, error: error?.message });
    }

    logger.info('Parrainage enregistré', { referrerId, referredId, referralCode });
    return true;
  } catch (error: any) {
    logger.error('Erreur enregistrement parrainage', error, { referrerId, referredId });
    return false;
  }
}

/**
 * Vérifie et récompense les parrainages après une commande
 */
export async function processReferralReward(orderId: string, userId: string, orderTotal: number): Promise<void> {
  try {
    // Vérifier si c'est la première commande de l'utilisateur
    const { data: previousOrders } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', userId)
      .neq('id', orderId)
      .limit(1);

    // Si l'utilisateur a déjà commandé, pas de récompense
    if (previousOrders && previousOrders.length > 0) {
      return;
    }

    // Vérifier si le montant minimum est atteint
    if (orderTotal < MIN_ORDER_AMOUNT_FOR_REWARD) {
      logger.info('Montant commande insuffisant pour récompense parrainage', { userId, orderTotal });
      return;
    }

    // Récupérer le parrainage en attente
    const { data: referral, error: referralError } = await supabase
      .from('referral_tracking')
      .select('*')
      .eq('referred_id', userId)
      .eq('status', 'pending')
      .single();

    if (referralError || !referral) {
      return; // Pas de parrainage en attente
    }

    // Mettre à jour le statut et donner les récompenses
    const { error: updateError } = await supabase
      .from('referral_tracking')
      .update({
        status: 'completed',
        first_order_id: orderId,
        referrer_reward_amount: REFERRER_REWARD_POINTS,
        reward_given_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', referral.id);

    if (updateError) throw updateError;

    // Donner les points au parrain
    try {
      await addLoyaltyPoints(
        referral.referrer_id,
        orderId,
        REFERRER_REWARD_POINTS,
        `Points parrainage: ${referral.referral_code}`
      );
    } catch (error: any) {
      logger.warn('Erreur ajout points parrain (non-blocking)', { referrerId: referral.referrer_id, error: error?.message });
    }

    // Mettre à jour le total des récompenses gagnées
    await supabase
      .from('referral_codes')
      .update({
        total_rewards_earned: supabase.raw(`total_rewards_earned + ${REFERRER_REWARD_POINTS}`),
        updated_at: new Date().toISOString(),
      })
      .eq('id', referral.referral_code_id);

    logger.info('Récompense parrainage donnée', {
      referrerId: referral.referrer_id,
      referredId: userId,
      orderId,
      points: REFERRER_REWARD_POINTS,
    });
  } catch (error: any) {
    logger.error('Erreur traitement récompense parrainage', error, { orderId, userId });
  }
}

/**
 * Récupère les statistiques de parrainage d'un utilisateur
 */
export async function getReferralStats(userId: string): Promise<{
  code: ReferralCode | null;
  totalReferrals: number;
  totalRewards: number;
  recentReferrals: ReferralTracking[];
}> {
  try {
    const code = await getOrCreateReferralCode(userId, 'User'); // Le nom sera mis à jour si nécessaire

    const { data: referrals } = await supabase
      .from('referral_tracking')
      .select('*')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    return {
      code,
      totalReferrals: code?.totalReferrals || 0,
      totalRewards: code?.totalRewardsEarned || 0,
      recentReferrals: (referrals || []).map(mapReferralTrackingFromDb),
    };
  } catch (error: any) {
    logger.error('Erreur récupération stats parrainage', error, { userId });
    return {
      code: null,
      totalReferrals: 0,
      totalRewards: 0,
      recentReferrals: [],
    };
  }
}

/**
 * Mappe les données DB vers l'interface TypeScript
 */
function mapReferralCodeFromDb(row: any): ReferralCode {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    isActive: row.is_active,
    totalReferrals: row.total_referrals,
    totalRewardsEarned: Number(row.total_rewards_earned || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReferralTrackingFromDb(row: any): ReferralTracking {
  return {
    id: row.id,
    referrerId: row.referrer_id,
    referredId: row.referred_id,
    referralCodeId: row.referral_code_id,
    referralCode: row.referral_code,
    status: row.status,
    referrerRewardType: row.referrer_reward_type,
    referrerRewardAmount: Number(row.referrer_reward_amount || 0),
    referredRewardType: row.referred_reward_type,
    referredRewardAmount: Number(row.referred_reward_amount || 0),
    firstOrderId: row.first_order_id,
    rewardGivenAt: row.reward_given_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

