/**
 * Helpers pour manipulation d'emails
 * Fonctions utilitaires pour valider et formater les emails
 */

/**
 * Valider un email
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Normaliser un email (lowercase, trim)
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }

  return email.toLowerCase().trim();
}

/**
 * Extraire le domaine d'un email
 */
export function getEmailDomain(email: string): string | null {
  if (!isValidEmail(email)) {
    return null;
  }

  return email.split('@')[1] || null;
}

/**
 * Masquer un email pour l'affichage
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) {
    return email;
  }

  const [local, domain] = email.split('@');

  if (local.length <= 2) {
    return email;
  }

  const masked = local.slice(0, 2) + '***' + local.slice(-1);
  return `${masked}@${domain}`;
}

/**
 * Vérifier si un email est un email de test/temporaire
 */
export function isTestEmail(email: string): boolean {
  const testDomains = [
    'example.com',
    'test.com',
    'mailinator.com',
    '10minutemail.com',
    'tempmail.com',
  ];

  const domain = getEmailDomain(email);
  return domain ? testDomains.includes(domain.toLowerCase()) : false;
}





