/**
 * Helpers pour le chiffrement de données sensibles
 * Basé sur recommandations Perplexity - Sécurité E-commerce 2025
 *
 * Note: Les emails ne sont PAS chiffrés car nécessaires pour :
 * - Authentification (login par email)
 * - Envoi d'emails (confirmations, etc.)
 * - Recherche utilisateurs
 *
 * Les données chiffrées: téléphones, adresses complètes
 */

import { getEncryptionService } from '../services/encryptionService.js';
import { logger } from './logger.js';

/**
 * Chiffrer un numéro de téléphone
 * Retourne la version chiffrée ou null si vide
 */
export function encryptPhone(phone: string | null | undefined): string | null {
  if (!phone || !phone.trim()) {
    return null;
  }

  try {
    const encryptor = getEncryptionService();
    return encryptor.encrypt(phone.trim());
  } catch (error) {
    logger.error('Failed to encrypt phone', error instanceof Error ? error : new Error(String(error)));
    // En cas d'erreur, ne pas stocker la donnée plutôt que de la laisser en clair
    throw error;
  }
}

/**
 * Déchiffrer un numéro de téléphone
 * Retourne la version déchiffrée ou null si vide
 */
export function decryptPhone(encryptedPhone: string | null | undefined): string | null {
  if (!encryptedPhone || !encryptedPhone.trim()) {
    return null;
  }

  try {
    const encryptor = getEncryptionService();
    return encryptor.decrypt(encryptedPhone);
  } catch (error) {
    logger.error('Failed to decrypt phone', error instanceof Error ? error : new Error(String(error)));
    // En cas d'erreur, retourner null plutôt que de crash
    return null;
  }
}

/**
 * Chiffrer une adresse complète (objet)
 * Utile pour les adresses de livraison
 */
export function encryptAddress(address: {
  street?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
} | null | undefined): string | null {
  if (!address) {
    return null;
  }

  // Filtrer les valeurs vides
  const cleanAddress = {
    street: address.street?.trim() || null,
    city: address.city?.trim() || null,
    postalCode: address.postalCode?.trim() || null,
    country: address.country?.trim() || null,
  };

  // Si toutes les valeurs sont vides, retourner null
  if (!cleanAddress.street && !cleanAddress.city && !cleanAddress.postalCode && !cleanAddress.country) {
    return null;
  }

  try {
    const encryptor = getEncryptionService();
    const addressJson = JSON.stringify(cleanAddress);
    return encryptor.encrypt(addressJson);
  } catch (error) {
    logger.error('Failed to encrypt address', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Déchiffrer une adresse complète
 */
export function decryptAddress(encryptedAddress: string | null | undefined): {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
} | null {
  if (!encryptedAddress || !encryptedAddress.trim()) {
    return null;
  }

  try {
    const encryptor = getEncryptionService();
    const decryptedJson = encryptor.decrypt(encryptedAddress);
    return JSON.parse(decryptedJson);
  } catch (error) {
    logger.error('Failed to decrypt address', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Chiffrer des données personnelles (pour future utilisation)
 * Permet de chiffrer plusieurs champs à la fois
 */
export function encryptPersonalData(data: Record<string, string | null | undefined>): Record<string, string | null> {
  const encrypted: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!value || !value.trim()) {
      encrypted[key] = null;
    } else {
      try {
        const encryptor = getEncryptionService();
        encrypted[key] = encryptor.encrypt(value.trim());
      } catch (error) {
        logger.error(`Failed to encrypt field ${key}`, error instanceof Error ? error : new Error(String(error)));
        encrypted[key] = null; // Ne pas stocker en cas d'erreur
      }
    }
  }

  return encrypted;
}

/**
 * Déchiffrer des données personnelles
 */
export function decryptPersonalData(encryptedData: Record<string, string | null | undefined>): Record<string, string | null> {
  const decrypted: Record<string, string | null> = {};

  for (const [key, value] of Object.entries(encryptedData)) {
    if (!value || !value.trim()) {
      decrypted[key] = null;
    } else {
      try {
        const encryptor = getEncryptionService();
        decrypted[key] = encryptor.decrypt(value);
      } catch (error) {
        logger.error(`Failed to decrypt field ${key}`, error instanceof Error ? error : new Error(String(error)));
        decrypted[key] = null;
      }
    }
  }

  return decrypted;
}

