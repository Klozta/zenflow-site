// backend/src/routes/courseEnrollments.routes.ts
import { Router } from 'express';
import { RequestWithUser } from '../types/auth.types.js';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
    enrollUserInCourse,
    enrollUserInMultipleCourses,
    getEnrollmentById,
    getUserEnrollments,
    isUserEnrolled,
    updateCourseProgress,
} from '../services/courseEnrollmentService.js';
import { createError } from '../utils/errors.js';

const router = Router();

/**
 * @swagger
 * /api/courses/enrollments:
 *   get:
 *     summary: Récupère les inscriptions de l'utilisateur connecté
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des inscriptions
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const enrollments = await getUserEnrollments(userId);
    res.json({ enrollments });
  })
);

/**
 * @swagger
 * /api/courses/enrollments/:id:
 *   get:
 *     summary: Récupère une inscription spécifique
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const enrollment = await getEnrollmentById(req.params.id);
    if (!enrollment) {
      throw createError.notFound('Inscription introuvable');
    }

    // Vérifier que l'utilisateur est propriétaire de l'inscription
    if (enrollment.user_id !== userId && req.user?.role !== 'admin') {
      throw createError.forbidden('Accès non autorisé');
    }

    res.json({ enrollment });
  })
);

/**
 * @swagger
 * /api/courses/enrollments:
 *   post:
 *     summary: Inscrit l'utilisateur à un cours
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const schema = z.object({
      courseId: z.string().uuid('ID cours invalide'),
      orderId: z.string().uuid('ID commande invalide').optional().nullable(),
    });

    const { courseId, orderId } = schema.parse(req.body);

    const enrollment = await enrollUserInCourse({
      userId,
      courseId,
      orderId: orderId || null,
    });

    res.status(201).json({ enrollment });
  })
);

/**
 * @swagger
 * /api/courses/enrollments/batch:
 *   post:
 *     summary: Inscrit l'utilisateur à plusieurs cours (après achat)
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/batch',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const schema = z.object({
      courseIds: z.array(z.string().uuid('ID cours invalide')).min(1),
      orderId: z.string().uuid('ID commande invalide').optional().nullable(),
    });

    const { courseIds, orderId } = schema.parse(req.body);

    const enrollments = await enrollUserInMultipleCourses(userId, courseIds, orderId || null);

    res.status(201).json({ enrollments });
  })
);

/**
 * @swagger
 * /api/courses/enrollments/:id/progress:
 *   put:
 *     summary: Met à jour la progression dans un cours
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 */
router.put(
  '/:id/progress',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const schema = z.object({
      lessonId: z.string().uuid('ID leçon invalide'),
      completed: z.boolean().optional().default(true),
    });

    const { lessonId, completed } = schema.parse(req.body);

    // Vérifier que l'inscription appartient à l'utilisateur
    const enrollment = await getEnrollmentById(req.params.id);
    if (!enrollment) {
      throw createError.notFound('Inscription introuvable');
    }

    if (enrollment.user_id !== userId) {
      throw createError.forbidden('Accès non autorisé');
    }

    const updated = await updateCourseProgress({
      enrollmentId: req.params.id,
      lessonId,
      completed,
    });

    res.json({ enrollment: updated });
  })
);

/**
 * @swagger
 * /api/courses/:courseId/enrolled:
 *   get:
 *     summary: Vérifie si l'utilisateur est inscrit à un cours
 *     tags: [Course Enrollments]
 *     security:
 *       - bearerAuth: []
 */
router.get(
  '/course/:courseId/enrolled',
  authMiddleware,
  asyncHandler(async (req: RequestWithUser, res) => {
    const userId = req.user?.id;
    if (!userId) {
      throw createError.auth('Utilisateur non authentifié');
    }

    const enrolled = await isUserEnrolled(userId, req.params.courseId);
    res.json({ enrolled });
  })
);

export default router;
