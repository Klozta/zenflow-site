/**
 * Optimisation avancée des index SQL basée sur recommandations Perplexity
 * Focus sur: index composites avec INCLUDE, index couvrants pour éviter Heap Fetches
 *
 * Usage: Exécuter dans Supabase SQL Editor après optimize-indexes.sql
 */

-- ============================================
-- INDEX COMPOSITES AVEC INCLUDE (Index Couvrants)
-- ============================================
-- Les index avec INCLUDE permettent de récupérer les données directement depuis l'index
-- sans accès à la table (zero Heap Fetches) - 40-60% de performance supplémentaire

-- PRODUITS: Recherche par catégorie avec tri par prix
-- INCLUDE name, stock_quantity pour éviter Heap Fetches
CREATE INDEX IF NOT EXISTS idx_products_category_price_incl
ON products(category, price DESC)
INCLUDE (title, stock)
WHERE is_deleted = false;

-- PRODUITS: Recherche par catégorie et statut stock
CREATE INDEX IF NOT EXISTS idx_products_category_stock_incl
ON products(category, stock)
INCLUDE (title, price, rating)
WHERE is_deleted = false AND stock > 0;

-- COMMANDES: Par client avec tri par date (dashboard client)
CREATE INDEX IF NOT EXISTS idx_orders_user_created_incl
ON orders(user_id, created_at DESC)
INCLUDE (order_number, total, status)
WHERE user_id IS NOT NULL;

-- COMMANDES: Par statut et date (dashboard admin)
CREATE INDEX IF NOT EXISTS idx_orders_status_created_incl
ON orders(status, created_at DESC)
INCLUDE (order_number, total, shipping_email)
WHERE status != 'cancelled';

-- ORDER ITEMS: Par commande avec détails produits
CREATE INDEX IF NOT EXISTS idx_order_items_order_incl
ON order_items(order_id)
INCLUDE (product_id, quantity, unit_price);

-- ORDER ITEMS: Par produit pour analyses (top produits)
CREATE INDEX IF NOT EXISTS idx_order_items_product_incl
ON order_items(product_id, order_id)
INCLUDE (quantity, unit_price);

-- ============================================
-- INDEX POUR RECHERCHE FULL-TEXT OPTIMISÉE
-- ============================================

-- Vérifier si search_vector existe, sinon le créer
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'products'::regclass
    AND attname = 'search_vector'
  ) THEN
    ALTER TABLE products ADD COLUMN search_vector tsvector;
  END IF;
END $$;

-- Index GIN pour recherche textuelle (déjà créé, mais on vérifie)
CREATE INDEX IF NOT EXISTS products_search_idx
ON products USING GIN(search_vector)
WHERE is_deleted = false;

-- Fonction pour mettre à jour search_vector (si pas déjà créée)
CREATE OR REPLACE FUNCTION products_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('french', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('french', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger (si pas déjà créé)
DROP TRIGGER IF EXISTS products_search_trigger ON products;
CREATE TRIGGER products_search_trigger
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_update();

-- Mettre à jour les produits existants
UPDATE products
SET search_vector =
  setweight(to_tsvector('french', COALESCE(title, '')), 'A') ||
  setweight(to_tsvector('french', COALESCE(description, '')), 'B')
WHERE search_vector IS NULL OR search_vector = ''::tsvector;

-- ============================================
-- INDEX POUR PAGINATION OPTIMISÉE
-- ============================================

-- Index pour pagination produits (created_at DESC par défaut)
CREATE INDEX IF NOT EXISTS idx_products_pagination
ON products(created_at DESC, id)
INCLUDE (title, price, category, stock)
WHERE is_deleted = false;

-- Index pour pagination commandes
CREATE INDEX IF NOT EXISTS idx_orders_pagination
ON orders(created_at DESC, id)
INCLUDE (order_number, status, total);

-- ============================================
-- INDEX POUR ANALYSES ET RAPPORTS
-- ============================================

-- Index pour calculs de revenue par période
CREATE INDEX IF NOT EXISTS idx_orders_revenue_analysis
ON orders(created_at, status)
INCLUDE (total)
WHERE status IN ('confirmed', 'shipped', 'delivered');

-- Index pour analyses par produit (commandes avec ce produit)
CREATE INDEX IF NOT EXISTS idx_order_items_product_analysis
ON order_items(product_id, order_id)
INCLUDE (quantity, unit_price)
WHERE quantity > 0;

-- ============================================
-- MAINTENANCE ET VÉRIFICATION
-- ============================================

-- Analyser les tables pour mettre à jour les statistiques
ANALYZE products;
ANALYZE orders;
ANALYZE order_items;

-- Vérifier les index créés
-- SELECT schemaname, tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND tablename IN ('products', 'orders', 'order_items')
-- ORDER BY tablename, indexname;

-- Vérifier la taille des index
-- SELECT
--   schemaname,
--   tablename,
--   indexname,
--   pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- AND tablename IN ('products', 'orders', 'order_items')
-- ORDER BY pg_relation_size(indexrelid) DESC;

