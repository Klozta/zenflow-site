/**
 * Middleware rate limiting pour imports
 */
import { importRateLimiter } from '../utils/rateLimiter.js';

/**
 * Rate limiter pour imports (utilise importRateLimiter)
 */
export const rateLimitImport = importRateLimiter;





