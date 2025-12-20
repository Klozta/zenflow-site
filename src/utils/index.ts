/**
 * Barrel export pour tous les utils
 * Facilite les imports
 */

// Cache
export * from './cache.js';
export * from './cacheInvalidation.js';

// Logging
export * from './logger.js';
export * from './logSanitizer.js';
export * from './securityLogger.js';
export * from './structuredLogger.js';

// Validation
export * from './validationHelpers.js';

// Performance
export * from './performance.js';

// Security
export * from './securityHelpers.js';

// Strings
export * from './stringHelpers.js';

// Dates
export * from './dateHelpers.js';

// Arrays
export * from './arrayHelpers.js';

// Rate limiting
export * from './rateLimiter.js';

// Retry
export * from './retry.js';

// Request
export * from './requestHelpers.js';

// Database
export * from './databaseHelpers.js';

// Encryption
export * from './encryptionHelpers.js';

// Email - Exporter seulement les fonctions uniques (éviter les doublons)
export {
  getEmailDomain,
  isTestEmail
} from './emailHelpers.js';
// Note: isValidEmail, normalizeEmail, maskEmail sont exportés depuis securityHelpers, stringHelpers, validationHelpers
// pour éviter les conflits, on ne les exporte pas depuis emailHelpers

// Metrics
export * from './metricsHelpers.js';

// Error Handlers
export * from './errorHandlers.js';

// Advanced utilities
export * from './advancedCache.js';
// Note: retryWithBackoff est exporté depuis performance.js, on exporte seulement les fonctions uniques depuis advancedRetry
export {
  CircuitBreaker, isRetryableError, RetryError
} from './advancedRetry.js';
