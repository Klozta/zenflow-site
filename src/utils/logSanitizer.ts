/**
 * Sanitize data before logging to prevent sensitive information leakage
 */

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'creditcard',
  'credit_card',
  'cvv',
  'ssn',
  'social_security',
  'refresh_token',
  'access_token',
  // PII
  'email',
  'phone',
  'address',
  'postal',
  'city',
];

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikePhone(value: string): boolean {
  const cleaned = value.replace(/[^\d+]/g, '');
  return cleaned.length >= 10 && cleaned.length <= 15;
}

/**
 * Recursively sanitize object for logging
 */
export function sanitizeForLogging(data: any, depth: number = 0): any {
  if (depth > 10) return '[Max depth reached]'; // Prevent infinite recursion

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // PII patterns
    if (looksLikeEmail(data)) return '***REDACTED_EMAIL***';
    if (looksLikePhone(data)) return '***REDACTED_PHONE***';

    // Check if string looks like a token (long alphanumeric)
    if (data.length > 20 && /^[A-Za-z0-9_-]+$/.test(data)) {
      return '***REDACTED_TOKEN***';
    }
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeForLogging(item, depth + 1));
  }

  const sanitized: any = {};
  for (const key in data) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some(sensitive => lowerKey.includes(sensitive));

    if (isSensitive) {
      sanitized[key] = '***REDACTED***';
    } else {
      sanitized[key] = sanitizeForLogging(data[key], depth + 1);
    }
  }

  return sanitized;
}

/**
 * Sanitize error object for logging
 */
export function sanitizeError(error: any): any {
  if (!error) return error;

  const sanitized: any = {
    message: error.message,
    name: error.name,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  };

  if (error.response) {
    sanitized.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: sanitizeForLogging(error.response.data),
    };
  }

  return sanitized;
}
