/**
 * Service de gamification - Badges, Points, Niveaux, Challenges
 * Système d'engagement utilisateur avec récompenses
 */

import { supabase } from '../config/supabase.js';
import { handleServiceError } from '../utils/errorHandlers.js';
import { logger } from '../utils/logger.js';

export type BadgeType =
  | 'first_order'
  | 'power_buyer'
  | 'early_bird'
  | 'reviewer'
  | 'social_sharer'
  | 'loyal_customer'
  | 'trend_setter'
  | 'collector'
  | 'explorer'
  | 'vip';

export interface Badge {
  id: string;
  type: BadgeType;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  points: number;
  unlockedAt?: string;
}

export interface UserGamification {
  userId: string;
  totalPoints: number;
  level: number;
  currentLevelPoints: number;
  nextLevelPoints: number;
  badges: Badge[];
  achievements: Achievement[];
  rank: number;
  streak: number; // Jours consécutifs
  lastActivityDate?: string;
}

export interface Achievement {
  id: string;
  type: string;
  name: string;
  description: string;
  progress: number;
  target: number;
  completed: boolean;
  completedAt?: string;
  reward?: {
    points: number;
    badge?: BadgeType;
  };
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  type: 'daily' | 'weekly' | 'monthly' | 'special';
  startDate: string;
  endDate: string;
  target: number;
  reward: {
    points: number;
    badge?: BadgeType;
  };
  participants: number;
}

/**
 * Service de gamification
 */
export class GamificationService {
  private readonly POINTS_PER_LEVEL = 1000; // Points nécessaires par niveau
  private readonly BADGES: Record<BadgeType, Omit<Badge, 'id' | 'unlockedAt'>> = {
    first_order: {
      type: 'first_order',
      name: 'Premier Achat',
      description: 'Effectuez votre première commande',
      icon: '🎉',
      rarity: 'common',
      points: 100,
    },
    power_buyer: {
      type: 'power_buyer',
      name: 'Acheteur Assidu',
      description: 'Effectuez 10 commandes',
      icon: '💪',
      rarity: 'rare',
      points: 500,
    },
    early_bird: {
      type: 'early_bird',
      name: 'Lève-tôt',
      description: 'Commandez avant 10h du matin',
      icon: '🌅',
      rarity: 'common',
      points: 150,
    },
    reviewer: {
      type: 'reviewer',
      name: 'Critique',
      description: 'Laissez 5 avis sur des produits',
      icon: '⭐',
      rarity: 'rare',
      points: 300,
    },
    social_sharer: {
      type: 'social_sharer',
      name: 'Influenceur',
      description: 'Partagez 3 produits sur les réseaux sociaux',
      icon: '📱',
      rarity: 'epic',
      points: 400,
    },
    loyal_customer: {
      type: 'loyal_customer',
      name: 'Client Fidèle',
      description: 'Commandez chaque mois pendant 3 mois',
      icon: '💎',
      rarity: 'epic',
      points: 750,
    },
    trend_setter: {
      type: 'trend_setter',
      name: 'Tendance',
      description: 'Achetez un produit trending',
      icon: '🔥',
      rarity: 'rare',
      points: 250,
    },
    collector: {
      type: 'collector',
      name: 'Collectionneur',
      description: 'Ajoutez 20 produits à votre wishlist',
      icon: '📦',
      rarity: 'rare',
      points: 350,
    },
    explorer: {
      type: 'explorer',
      name: 'Explorateur',
      description: 'Visitez 50 pages produits différents',
      icon: '🗺️',
      rarity: 'common',
      points: 200,
    },
    vip: {
      type: 'vip',
      name: 'VIP',
      description: 'Atteignez le niveau 10',
      icon: '👑',
      rarity: 'legendary',
      points: 2000,
    },
  };

