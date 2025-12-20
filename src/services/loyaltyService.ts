/**
 * Service de fidélité - Points et récompenses
 */
import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export interface LoyaltyProfile {
  userId: string;
  totalPoints: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  pointsExpiring: number;
  nextTierPoints: number;
}

export interface LoyaltyTransaction {
  id: string;
  userId: string;
  points: number;
  type: 'earned' | 'redeemed' | 'expired';
  description: string;
  orderId?: string;
  createdAt: string;
  expiresAt?: string;
}

/**
 * Récupère ou crée le profil de fidélité d'un utilisateur
 */
export async function getOrCreateLoyaltyProfile(userId: string): Promise<LoyaltyProfile | null> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return null;
    }

    // Vérifier si le profil existe
    const { data: existing, error: checkError } = await supabase
      .from('loyalty_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (checkError && (checkError as any).code !== 'PGRST116') {
      // PGRST116 = not found, on peut créer
      logger.error('Erreur vérification profil fidélité', checkError);
      return null;
    }

    if (existing) {
      return {
        userId: existing.user_id,
        totalPoints: existing.total_points || 0,
        tier: existing.tier || 'bronze',
        pointsExpiring: existing.points_expiring || 0,
        nextTierPoints: calculateNextTierPoints(existing.total_points || 0),
      };
    }

    // Créer le profil
    const { data: created, error: createError } = await supabase
      .from('loyalty_profiles')
      .insert({
        user_id: userId,
        total_points: 0,
        tier: 'bronze',
        points_expiring: 0,
      })
      .select()
      .single();

    if (createError) {
      logger.error('Erreur création profil fidélité', createError);
      return null;
    }

    return {
      userId: created.user_id,
      totalPoints: 0,
      tier: 'bronze',
      pointsExpiring: 0,
      nextTierPoints: 100, // 100 points pour silver
    };
  } catch (error: any) {
    logger.error('Erreur getOrCreateLoyaltyProfile', error);
    return null;
  }
}

/**
 * Calcule les points nécessaires pour le prochain tier
 */
function calculateNextTierPoints(currentPoints: number): number {
  if (currentPoints < 100) return 100; // Bronze → Silver
  if (currentPoints < 500) return 500; // Silver → Gold
  if (currentPoints < 1000) return 1000; // Gold → Platinum
  return 0; // Déjà au max
}

/**
 * Ajoute des points de fidélité (non-bloquant)
 * 1 point = 1€ dépensé
 */
export async function addLoyaltyPoints(
  userId: string,
  orderId: string,
  orderTotal: number,
  description: string
): Promise<boolean> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return false;
    }

    // Calculer les points (1€ = 1 point, arrondi)
    const points = Math.round(orderTotal);

    if (points <= 0) {
      return false;
    }

    // Date d'expiration : 1 an
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Créer la transaction
    const { error: transactionError } = await supabase
      .from('loyalty_transactions')
      .insert({
        user_id: userId,
        order_id: orderId,
        points,
        type: 'earned',
        description,
        expires_at: expiresAt.toISOString(),
      });

    if (transactionError) {
      logger.error('Erreur création transaction fidélité', transactionError);
      return false;
    }

    // Mettre à jour le profil
    const profile = await getOrCreateLoyaltyProfile(userId);
    if (!profile) {
      return false;
    }

    const newTotalPoints = profile.totalPoints + points;
    const newTier = calculateTier(newTotalPoints);

    const { error: updateError } = await supabase
      .from('loyalty_profiles')
      .update({
        total_points: newTotalPoints,
        tier: newTier,
      })
      .eq('user_id', userId);

    if (updateError) {
      logger.error('Erreur mise à jour profil fidélité', updateError);
      return false;
    }

    logger.info('Points fidélité ajoutés', { userId, orderId, points, newTotalPoints });
    return true;
  } catch (error: any) {
    logger.error('Erreur addLoyaltyPoints', error);
    return false;
  }
}

/**
 * Calcule le tier basé sur les points
 */
function calculateTier(points: number): 'bronze' | 'silver' | 'gold' | 'platinum' {
  if (points >= 1000) return 'platinum';
  if (points >= 500) return 'gold';
  if (points >= 100) return 'silver';
  return 'bronze';
}

