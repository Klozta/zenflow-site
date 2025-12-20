-- Configuration pgAudit pour audit trail database-level
-- Basé sur recommandations Perplexity - Sécurité E-commerce 2025
--
-- Usage: Exécuter en tant que superuser PostgreSQL
-- psql -U postgres -d your_database -f configure-pg-audit.sql

-- 1. Installer l'extension pgAudit (si disponible)
-- Note: pgAudit peut ne pas être disponible sur toutes les instances Supabase
CREATE EXTENSION IF NOT EXISTS pgaudit;

-- 2. Configurer pgAudit pour logger toutes les opérations sur tables sensibles
-- Configuration globale (toutes les tables)
ALTER SYSTEM SET pgaudit.log = 'all';
ALTER SYSTEM SET pgaudit.log_catalog = off; -- Ne pas logger les requêtes système
ALTER SYSTEM SET pgaudit.log_parameter = on; -- Logger les paramètres des requêtes
ALTER SYSTEM SET pgaudit.log_statement_once = off; -- Logger chaque statement
ALTER SYSTEM SET pgaudit.log_relation = on; -- Logger les accès aux tables/vues

-- Configuration spécifique par role
-- Créer un rôle dédié pour l'audit (optionnel)
-- CREATE ROLE audit_role;

-- 3. Créer une table pour stocker les logs d'audit
-- (Alternative: utiliser les logs PostgreSQL standards ou une table custom)
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  user_name TEXT,
  database_name TEXT,
  table_name TEXT,
  action TEXT, -- SELECT, INSERT, UPDATE, DELETE
  statement TEXT,
  parameters JSONB,
  ip_address INET,
  user_id TEXT, -- ID utilisateur application (si disponible via session)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_action ON audit_logs(table_name, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id) WHERE user_id IS NOT NULL;

-- 4. Fonction pour parser les logs pgAudit et les insérer dans audit_logs
-- (À adapter selon votre setup PostgreSQL)
CREATE OR REPLACE FUNCTION process_pgaudit_log()
RETURNS TRIGGER AS $$
BEGIN
  -- Cette fonction devrait être appelée par un trigger ou un processus externe
  -- qui parse les logs PostgreSQL et les insère dans audit_logs
  -- Pour l'instant, c'est une structure de base
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 5. Triggers d'audit pour tables sensibles (approche application-level)
-- Alternative à pgAudit si non disponible
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_old_data JSONB;
  v_new_data JSONB;
  v_action TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_action := 'DELETE';
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'UPDATE';
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
  ELSIF TG_OP = 'INSERT' THEN
    v_action := 'INSERT';
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO audit_logs (
    timestamp,
    user_name,
    database_name,
    table_name,
    action,
    statement,
    parameters
  ) VALUES (
    NOW(),
    current_user,
    current_database(),
    TG_TABLE_NAME,
    v_action,
    TG_OP,
    jsonb_build_object(
      'old', v_old_data,
      'new', v_new_data
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 6. Appliquer les triggers d'audit sur tables sensibles
-- Exemple pour la table users (à adapter selon vos besoins)

-- DROP TRIGGER IF EXISTS audit_users_changes ON users;
-- CREATE TRIGGER audit_users_changes
--   AFTER INSERT OR UPDATE OR DELETE ON users
--   FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

-- Exemple pour la table orders
-- DROP TRIGGER IF EXISTS audit_orders_changes ON orders;
-- CREATE TRIGGER audit_orders_changes
--   AFTER INSERT OR UPDATE OR DELETE ON orders
--   FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

-- 7. Fonction pour nettoyer les anciens logs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_audit_logs(retention_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM audit_logs
  WHERE timestamp < NOW() - (retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 8. Créer un job pour nettoyer automatiquement (si pg_cron disponible)
-- SELECT cron.schedule(
--   'cleanup-audit-logs',
--   '0 2 * * *', -- Tous les jours à 02:00
--   'SELECT cleanup_audit_logs(90);'
-- );

-- 9. Vues pour faciliter l'analyse des logs
CREATE OR REPLACE VIEW audit_logs_summary AS
SELECT
  DATE_TRUNC('day', timestamp) AS day,
  table_name,
  action,
  COUNT(*) AS count,
  COUNT(DISTINCT user_name) AS unique_users,
  COUNT(DISTINCT user_id) AS unique_app_users
FROM audit_logs
GROUP BY DATE_TRUNC('day', timestamp), table_name, action
ORDER BY day DESC, table_name, action;

-- Vue pour les actions sensibles récentes
CREATE OR REPLACE VIEW audit_logs_recent_sensitive AS
SELECT
  id,
  timestamp,
  user_name,
  table_name,
  action,
  user_id
FROM audit_logs
WHERE
  action IN ('DELETE', 'UPDATE')
  AND table_name IN ('users', 'orders', 'payments')
  AND timestamp >= NOW() - INTERVAL '7 days'
ORDER BY timestamp DESC;

-- 10. Permissions (ajuster selon vos besoins de sécurité)
-- GRANT SELECT ON audit_logs TO readonly_role;
-- GRANT SELECT ON audit_logs_summary TO readonly_role;
-- GRANT SELECT ON audit_logs_recent_sensitive TO admin_role;

-- Note: Sur Supabase, certaines de ces configurations peuvent nécessiter
-- l'accès au superuser qui n'est pas disponible. Utiliser plutôt l'approche
-- application-level avec les triggers et l'audit logging existant.

