-- Compliance Importer Schema (France/UE - GDPR by design)
-- Objectif: minimisation des données + audit trail immuable (sans PII).

-- Note: aucun extension requise (UUID générés côté application).

-- =========================
-- 1) PRODUCTS (whitelist)
-- =========================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,

  -- Whitelist des champs autorisés (NO PII)
  product_id TEXT NOT NULL,
  title VARCHAR(140) NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency VARCHAR(8) NOT NULL,
  availability VARCHAR(64) NOT NULL,
  source_url TEXT NOT NULL,
  source_host TEXT NOT NULL,
  category TEXT NULL,
  estimated_stock INTEGER NULL CHECK (estimated_stock IS NULL OR estimated_stock >= 0),

  -- Traçabilité / déduplication (sans PII)
  source_hash TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes de conformité
  CONSTRAINT chk_title_len CHECK (char_length(title) <= 140),
  CONSTRAINT uq_product_source UNIQUE (product_id, source_host)
);

CREATE INDEX IF NOT EXISTS idx_products_source_host ON products(source_host);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);

COMMENT ON TABLE products IS
  'Table produits (whitelist). AUCUNE colonne image/description/avis/PII. Conformité par conception.';

-- =========================
-- 2) COMPLIANCE AUDIT (immutable)
-- =========================
CREATE TABLE IF NOT EXISTS compliance_audit (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  source_host TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER NULL,
  duration_ms INTEGER NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  user_agent TEXT NULL,
  cache_status TEXT NULL,
  compliance_checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NULL,
  request_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compliance_timestamp ON compliance_audit(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_event ON compliance_audit(event_type);

COMMENT ON TABLE compliance_audit IS
  'Audit trail conformité (sans PII). Conserver 12 mois (politique interne).';

-- =========================
-- 3) Views (monitoring)
-- =========================
CREATE OR REPLACE VIEW v_compliance_last_24h_metrics AS
SELECT
  date_trunc('hour', timestamp) AS hour,
  event_type,
  source_host,
  count(*) AS events,
  avg(duration_ms) AS avg_duration_ms,
  sum(CASE WHEN http_status >= 400 THEN 1 ELSE 0 END) AS errors
FROM compliance_audit
WHERE timestamp >= now() - interval '24 hours'
GROUP BY 1,2,3
ORDER BY hour DESC;

CREATE OR REPLACE VIEW v_products_per_source AS
SELECT
  source_host,
  count(*) AS products,
  max(imported_at) AS last_import
FROM products
GROUP BY 1
ORDER BY products DESC;

CREATE OR REPLACE VIEW v_compliance_incidents AS
SELECT
  timestamp,
  event_type,
  source_host,
  http_status,
  error_message,
  compliance_checks,
  request_id
FROM compliance_audit
WHERE event_type IN ('crawl_blocked_policy','crawl_blocked_robots','crawl_error')
ORDER BY timestamp DESC;

-- =========================
-- 4) Retention helpers
-- =========================
-- Audit retention (12 months) — ajustable selon ta politique interne.
CREATE OR REPLACE FUNCTION cleanup_compliance_audit(retention_months integer DEFAULT 12)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM compliance_audit
  WHERE timestamp < now() - make_interval(months => retention_months);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_compliance_audit IS
  'Supprime les logs de conformité plus vieux que N mois (par défaut 12).';

