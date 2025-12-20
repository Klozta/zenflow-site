-- 🔒 Vérification RLS Policies - GirlyCrea
-- À exécuter dans Supabase SQL Editor pour vérifier la configuration RLS

-- ============================================
-- VÉRIFICATION RLS ACTIVÉ
-- ============================================
SELECT
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts')
ORDER BY tablename;

-- Résultat attendu: rls_enabled = true pour toutes les tables ✅

-- ============================================
-- VÉRIFICATION POLICIES EXISTANTES
-- ============================================
SELECT
    tablename,
    policyname,
    permissive,
    roles,
    cmd as command,
    CASE
        WHEN qual IS NOT NULL THEN 'USING clause présent'
        ELSE 'Pas de USING clause'
    END as using_clause
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts')
ORDER BY tablename, policyname;

-- Résultat attendu: Au moins une policy par table ✅

-- ============================================
-- VÉRIFICATION INDEXES SÉCURITÉ
-- ============================================
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND (
        indexname LIKE '%user_id%' OR
        indexname LIKE '%email%' OR
        indexname LIKE '%status%'
    )
ORDER BY tablename, indexname;

-- ============================================
-- RÉSUMÉ
-- ============================================
SELECT
    'Tables avec RLS' as check_type,
    COUNT(*) as count
FROM pg_tables
WHERE schemaname = 'public'
    AND rowsecurity = true
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts')

UNION ALL

SELECT
    'Policies configurées' as check_type,
    COUNT(*) as count
FROM pg_policies
WHERE schemaname = 'public'
    AND tablename IN ('users', 'products', 'orders', 'order_items', 'refresh_tokens', 'pending_products', 'abandoned_carts');

-- Résultat attendu:
-- Tables avec RLS: 7 (ou plus selon tables créées)
-- Policies configurées: Au moins 7 (une par table minimum)





