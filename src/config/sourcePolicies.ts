/**
 * Policies par source (CGU / autorisation) — conformité "by design".
 *
 * Objectif: éviter le "scraping par défaut".
 * - Par défaut: HTML crawl interdit si CGU inconnues.
 * - API tier-1 recommandé quand disponible.
 */

export type CguStatus = 'allowed' | 'forbidden' | 'unknown';

export interface SourcePolicy {
  /** Host exact (ex: "www.aliexpress.com") ou suffixe (ex: ".aliexpress.com"). */
  hostPattern: string;
  /** URL interne vers la page CGU/robots de référence (info, pas un contrôle automatique). */
  cguUrl?: string;
  /** Statut de validation interne des CGU (à mettre à jour manuellement). */
  cguStatus: CguStatus;
  /** Autoriser crawling HTML (fallback) si robots OK + rate-limit OK. */
  allowHtmlCrawl: boolean;
  /** Forcer l'utilisation d'une API (si disponible) — bloque HTML même en permissive. */
  apiOnly: boolean;
  /** Commentaire interne (raison, date de review, etc.). */
  notes?: string;
}

const DEFAULT_POLICY: SourcePolicy = {
  hostPattern: '*',
  cguStatus: 'unknown',
  allowHtmlCrawl: false,
  apiOnly: false,
  notes: 'Default deny for HTML crawl (CGU unknown)',
};

const ALLOW_ALL_POLICY: SourcePolicy = {
  hostPattern: '*',
  cguStatus: 'allowed',
  allowHtmlCrawl: true,
  apiOnly: false,
  notes: 'ALLOW ALL (runtime override): bypass source CGU gating',
};

const BASE_POLICIES: SourcePolicy[] = [
  {
    hostPattern: '.aliexpress.com',
    cguUrl: 'https://www.aliexpress.com/p/legal/terms-of-use.html',
    cguStatus: 'unknown',
    // Par défaut: API only (Affiliate) recommandé; HTML crawl = interdit tant que CGU pas validées.
    allowHtmlCrawl: false,
    apiOnly: true,
    notes: 'Prefer Affiliate API; deny HTML crawl by default.',
  },
  {
    hostPattern: '.amazon.',
    cguUrl: 'https://www.amazon.com/gp/help/customer/display.html?nodeId=508088',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: true,
    notes: 'Prefer official/affiliate APIs; deny HTML crawl by default.',
  },
  {
    hostPattern: '.ebay.',
    cguUrl: 'https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: true,
    notes: 'Prefer eBay APIs; deny HTML crawl by default.',
  },
  {
    hostPattern: '.etsy.com',
    cguUrl: 'https://www.etsy.com/legal/terms-of-use',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: false,
    notes: 'Deny HTML crawl by default until CGU validated.',
  },
  {
    hostPattern: '.myshopify.com',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: false,
    notes: 'Shopify stores are per-merchant; default deny unless you have permission.',
  },
  {
    hostPattern: '.shopify.com',
    cguUrl: 'https://www.shopify.com/legal/terms',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: false,
    notes: 'Default deny unless you have permission (per-store CGU may apply).',
  },
  {
    hostPattern: 'www.cdiscount.com',
    cguUrl: 'https://www.cdiscount.com/informations/conditions-generales-de-vente.html',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: false,
    notes: 'Default deny until CGU validated.',
  },
  {
    hostPattern: 'www.fnac.com',
    cguUrl: 'https://www.fnac.com/conditions-generales-de-vente',
    cguStatus: 'unknown',
    allowHtmlCrawl: false,
    apiOnly: false,
    notes: 'Default deny until CGU validated.',
  },
  // Exemple: ajoute tes sources autorisées ici après validation CGU
  // {
  //   hostPattern: 'example.com',
  //   cguUrl: 'https://example.com/terms',
  //   cguStatus: 'allowed',
  //   allowHtmlCrawl: true,
  //   apiOnly: false,
  //   notes: 'Validated on 2025-12-17 by <name>',
  // },
];

function matchesHost(hostname: string, pattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (p === '*') return true;
  if (p.startsWith('.')) return h.endsWith(p);
  if (p.endsWith('.')) return h.startsWith(p); // very permissive prefix (rare)
  if (p.includes('*')) {
    // wildcard simple: "*.amazon.*" style is not supported; keep it minimal.
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(h);
  }
  return h === p;
}

function loadEnvPolicies(): SourcePolicy[] {
  const raw = process.env.SOURCE_POLICIES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p): p is SourcePolicy => !!p && typeof p === 'object')
      .map((p: any) => ({
        hostPattern: String(p.hostPattern || '').trim(),
        cguUrl: p.cguUrl ? String(p.cguUrl) : undefined,
        cguStatus: (p.cguStatus === 'allowed' || p.cguStatus === 'forbidden' || p.cguStatus === 'unknown') ? p.cguStatus : 'unknown',
        allowHtmlCrawl: Boolean(p.allowHtmlCrawl),
        apiOnly: Boolean(p.apiOnly),
        notes: p.notes ? String(p.notes) : undefined,
      }))
      .filter(p => p.hostPattern.length > 0);
  } catch {
    return [];
  }
}

export function getSourcePolicy(urlOrHost: string): SourcePolicy {
  // Mode global (DANGEREUX): autorise le crawling HTML pour toutes les sources.
  // À n'utiliser que si tu assumes le risque CGU/contractuel.
  const mode = (process.env.SOURCE_POLICY_MODE || 'deny_by_default').toLowerCase().trim();
  if (mode === 'allow_all') {
    return ALLOW_ALL_POLICY;
  }

  const hostname = urlOrHost.includes('://') ? new URL(urlOrHost).hostname : urlOrHost;
  // 1) Override env (runtime)
  for (const policy of loadEnvPolicies()) {
    if (matchesHost(hostname, policy.hostPattern)) return policy;
  }
  // 2) Base policies (repo)
  for (const policy of BASE_POLICIES) {
    if (matchesHost(hostname, policy.hostPattern)) return policy;
  }
  return DEFAULT_POLICY;
}

