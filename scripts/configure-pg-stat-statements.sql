/**
 * Configuration pg_stat_statements pour monitoring des requêtes
 * Basé sur recommandations Perplexity
 *
 * Permet d'identifier les requêtes lentes et les goulots d'étranglement
 *
 * Usage: Exécuter dans Supabase SQL Editor (si extension disponible)
 */

-- ============================================
-- ACTIVATION EXTENSION pg_stat_statements
-- ============================================

-- Activer l'extension (nécessite droits superuser sur Supabase)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Configuration recommandée
ALTER SYSTEM SET pg_stat_statements.max = 10000; -- Nombre max de requêtes trackées
ALTER SYSTEM SET pg_stat_statements.track = 'all'; -- Tracker toutes les requêtes
ALTER SYSTEM SET pg_stat_statements.track_utility = 'on'; -- Tracker aussi COMMIT, BEGIN, etc.

-- Recharger la configuration (nécessite redémarrage ou SELECT pg_reload_conf();)
-- SELECT pg_reload_conf();

-- ============================================
-- REQUÊTES UTILES POUR ANALYSE
-- ============================================

-- Top 10 requêtes les plus lentes (par temps total)
-- SELECT
--   LEFT(query, 100) AS query_preview,
--   calls,
--   ROUND(total_exec_time::numeric, 2) AS total_time_ms,
--   ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
--   ROUND(max_exec_time::numeric, 2) AS max_time_ms,
--   ROUND((total_exec_time / calls)::numeric, 2) AS avg_time_per_call_ms
-- FROM pg_stat_statements
-- WHERE calls > 5 -- Ignorer les requêtes uniques
-- ORDER BY total_exec_time DESC
-- LIMIT 10;

-- Top 10 requêtes les plus fréquentes (potentiellement à optimiser)
-- SELECT
--   LEFT(query, 100) AS query_preview,
--   calls,
--   ROUND(total_exec_time::numeric, 2) AS total_time_ms,
--   ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
--   ROUND((100.0 * total_exec_time / SUM(total_exec_time) OVER ())::numeric, 2) AS pct_of_total_time
-- FROM pg_stat_statements
-- WHERE calls > 10
-- ORDER BY calls DESC
-- LIMIT 10;

-- Requêtes avec temps d'exécution p99 élevé (goulots d'étranglement)
-- SELECT
--   LEFT(query, 100) AS query_preview,
--   calls,
--   ROUND(mean_exec_time::numeric, 2) AS mean_ms,
--   ROUND(max_exec_time::numeric, 2) AS max_ms,
--   ROUND(stddev_exec_time::numeric, 2) AS stddev_ms
-- FROM pg_stat_statements
-- WHERE calls > 10
--   AND stddev_exec_time > mean_exec_time * 2 -- Variance élevée = requêtes instables
-- ORDER BY max_exec_time DESC
-- LIMIT 10;

-- Requêtes avec beaucoup de scans séquentiels (manque d'index)
-- SELECT
--   LEFT(query, 100) AS query_preview,
--   calls,
--   shared_blks_hit + shared_blks_read AS total_blocks,
--   shared_blks_hit AS cache_hits,
--   shared_blks_read AS disk_reads,
--   ROUND((100.0 * shared_blks_read / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) AS pct_disk_reads
-- FROM pg_stat_statements
-- WHERE calls > 10
--   AND shared_blks_read > 1000 -- Beaucoup de lectures disque
-- ORDER BY shared_blks_read DESC
-- LIMIT 10;

-- ============================================
-- FONCTION HELPER POUR RAPPORT COMPLET
-- ============================================

CREATE OR REPLACE FUNCTION analyze_slow_queries(limit_count INTEGER DEFAULT 20)
RETURNS TABLE (
  query_preview TEXT,
  calls BIGINT,
  total_time_ms NUMERIC,
  mean_time_ms NUMERIC,
  max_time_ms NUMERIC,
  cache_hit_rate NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    LEFT(query, 150) AS query_preview,
    calls,
    ROUND(total_exec_time::numeric, 2) AS total_time_ms,
    ROUND(mean_exec_time::numeric, 2) AS mean_time_ms,
    ROUND(max_exec_time::numeric, 2) AS max_time_ms,
    ROUND((100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) AS cache_hit_rate
  FROM pg_stat_statements
  WHERE calls > 5
  ORDER BY total_exec_time DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Utilisation:
-- SELECT * FROM analyze_slow_queries(10);

-- ============================================
-- NETTOYAGE PÉRIODIQUE (recommandé mensuel)
-- ============================================

-- Réinitialiser les statistiques (à faire périodiquement pour éviter le vieillissement)
-- SELECT pg_stat_statements_reset();

-- Ou réinitialiser seulement pour certaines requêtes spécifiques:
-- SELECT pg_stat_statements_reset(userid, dbid, queryid);

