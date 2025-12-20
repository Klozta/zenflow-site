/**
 * Mode "catalogue légal" (anti-dropshipping / anti-scraping risqué)
 *
 * Objectif:
 * - En production, bloquer par défaut les features qui:
 *   - crawls HTML de marketplaces
 *   - importent des produits depuis des URLs externes
 *   - proposent du "trending" marketplace
 *
 * Activation:
 * - Par défaut: activé en production (fail-safe)
 * - Override: LEGAL_CATALOG_MODE=false (uniquement si tu assumes le risque)
 */

export function isLegalCatalogModeEnabled(): boolean {
  const raw = (process.env.LEGAL_CATALOG_MODE || '').toLowerCase().trim();

  // Permet un override explicite
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === '1' || raw === 'on') return true;

  // Fail-safe: ON en production
  return process.env.NODE_ENV === 'production';
}