/**
 * Récupère les statistiques de fidélité
 */
export async function getLoyaltyStats(userId: string): Promise<{
  profile: LoyaltyProfile | null;
  nextTier: string;
  pointsToNextTier: number;
  pointsExpiringSoon: number;
}> {
  try {
    const profile = await getOrCreateLoyaltyProfile(userId);
    if (!profile) {
      return {
        profile: null,
        nextTier: 'silver',
        pointsToNextTier: 100,
        pointsExpiringSoon: 0,
      };
    }

    const nextTier = getNextTier(profile.tier);
    const pointsToNextTier = Math.max(0, profile.nextTierPoints - profile.totalPoints);

    // Calculer points expirant bientôt (dans 30 jours)
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);

    const { count } = await supabase
      .from('loyalty_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', 'earned')
      .lte('expires_at', soon.toISOString())
      .gt('expires_at', new Date().toISOString());

    return {
      profile,
      nextTier,
      pointsToNextTier,
      pointsExpiringSoon: count || 0,
    };
  } catch (error: any) {
    logger.error('Erreur getLoyaltyStats', error);
    return {
      profile: null,
      nextTier: 'silver',
      pointsToNextTier: 100,
      pointsExpiringSoon: 0,
    };
  }
}

/**
 * Récupère le prochain tier
 */
function getNextTier(currentTier: string): string {
  switch (currentTier) {
    case 'bronze': return 'silver';
    case 'silver': return 'gold';
    case 'gold': return 'platinum';
    default: return 'platinum';
  }
}

/**
 * Récupère l'historique des transactions
 */
export async function getLoyaltyHistory(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<LoyaltyTransaction[]> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return [];
    }

    const { data, error } = await supabase
      .from('loyalty_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Erreur récupération historique fidélité', error);
      return [];
    }

    return (data || []).map((t: any) => ({
      id: t.id,
      userId: t.user_id,
      points: t.points,
      type: t.type,
      description: t.description,
      orderId: t.order_id,
      createdAt: t.created_at,
      expiresAt: t.expires_at,
    }));
  } catch (error: any) {
    logger.error('Erreur getLoyaltyHistory', error);
    return [];
  }
}

/**
 * Utilise des points pour une réduction
 * 100 points = 1€ de réduction
 */
export async function redeemLoyaltyPoints(
  userId: string,
  points: number,
  orderId?: string,
  description?: string
): Promise<{ success: boolean; discountAmount: number; error?: string }> {
  try {
    if (!supabase || typeof supabase.from !== 'function') {
      return { success: false, discountAmount: 0, error: 'Service non disponible' };
    }

    const profile = await getOrCreateLoyaltyProfile(userId);
    if (!profile || profile.totalPoints < points) {
      return { success: false, discountAmount: 0, error: 'Points insuffisants' };
    }

    // Calculer la réduction (100 points = 1€)
    const discountAmount = points / 100;

    // Créer la transaction de rédemption
    const { error: transactionError } = await supabase
      .from('loyalty_transactions')
      .insert({
        user_id: userId,
        order_id: orderId,
        points: -points, // Négatif pour rédemption
        type: 'redeemed',
        description: description || `Rédemption de ${points} points`,
      });

    if (transactionError) {
      logger.error('Erreur rédemption points', transactionError);
      return { success: false, discountAmount: 0, error: 'Erreur transaction' };
    }

    // Mettre à jour le profil
    const newTotalPoints = profile.totalPoints - points;
    const { error: updateError } = await supabase
      .from('loyalty_profiles')
      .update({
        total_points: newTotalPoints,
        tier: calculateTier(newTotalPoints),
      })
      .eq('user_id', userId);

    if (updateError) {
      logger.error('Erreur mise à jour profil après rédemption', updateError);
      return { success: false, discountAmount: 0, error: 'Erreur mise à jour' };
    }

    return { success: true, discountAmount };
  } catch (error: any) {
    logger.error('Erreur redeemLoyaltyPoints', error);
    return { success: false, discountAmount: 0, error: error.message };
  }
}


