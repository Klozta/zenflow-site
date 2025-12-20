/**
 * Helpers de validation et sanitization
 * Fonctions utilitaires pour valider et nettoyer les données
 */

/**
 * Normaliser une chaîne de recherche pour full-text search
 * Échappe les caractères spéciaux et limite la longueur
 */
export function normalizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Limiter la longueur
  let normalized = query.trim().slice(0, 100);

  // Échapper les caractères spéciaux PostgreSQL
  normalized = normalized.replace(/[!&|():*]/g, ' ');

  // Supprimer les espaces multiples
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Valider et normaliser un email
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }

  return email.toLowerCase().trim();
}

/**
 * Valider et normaliser un UUID
 */
export function validateUUID(uuid: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuid || !uuidRegex.test(uuid)) {
    throw new Error('Invalid UUID format');
  }

  return uuid.toLowerCase();
}

/**
 * Sanitizer HTML basique (pour descriptions produits)
 */
export function sanitizeHTML(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Supprimer les balises script et style
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Limiter la longueur
  sanitized = sanitized.slice(0, 10000);

  return sanitized;
}

/**
 * Valider un prix avec arrondi
 */
export function normalizePrice(price: number): number {
  if (typeof price !== 'number' || isNaN(price)) {
    throw new Error('Price must be a number');
  }

  if (price < 0) {
    throw new Error('Price cannot be negative');
  }

  if (price > 999999.99) {
    throw new Error('Price too high');
  }

  // Arrondir à 2 décimales
  return Math.round(price * 100) / 100;
}

/**
 * Valider et normaliser un code postal français
 */
export function normalizePostalCode(code: string): string {
  if (!code || typeof code !== 'string') {
    throw new Error('Postal code is required');
  }

  // Supprimer les espaces et garder seulement les chiffres
  const normalized = code.replace(/\s/g, '');

  // Valider format français (5 chiffres)
  if (!/^\d{5}$/.test(normalized)) {
    throw new Error('Invalid French postal code format (must be 5 digits)');
  }

  return normalized;
}

/**
 * Valider et normaliser un numéro de téléphone français
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Phone number is required');
  }

  // Supprimer les espaces, tirets, points
  let normalized = phone.replace(/[\s\-\.]/g, '');

  // Ajouter le préfixe +33 si nécessaire
  if (normalized.startsWith('0')) {
    normalized = '+33' + normalized.substring(1);
  } else if (!normalized.startsWith('+33')) {
    normalized = '+33' + normalized;
  }

  // Valider format (10 chiffres après +33)
  if (!/^\+33\d{9}$/.test(normalized)) {
    throw new Error('Invalid French phone number format');
  }

  return normalized;
}

/**
 * Générer un slug depuis un titre
 */
export function generateSlug(title: string): string {
  if (!title || typeof title !== 'string') {
    return '';
  }

  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprimer accents
    .replace(/[^a-z0-9]+/g, '-') // Remplacer non-alphanum par tirets
    .replace(/^-+|-+$/g, '') // Supprimer tirets en début/fin
    .slice(0, 100); // Limiter longueur
}





