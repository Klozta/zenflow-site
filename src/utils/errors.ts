/**
 * Types d'erreurs personnalisées pour l'application
 * Améliore la gestion d'erreurs avec des types spécifiques
 */

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public fields?: Record<string, string>) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, 'DATABASE_ERROR');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}

/**
 * Helper pour créer des erreurs rapidement
 */
export const createError = {
  validation: (message: string, fields?: Record<string, string>) =>
    new ValidationError(message, fields),

  badRequest: (message: string) =>
    new ValidationError(message),

  auth: (message?: string) =>
    new AuthenticationError(message),

  forbidden: (message?: string) =>
    new AuthorizationError(message),

  notFound: (resource?: string) =>
    new NotFoundError(resource),

  conflict: (message: string) =>
    new ConflictError(message),

  rateLimit: (message?: string) =>
    new RateLimitError(message),

  database: (message: string, originalError?: Error) =>
    new DatabaseError(message, originalError),

  externalService: (service: string, message: string) =>
    new ExternalServiceError(service, message),

  internal: (message: string) =>
    new AppError(message, 500, 'INTERNAL_ERROR'),
};
