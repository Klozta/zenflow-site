import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { isLegalCatalogModeEnabled } from './config/legalCatalog.js';
import { validateSecrets } from './config/secrets.js';
import { initSentry } from './config/sentry.js';
import { botDetectionMiddleware } from './middleware/botDetection.middleware.js';
import { globalRateLimiter } from './middleware/rateLimit.middleware.js';
import { requestContextMiddleware } from './middleware/requestContext.middleware.js';
import { requestIdMiddleware, requestLoggingMiddleware } from './middleware/requestId.middleware.js';
import { responseTimeMiddleware } from './middleware/responseTime.middleware.js';
import {
  sanitizeInput,
  securityHeaders,
  suspiciousActivityLogging,
} from './middleware/security.middleware.js';
import { timeoutMiddleware } from './middleware/timeout.middleware.js';
import { logger } from './utils/logger.js';

// Routes
import abandonedCartsRoutes from './routes/abandonedCarts.routes.js';
import adminRoutes from './routes/admin.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import apiDocsRoutes from './routes/api-docs.routes.js';
import auditRoutes from './routes/audit.routes.js';
import authRoutes from './routes/auth.routes.js';
import autoProductRoutes from './routes/autoProduct.routes.js';
import autoProductQueueRoutes from './routes/autoProductQueue.routes.js';
import autoProductSmartRoutes from './routes/autoProductSmart.routes.js';
import chatbotRoutes from './routes/chatbot.routes.js';
import complianceRoutes from './routes/compliance.routes.js';
import contactRoutes from './routes/contact.routes.js';
import courseEnrollmentsRoutes from './routes/courseEnrollments.routes.js';
import coursesRoutes from './routes/courses.routes.js';
import cronRoutes from './routes/cron.routes.js';
import emailPreferencesRoutes from './routes/emailPreferences.routes.js';
import featureFlagsRoutes from './routes/featureFlags.routes.js';
import gamificationRoutes from './routes/gamification.routes.js';
import healthRoutes from './routes/health.routes.js';
import imagesRoutes from './routes/images.routes.js';
import loyaltyRoutes from './routes/loyalty.routes.js';
import metricsRoutes from './routes/metrics/index.js';
import monitoringRoutes from './routes/monitoring.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import orderTagsRoutes from './routes/orderTags.routes.js';
import paymentsRoutes, { stripeWebhookHandler, stripeWebhookRateLimiter } from './routes/payments.routes.js';
import productsRoutes from './routes/products.routes.js';
import productSpecsRoutes from './routes/productSpecs.routes.js';
import productSuggestionsRoutes from './routes/productSuggestions.routes.js';
import prometheusMetricsRoutes from './routes/prometheusMetrics.routes.js';
import promoRoutes from './routes/promo.routes.js';
import pushNotificationsRoutes from './routes/pushNotifications.routes.js';
import recommendationsRoutes from './routes/recommendations.routes.js';
import returnsRoutes from './routes/returns.routes.js';
import reviewsRoutes from './routes/reviews.routes.js';
import sharedWishlistRoutes from './routes/sharedWishlist.routes.js';
import suggestionsRoutes from './routes/suggestions.routes.js';
import trendingRoutes from './routes/trending.routes.js';
import userDashboardRoutes from './routes/userDashboard.routes.js';
import viewHistoryRoutes from './routes/viewHistory.routes.js';
// import commerceRoutes from './routes/commerce.routes.js';

dotenv.config();

// Monitoring (optionnel) - s'active automatiquement si SENTRY_DSN est configuré
// Initialiser Sentry de manière asynchrone (non-bloquant)
initSentry().catch(() => {
  // Ignorer silencieusement si Sentry non disponible
});

