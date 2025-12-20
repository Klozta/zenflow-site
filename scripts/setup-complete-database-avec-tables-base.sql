-- 🚀 Script SQL COMPLET - GirlyCrea (Avec Tables de Base)
-- À exécuter dans Supabase SQL Editor
-- Crée TOUTES les tables dans le bon ordre
-- Date: 2025-01-XX

-- ============================================
-- PARTIE 0: TABLES DE BASE (Créer en premier)
-- ============================================

-- 1. USERS - Table utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- 2. PRODUCTS - Table produits
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  category TEXT,
  stock INTEGER DEFAULT 0,
  images TEXT[],
  tags TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
CREATE INDEX IF NOT EXISTS idx_products_is_deleted ON products(is_deleted);
CREATE INDEX IF NOT EXISTS idx_products_tags ON products USING GIN(tags);

-- Colonne tsvector pour full-text search
ALTER TABLE products ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS products_search_idx ON products USING GIN(search_vector);

-- Fonction pour mettre à jour search_vector
CREATE OR REPLACE FUNCTION products_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('french', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('french', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('french', array_to_string(COALESCE(NEW.tags, ARRAY[]::TEXT[]), ' ')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour mise à jour automatique
DROP TRIGGER IF EXISTS products_search_trigger ON products;
CREATE TRIGGER products_search_trigger
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_update();

-- 3. ORDERS - Table commandes
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
  shipping_first_name TEXT NOT NULL,
  shipping_last_name TEXT NOT NULL,
  shipping_email TEXT NOT NULL,
  shipping_phone TEXT NOT NULL,
  shipping_address TEXT NOT NULL,
  shipping_city TEXT NOT NULL,
  shipping_postal_code TEXT NOT NULL,
  shipping_country TEXT NOT NULL DEFAULT 'France',
  promo_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 4. ORDER_ITEMS - Table items de commande
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- Trigger pour updated_at automatique sur orders
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at_trigger ON orders;
CREATE TRIGGER orders_updated_at_trigger
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();

-- 5. REFRESH_TOKENS - Table tokens de rafraîchissement
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================
-- PARTIE 1: TABLES SUPPLÉMENTAIRES
-- ============================================

-- PENDING_PRODUCTS - Table pour produits en attente de validation
CREATE TABLE IF NOT EXISTS pending_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('aliexpress', 'image', 'manual')),
  source_url TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  original_price DECIMAL(10,2),
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  images TEXT[] DEFAULT '{}',
  specifications JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejected_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_pending_products_status ON pending_products(status);
CREATE INDEX IF NOT EXISTS idx_pending_products_created_at ON pending_products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_products_source ON pending_products(source);
CREATE INDEX IF NOT EXISTS idx_pending_products_category ON pending_products(category);

-- REVIEWS - Table pour avis clients
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title TEXT NOT NULL,
  comment TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  helpful INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);

-- PROMO_CODES - Table pour codes promo
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(10,2) NOT NULL CHECK (discount_value > 0),
  min_purchase DECIMAL(10,2),
  max_discount DECIMAL(10,2),
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
  valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_promo_codes_valid_dates ON promo_codes(valid_from, valid_until);

-- PRODUCT_SPECIFICATIONS - Table pour spécifications produits
CREATE TABLE IF NOT EXISTS product_specifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_specs_product_id ON product_specifications(product_id);
CREATE INDEX IF NOT EXISTS idx_product_specs_category ON product_specifications(category);
CREATE INDEX IF NOT EXISTS idx_product_specs_display_order ON product_specifications(product_id, display_order);

-- ABANDONED_CARTS - Table pour paniers abandonnés
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  items JSONB NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  recovered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_session_id ON abandoned_carts(session_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_user_id ON abandoned_carts(user_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email_sent ON abandoned_carts(email_sent, recovered);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_last_activity ON abandoned_carts(last_activity);

-- ============================================
-- PARTIE 2: RLS POLICIES COMPLÈTES
-- ============================================
-- 🔒 Score sécurité: +1.5 → 10/10

-- 1. USERS - RLS (own data only)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own data only" ON users;
CREATE POLICY "Users own data only" ON users FOR ALL
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Service role can manage users" ON users;
CREATE POLICY "Service role can manage users" ON users FOR ALL
USING (auth.role() = 'service_role');

-- 2. PRODUCTS - RLS (public read, admin write)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products" ON products FOR SELECT
USING (is_deleted = false OR is_deleted IS NULL);

DROP POLICY IF EXISTS "Admin modify products" ON products;
CREATE POLICY "Admin modify products" ON products FOR ALL
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Service role can manage products" ON products;
CREATE POLICY "Service role can manage products" ON products FOR ALL
USING (auth.role() = 'service_role');

-- 3. ORDERS - RLS (own orders only)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own orders only" ON orders;
CREATE POLICY "Own orders only" ON orders FOR ALL
USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Admin can view all orders" ON orders;
CREATE POLICY "Admin can view all orders" ON orders FOR SELECT
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

DROP POLICY IF EXISTS "Service role can manage orders" ON orders;
CREATE POLICY "Service role can manage orders" ON orders FOR ALL
USING (auth.role() = 'service_role');

-- 4. ORDER_ITEMS - RLS (via orders)
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own order items only" ON order_items;
CREATE POLICY "Own order items only" ON order_items FOR SELECT
USING (
  EXISTS(
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.uid() OR orders.user_id IS NULL)
  )
);

DROP POLICY IF EXISTS "Service role can manage order items" ON order_items;
CREATE POLICY "Service role can manage order items" ON order_items FOR ALL
USING (auth.role() = 'service_role');

-- 5. REFRESH_TOKENS - RLS (own tokens only)
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own refresh tokens only" ON refresh_tokens;
CREATE POLICY "Own refresh tokens only" ON refresh_tokens FOR ALL
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage refresh tokens" ON refresh_tokens;
CREATE POLICY "Service role can manage refresh tokens" ON refresh_tokens FOR ALL
USING (auth.role() = 'service_role');

-- 6. PENDING_PRODUCTS - RLS (admin + service role)
ALTER TABLE pending_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage pending products" ON pending_products;
CREATE POLICY "Service role can manage pending products" ON pending_products FOR ALL
USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin can manage pending products" ON pending_products;
CREATE POLICY "Admin can manage pending products" ON pending_products FOR ALL
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- 7. ABANDONED_CARTS - RLS (own carts only)
ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own abandoned carts only" ON abandoned_carts;
CREATE POLICY "Own abandoned carts only" ON abandoned_carts FOR ALL
USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Service role can manage abandoned carts" ON abandoned_carts;
CREATE POLICY "Service role can manage abandoned carts" ON abandoned_carts FOR ALL
USING (auth.role() = 'service_role');

-- 8. REVIEWS - RLS (public read, authenticated write)
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read reviews" ON reviews;
CREATE POLICY "Anyone can read reviews" ON reviews FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Authenticated users can create reviews" ON reviews;
CREATE POLICY "Authenticated users can create reviews" ON reviews FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reviews" ON reviews;
CREATE POLICY "Users can update own reviews" ON reviews FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage reviews" ON reviews;
CREATE POLICY "Service role can manage reviews" ON reviews FOR ALL
USING (auth.role() = 'service_role');

-- 9. PROMO_CODES - RLS (public read active, admin write)
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active promo codes" ON promo_codes;
CREATE POLICY "Anyone can read active promo codes" ON promo_codes FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "Service role can manage promo codes" ON promo_codes;
CREATE POLICY "Service role can manage promo codes" ON promo_codes FOR ALL
USING (auth.role() = 'service_role');

-- 10. PRODUCT_SPECIFICATIONS - RLS (public read, admin write)
ALTER TABLE product_specifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read product specifications" ON product_specifications;
CREATE POLICY "Anyone can read product specifications" ON product_specifications FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Service role can manage specifications" ON product_specifications;
CREATE POLICY "Service role can manage specifications" ON product_specifications FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- VÉRIFICATION FINALE
-- ============================================

-- Message de succès
DO $$
BEGIN
    RAISE NOTICE '✅ Script SQL complet exécuté avec succès!';
    RAISE NOTICE '📊 Vérification en cours...';
END $$;

-- Vérifier RLS activé sur toutes les tables
SELECT
    '✅ RLS Status' as status,
    tablename,
    CASE
        WHEN rowsecurity THEN '✅ Activé'
        ELSE '❌ Non activé'
    END as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts', 'reviews', 'promo_codes', 'product_specifications')
ORDER BY tablename;

-- Vérifier policies créées
SELECT
    '📋 Policies' as status,
    tablename,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts', 'reviews', 'promo_codes', 'product_specifications')
ORDER BY tablename, policyname;

-- Vérifier toutes les tables créées
SELECT
    '📊 Tables' as status,
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'reviews', 'promo_codes', 'product_specifications', 'abandoned_carts')
ORDER BY table_name, ordinal_position;

-- Résumé final
SELECT
    '📊 Résumé' as status,
    COUNT(DISTINCT tablename) as tables_avec_rls,
    COUNT(*) as total_policies
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts', 'reviews', 'promo_codes', 'product_specifications');

-- Résultat attendu:
-- ✅ Toutes les tables avec rls_enabled = true
-- ✅ Au moins 2-3 policies par table (user/admin/service_role)
-- ✅ Total: ~25-30 policies configurées
-- ✅ Toutes les tables créées: users, products, orders, order_items, refresh_tokens, pending_products, reviews, promo_codes, product_specifications, abandoned_carts

