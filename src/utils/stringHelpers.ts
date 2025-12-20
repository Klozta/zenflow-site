/**
 * Helpers pour manipulation de chaînes
 * Fonctions utilitaires pour formater et transformer les strings
 */

/**
 * Tronquer une chaîne avec ellipsis
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitaliser la première lettre
 */
export function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Formater un prix en euros
 */
export function formatPrice(price: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
  }).format(price);
}

/**
 * Formater une date
 */
export function formatDate(date: string | Date, locale: string = 'fr-FR'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dateObj);
}

/**
 * Formater une date relative (il y a X jours)
 */
export function formatRelativeDate(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `Il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `Il y a ${months} mois`;
  }
  const years = Math.floor(diffDays / 365);
  return `Il y a ${years} an${years > 1 ? 's' : ''}`;
}

/**
 * Nettoyer et normaliser un texte
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ') // Espaces multiples -> un seul
    .replace(/[\r\n]+/g, ' ') // Retours à la ligne -> espace
    .trim();
}

/**
 * Extraire les mots-clés d'un texte
 */
export function extractKeywords(text: string, minLength: number = 3): string[] {
  if (!text) return [];

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Supprimer ponctuation
    .split(/\s+/)
    .filter(word => word.length >= minLength);

  // Retourner les mots uniques
  return [...new Set(words)];
}

/**
 * Masquer une partie d'un email
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;

  const [local, domain] = email.split('@');
  if (local.length <= 2) return email;

  const masked = local.slice(0, 2) + '***' + local.slice(-1);
  return `${masked}@${domain}`;
}

/**
 * Masquer une partie d'un numéro de téléphone
 */
export function maskPhone(phone: string): string {
  if (!phone) return '';

  // Garder les 2 premiers et 2 derniers chiffres
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;

  return phone.slice(0, 2) + '***' + phone.slice(-2);
}





