-- Vérification Tables DB - GirlyCrea
-- Exécuter dans Supabase SQL Editor

-- Vérifier que toutes les tables existent
SELECT
    table_name,
    CASE
        WHEN table_name IN ('users', 'products', 'orders', 'order_items', 'import_history', 'refresh_tokens')
        THEN '✅ Trouvée'
        ELSE '⚠️  Table supplémentaire'
    END as status
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE'
ORDER BY
    CASE
        WHEN table_name IN ('users', 'products', 'orders', 'order_items', 'import_history', 'refresh_tokens')
        THEN 0
        ELSE 1
    END,
    table_name;

-- Vérifier RLS activé
SELECT
    tablename,
    CASE
        WHEN rowsecurity THEN '✅ RLS Activé'
        ELSE '❌ RLS Non Activé'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('users', 'products', 'orders', 'order_items', 'import_history', 'refresh_tokens')
ORDER BY tablename;

-- Compter les enregistrements (optionnel)
SELECT
    'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL
SELECT 'import_history', COUNT(*) FROM import_history
UNION ALL
SELECT 'refresh_tokens', COUNT(*) FROM refresh_tokens;

