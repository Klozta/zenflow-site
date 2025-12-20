import axios from 'axios';
import { getCache, setCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

export type RobotsCacheStatus = 'hit' | 'miss' | 'disabled' | 'error';

export interface RobotsCheckResult {
  allowed: boolean;
  reason: 'allowed' | 'disallowed' | 'no_robots' | 'fetch_error' | 'parse_error';
  cacheStatus: RobotsCacheStatus;
  robotsUrl: string;
}

type RobotsRule = { allow: boolean; path: string };

function normalizePath(p: string): string {
  if (!p.startsWith('/')) return `/${p}`;
  return p;
}

function pathMatches(rulePath: string, targetPath: string): boolean {
  const rp = normalizePath(rulePath);
  const tp = normalizePath(targetPath);
  // Standard simple: préfixe
  return tp.startsWith(rp);
}

function parseRobotsTxt(content: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  const lines = content.split('\n').map(l => l.trim());

  let applies = false;
  for (const raw of lines) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;

    const [kRaw, vRaw] = line.split(':', 2);
    if (!kRaw || vRaw === undefined) continue;
    const key = kRaw.trim().toLowerCase();
    const value = vRaw.trim();

    if (key === 'user-agent') {
      // On applique seulement le bloc User-agent: *
      applies = value === '*' ? true : false;
      continue;
    }

    if (!applies) continue;

    if (key === 'disallow') {
      if (value === '') continue; // disallow vide => tout autorisé
      rules.push({ allow: false, path: value });
    }
    if (key === 'allow') {
      if (value === '') continue;
      rules.push({ allow: true, path: value });
    }
  }

  return rules;
}

function decideAllowed(rules: RobotsRule[], targetPath: string): boolean {
  // Règle simple et courante: la règle la plus spécifique (longueur max) gagne.
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!pathMatches(r.path, targetPath)) continue;
    if (!best || normalizePath(r.path).length > normalizePath(best.path).length) {
      best = r;
    }
  }
  if (!best) return true;
  return best.allow;
}

function robotsCacheKey(hostname: string): string {
  return `compliance:robots:${hostname}`;
}

export class RobotsValidator {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;
  private readonly userAgent: string;

  constructor(opts?: { ttlSeconds?: number; enabled?: boolean; userAgent?: string }) {
    this.ttlSeconds = opts?.ttlSeconds ?? 86400; // 24h
    this.enabled = opts?.enabled ?? true;
    this.userAgent = (opts?.userAgent || process.env.COMPLIANCE_USER_AGENT || 'ZenFlowProductImporter/1.0').trim();
  }

  async canFetch(url: string): Promise<RobotsCheckResult> {
    const { hostname, pathname, protocol } = new URL(url);
    const robotsUrl = `${protocol}//${hostname}/robots.txt`;

    if (!this.enabled) {
      return { allowed: true, reason: 'allowed', cacheStatus: 'disabled', robotsUrl };
    }

    const key = robotsCacheKey(hostname);
    try {
      const cached = await getCache<{ rules: RobotsRule[] }>(key);
      if (cached?.rules) {
        const allowed = decideAllowed(cached.rules, pathname);
        return { allowed, reason: allowed ? 'allowed' : 'disallowed', cacheStatus: 'hit', robotsUrl };
      }
    } catch (error) {
      logger.warn('Robots cache read failed', { hostname, error: error instanceof Error ? error.message : String(error) });
      // continue with network fetch
    }

    try {
      const resp = await axios.get(robotsUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/plain,*/*',
          'DNT': '1',
        },
        validateStatus: () => true,
      });

      if (resp.status >= 400) {
        // robots.txt absent => souvent considéré comme autorisé (mais dépend des CGU)
        return { allowed: true, reason: 'no_robots', cacheStatus: 'miss', robotsUrl };
      }

      const body = typeof resp.data === 'string' ? resp.data : String(resp.data ?? '');
      let rules: RobotsRule[] = [];
      try {
        rules = parseRobotsTxt(body);
      } catch {
        return { allowed: false, reason: 'parse_error', cacheStatus: 'miss', robotsUrl };
      }

      // Cache parsed rules
      try {
        await setCache(key, { rules }, this.ttlSeconds);
      } catch (error) {
        logger.warn('Robots cache write failed', { hostname, error: error instanceof Error ? error.message : String(error) });
      }

      const allowed = decideAllowed(rules, pathname);
      return { allowed, reason: allowed ? 'allowed' : 'disallowed', cacheStatus: 'miss', robotsUrl };
    } catch (error) {
      return {
        allowed: false,
        reason: 'fetch_error',
        cacheStatus: 'error',
        robotsUrl,
      };
    }
  }
}

