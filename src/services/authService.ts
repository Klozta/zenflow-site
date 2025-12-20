// backend/src/services/authService.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getSecret } from '../config/secrets.js';
import { supabase } from '../config/supabase.js';
import {
    JwtPayload,
    RefreshTokenRecord,
    User,
    UserWithPassword
} from '../types/auth.types.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Hash password with bcrypt (10 rounds)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Compare plain password with hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate JWT access token (15min)
 */
export function generateAccessToken(userId: string): string {
  const secret = getSecret('JWT_SECRET');
  return jwt.sign(
    { userId, type: 'access' },
    secret,
    { expiresIn: '15m' }
  );
}

/**
 * Generate JWT refresh token (7 days)
 */
export function generateRefreshToken(userId: string): string {
  const secret = getSecret('JWT_REFRESH_SECRET');
  return jwt.sign(
    { userId, type: 'refresh' },
    secret,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT access token
 */
export function verifyAccessToken(token: string): { userId: string } | null {
  try {
    const secret = getSecret('JWT_SECRET');
    const decoded = jwt.verify(token, secret) as JwtPayload;
    if (decoded.type !== 'access') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

/**
 * Verify JWT refresh token
 */
export function verifyRefreshToken(token: string): { userId: string } | null {
  try {
    const secret = getSecret('JWT_REFRESH_SECRET');
    const decoded = jwt.verify(token, secret) as JwtPayload;
    if (decoded.type !== 'refresh') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

/**
 * Create new user in Supabase
 */
export async function createUser(
  email: string,
  passwordHash: string,
  name: string
): Promise<{ id: string; email: string; name: string }> {
  const { data, error } = await supabase
    .from('users')
    .insert({ email, password_hash: passwordHash, name })
    .select('id, email, name')
    .single();

  if (error) {
    logger.error('Failed to create user', new Error(error.message), { email });
    // Vérifier si c'est une erreur de contrainte unique (email déjà utilisé)
    if (error.code === '23505' || error.message.includes('duplicate') || error.message.includes('unique')) {
      throw createError.conflict('Cet email est déjà utilisé');
    }
    throw createError.database(`Erreur lors de la création de l'utilisateur: ${error.message}`, new Error(error.message));
  }
  if (!data) {
    logger.error('User creation returned no data', new Error('No data returned'), { email });
    throw createError.database('Échec de la création de l\'utilisateur');
  }

  logger.info('User created successfully', { userId: data.id, email: data.email });
  return data;
}

/**
 * Find user by email (with password)
 */
export async function findUserByEmail(email: string): Promise<UserWithPassword | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, password_hash')
    .eq('email', email)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Find user by ID (without password)
 */
export async function findUserById(id: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, created_at')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Save refresh token to database
 */
export async function saveRefreshToken(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id: userId,
      token,
      expires_at: expiresAt.toISOString()
    });

  if (error) throw new Error(`Failed to save refresh token: ${error.message}`);
}

/**
 * Find refresh token in database
 */
export async function findRefreshToken(token: string): Promise<RefreshTokenRecord | null> {
  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('token', token)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Revoke refresh token (soft delete)
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true })
    .eq('token', token);

  if (error) throw new Error(`Failed to revoke token: ${error.message}`);
}

/**
 * Delete refresh token (hard delete)
 */
export async function deleteRefreshToken(token: string): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .delete()
    .eq('token', token);

  if (error) throw new Error(`Failed to delete token: ${error.message}`);
}

/**
 * Find all active refresh tokens for a user
 */
export async function findRefreshTokensByUserId(userId: string): Promise<RefreshTokenRecord[]> {
  const { data, error } = await supabase
    .from('refresh_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('is_revoked', false)
    .gt('expires_at', new Date().toISOString());

  if (error) throw new Error(`Failed to find tokens: ${error.message}`);
  return data || [];
}

/**
 * Revoke all tokens for a user (security measure - token reuse detection)
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  const { error } = await supabase
    .from('refresh_tokens')
    .update({ is_revoked: true })
    .eq('user_id', userId)
    .eq('is_revoked', false);

  if (error) throw new Error(`Failed to revoke tokens: ${error.message}`);
}
