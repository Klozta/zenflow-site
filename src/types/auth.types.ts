// backend/src/types/auth.types.ts
import { Request } from 'express';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at?: string;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
  is_revoked: boolean;
}

export interface JwtPayload {
  userId: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  user: User & { created_at: string };
}

export interface RequestWithUser extends Request {
  user?: { id: string; role?: string };
}
