/**
 * Vues Matérialisées pour pré-agrégation des données
 * Basées sur recommandations Perplexity
 *
 * Amélioration de performance: 50-60% pour agrégations complexes
 *
 * Usage: Exécuter dans Supabase SQL Editor
 */

-- ============================================
-- VUE MATÉRIALISÉE: Résumé des ventes par jour et catégorie
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS sales_summary_daily AS
SELECT
  DATE_TRUNC('day', o.created_at) AS sale_date,
  p.category,
  COUNT(DISTINCT o.user_id) AS unique_customers,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(o.total) AS total_revenue,
  AVG(o.total) AS avg_order_value,
  MAX(o.total) AS max_order_value,
  MIN(o.total) AS min_order_value
FROM orders o
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON oi.product_id = p.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '90 days'
  AND o.status != 'cancelled'
GROUP BY DATE_TRUNC('day', o.created_at), p.category
WITH DATA;

-- Index unique pour refresh concurrent
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_summary_daily_unique
ON sales_summary_daily(sale_date, category);

-- ============================================
-- VUE MATÉRIALISÉE: Produits populaires par heure
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS top_products_hourly AS
SELECT
  DATE_TRUNC('hour', o.created_at) AS hour,
  oi.product_id,
  p.title,
  COUNT(DISTINCT o.id) AS order_count,
  SUM(oi.quantity) AS units_sold,
  SUM(oi.unit_price * oi.quantity) AS revenue,
  AVG(oi.unit_price) AS avg_unit_price
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
WHERE o.created_at >= CURRENT_DATE - INTERVAL '7 days'
  AND o.status != 'cancelled'
GROUP BY DATE_TRUNC('hour', o.created_at), oi.product_id, p.title
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_top_products_hourly_unique
ON top_products_hourly(hour, product_id);

-- ============================================
-- VUE MATÉRIALISÉE: Dashboard ventes temps réel
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS sales_dashboard_realtime AS
SELECT
  DATE_TRUNC('hour', o.created_at) AS period,
  COUNT(DISTINCT o.user_id) AS unique_customers,
  COUNT(DISTINCT o.id) AS total_orders,
  SUM(o.total) AS revenue,
  AVG(o.total) AS avg_order_value,
  MAX(o.total) AS max_order_value,
  COUNT(DISTINCT oi.product_id) AS unique_products_sold
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.created_at >= NOW() - INTERVAL '30 days'
  AND o.status != 'cancelled'
GROUP BY DATE_TRUNC('hour', o.created_at)
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_dashboard_realtime_unique
ON sales_dashboard_realtime(period);

-- ============================================
-- VUE MATÉRIALISÉE: Statistiques produits (stock, ventes)
-- ============================================

CREATE MATERIALIZED VIEW IF NOT EXISTS products_stats AS
SELECT
  p.id AS product_id,
  p.title,
  p.category,
  p.stock,
  p.price,
  COUNT(DISTINCT oi.order_id) AS times_ordered,
  SUM(oi.quantity) AS total_units_sold,
  SUM(oi.quantity * oi.unit_price) AS total_revenue,
  AVG(oi.quantity) AS avg_quantity_per_order,
  MAX(o.created_at) AS last_sale_date
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'cancelled'
WHERE p.is_deleted = false
GROUP BY p.id, p.title, p.category, p.stock, p.price
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_stats_unique
ON products_stats(product_id);

-- ============================================
-- FONCTIONS DE RAFRAÎCHISSEMENT
-- ============================================

-- Fonction pour rafraîchir toutes les vues matérialisées
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY sales_summary_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY top_products_hourly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY sales_dashboard_realtime;
  REFRESH MATERIALIZED VIEW CONCURRENTLY products_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PLANIFICATION RAFRAÎCHISSEMENT (avec pg_cron si disponible)
-- ============================================

-- Rafraîchir sales_dashboard_realtime toutes les 15 minutes
-- SELECT cron.schedule(
--   'refresh-sales-dashboard',
--   '*/15 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY sales_dashboard_realtime'
-- );

-- Rafraîchir top_products_hourly toutes les heures
-- SELECT cron.schedule(
--   'refresh-top-products',
--   '0 * * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY top_products_hourly'
-- );

-- Rafraîchir sales_summary_daily quotidiennement à 2h du matin
-- SELECT cron.schedule(
--   'refresh-sales-summary',
--   '0 2 * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY sales_summary_daily'
-- );

-- Rafraîchir products_stats quotidiennement à 3h du matin
-- SELECT cron.schedule(
--   'refresh-products-stats',
--   '0 3 * * *',
--   'REFRESH MATERIALIZED VIEW CONCURRENTLY products_stats'
-- );

-- ============================================
-- NOTES D'UTILISATION
-- ============================================

-- Pour utiliser les vues matérialisées dans le code:
--
-- 1. Dashboard ventes temps réel (7 derniers jours):
--    SELECT * FROM sales_dashboard_realtime
--    WHERE period >= NOW() - INTERVAL '7 days'
--    ORDER BY period DESC;
--
-- 2. Top produits dernière heure:
--    SELECT * FROM top_products_hourly
--    WHERE hour >= NOW() - INTERVAL '1 hour'
--    ORDER BY units_sold DESC
--    LIMIT 10;
--
-- 3. Résumé ventes par catégorie:
--    SELECT * FROM sales_summary_daily
--    WHERE sale_date >= CURRENT_DATE - INTERVAL '30 days'
--    ORDER BY sale_date DESC, category;
--
-- 4. Statistiques produit:
--    SELECT * FROM products_stats
--    WHERE product_id = 'uuid-here';

