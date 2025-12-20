/**
 * Configuration et validation des secrets
 * Vérifie que tous les secrets requis sont présents et sécurisés
 */

/**
 * Liste des secrets requis
 */
const REQUIRED_SECRETS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'UPSTASH_REDIS_URL',
  'UPSTASH_REDIS_TOKEN',
  'ADMIN_TOKEN',        // ISR on-demand revalidation
  'REVALIDATE_SECRET',  // ISR on-demand revalidation
] as const;

// Secrets optionnels (features) gérés directement dans le code (pas besoin de constante)
// - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: nécessaires uniquement si /api/payments est utilisé

/**
 * Vérifie qu'un secret respecte les critères de sécurité
 */
function validateSecretStrength(key: string, value: string, minLength: number = 32): void {
  if (value.length < minLength) {
    throw new Error(
      `Secret ${key} must be at least ${minLength} characters long. Current length: ${value.length}`
    );
  }

  // Vérifier qu'il n'est pas la valeur par défaut
  if (value.includes('your_') || value.includes('here')) {
    throw new Error(`Secret ${key} appears to be a placeholder. Please set a real value.`);
  }
}

/**
 * Génère un secret fort aléatoire
 */
export function generateSecret(length: number = 64): string {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Valide tous les secrets requis au démarrage
 * @throws Error si des secrets sont manquants ou invalides
 */
export function validateSecrets(): void {
  const missing: string[] = [];
  const invalid: string[] = [];

  // Vérifier secrets requis
  for (const key of REQUIRED_SECRETS) {
    const value = process.env[key];

    if (!value) {
      missing.push(key);
      continue;
    }

    // Validation spécifique selon le secret
    if (key === 'JWT_SECRET' || key === 'JWT_REFRESH_SECRET' ||
        key === 'ADMIN_TOKEN' || key === 'REVALIDATE_SECRET') {
      try {
        validateSecretStrength(key, value, 32);
      } catch (error) {
        invalid.push(`${key}: ${(error as Error).message}`);
      }
    }

    // Vérifier que SUPABASE_URL est une URL valide
    if (key === 'SUPABASE_URL') {
      // En mode développement, permettre les placeholders pour permettre le démarrage
      if ((process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) && (value.includes('your_') || value.includes('here'))) {
        console.warn(`⚠️  Warning: ${key} contient un placeholder. Le backend démarrera mais Supabase ne fonctionnera pas.`);
        continue; // Skip validation pour permettre le démarrage
      }
      try {
        new URL(value);
      } catch {
        invalid.push(`${key}: Invalid URL format`);
      }
    }

    // Même chose pour SUPABASE_KEY
    if (key === 'SUPABASE_KEY') {
      if ((process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) && (value.includes('your_') || value.includes('here'))) {
        console.warn(`⚠️  Warning: ${key} contient un placeholder. Le backend démarrera mais Supabase ne fonctionnera pas.`);
        continue;
      }
    }
  }

  // Erreurs
  if (missing.length > 0) {
    throw new Error(
      `Missing required secrets: ${missing.join(', ')}\n` +
      `Please add them to your .env file. See .env.template for reference.`
    );
  }

  if (invalid.length > 0) {
    throw new Error(`Invalid secrets:\n${invalid.join('\n')}`);
  }

  console.log('✅ All secrets validated successfully');
}

/**
 * Récupère un secret avec validation
 */
export function getSecret(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;

  if (!value) {
    throw new Error(`Secret ${key} is not set and no default value provided`);
  }

  return value;
}

/**
 * Récupère un secret optionnel
 */
export function getOptionalSecret(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}
