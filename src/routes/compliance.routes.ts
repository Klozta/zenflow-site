/**
 * Routes conformité (read-only)
 * - Expose métriques basées sur la Compliance DB (Postgres séparé)
 * - Sans PII
 */
import { Router } from 'express';
import { isComplianceDbEnabled, queryComplianceDb } from '../services/compliance/complianceLogger.js';
import { logger } from '../utils/logger.js';

const router = Router();

function isAuthorized(req: any): boolean {
  const key = req.headers['x-cron-key'] || req.query.key;
  const expected = process.env.CRON_API_KEY || process.env.ADMIN_TOKEN;
  if (!expected) return process.env.NODE_ENV === 'development';
  return key === expected;
}

// GET /api/compliance/status
// - Vérifie que la Compliance DB est activée, joignable, et que le schéma attendu existe.
router.get('/status', async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!isComplianceDbEnabled()) {
      return res.status(501).json({
        ok: false,
        error: 'COMPLIANCE_DB_DISABLED',
        message: 'Compliance DB non activée (COMPLIANCE_DB_ENABLED=false).',
      });
    }

    // Basic connectivity check
    const dbNow = await queryComplianceDb<{ now: string }>('SELECT now()::text AS now');

    // Schema checks (tables + views)
    const schema = await queryComplianceDb<{
      products: string | null;
      compliance_audit: string | null;
      v_compliance_last_24h_metrics: string | null;
      v_products_per_source: string | null;
      v_compliance_incidents: string | null;
    }>(
      `
      SELECT
        to_regclass('public.products')::text AS products,
        to_regclass('public.compliance_audit')::text AS compliance_audit,
        to_regclass('public.v_compliance_last_24h_metrics')::text AS v_compliance_last_24h_metrics,
        to_regclass('public.v_products_per_source')::text AS v_products_per_source,
        to_regclass('public.v_compliance_incidents')::text AS v_compliance_incidents
      `
    );

    const s = schema?.[0] || ({} as any);
    const schemaOk =
      Boolean(s.products) &&
      Boolean(s.compliance_audit) &&
      Boolean(s.v_compliance_last_24h_metrics) &&
      Boolean(s.v_products_per_source) &&
      Boolean(s.v_compliance_incidents);

    return res.json({
      ok: true,
      enabled: true,
      now: new Date().toISOString(),
      db: {
        connected: true,
        serverTime: dbNow?.[0]?.now || null,
      },
      schema: {
        ok: schemaOk,
        products: Boolean(s.products),
        complianceAudit: Boolean(s.compliance_audit),
        views: {
          last24hMetrics: Boolean(s.v_compliance_last_24h_metrics),
          productsPerSource: Boolean(s.v_products_per_source),
          incidents: Boolean(s.v_compliance_incidents),
        },
      },
      mode: {
        complianceMode: process.env.COMPLIANCE_MODE || 'unknown',
        dataScope: process.env.COMPLIANCE_DATA_SCOPE || 'unknown',
        robotsEnabled: process.env.COMPLIANCE_ROBOTS_ENABLED || 'unknown',
        sourcePolicyMode: process.env.SOURCE_POLICY_MODE || 'unknown',
      },
    });
  } catch (error: any) {
    logger.error('Compliance status error', error);
    return res.status(503).json({
      ok: false,
      error: 'COMPLIANCE_DB_UNAVAILABLE',
      message: 'Compliance DB inaccessible ou schéma manquant.',
    });
  }
});

// GET /api/compliance/metrics?hours=24
router.get('/metrics', async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!isComplianceDbEnabled()) {
      return res.status(501).json({
        error: 'COMPLIANCE_DB_DISABLED',
        message: 'Compliance DB non activée (COMPLIANCE_DB_ENABLED=false).',
      });
    }

    const hours = Math.min(Math.max(parseInt(String(req.query.hours || '24'), 10) || 24, 1), 168);

    const byEvent = await queryComplianceDb<{
      event_type: string;
      events: number;
      errors: number;
      avg_duration_ms: number | null;
    }>(
      `
      SELECT
        event_type,
        COUNT(*)::int AS events,
        SUM(CASE WHEN http_status >= 400 THEN 1 ELSE 0 END)::int AS errors,
        AVG(duration_ms)::float AS avg_duration_ms
      FROM compliance_audit
      WHERE timestamp >= now() - make_interval(hours => $1)
      GROUP BY event_type
      ORDER BY events DESC
      `,
      [hours]
    );

    const incidents = await queryComplianceDb<any>(
      `
      SELECT timestamp, event_type, source_host, http_status, error_message, cache_status, request_id
      FROM compliance_audit
      WHERE timestamp >= now() - make_interval(hours => $1)
        AND event_type IN ('crawl_blocked_policy','crawl_blocked_robots','crawl_error')
      ORDER BY timestamp DESC
      LIMIT 50
      `,
      [hours]
    );

    return res.json({
      ok: true,
      windowHours: hours,
      now: new Date().toISOString(),
      byEvent,
      incidents,
    });
  } catch (error: any) {
    logger.error('Compliance metrics error', error);
    return res.status(500).json({ error: 'Failed to fetch compliance metrics' });
  }
});

export default router;

