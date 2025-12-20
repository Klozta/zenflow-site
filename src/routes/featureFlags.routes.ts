/**
 * Routes pour gérer les feature flags
 * Permet de configurer les feature flags dynamiquement
 */
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { featureFlags } from '../services/featureFlags.js';
import { logger } from '../utils/logger.js';

const router = Router();

const featureFlagSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  description: z.string().optional(),
  rollout: z.object({
    percentage: z.number().min(0).max(100).optional(),
    userIds: z.array(z.string()).optional(),
    userEmails: z.array(z.string().email()).optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

/**
 * GET /api/feature-flags - Liste toutes les feature flags
 */
router.get('/', requireAdminAuth, asyncHandler(async (_req: Request, res: Response) => {
  const flags = await featureFlags.getAllFlags();
  return res.json({ flags });
}));

/**
 * GET /api/feature-flags/:name - Récupère une feature flag spécifique
 */
router.get('/:name', requireAdminAuth, asyncHandler(async (req: Request, res: Response) => {
  const flag = await featureFlags.getFlag(req.params.name);
  if (!flag) {
    return res.status(404).json({ error: 'Feature flag not found' });
  }
  return res.json({ flag });
}));

/**
 * POST /api/feature-flags - Crée ou met à jour une feature flag
 */
router.post(
  '/',
  requireAdminAuth,
  validate(featureFlagSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const flagData = req.body;
    await featureFlags.setFlag(flagData);
    logger.info('Feature flag updated', { name: flagData.name, enabled: flagData.enabled });
    return res.json({ success: true, flag: flagData });
  })
);

/**
 * POST /api/feature-flags/:name/enable - Active une feature flag
 */
router.post('/:name/enable', requireAdminAuth, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  const { description } = req.body as { description?: string };

  await featureFlags.enableFlag(name, description);
  logger.info('Feature flag enabled', { name });
  return res.json({ success: true, message: `Feature flag ${name} enabled` });
}));

/**
 * POST /api/feature-flags/:name/disable - Désactive une feature flag
 */
router.post('/:name/disable', requireAdminAuth, asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;

  try {
    await featureFlags.disableFlag(name);
    logger.info('Feature flag disabled', { name });
    return res.json({ success: true, message: `Feature flag ${name} disabled` });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

/**
 * POST /api/feature-flags/cache/invalidate - Invalide le cache des feature flags
 */
router.post('/cache/invalidate', requireAdminAuth, asyncHandler(async (_req: Request, res: Response) => {
  featureFlags.invalidateCache();
  logger.info('Feature flags cache invalidated');
  return res.json({ success: true, message: 'Cache invalidated' });
}));

export default router;

