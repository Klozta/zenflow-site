/**
 * Script d'analyse des requêtes lentes
 * Aide à identifier les requêtes à optimiser
 *
 * Usage: Exécuter dans Supabase SQL Editor
 */

-- ============================================
-- ANALYSE DES REQUÊTES LENTES (nécessite pg_stat_statements)
-- ============================================

-- Voir les requêtes les plus lentes (si extension activée)
SELECT
  query,
  calls,
  total_time,
  mean_time,
  max_time,
  (total_time / calls) AS avg_time_per_call
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 20;

-- Voir les requêtes les plus fréquentes
SELECT
  LEFT(query, 100) AS query_start,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- ============================================
-- ANALYSE DES INDEX NON UTILISÉS
-- ============================================

-- Identifier les index non utilisés (peut être supprimés pour optimiser)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname = 'public'
ORDER BY tablename, indexname;

-- Voir l'utilisation des index par table
SELECT
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY tablename, idx_scan DESC;

-- ============================================
-- ANALYSE DE LA TAILLE DES TABLES ET INDEX
-- ============================================

-- Taille des tables
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- ============================================
-- ANALYSE DES SÉQUENCES SCANS (manque d'index)
-- ============================================

-- Identifier les tables avec beaucoup de sequential scans
SELECT
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  seq_tup_read / seq_scan AS avg_seq_read
FROM pg_stat_user_tables
WHERE seq_scan > 0
  AND schemaname = 'public'
ORDER BY seq_tup_read DESC
LIMIT 20;

-- ============================================
-- RECOMMANDATIONS D'INDEX BASÉS SUR LES STATS
-- ============================================

-- Identifier les colonnes fréquemment utilisées dans WHERE
-- (nécessite pg_stat_statements et analyse manuelle)

-- Pour chaque table importante, vérifier:
-- 1. Les colonnes dans WHERE clauses
-- 2. Les colonnes dans ORDER BY
-- 3. Les colonnes dans JOIN conditions

-- Exemple pour products:
-- - is_deleted (filtre fréquent) ✓
-- - category (filtre fréquent) ✓
-- - price (filtre + tri fréquent) ✓
-- - stock (filtre fréquent) ✓
-- - created_at (tri fréquent) ✓

-- Exemple pour orders:
-- - status (filtre fréquent) ✓
-- - user_id (filtre fréquent) ✓
-- - created_at (tri + filtres date) ✓
-- - order_number (lookup) ✓

