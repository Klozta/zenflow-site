/**
 * Service de chiffrement des données sensibles
 * Basé sur recommandations Perplexity - Sécurité E-commerce 2025
 *
 * Utilise AES-256-CBC avec IV unique pour chaque chiffrement
 */

import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export class EncryptionService {
  private masterKey: Buffer;

  constructor(masterKey?: string) {
    // Clé depuis variable d'environnement ou secrets manager
    const keyHex = masterKey || process.env.MASTER_ENCRYPTION_KEY;

    if (!keyHex) {
      throw new Error('MASTER_ENCRYPTION_KEY must be set in environment variables');
    }

    // Vérifier que la clé fait exactement 32 bytes (64 hex chars)
    if (keyHex.length !== 64) {
      throw new Error('MASTER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
    }

    this.masterKey = Buffer.from(keyHex, 'hex');
  }

  /**
   * Chiffrer des données sensibles
   * Retourne: IV hexadécimal + encrypted data (concaténés avec :)
   */
  encrypt(plaintext: string): string {
    try {
      // Générer IV unique pour chaque chiffrement (16 bytes)
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', this.masterKey, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Stocker IV en préfixe (non-secret, nécessaire au déchiffrement)
      return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
      logger.error('Encryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Encryption failed');
    }
  }

  /**
   * Déchiffrer des données
   */
  decrypt(ciphertext: string): string {
    try {
      const [ivHex, encryptedHex] = ciphertext.split(':');

      if (!ivHex || !encryptedHex) {
        throw new Error('Invalid ciphertext format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.masterKey, iv);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption failed', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Decryption failed');
    }
  }

  /**
   * Chiffrer un objet (utile pour chiffrer plusieurs champs)
   */
  encryptObject(data: Record<string, string>): Record<string, string> {
    const encrypted: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      encrypted[key] = this.encrypt(value);
    }

    return encrypted;
  }

  /**
   * Déchiffrer un objet
   */
  decryptObject(data: Record<string, string>): Record<string, string> {
    const decrypted: Record<string, string> = {};

    for (const [key, value] of Object.entries(data)) {
      decrypted[key] = this.decrypt(value);
    }

    return decrypted;
  }
}

// Singleton avec clé depuis env
let encryptionServiceInstance: EncryptionService | null = null;

/**
 * Obtenir l'instance du service de chiffrement
 */
export function getEncryptionService(): EncryptionService {
  if (!encryptionServiceInstance) {
    encryptionServiceInstance = new EncryptionService();
  }
  return encryptionServiceInstance;
}

/**
 * Générer une nouvelle clé de chiffrement (pour rotation)
 * Usage: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
export function generateMasterKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

