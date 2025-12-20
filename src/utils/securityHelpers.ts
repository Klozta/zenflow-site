/**
 * Helpers de sécurité
 * Fonctions utilitaires pour la sécurité et la validation
 */

/**
 * Masquer des données sensibles dans les logs
 */
export function maskSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'refreshToken',
    'authorization',
    'creditCard',
    'cvv',
  ];

  const masked = { ...data };

  for (const key in masked) {
    const lowerKey = key.toLowerCase();

    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      masked[key] = '[REDACTED]';
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }

  return masked;
}

/**
 * Valider une URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Valider un email
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Générer un token aléatoire sécurisé
 */
export function generateSecureToken(length: number = 32): string {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Vérifier la force d'un mot de passe
 */
export function checkPasswordStrength(password: string): {
  score: number; // 0-4
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else feedback.push('Le mot de passe doit contenir au moins 8 caractères');

  if (/[a-z]/.test(password)) score++;
  else feedback.push('Ajoutez des minuscules');

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('Ajoutez des majuscules');

  if (/[0-9]/.test(password)) score++;
  else feedback.push('Ajoutez des chiffres');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else feedback.push('Ajoutez des caractères spéciaux');

  return { score, feedback };
}

/**
 * Sanitizer pour prévenir XSS (amélioré)
 */
export function sanitizeInput(input: string, maxLength: number = 10000): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Limiter la longueur d'abord
  let sanitized = input.substring(0, maxLength);

  // Supprimer les balises HTML
  sanitized = sanitized.replace(/<[^>]*>/g, '');

  // Échapper les caractères HTML
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  // Supprimer les caractères de contrôle
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  return sanitized.trim();
}

/**
 * Valide qu'une chaîne ne contient pas de code JavaScript dangereux
 */
export function isSafeString(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Détecter les patterns JavaScript dangereux
  const dangerousPatterns = [
    /javascript:/i,
    /on\w+\s*=/i, // onclick=, onerror=, etc.
    /<script/i,
    /<\/script>/i,
    /eval\(/i,
    /expression\(/i,
    /vbscript:/i,
    /data:text\/html/i,
  ];

  return !dangerousPatterns.some(pattern => pattern.test(text));
}