  /**
   * Récupère le profil de gamification d'un utilisateur
   */
  async getUserGamification(userId: string): Promise<UserGamification> {
    try {
      // Récupérer les données de gamification depuis la DB
      const { data: gamification, error } = await supabase
        .from('user_gamification')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = not found, on crée le profil
        throw error;
      }

      // Si pas de profil, créer un nouveau
      if (!gamification) {
        return await this.createUserGamification(userId);
      }

      // Calculer le niveau actuel
      const level = Math.floor(gamification.total_points / this.POINTS_PER_LEVEL) + 1;
      const currentLevelPoints = gamification.total_points % this.POINTS_PER_LEVEL;
      const nextLevelPoints = this.POINTS_PER_LEVEL - currentLevelPoints;

      // Récupérer les badges
      const badges = await this.getUserBadges(userId);

      // Récupérer les achievements
      const achievements = await this.getUserAchievements(userId);

      // Calculer le rank
      const rank = await this.getUserRank(userId);

      // Calculer la streak
      const streak = await this.calculateStreak(userId);

      return {
        userId,
        totalPoints: gamification.total_points || 0,
        level,
        currentLevelPoints,
        nextLevelPoints,
        badges,
        achievements,
        rank,
        streak,
        lastActivityDate: gamification.last_activity_date,
      };
    } catch (error) {
      throw handleServiceError(error, 'getUserGamification', 'Erreur récupération gamification');
    }
  }

  /**
   * Crée un nouveau profil de gamification
   */
  private async createUserGamification(userId: string): Promise<UserGamification> {
    const { error } = await supabase.from('user_gamification').insert({
      user_id: userId,
      total_points: 0,
      level: 1,
      last_activity_date: new Date().toISOString(),
    });

    if (error) {
      throw handleServiceError(error, 'createUserGamification', 'Erreur création profil gamification');
    }

    return {
      userId,
      totalPoints: 0,
      level: 1,
      currentLevelPoints: 0,
      nextLevelPoints: this.POINTS_PER_LEVEL,
      badges: [],
      achievements: [],
      rank: 0,
      streak: 0,
    };
  }

  /**
   * Ajoute des points à un utilisateur
   */
  async addPoints(userId: string, points: number, reason: string): Promise<number> {
    try {
      // Récupérer le profil actuel
      const { data: current, error: fetchError } = await supabase
        .from('user_gamification')
        .select('total_points')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      const currentPoints = current?.total_points || 0;
      const newPoints = currentPoints + points;

      // Mettre à jour les points
      const { error: updateError } = await supabase
        .from('user_gamification')
        .upsert(
          {
            user_id: userId,
            total_points: newPoints,
            last_activity_date: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (updateError) {
        throw updateError;
      }

      // Logger l'événement
      await supabase.from('gamification_events').insert({
        user_id: userId,
        event_type: 'points_earned',
        points,
        reason,
        total_points: newPoints,
      });

      // Vérifier les badges à débloquer
      await this.checkAndUnlockBadges(userId, newPoints);

      logger.info('Points ajoutés', { userId, points, reason, newTotal: newPoints });

      return newPoints;
    } catch (error) {
      throw handleServiceError(error, 'addPoints', 'Erreur ajout points');
    }
  }

  /**
   * Débloque un badge pour un utilisateur
   */
  async unlockBadge(userId: string, badgeType: BadgeType): Promise<Badge> {
    try {
      // Vérifier si le badge existe déjà
      const { data: existing } = await supabase
        .from('user_badges')
        .select('*')
        .eq('user_id', userId)
        .eq('badge_type', badgeType)
        .single();

      if (existing) {
        // Badge déjà débloqué
        const badgeDef = this.BADGES[badgeType];
        return {
          id: existing.id,
          ...badgeDef,
          unlockedAt: existing.unlocked_at,
        };
      }

      // Débloquer le badge
      const badgeDef = this.BADGES[badgeType];
      const { data: newBadge, error } = await supabase
        .from('user_badges')
        .insert({
          user_id: userId,
          badge_type: badgeType,
          unlocked_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Ajouter les points du badge
      if (badgeDef.points > 0) {
        await this.addPoints(userId, badgeDef.points, `Badge: ${badgeDef.name}`);
      }

      // Logger l'événement
      await supabase.from('gamification_events').insert({
        user_id: userId,
        event_type: 'badge_unlocked',
        badge_type: badgeType,
        points: badgeDef.points,
      });

      logger.info('Badge débloqué', { userId, badgeType, badgeName: badgeDef.name });

      return {
        id: newBadge.id,
        ...badgeDef,
        unlockedAt: newBadge.unlocked_at,
      };
    } catch (error) {
      throw handleServiceError(error, 'unlockBadge', 'Erreur déblocage badge');
    }
  }

  /**
   * Vérifie et débloque automatiquement les badges
   */
  private async checkAndUnlockBadges(userId: string, totalPoints: number): Promise<void> {
    // Badge VIP (niveau 10)
    if (totalPoints >= this.POINTS_PER_LEVEL * 10) {
      await this.unlockBadge(userId, 'vip').catch(() => {
        // Ignorer si déjà débloqué
      });
    }
  }

  /**
   * Récupère les badges d'un utilisateur
   */
  private async getUserBadges(userId: string): Promise<Badge[]> {
    const { data: userBadges, error } = await supabase
      .from('user_badges')
      .select('*')
      .eq('user_id', userId)
      .order('unlocked_at', { ascending: false });

    if (error) {
      logger.warn('Erreur récupération badges', { error, userId });
      return [];
    }

    return (userBadges || []).map((ub: any) => {
      const badgeDef = this.BADGES[ub.badge_type as BadgeType];
      return {
        id: ub.id,
        ...badgeDef,
        unlockedAt: ub.unlocked_at,
      };
    });
  }

  /**
   * Récupère les achievements d'un utilisateur
   */
  private async getUserAchievements(userId: string): Promise<Achievement[]> {
    // Récupérer les statistiques utilisateur
    const [ordersCount, reviewsCount, wishlistCount] = await Promise.all([
      this.getUserOrdersCount(userId),
      this.getUserReviewsCount(userId),
      this.getUserWishlistCount(userId),
    ]);

    const achievements: Achievement[] = [
      {
        id: 'first_order',
        type: 'orders',
        name: 'Premier Achat',
        description: 'Effectuez votre première commande',
        progress: Math.min(ordersCount, 1),
        target: 1,
        completed: ordersCount >= 1,
      },
      {
        id: 'power_buyer',
        type: 'orders',
        name: 'Acheteur Assidu',
        description: 'Effectuez 10 commandes',
        progress: ordersCount,
        target: 10,
        completed: ordersCount >= 10,
        reward: { points: 500, badge: 'power_buyer' },
      },
      {
        id: 'reviewer',
        type: 'reviews',
        name: 'Critique',
        description: 'Laissez 5 avis',
        progress: reviewsCount,
        target: 5,
        completed: reviewsCount >= 5,
        reward: { points: 300, badge: 'reviewer' },
      },
      {
        id: 'collector',
        type: 'wishlist',
        name: 'Collectionneur',
        description: 'Ajoutez 20 produits à votre wishlist',
        progress: wishlistCount,
        target: 20,
        completed: wishlistCount >= 20,
        reward: { points: 350, badge: 'collector' },
      },
    ];

    return achievements;
  }

  /**
   * Récupère le classement d'un utilisateur
   */
  private async getUserRank(userId: string): Promise<number> {
    const { data: allUsers, error } = await supabase
      .from('user_gamification')
      .select('user_id, total_points')
      .order('total_points', { ascending: false });

    if (error || !allUsers) {
      return 0;
    }

    const userIndex = allUsers.findIndex((u: any) => u.user_id === userId);
    return userIndex >= 0 ? userIndex + 1 : 0;
  }

  /**
   * Calcule la streak (jours consécutifs)
   */
  private async calculateStreak(userId: string): Promise<number> {
    const { data: events, error } = await supabase
      .from('gamification_events')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error || !events || events.length === 0) {
      return 0;
    }

    // Calculer la streak en vérifiant les jours consécutifs
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < events.length; i++) {
      const eventDate = new Date(events[i].created_at);
      eventDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.floor((today.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff === streak) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  /**
   * Récupère le leaderboard
   */
  async getLeaderboard(limit = 10): Promise<Array<{ userId: string; points: number; level: number; rank: number }>> {
    try {
      const { data, error } = await supabase
        .from('user_gamification')
        .select('user_id, total_points')
        .order('total_points', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return (data || []).map((user: any, index: number) => ({
        userId: user.user_id,
        points: user.total_points || 0,
        level: Math.floor((user.total_points || 0) / this.POINTS_PER_LEVEL) + 1,
        rank: index + 1,
      }));
    } catch (error) {
      throw handleServiceError(error, 'getLeaderboard', 'Erreur récupération leaderboard');
    }
  }

  /**
   * Récupère les challenges actifs
   */
  async getActiveChallenges(): Promise<Challenge[]> {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('challenges')
        .select('*')
        .gte('end_date', now)
        .lte('start_date', now)
        .order('end_date', { ascending: true });

      if (error) {
        throw error;
      }

      return (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
        startDate: c.start_date,
        endDate: c.end_date,
        target: c.target,
        reward: c.reward,
        participants: c.participants || 0,
      }));
    } catch (error) {
      throw handleServiceError(error, 'getActiveChallenges', 'Erreur récupération challenges');
    }
  }

  // Helpers pour statistiques
  private async getUserOrdersCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return error ? 0 : count || 0;
  }

  private async getUserReviewsCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('reviews')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return error ? 0 : count || 0;
  }

  private async getUserWishlistCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('wishlist')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    return error ? 0 : count || 0;
  }
}

// Instance singleton
export const gamificationService = new GamificationService();

