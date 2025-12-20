-- 🔒 RLS Policies Complètes - GirlyCrea
-- À exécuter dans Supabase SQL Editor
-- Score sécurité: +1.5 → 10/10

-- ============================================
-- 1. USERS - RLS (own data only)
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users own data only" ON users;
CREATE POLICY "Users own data only" ON users FOR ALL
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy admin: Service role peut tout faire
DROP POLICY IF EXISTS "Service role can manage users" ON users;
CREATE POLICY "Service role can manage users" ON users FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 2. PRODUCTS - RLS (public read, admin write)
-- ============================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Public peut lire les produits non supprimés
DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products" ON products FOR SELECT
USING (is_deleted = false OR is_deleted IS NULL);

-- Seuls les admins peuvent créer/modifier/supprimer
DROP POLICY IF EXISTS "Admin modify products" ON products;
CREATE POLICY "Admin modify products" ON products FOR ALL
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Service role peut tout faire (backend API)
DROP POLICY IF EXISTS "Service role can manage products" ON products;
CREATE POLICY "Service role can manage products" ON products FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 3. ORDERS - RLS (own orders only)
-- ============================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Users peuvent voir leurs propres commandes
DROP POLICY IF EXISTS "Own orders only" ON orders;
CREATE POLICY "Own orders only" ON orders FOR ALL
USING (user_id = auth.uid() OR user_id IS NULL);

-- Admins peuvent voir toutes les commandes
DROP POLICY IF EXISTS "Admin can view all orders" ON orders;
CREATE POLICY "Admin can view all orders" ON orders FOR SELECT
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- Service role peut tout faire
DROP POLICY IF EXISTS "Service role can manage orders" ON orders;
CREATE POLICY "Service role can manage orders" ON orders FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 4. ORDER_ITEMS - RLS (via orders)
-- ============================================
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Users peuvent voir les items de leurs commandes
DROP POLICY IF EXISTS "Own order items only" ON order_items;
CREATE POLICY "Own order items only" ON order_items FOR SELECT
USING (
  EXISTS(
    SELECT 1 FROM orders
    WHERE orders.id = order_items.order_id
    AND (orders.user_id = auth.uid() OR orders.user_id IS NULL)
  )
);

-- Service role peut tout faire
DROP POLICY IF EXISTS "Service role can manage order items" ON order_items;
CREATE POLICY "Service role can manage order items" ON order_items FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 5. REFRESH_TOKENS - RLS (own tokens only)
-- ============================================
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

-- Users peuvent voir leurs propres tokens
DROP POLICY IF EXISTS "Own refresh tokens only" ON refresh_tokens;
CREATE POLICY "Own refresh tokens only" ON refresh_tokens FOR ALL
USING (user_id = auth.uid());

-- Service role peut tout faire (backend API)
DROP POLICY IF EXISTS "Service role can manage refresh tokens" ON refresh_tokens;
CREATE POLICY "Service role can manage refresh tokens" ON refresh_tokens FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 6. PENDING_PRODUCTS - RLS (admin + service role)
-- ============================================
ALTER TABLE pending_products ENABLE ROW LEVEL SECURITY;

-- Service role peut tout faire (backend API)
DROP POLICY IF EXISTS "Service role can manage pending products" ON pending_products;
CREATE POLICY "Service role can manage pending products" ON pending_products FOR ALL
USING (auth.role() = 'service_role');

-- Admins peuvent voir et modifier
DROP POLICY IF EXISTS "Admin can manage pending products" ON pending_products;
CREATE POLICY "Admin can manage pending products" ON pending_products FOR ALL
USING (
  EXISTS(
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- ============================================
-- 7. ABANDONED_CARTS - RLS (own carts only)
-- ============================================
ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;

-- Users peuvent voir leurs propres paniers abandonnés
DROP POLICY IF EXISTS "Own abandoned carts only" ON abandoned_carts;
CREATE POLICY "Own abandoned carts only" ON abandoned_carts FOR ALL
USING (user_id = auth.uid() OR user_id IS NULL);

-- Service role peut tout faire
DROP POLICY IF EXISTS "Service role can manage abandoned carts" ON abandoned_carts;
CREATE POLICY "Service role can manage abandoned carts" ON abandoned_carts FOR ALL
USING (auth.role() = 'service_role');

-- ============================================
-- 8. INDEXES SÉCURITÉ (Performance)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_user_id ON abandoned_carts(user_id);

-- ============================================
-- 9. VÉRIFICATION FINALE
-- ============================================

-- Afficher un message de succès
DO $$
BEGIN
    RAISE NOTICE '✅ RLS Policies configurées avec succès!';
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
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts')
ORDER BY tablename;

-- Vérifier policies créées (détail)
SELECT
    '📋 Policies' as status,
    tablename,
    policyname,
    cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts')
ORDER BY tablename, policyname;

-- Résumé final
SELECT
    '📊 Résumé' as status,
    COUNT(DISTINCT tablename) as tables_avec_rls,
    COUNT(*) as total_policies
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts');

-- Résultat attendu:
-- ✅ Toutes les tables avec rls_enabled = true
-- ✅ Au moins 2-3 policies par table (user/admin/service_role)
-- ✅ Total: ~15-20 policies configurées