// Valider secrets au démarrage (CRITIQUE)
try {
  validateSecrets();
} catch (error) {
  logger.error('Secret validation failed', error as Error, {
    message: (error as Error).message,
  });
  logger.error('Please check your .env file and ensure all required secrets are set');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware de sécurité (CSP, HSTS, etc.)
// Utilise la configuration améliorée avec support Stripe
app.use(securityHeaders);

// Sanitization des entrées utilisateur (protection XSS)
app.use(sanitizeInput);

// Logging des activités suspectes
app.use(suspiciousActivityLogging);

// CORS strict avec validation des origines
const allowedOrigins = [
  process.env.CORS_ORIGIN || 'http://localhost:3004',
  process.env.CORS_ORIGIN_PROD,
  process.env.CORS_ORIGIN_STAGING,
].filter(Boolean);

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Permettre requêtes sans origin (mobile apps, Postman, etc.) en dev uniquement
    if (!origin && process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Autoriser localhost avec différents ports en dev
    if (process.env.NODE_ENV === 'development' && origin && (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:')
    )) {
      return callback(null, true);
    }

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked for origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Cron-Key', 'X-CSRF-Token'],
  exposedHeaders: ['X-Response-Time', 'X-Request-ID'],
}));
app.use(cookieParser());

// Compression gzip (réduit taille réponse JSON/HTML de 60-80%)
app.use(compression({ level: 6, threshold: 1024 })); // Compress si > 1KB

// Stripe webhook MUST be raw-body and mounted before express.json()
// Security: raw body limit 500KB (Stripe events are small), no CSRF (webhook signature validates)
app.post(
  '/api/payments/stripe/webhook',
  stripeWebhookRateLimiter,
  express.raw({ type: 'application/json', limit: '500kb' }), // Limit raw body size
  stripeWebhookHandler
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request ID pour tracing (doit être avant les autres middlewares)
app.use(requestIdMiddleware);

// Enrichir le contexte de la requête
app.use(requestContextMiddleware);

// Détection de bots
app.use(botDetectionMiddleware);

// Protection CSRF : générer token pour toutes les requêtes GET
import { csrfTokenMiddleware, getCsrfToken } from './middleware/csrf.middleware.js';
app.use(csrfTokenMiddleware);
// Endpoint pour récupérer le token CSRF
app.get('/api/csrf-token', getCsrfToken);

// Timeout protection (30s max par requête)
app.use(timeoutMiddleware);

// Response time tracking
app.use(responseTimeMiddleware);

// Request logging (doit être après requestIdMiddleware)
app.use(requestLoggingMiddleware);

// Rate limiting global (protection DDoS)
app.use('/api', globalRateLimiter);

// Health check routes (simple + detailed)
app.use('/health', healthRoutes);

// Monitoring routes (admin only)
app.use('/api/monitoring', monitoringRoutes);

// API Routes
app.get('/api', (_req, res) => {
  res.json({
    message: 'ZenFlow API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      products: '/api/products',
      'products-import': '/api/products/import',
      'products-import-batch': '/api/products/import/batch',
      'products-import-history': '/api/products/import/history',
      'products-import-stats': '/api/products/import/stats',
      orders: '/api/orders',
      promo: '/api/promo',
      suggestions: '/api/suggestions',
      trending: '/api/trending',
      cron: '/api/cron',
      'api-docs': '/api-docs',
      // commerce: '/api/commerce (Prompt 6)',
    },
  });
});

