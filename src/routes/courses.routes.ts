// backend/src/routes/courses.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAdminAuth } from '../middleware/adminAuth.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
    addCourseReview,
    createCourse,
    createLesson,
    deleteCourse,
    deleteLesson,
    getCourseById,
    getCourseLessons,
    getCourseReviews,
    getCourses,
    getCoursesStats,
    getInstructors,
    updateCourse,
    updateLesson,
} from '../services/coursesService.js';
import {
    courseReviewSchema,
    courseSchema,
    filterCoursesSchema,
    lessonSchema,
    updateCourseSchema,
    updateLessonSchema,
} from '../validations/schemas.js';

const router = Router();

/**
 * GET /api/courses
 * Liste des cours avec filtres
 */
router.get(
  '/',
  validate(filterCoursesSchema, 'query'),
  asyncHandler(async (req, res) => {
    const filters: any = {};

    // Pagination
    if (req.query.page) {
      const page = parseInt(String(req.query.page));
      if (!isNaN(page) && page > 0) filters.page = page;
    }
    if (req.query.limit) {
      const limit = parseInt(String(req.query.limit));
      if (!isNaN(limit) && limit > 0 && limit <= 100) filters.limit = limit;
    }

    // Filtres
    if (req.query.level && typeof req.query.level === 'string') {
      const validLevels = ['débutant', 'intermédiaire', 'avancé'];
      if (validLevels.includes(req.query.level)) {
        filters.level = req.query.level;
      }
    }

    if (req.query.format && typeof req.query.format === 'string') {
      const validFormats = ['en ligne', 'présentiel', 'mixte'];
      if (validFormats.includes(req.query.format)) {
        filters.format = req.query.format;
      }
    }

    if (req.query.price_min && typeof req.query.price_min === 'string') {
      const priceMin = parseFloat(req.query.price_min);
      if (!isNaN(priceMin) && priceMin >= 0) filters.minPrice = priceMin;
    }

    if (req.query.price_max && typeof req.query.price_max === 'string') {
      const priceMax = parseFloat(req.query.price_max);
      if (!isNaN(priceMax) && priceMax >= 0) filters.maxPrice = priceMax;
    }

    if (req.query.instructor_id && typeof req.query.instructor_id === 'string') {
      filters.instructor_id = req.query.instructor_id;
    }

    if (req.query.sort && typeof req.query.sort === 'string') {
      const validSorts = ['price_asc', 'price_desc', 'rating_desc', 'created_at_desc'];
      if (validSorts.includes(req.query.sort)) {
        filters.sort = req.query.sort;
      }
    }

    // Recherche full-text
    if (req.query.search && typeof req.query.search === 'string') {
      filters.search = req.query.search.trim();
    }

    const result = await getCourses(filters);
    return res.json(result);
  })
);

/**
 * GET /api/courses/instructors
 * Liste des instructeurs
 */
router.get(
  '/instructors',
  asyncHandler(async (_req, res) => {
    const instructors = await getInstructors();
    return res.json({ instructors });
  })
);

/**
 * GET /api/courses/stats
 * Statistiques des cours
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await getCoursesStats();
    return res.json({ stats });
  })
);

/**
 * GET /api/courses/:id
 * Détails d'un cours
 */
router.get(
  '/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const includeRelations = req.query.include === 'all';
    const course = await getCourseById(req.params.id, includeRelations);
    if (!course) {
      const { createError } = await import('../utils/errors.js');
      throw createError.notFound('Cours introuvable');
    }
    return res.json({ course });
  })
);

/**
 * GET /api/courses/:id/lessons
 * Liste des leçons d'un cours
 */
router.get(
  '/:id/lessons',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const lessons = await getCourseLessons(req.params.id);
    return res.json({ lessons });
  })
);

/**
 * GET /api/courses/:id/reviews
 * Liste des avis d'un cours
 */
router.get(
  '/:id/reviews',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const reviews = await getCourseReviews(req.params.id);
    return res.json({ reviews });
  })
);

/**
 * POST /api/courses
 * Créer un cours (admin)
 */
router.post(
  '/',
  requireAdminAuth,
  validate(courseSchema, 'body'),
  asyncHandler(async (req, res) => {
    const course = await createCourse(req.body);
    return res.status(201).json({ course });
  })
);

/**
 * PUT /api/courses/:id
 * Mettre à jour un cours (admin)
 */
router.put(
  '/:id',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(updateCourseSchema, 'body'),
  asyncHandler(async (req, res) => {
    const course = await updateCourse(req.params.id, req.body);
    return res.json({ course });
  })
);

/**
 * DELETE /api/courses/:id
 * Supprimer un cours (admin)
 */
router.delete(
  '/:id',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await deleteCourse(req.params.id);
    return res.status(204).send();
  })
);

/**
 * POST /api/courses/:id/lessons
 * Créer une leçon (admin)
 */
router.post(
  '/:id/lessons',
  requireAdminAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(lessonSchema, 'body'),
  asyncHandler(async (req, res) => {
    const lesson = await createLesson(req.params.id, req.body);
    return res.status(201).json({ lesson });
  })
);

/**
 * PUT /api/courses/:courseId/lessons/:lessonId
 * Mettre à jour une leçon (admin)
 */
router.put(
  '/:courseId/lessons/:lessonId',
  requireAdminAuth,
  validate(
    z.object({
      courseId: z.string().uuid(),
      lessonId: z.string().uuid(),
    }),
    'params'
  ),
  validate(updateLessonSchema, 'body'),
  asyncHandler(async (req, res) => {
    const lesson = await updateLesson(req.params.lessonId, req.body);
    return res.json({ lesson });
  })
);

/**
 * DELETE /api/courses/:courseId/lessons/:lessonId
 * Supprimer une leçon (admin)
 */
router.delete(
  '/:courseId/lessons/:lessonId',
  requireAdminAuth,
  validate(
    z.object({
      courseId: z.string().uuid(),
      lessonId: z.string().uuid(),
    }),
    'params'
  ),
  asyncHandler(async (req, res) => {
    await deleteLesson(req.params.lessonId);
    return res.status(204).send();
  })
);

/**
 * POST /api/courses/:id/reviews
 * Ajouter un avis (utilisateur authentifié)
 */
router.post(
  '/:id/reviews',
  authMiddleware,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(courseReviewSchema, 'body'),
  asyncHandler(async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) {
      const { createError } = await import('../utils/errors.js');
      throw createError.auth('Utilisateur non authentifié');
    }
    const review = await addCourseReview(req.params.id, userId, req.body);
    return res.status(201).json({ review });
  })
);

export default router;
