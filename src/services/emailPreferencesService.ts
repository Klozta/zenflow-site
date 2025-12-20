/**
 * Service de gestion des préférences emails utilisateur
 */

import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

export interface EmailPreferences {
  id: string;
  user_id: string;
  order_confirmation: boolean;
  order_shipped: boolean;
  order_delivered: boolean;
  abandoned_cart: boolean;
  newsletter: boolean;
  promotions: boolean;
  product_recommendations: boolean;
  loyalty_updates: boolean;
  frequency: 'immediate' | 'daily' | 'weekly' | 'monthly' | 'never';
  created_at: string;
  updated_at: string;
}

export interface UpdateEmailPreferencesInput {
  order_confirmation?: boolean;
  order_shipped?: boolean;
  order_delivered?: boolean;
  abandoned_cart?: boolean;
  newsletter?: boolean;
  promotions?: boolean;
  product_recommendations?: boolean;
  loyalty_updates?: boolean;
  frequency?: 'immediate' | 'daily' | 'weekly' | 'monthly' | 'never';
}

/**
 * Obtenir ou créer les préférences emails d'un utilisateur
 */
export async function getOrCreateEmailPreferences(userId: string): Promise<EmailPreferences | null> {
  try {
    // Essayer de récupérer les préférences existantes
    const { data: existing, error: _fetchError } = await supabase
      .from('email_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existing) {
      return existing as EmailPreferences;
    }

    // Si pas trouvé, créer avec valeurs par défaut
    const { data: created, error: createError } = await supabase
      .from('email_preferences')
      .insert({
        user_id: userId,
        // Toutes les préférences activées par défaut
        order_confirmation: true,
        order_shipped: true,
        order_delivered: true,
        abandoned_cart: true,
        newsletter: true,
        promotions: true,
        product_recommendations: true,
        loyalty_updates: true,
        frequency: 'weekly',
      })
      .select()
      .single();

    if (createError) {
      logger.error('Erreur création préférences emails', createError, { userId });
      return null;
    }

    return created as EmailPreferences;
  } catch (error: any) {
    logger.error('Erreur récupération préférences emails', error, { userId });
    return null;
  }
}

/**
 * Mettre à jour les préférences emails
 */
export async function updateEmailPreferences(
  userId: string,
  preferences: UpdateEmailPreferencesInput
): Promise<EmailPreferences | null> {
  try {
    // S'assurer que les préférences existent
    await getOrCreateEmailPreferences(userId);

    const { data, error } = await supabase
      .from('email_preferences')
      .update(preferences)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      logger.error('Erreur mise à jour préférences emails', error, { userId, preferences });
      return null;
    }

    return data as EmailPreferences;
  } catch (error: any) {
    logger.error('Erreur mise à jour préférences emails', error, { userId });
    return null;
  }
}

/**
 * Vérifier si un type d'email est autorisé pour un utilisateur
 */
export async function canSendEmail(
  userId: string,
  emailType: 'order_confirmation' | 'order_shipped' | 'order_delivered' | 'abandoned_cart' | 'newsletter' | 'promotions' | 'product_recommendations' | 'loyalty_updates'
): Promise<boolean> {
  try {
    const preferences = await getOrCreateEmailPreferences(userId);
    if (!preferences) {
      // Par défaut, autoriser si préférences non trouvées (fallback)
      return true;
    }

    return preferences[emailType] === true;
  } catch (error: any) {
    logger.error('Erreur vérification préférences email', error, { userId, emailType });
    // En cas d'erreur, autoriser par défaut pour ne pas bloquer les emails critiques
    return true;
  }
}

/**
 * Obtenir la fréquence d'envoi pour un utilisateur
 */
export async function getEmailFrequency(userId: string): Promise<'immediate' | 'daily' | 'weekly' | 'monthly' | 'never'> {
  try {
    const preferences = await getOrCreateEmailPreferences(userId);
    return preferences?.frequency || 'weekly';
  } catch (error: any) {
    logger.error('Erreur récupération fréquence email', error, { userId });
    return 'weekly';
  }
}

