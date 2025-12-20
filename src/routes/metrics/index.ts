/**
 * Routes métriques - Point d'entrée principal
 * Combine tous les sous-modules de métriques
 */
import { Router } from 'express';
import alertsRoutes from './alerts.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import exportRoutes from './export.routes.js';
import miscRoutes from './misc.routes.js';
import ordersRoutes from './orders.routes.js';
import performanceRoutes from './performance.routes.js';
import productsRoutes from './products.routes.js';
import usersRoutes from './users.routes.js';

const router = Router();

// Monter tous les sous-routers
router.use('/', dashboardRoutes);
router.use('/', ordersRoutes);
router.use('/', productsRoutes);
router.use('/', usersRoutes);
router.use('/', performanceRoutes);
router.use('/', alertsRoutes);
router.use('/', exportRoutes);
router.use('/', miscRoutes);

export default router;

