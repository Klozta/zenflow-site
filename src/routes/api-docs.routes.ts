/**
 * Documentation API automatique
 * Génère une documentation basique de l'API
 */
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '../config/swagger.js';

const router = Router();

// Swagger UI - Documentation interactive
router.use('/swagger', swaggerUi.serve);
router.get('/swagger', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'ZenFlow API Documentation',
  customfavIcon: '/favicon.ico',
}));

// Swagger JSON - Spécification OpenAPI brute
router.get('/swagger.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

interface Endpoint {
  method: string;
  path: string;
  description: string;
  auth?: boolean;
  body?: any;
  query?: any;
  response?: any;
}

const endpoints: Endpoint[] = [
  // Auth
  {
    method: 'POST',
    path: '/api/auth/register',
    description: 'Inscription utilisateur',
    body: {
      email: 'string',
      password: 'string',
      firstName: 'string',
      lastName: 'string',
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    description: 'Connexion utilisateur',
    body: {
      email: 'string',
      password: 'string',
    },
  },
  {
    method: 'POST',
    path: '/api/auth/refresh',
    description: 'Rafraîchir le token',
    auth: true,
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    description: 'Déconnexion',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    description: 'Profil utilisateur actuel',
    auth: true,
  },
  // Products
  {
    method: 'GET',
    path: '/api/products',
    description: 'Liste produits avec filtres',
    query: {
      page: 'number',
      limit: 'number',
      category: 'string',
      minPrice: 'number',
      maxPrice: 'number',
    },
  },
  {
    method: 'GET',
    path: '/api/products/search',
    description: 'Recherche full-text',
    query: {
      q: 'string',
      page: 'number',
      limit: 'number',
    },
  },
  {
    method: 'GET',
    path: '/api/products/:id',
    description: 'Détails produit',
  },
  {
    method: 'POST',
    path: '/api/products',
    description: 'Créer produit (admin)',
    auth: true,
    body: {
      title: 'string',
      description: 'string',
      price: 'number',
      category: 'string',
      stock: 'number',
      images: 'string[]',
      tags: 'string[]',
    },
  },
  {
    method: 'PUT',
    path: '/api/products/:id',
    description: 'Modifier produit (admin)',
    auth: true,
  },
  {
    method: 'DELETE',
    path: '/api/products/:id',
    description: 'Supprimer produit (admin)',
    auth: true,
  },
  // Orders
  {
    method: 'POST',
    path: '/api/orders',
    description: 'Créer commande',
    body: {
      items: 'OrderItem[]',
      shipping: 'ShippingInfo',
      total: 'number',
    },
  },
  {
    method: 'GET',
    path: '/api/orders',
    description: 'Liste commandes utilisateur',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/orders/:id',
    description: 'Détails commande',
    auth: true,
  },
  // Import
  {
    method: 'POST',
    path: '/api/products/import',
    description: 'Importer produit depuis URL',
    auth: true,
    body: {
      url: 'string',
    },
  },
  {
    method: 'POST',
    path: '/api/products/import/batch',
    description: 'Import batch (max 20)',
    auth: true,
    body: {
      urls: 'string[]',
    },
  },
  // Auto Queue
  {
    method: 'POST',
    path: '/api/products/auto-queue/aliexpress',
    description: 'Rechercher et queue produits AliExpress',
    auth: true,
    body: {
      query: 'string',
      options: {
        maxResults: 'number',
        minRating: 'number',
        maxPrice: 'number',
        category: 'string',
      },
    },
  },
  {
    method: 'GET',
    path: '/api/products/auto-queue',
    description: 'Liste produits en attente',
    auth: true,
    query: {
      status: 'pending | approved | rejected',
    },
  },
  {
    method: 'POST',
    path: '/api/products/auto-queue/:id/approve',
    description: 'Approuver produit',
    auth: true,
  },
  {
    method: 'POST',
    path: '/api/products/auto-queue/:id/reject',
    description: 'Rejeter produit',
    auth: true,
    body: {
      reason: 'string',
    },
  },
  // Health
  {
    method: 'GET',
    path: '/health',
    description: 'Health check simple',
  },
  {
    method: 'GET',
    path: '/health/detailed',
    description: 'Health check détaillé (services)',
  },
  {
    method: 'GET',
    path: '/health/readiness',
    description: 'Readiness check (K8s)',
  },
  {
    method: 'GET',
    path: '/health/liveness',
    description: 'Liveness check (K8s)',
  },
  // Metrics
  {
    method: 'GET',
    path: '/api/metrics',
    description: 'Métriques système de base (uptime, memory, version)',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/dashboard',
    description: 'Dashboard métriques (vue d\'ensemble complète avec tendances) - cached 2min',
    auth: true,
    query: {
      startDate: 'string (ISO datetime, optional)',
      endDate: 'string (ISO datetime, optional)',
      period: 'string (24h|7d|30d|90d|1y|all, optional)',
    },
    response: {
      system: 'System metrics',
      overview: 'Business metrics overview',
      recent: 'Recent activity (24h, 7d) with trends',
      alerts: 'Alerts (out of stock, returns, etc.)',
    },
  },
  {
    method: 'GET',
    path: '/api/metrics/database',
    description: 'Métriques base de données (compteurs par table) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/orders',
    description: 'Statistiques commandes (par statut, revenus, AOV, tendances) - cached 5min',
    auth: true,
    query: {
      startDate: 'string (ISO datetime, optional)',
      endDate: 'string (ISO datetime, optional)',
      period: 'string (24h|7d|30d|90d|1y|all, optional)',
    },
  },
  {
    method: 'GET',
    path: '/api/metrics/products',
    description: 'Métriques produits (stock, catégories, top vendus) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/users',
    description: 'Métriques utilisateurs (inscriptions, actifs, conversion) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/reviews',
    description: 'Métriques avis (satisfaction, distribution notes) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/returns',
    description: 'Métriques retours (taux, raisons, délais) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/loyalty',
    description: 'Métriques programme fidélité (points, tiers, redemptions) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/abandoned-carts',
    description: 'Statistiques paniers abandonnés - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/attribution',
    description: 'Statistiques attribution marketing (UTM sources/campaigns) - cached 5min',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/rate-limit',
    description: 'Compteurs rate-limit (429 errors) - real-time',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/payments',
    description: 'Compteurs paiements (succès/échecs) - real-time',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/performance',
    description: 'Métriques performance API (temps réponse, erreurs) - real-time',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/performance/slowest',
    description: 'Endpoints les plus lents',
    auth: true,
    query: {
      limit: 'number (default: 10)',
    },
  },
  {
    method: 'GET',
    path: '/api/metrics/performance/errors',
    description: 'Endpoints avec erreurs',
    auth: true,
    query: {
      limit: 'number (default: 10)',
    },
  },
  {
    method: 'POST',
    path: '/api/metrics/performance/reset',
    description: 'Réinitialiser les métriques performance (admin)',
    auth: true,
  },
  {
    method: 'GET',
    path: '/api/metrics/alerts',
    description: 'Alertes critiques basées sur les métriques (ruptures de stock, retours, etc.) - cached 1min',
    auth: true,
    response: {
      critical: 'Alertes critiques nécessitant action immédiate',
      warnings: 'Avertissements nécessitant attention',
      summary: 'Résumé du nombre d\'alertes',
    },
  },
  {
    method: 'GET',
    path: '/api/metrics/export/:type',
    description: 'Export métriques en CSV (orders, products, users, reviews, returns, loyalty, dashboard)',
    auth: true,
    query: {
      type: 'string (orders|products|users|reviews|returns|loyalty|dashboard)',
    },
  },
];

/**
 * GET /api-docs - Documentation API
 */
router.get('/', (_req, res) => {
  res.json({
    title: 'ZenFlow API Documentation',
    version: '1.0.0',
    baseUrl: process.env.API_URL || 'http://localhost:3001',
    endpoints: endpoints.map(ep => ({
      method: ep.method,
      path: ep.path,
      description: ep.description,
      requiresAuth: ep.auth || false,
      ...(ep.body && { requestBody: ep.body }),
      ...(ep.query && { queryParams: ep.query }),
    })),
  });
});

/**
 * GET /api-docs/:endpoint - Documentation d'un endpoint spécifique
 */
router.get('/:endpoint', (req, res) => {
  const endpointPath = `/${req.params.endpoint}`;
  const endpoint = endpoints.find(ep => ep.path.includes(endpointPath));

  if (!endpoint) {
    return res.status(404).json({
      error: 'Endpoint not found',
      availableEndpoints: endpoints.map(ep => ep.path),
    });
  }

  return res.json({
    ...endpoint,
    examples: generateExamples(endpoint),
  });
});

function generateExamples(endpoint: Endpoint): any {
  const baseUrl = process.env.API_URL || 'http://localhost:3001';

  return {
    curl: generateCurlExample(endpoint, baseUrl),
    javascript: generateJSExample(endpoint, baseUrl),
  };
}

function generateCurlExample(endpoint: Endpoint, baseUrl: string): string {
  let curl = `curl -X ${endpoint.method} ${baseUrl}${endpoint.path}`;

  if (endpoint.auth) {
    curl += ' \\\n  -H "Authorization: Bearer YOUR_TOKEN"';
  }

  if (endpoint.body) {
    curl += ' \\\n  -H "Content-Type: application/json"';
    curl += ' \\\n  -d \'{"example": "data"}\'';
  }

  return curl;
}

function generateJSExample(endpoint: Endpoint, baseUrl: string): string {
  let js = `const response = await fetch('${baseUrl}${endpoint.path}', {\n`;
  js += `  method: '${endpoint.method}',\n`;

  if (endpoint.auth) {
    js += `  headers: {\n`;
    js += `    'Authorization': 'Bearer YOUR_TOKEN',\n`;
    if (endpoint.body) {
      js += `    'Content-Type': 'application/json',\n`;
    }
    js += `  },\n`;
  } else if (endpoint.body) {
    js += `  headers: {\n`;
    js += `    'Content-Type': 'application/json',\n`;
    js += `  },\n`;
  }

  if (endpoint.body) {
    js += `  body: JSON.stringify({ example: 'data' }),\n`;
  }

  js += `});\n`;
  js += `const data = await response.json();`;

  return js;
}

export default router;
