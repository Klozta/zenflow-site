/**
 * Script d'optimisation des index SQL pour améliorer les performances
 * Basé sur l'analyse des requêtes fréquentes dans le code
 *
 * Usage: Exécuter dans Supabase SQL Editor
 */

-- ============================================
-- INDEX POUR TABLE PRODUCTS
-- ============================================

-- Index composite pour filtrage fréquent: is_deleted + category + price
-- Utilisé dans getProducts() avec filtres category et price
CREATE INDEX IF NOT EXISTS idx_products_deleted_category_price
ON products(is_deleted, category, price)
WHERE is_deleted = false;

-- Index composite pour filtrage stock (stockStatus)
-- Utilisé dans getProducts() avec stockStatus filter
CREATE INDEX IF NOT EXISTS idx_products_deleted_stock
ON products(is_deleted, stock)
WHERE is_deleted = false;

-- Index composite pour tri par created_at (tri par défaut)
CREATE INDEX IF NOT EXISTS idx_products_deleted_created_at
ON products(is_deleted, created_at DESC)
WHERE is_deleted = false;

-- Index pour recherche full-text (déjà créé mais on vérifie)
-- CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN(search_vector);

-- Index pour tags (déjà créé mais on vérifie)
-- CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);

-- Index composite pour tri par rating
CREATE INDEX IF NOT EXISTS idx_products_rating
ON products(rating DESC NULLS LAST)
WHERE is_deleted = false;

-- ============================================
-- INDEX POUR TABLE ORDERS
-- ============================================

-- Index composite pour filtrage par status et date (requêtes fréquentes)
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
ON orders(status, created_at DESC);

-- Index pour recherche par user_id + status (commandes utilisateur)
CREATE INDEX IF NOT EXISTS idx_orders_user_status
ON orders(user_id, status, created_at DESC)
WHERE user_id IS NOT NULL;

-- Index pour order_number (lookups fréquents)
CREATE INDEX IF NOT EXISTS idx_orders_order_number
ON orders(order_number)
WHERE order_number IS NOT NULL;

-- Index pour calculs de revenue (status != cancelled)
CREATE INDEX IF NOT EXISTS idx_orders_status_total
ON orders(status, total)
WHERE status != 'cancelled';

-- Index pour dates (requêtes avec date ranges)
CREATE INDEX IF NOT EXISTS idx_orders_created_at_brin
ON orders USING BRIN(created_at);

-- Index pour shipping_email (recherche de commandes)
CREATE INDEX IF NOT EXISTS idx_orders_shipping_email
ON orders(shipping_email)
WHERE shipping_email IS NOT NULL;

-- ============================================
-- INDEX POUR TABLE ORDER_ITEMS
-- ============================================

-- Index pour récupérer les items d'une commande (requête fréquente)
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
ON order_items(order_id);

-- Index composite pour analyses (product_id + order_id)
CREATE INDEX IF NOT EXISTS idx_order_items_product_order
ON order_items(product_id, order_id);

-- ============================================
-- INDEX POUR TABLE USERS
-- ============================================

-- Index pour email (lookups fréquents)
CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email)
WHERE email IS NOT NULL;

-- Index pour dates (analyses utilisateurs actifs)
CREATE INDEX IF NOT EXISTS idx_users_created_at
ON users(created_at DESC);

-- ============================================
-- INDEX POUR TABLE REVIEWS
-- ============================================

-- Index pour récupérer les reviews d'un produit
CREATE INDEX IF NOT EXISTS idx_reviews_product_id
ON reviews(product_id, created_at DESC);

-- Index pour récupérer les reviews d'un utilisateur
CREATE INDEX IF NOT EXISTS idx_reviews_user_id
ON reviews(user_id, created_at DESC);

-- Index pour rating (analyses)
CREATE INDEX IF NOT EXISTS idx_reviews_rating
ON reviews(rating);

-- ============================================
-- INDEX POUR TABLE RETURN_REQUESTS
-- ============================================

-- Index pour filtrage par status (requêtes métriques)
CREATE INDEX IF NOT EXISTS idx_return_requests_status
ON return_requests(status, created_at DESC);

-- Index pour order_id (lookups)
CREATE INDEX IF NOT EXISTS idx_return_requests_order_id
ON return_requests(order_id);

-- ============================================
-- INDEX POUR TABLE REFRESH_TOKENS
-- ============================================

-- Index composite pour vérification tokens (requête à chaque refresh)
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_user
ON refresh_tokens(token, user_id, is_revoked, expires_at);

-- Index pour cleanup des tokens expirés
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
ON refresh_tokens(expires_at)
WHERE is_revoked = false;

-- ============================================
-- ANALYSE DES INDEX EXISTANTS
-- ============================================

-- Vérifier les index existants
-- SELECT schemaname, tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- ============================================
-- MAINTENANCE DES INDEX
-- ============================================

-- ANALYZE pour mettre à jour les statistiques (à exécuter périodiquement)
-- ANALYZE products;
-- ANALYZE orders;
-- ANALYZE users;
-- ANALYZE order_items;

-- VACUUM ANALYZE pour optimiser (à exécuter périodiquement, surtout après beaucoup de DELETE/UPDATE)
-- VACUUM ANALYZE products;
-- VACUUM ANALYZE orders;

-- ============================================
-- NOTES D'OPTIMISATION
-- ============================================

-- 1. Les index partiels (WHERE clause) sont plus petits et plus rapides
-- 2. Les index composites doivent correspondre à l'ordre des colonnes dans ORDER BY
-- 3. BRIN indexes sont efficaces pour les colonnes temporelles avec données ordonnées
-- 4. GIN indexes sont efficaces pour les arrays et full-text search
-- 5. TROP d'index ralentissent les INSERT/UPDATE, trouver l'équilibre
-- 6. Surveiller pg_stat_user_indexes pour identifier les index non utilisés

