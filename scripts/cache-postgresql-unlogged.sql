/**
 * Table de cache PostgreSQL unlogged pour performances
 * Basé sur recommandations Perplexity
 *
 * Alternative/complément à Redis pour volumes moyens
 * Performance: ~7425 req/s (640M req/jour) - suffisant pour volumes moyens
 *
 * Usage: Exécuter dans Supabase SQL Editor
 */

-- ============================================
-- TABLE CACHE UNLOGGED (pas de WAL = plus rapide)
-- ============================================

CREATE UNLOGGED TABLE IF NOT EXISTS session_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  cache_value JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  access_count INTEGER NOT NULL DEFAULT 0
);

-- Index pour recherche rapide par expiration
CREATE INDEX IF NOT EXISTS idx_session_cache_expiry
ON session_cache(expires_at)
WHERE expires_at > NOW();

-- Index pour nettoyage périodique
CREATE INDEX IF NOT EXISTS idx_session_cache_last_accessed
ON session_cache(last_accessed_at);

-- ============================================
-- FONCTIONS DE GESTION DU CACHE
-- ============================================

-- Fonction: Obtenir une valeur du cache
CREATE OR REPLACE FUNCTION cache_get(p_key VARCHAR(255))
RETURNS JSONB AS $$
DECLARE
  v_value JSONB;
BEGIN
  -- Vérifier expiration
  SELECT cache_value, NOW()
  INTO v_value, v_value -- Mettre à jour last_accessed_at via trigger si besoin
  FROM session_cache
  WHERE cache_key = p_key
    AND expires_at > NOW();

  -- Mettre à jour last_accessed_at et access_count
  IF v_value IS NOT NULL THEN
    UPDATE session_cache
    SET last_accessed_at = NOW(),
        access_count = access_count + 1
    WHERE cache_key = p_key;
  END IF;

  RETURN v_value;
END;
$$ LANGUAGE plpgsql;

-- Fonction: Mettre une valeur en cache
CREATE OR REPLACE FUNCTION cache_set(
  p_key VARCHAR(255),
  p_value JSONB,
  p_ttl_seconds INTEGER DEFAULT 3600
)
RETURNS void AS $$
BEGIN
  INSERT INTO session_cache (cache_key, cache_value, expires_at)
  VALUES (p_key, p_value, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (cache_key)
  DO UPDATE SET
    cache_value = EXCLUDED.cache_value,
    expires_at = EXCLUDED.expires_at,
    created_at = CASE
      WHEN session_cache.access_count = 0 THEN EXCLUDED.created_at
      ELSE session_cache.created_at
    END,
    last_accessed_at = NOW(),
    access_count = 0; -- Reset access count on update
END;
$$ LANGUAGE plpgsql;

-- Fonction: Supprimer une clé du cache
CREATE OR REPLACE FUNCTION cache_delete(p_key VARCHAR(255))
RETURNS BOOLEAN AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM session_cache WHERE cache_key = p_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$ LANGUAGE plpgsql;

-- Fonction: Nettoyer les entrées expirées
CREATE OR REPLACE FUNCTION cache_cleanup_expired()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM session_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Fonction: Nettoyer les entrées les moins utilisées (LRU)
CREATE OR REPLACE FUNCTION cache_cleanup_lru(max_size INTEGER DEFAULT 10000)
RETURNS INTEGER AS $$
DECLARE
  v_current_count INTEGER;
  v_to_delete INTEGER;
  v_deleted INTEGER;
BEGIN
  -- Compter entrées actuelles
  SELECT COUNT(*) INTO v_current_count FROM session_cache;

  -- Si sous la limite, rien à faire
  IF v_current_count <= max_size THEN
    RETURN 0;
  END IF;

  -- Calculer combien supprimer (garder 80% de max_size)
  v_to_delete := v_current_count - (max_size * 0.8)::INTEGER;

  -- Supprimer les entrées les moins récemment utilisées
  WITH to_delete AS (
    SELECT cache_key
    FROM session_cache
    ORDER BY last_accessed_at ASC, access_count ASC
    LIMIT v_to_delete
  )
  DELETE FROM session_cache
  WHERE cache_key IN (SELECT cache_key FROM to_delete);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PLANIFICATION NETTOYAGE (avec pg_cron si disponible)
-- ============================================

-- Nettoyer les entrées expirées toutes les 15 minutes
-- SELECT cron.schedule(
--   'cleanup-expired-cache',
--   '*/15 * * * *',
--   'SELECT cache_cleanup_expired()'
-- );

-- Nettoyer LRU si nécessaire toutes les heures
-- SELECT cron.schedule(
--   'cleanup-lru-cache',
--   '0 * * * *',
--   'SELECT cache_cleanup_lru(10000)'
-- );

-- ============================================
-- STATISTIQUES CACHE (monitoring)
-- ============================================

-- Fonction: Obtenir statistiques du cache
CREATE OR REPLACE FUNCTION cache_stats()
RETURNS TABLE (
  total_entries BIGINT,
  active_entries BIGINT,
  expired_entries BIGINT,
  total_access_count BIGINT,
  avg_access_count NUMERIC,
  oldest_entry TIMESTAMP,
  newest_entry TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_entries,
    COUNT(*) FILTER (WHERE expires_at > NOW())::BIGINT AS active_entries,
    COUNT(*) FILTER (WHERE expires_at <= NOW())::BIGINT AS expired_entries,
    SUM(access_count)::BIGINT AS total_access_count,
    ROUND(AVG(access_count)::NUMERIC, 2) AS avg_access_count,
    MIN(created_at) AS oldest_entry,
    MAX(created_at) AS newest_entry
  FROM session_cache;
END;
$$ LANGUAGE plpgsql;

-- Utilisation:
-- SELECT * FROM cache_stats();

-- ============================================
-- NOTES D'UTILISATION DANS LE CODE
-- ============================================

-- Exemple d'utilisation dans Node.js/TypeScript:
--
-- // Obtenir depuis cache
-- const { data, error } = await supabase.rpc('cache_get', {
--   p_key: 'products:category:5'
-- });
-- if (data) return JSON.parse(data);
--
-- // Mettre en cache
-- await supabase.rpc('cache_set', {
--   p_key: 'products:category:5',
--   p_value: JSON.stringify(products),
--   p_ttl_seconds: 3600
-- });
--
-- // Supprimer cache
-- await supabase.rpc('cache_delete', {
--   p_key: 'products:category:5'
-- });

