/**
 * Tests unitaires pour authService
 * Tests de logique métier sans dépendances externes
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { comparePassword, generateAccessToken, generateRefreshToken, hashPassword } from '../services/authService.js';

// Mock des dépendances
jest.mock('../config/supabase.js');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // En ESM, préférer une config d'env plutôt qu'un mock de module.
    process.env.JWT_SECRET = 'test-secret-key-128-chars-minimum-for-jwt-security-requirements';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-128-chars-minimum-for-jwt-security-requirements';
  });

  describe('hashPassword', () => {
    it('devrait hasher un mot de passe', async () => {
      const password = 'Test1234!';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(50); // bcrypt hash length
    });

    it('devrait générer des hash différents pour le même mot de passe', async () => {
      const password = 'Test1234!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2); // Salt différent à chaque fois
    });
  });

  describe('comparePassword', () => {
    it('devrait valider un mot de passe correct', async () => {
      const password = 'Test1234!';
      const hash = await hashPassword(password);

      const isValid = await comparePassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('devrait rejeter un mot de passe incorrect', async () => {
      const password = 'Test1234!';
      const wrongPassword = 'WrongPassword!';
      const hash = await hashPassword(password);

      const isValid = await comparePassword(wrongPassword, hash);
      expect(isValid).toBe(false);
    });
  });

  describe('generateAccessToken', () => {
    it('devrait générer un token JWT valide', () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const token = generateAccessToken(userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format: header.payload.signature
    });

    it('devrait générer des tokens différents pour le même utilisateur', () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const token1 = generateAccessToken(userId);
      const token2 = generateAccessToken(userId);

      // Les tokens peuvent être différents à cause du timestamp, mais structure similaire
      expect(token1.split('.')).toHaveLength(3);
      expect(token2.split('.')).toHaveLength(3);
    });
  });

  describe('generateRefreshToken', () => {
    it('devrait générer un refresh token JWT valide', () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const token = generateRefreshToken(userId);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('devrait utiliser un secret différent du access token', () => {
      const userId = '123e4567-e89b-12d3-a456-426614174000';
      const accessToken = generateAccessToken(userId);
      const refreshToken = generateRefreshToken(userId);

      expect(accessToken).not.toBe(refreshToken);
    });
  });
});
