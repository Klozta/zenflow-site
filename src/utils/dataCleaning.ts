/**
 * Utilitaires de nettoyage et validation de données
 * Nettoie les données extraites du web scraping
 */

/**
 * Nettoie le texte HTML et les caractères spéciaux
 */
export function cleanText(text: string): string {
  if (!text) return '';
  
  return text
    // Supprimer les balises HTML
    .replace(/<[^>]*>/g, '')
    // Décoder les entités HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Supprimer les espaces multiples
    .replace(/\s+/g, ' ')
    // Supprimer les espaces en début/fin
    .trim()
    // Limiter la longueur
    .substring(0, 5000);
}

/**
 * Nettoie et normalise le titre
 */
export function cleanTitle(title: string): string {
  if (!title) return 'Produit sans titre';
  
  return cleanText(title)
    // Supprimer les caractères spéciaux indésirables
    .replace(/[^\w\s\-.,!?()]/g, '')
    // Limiter la longueur
    .substring(0, 255)
    .trim();
}

/**
 * Nettoie la description
 */
export function cleanDescription(description: string): string {
  if (!description) return '';
  
  return cleanText(description)
    // Supprimer les URLs
    .replace(/https?:\/\/[^\s]+/g, '')
    // Supprimer les emails
    .replace(/[^\s]+@[^\s]+/g, '')
    // Limiter la longueur
    .substring(0, 5000)
    .trim();
}

/**
 * Nettoie et normalise le prix
 */
export function cleanPrice(priceText: string | number): number {
  if (typeof priceText === 'number') {
    return Math.max(0, Math.round(priceText * 100) / 100);
  }

  if (!priceText) return 0;

  // Extraire les chiffres et le point/virgule
  const cleaned = String(priceText)
    .replace(/[^\d,.]/g, '')
    .replace(',', '.');

  const price = parseFloat(cleaned);
  
  if (isNaN(price) || price < 0) {
    return 0;
  }

  // Arrondir à 2 décimales
  return Math.round(price * 100) / 100;
}

/**
 * Nettoie les URLs d'images
 */
export function cleanImageUrl(url: string, baseUrl?: string): string | null {
  if (!url) return null;

  try {
    // Si l'URL est relative, la rendre absolue
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (url.startsWith('/') && baseUrl) {
      const base = new URL(baseUrl);
      url = `${base.origin}${url}`;
    } else if (!url.startsWith('http')) {
      if (baseUrl) {
        url = new URL(url, baseUrl).toString();
      } else {
        return null;
      }
    }

    // Vérifier que c'est une URL valide
    new URL(url);
    
    // Filtrer les URLs d'images invalides
    if (url.includes('data:image')) {
      return null; // Les images base64 sont trop grandes
    }

    // Vérifier l'extension
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const hasValidExtension = validExtensions.some(ext => 
      url.toLowerCase().includes(ext)
    );

    if (!hasValidExtension && !url.includes('?')) {
      // Si pas d'extension et pas de query string, probablement pas une image
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/**
 * Nettoie un tableau d'URLs d'images
 */
export function cleanImageUrls(urls: string[], baseUrl?: string): string[] {
  return urls
    .map(url => cleanImageUrl(url, baseUrl))
    .filter((url): url is string => url !== null)
    .slice(0, 10); // Limiter à 10 images max
}

/**
 * Nettoie et normalise la catégorie
 */
export function cleanCategory(category: string | null | undefined): string | null {
  if (!category) return null;

  return cleanText(category)
    .substring(0, 100)
    .trim() || null;
}

/**
 * Nettoie les tags
 */
export function cleanTags(tags: string[]): string[] {
  if (!Array.isArray(tags)) return [];

  return tags
    .map(tag => cleanText(tag).toLowerCase())
    .filter(tag => tag.length > 0 && tag.length <= 50)
    .filter((tag, index, self) => self.indexOf(tag) === index) // Dédupliquer
    .slice(0, 20); // Limiter à 20 tags
}

/**
 * Valide et nettoie toutes les données d'un produit
 */
export function cleanProductData(data: {
  title?: string;
  description?: string;
  price?: string | number;
  images?: string[];
  category?: string | null;
  tags?: string[];
  sourceUrl?: string;
}): {
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string | null;
  tags: string[];
} {
  return {
    title: cleanTitle(data.title || ''),
    description: cleanDescription(data.description || ''),
    price: cleanPrice(data.price || 0),
    images: cleanImageUrls(data.images || [], data.sourceUrl),
    category: cleanCategory(data.category),
    tags: cleanTags(data.tags || []),
  };
}

/**
 * Valide que les données sont complètes et cohérentes
 */
export function validateProductData(data: {
  title: string;
  price: number;
  images: string[];
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data.title || data.title.length < 3) {
    errors.push('Le titre doit contenir au moins 3 caractères');
  }

  if (data.price <= 0) {
    errors.push('Le prix doit être supérieur à 0');
  }

  if (data.price > 999999.99) {
    errors.push('Le prix est trop élevé (max: 999999.99€)');
  }

  if (data.images.length === 0) {
    errors.push('Au moins une image est requise');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}