// Auth routes (Prompt 4 ✅)
// Le rate limit auth est appliqué sur les endpoints sensibles (ex: /login) directement dans auth.routes.ts
app.use('/api/auth', authRoutes);
// Admin session (cookie httpOnly)
app.use('/api/admin', adminRoutes);
// Historique de navigation utilisateur + Dashboard
app.use('/api/user', viewHistoryRoutes);
app.use('/api/user', userDashboardRoutes);
// Retours/remboursements
app.use('/api/returns', returnsRoutes);
// Order tags & notes
app.use('/api/order-tags', orderTagsRoutes);
// Audit routes (order_status_events, stripe_refs, notifications)
app.use('/api/audit', auditRoutes);
// Products routes (Prompt 5 ✅)
app.use('/api/products', productsRoutes);
// Courses routes
app.use('/api/courses', coursesRoutes);
app.use('/api/courses/enrollments', courseEnrollmentsRoutes);
// Orders routes (J3 ✅)
app.use('/api/orders', ordersRoutes);
// Loyalty program
app.use('/api/loyalty', loyaltyRoutes);
// Payments routes (Stripe)
app.use('/api/payments', paymentsRoutes);
// Abandoned carts (emails)
app.use('/api/abandoned-carts', abandonedCartsRoutes);
// Email preferences
app.use('/api/email-preferences', emailPreferencesRoutes);
// Promo codes routes
app.use('/api/promo', promoRoutes);
// Reviews routes
app.use('/api/reviews', reviewsRoutes);
// Recommendations routes
app.use('/api/recommendations', recommendationsRoutes);
// Smart suggestions routes
app.use('/api/suggestions', suggestionsRoutes);
// Trending products routes (marketplaces) — bloqué en mode catalogue légal
if (!isLegalCatalogModeEnabled()) {
  app.use('/api/trending', trendingRoutes);
} else {
  logger.warn('LEGAL_CATALOG_MODE enabled: /api/trending disabled');
}
// Product specifications routes
app.use('/api/products', productSpecsRoutes);
// Auto product generation routes
app.use('/api/products', autoProductRoutes);
// Auto product smart routes (peut inclure AliExpress) — bloqué en mode catalogue légal
if (!isLegalCatalogModeEnabled()) {
  app.use('/api/products', autoProductSmartRoutes);
} else {
  logger.warn('LEGAL_CATALOG_MODE enabled: /api/products/auto-smart disabled');
}
// Product suggestions routes (clic → produits)
app.use('/api/products', productSuggestionsRoutes);
// Auto product queue routes (AliExpress) — bloqué en mode catalogue légal
if (!isLegalCatalogModeEnabled()) {
  app.use('/api/products/auto-queue', autoProductQueueRoutes);
} else {
  logger.warn('LEGAL_CATALOG_MODE enabled: /api/products/auto-queue disabled');
}
// Cron jobs routes (emails, nettoyage, etc.)
app.use('/api/cron', cronRoutes);
// Compliance metrics (read-only, protected)
app.use('/api/compliance', complianceRoutes);
// API Documentation
app.use('/api-docs', apiDocsRoutes);
// Metrics (à protéger en production)
app.use('/api/metrics', metricsRoutes);
// Prometheus metrics (standard endpoint /metrics)
app.use('/metrics', prometheusMetricsRoutes);
// Analytics (business intelligence)
app.use('/api/analytics', analyticsRoutes);
// Notifications admin
app.use('/api/notifications', notificationsRoutes);
app.use('/api/notifications', pushNotificationsRoutes);
// Images CDN (upload, optimize, delete)
app.use('/api/images', imagesRoutes);
// Gamification (badges, points, challenges, leaderboard)
app.use('/api/gamification', gamificationRoutes);
// Chatbot IA (support client intelligent)
app.use('/api/chatbot', chatbotRoutes);
// Wishlist Partagée (listes de cadeaux)
app.use('/api/wishlists', sharedWishlistRoutes);
// Feature flags (configuration dynamique)
app.use('/api/feature-flags', featureFlagsRoutes);
// Contact form
app.use('/api/contact', contactRoutes);
// app.use('/api/commerce', commerceRoutes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handler
import { errorHandler } from './middleware/errorHandler.middleware.js';
app.use(errorHandler);

const HOST = process.env.HOST || '0.0.0.0';

// Fonction pour trouver un port disponible si le port par défaut est occupé
async function startServer() {
  const server = app.listen(Number(PORT), HOST, () => {
    logger.info('ZenFlow Backend started', {
      host: HOST,
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      healthCheck: `http://localhost:${PORT}/health`,
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port already in use', err, {
        port: PORT,
        solutions: [
          '1. Arrêter le processus: ./TUER-PORT.sh',
          '2. Utiliser un autre port: PORT=3002 npm run dev',
          `3. Trouver le processus: lsof -i :${PORT}`,
        ],
      });
      process.exit(1);
    } else {
      throw err;
    }
  });
}

startServer();
