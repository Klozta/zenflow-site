import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';

export type ComplianceEventType =
  | 'crawl_attempt'
  | 'crawl_blocked_policy'
  | 'crawl_blocked_robots'
  | 'crawl_success'
  | 'crawl_error';

export interface ComplianceChecks {
  complianceMode: string;
  dataScope: string;
  policy?: {
    hostPattern: string;
    cguStatus: string;
    allowHtmlCrawl: boolean;
    apiOnly: boolean;
  };
  robots?: {
    allowed: boolean;
    reason: string;
    cacheStatus: string;
    robotsUrl: string;
  };
}

export interface ComplianceAuditLogInput {
  eventType: ComplianceEventType;
  sourceHost: string;
  productCount?: number;
  httpStatus?: number;
  durationMs?: number;
  userAgent?: string;
  cacheStatus?: string;
  complianceChecks?: ComplianceChecks;
  errorMessage?: string;
  requestId?: string;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;

  const host = process.env.COMPLIANCE_DB_HOST;
  const port = process.env.COMPLIANCE_DB_PORT ? Number(process.env.COMPLIANCE_DB_PORT) : 5432;
  const database = process.env.COMPLIANCE_DB_NAME;
  const user = process.env.COMPLIANCE_DB_USER;
  const password = process.env.COMPLIANCE_DB_PASSWORD;

  if (!host || !database || !user || !password) {
    throw new Error('Compliance DB env missing: COMPLIANCE_DB_HOST/NAME/USER/PASSWORD');
  }

  pool = new Pool({
    host,
    port,
    database,
    user,
    password,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.COMPLIANCE_DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

export function isComplianceDbEnabled(): boolean {
  return process.env.COMPLIANCE_DB_ENABLED === 'true';
}

export async function queryComplianceDb<T = unknown>(
  sql: string,
  params: Array<string | number | boolean | null> = []
): Promise<T[]> {
  const p = getPool();
  const result = await p.query(sql, params);
  return (result.rows || []) as T[];
}

export class ComplianceLogger {
  private readonly enabled: boolean;

  constructor(opts?: { enabled?: boolean }) {
    // Enabled by default if env is present; otherwise disabled (no hard crash).
    this.enabled = opts?.enabled ?? (process.env.COMPLIANCE_DB_ENABLED === 'true');
  }

  async log(input: ComplianceAuditLogInput): Promise<void> {
    if (!this.enabled) return;

    const id = uuidv4();
    const requestId = input.requestId || uuidv4();
    const now = new Date().toISOString();

    try {
      const p = getPool();
      await p.query(
        `
          INSERT INTO compliance_audit (
            id, timestamp, event_type, source_host, product_count,
            http_status, duration_ms, user_agent, cache_status,
            compliance_checks, error_message, request_id
          ) VALUES (
            $1::uuid, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10::jsonb, $11, $12::uuid
          )
        `,
        [
          id,
          now,
          input.eventType,
          input.sourceHost,
          input.productCount ?? 0,
          input.httpStatus ?? null,
          input.durationMs ?? null,
          input.userAgent ?? null,
          input.cacheStatus ?? null,
          input.complianceChecks ? JSON.stringify(input.complianceChecks) : JSON.stringify({}),
          input.errorMessage ?? null,
          requestId,
        ]
      );
    } catch (error) {
      logger.warn('Compliance audit log failed (non-blocking)', {
        eventType: input.eventType,
        sourceHost: input.sourceHost,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

