// backend/src/services/coursesService.ts
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';
import {
    Course,
    CourseInput,
    CourseReviewInput,
    FilterCoursesInput,
    Instructor,
    Lesson,
    LessonInput,
    Pagination,
    UpdateCourseInput,
    UpdateLessonInput,
} from '../types/courses.types.js';
import { deleteCache, getCache, setCache } from '../utils/cache.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { isNetworkError, retry } from '../utils/retry.js';

function isSupabaseRetryable(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.toLowerCase().includes('supabase non configur')) return false;
  if (isNetworkError(error)) return true;
  const code = (error as { code?: string })?.code;
  if (!code) return false;
  return ['57P01', '57P02', '53300', 'P0001', '42501'].includes(code);
}

function hashObject(obj: unknown): string {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Calculate course rating from reviews
 */
async function calculateCourseRating(courseId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('course_reviews')
    .select('rating')
    .eq('course_id', courseId);

  if (error || !data || data.length === 0) {
    return null;
  }

  const sum = data.reduce((acc: number, review: { rating: number }) => acc + review.rating, 0);
  return Math.round((sum / data.length) * 10) / 10; // Arrondir à 1 décimale
}

/**
 * Get courses list with filters and pagination
 */
export async function getCourses(
  filters: FilterCoursesInput
): Promise<{ courses: Course[]; pagination: Pagination }> {
  const cacheKey = `courses:list:${hashObject(filters)}`;
  const cached = await getCache<{ courses: Course[]; pagination: Pagination }>(cacheKey);

  if (cached) {
    return cached;
  }

  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;

  let query = supabase
    .from('courses')
    .select('*, instructor:instructors(*)', { count: 'exact' })
    .eq('is_deleted', false);

  // Recherche full-text (titre et description)
  // Utiliser la fonction RPC si disponible, sinon fallback sur ILIKE
  if (filters.search && filters.search.trim()) {
    const searchTerm = filters.search.trim();
    // Essayer d'abord avec la fonction RPC (plus performante)
    try {
      const { data: searchResults, error: rpcError } = await retry(
        () =>
          supabase.rpc('search_courses', {
            query_text: searchTerm,
            page_num: page,
            page_size: limit,
          }),
        { retryable: isSupabaseRetryable, maxRetries: 2 }
      ) as { data: Course[] | null; error: any };

      if (!rpcError && searchResults) {
        const courses = searchResults as Course[];
        const total = courses.length > 0 ? (courses[0] as any).total_count || 0 : 0;
        const totalPages = Math.ceil(total / limit);

        // Calculate ratings
        for (const course of courses) {
          if (!course.rating) {
            course.rating = await calculateCourseRating(course.id);
          }
        }

        const coursesResult = {
          courses,
          pagination: { page, limit, total, totalPages },
        };

        await setCache(cacheKey, coursesResult, 300);
        return coursesResult;
      }
    } catch {
      // Fallback sur ILIKE si RPC n'est pas disponible
    }

    // Fallback: recherche simple avec ILIKE
    query = query.or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
  }

  // Filters
  if (filters.level) {
    query = query.eq('level', filters.level);
  }
  if (filters.format) {
    query = query.eq('format', filters.format);
  }
  if (filters.minPrice !== undefined) {
    query = query.gte('price', filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    query = query.lte('price', filters.maxPrice);
  }
  if (filters.instructor_id) {
    query = query.eq('instructor_id', filters.instructor_id);
  }

  // Sorting
  const sort = filters.sort || 'created_at_desc';
  switch (sort) {
    case 'price_asc':
      query = query.order('price', { ascending: true });
      break;
    case 'price_desc':
      query = query.order('price', { ascending: false });
      break;
    case 'rating_desc':
      query = query.order('rating', { ascending: false, nullsFirst: false });
      break;
    case 'created_at_desc':
    default:
      query = query.order('created_at', { ascending: false });
      break;
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await retry(
    () => query,
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Course[] | null; error: any; count: number | null };

  if (error) {
    logger.error('Failed to fetch courses', error instanceof Error ? error : new Error(String(error)), { filters });
    throw createError.database('Erreur lors de la récupération des cours');
  }

  const courses = (data || []) as Course[];
  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  // Calculate ratings for each course
  for (const course of courses) {
    if (!course.rating) {
      course.rating = await calculateCourseRating(course.id);
      // Update cache if rating changed
      if (course.rating !== null) {
        await supabase
          .from('courses')
          .update({ rating: course.rating })
          .eq('id', course.id)
          .then(() => deleteCache(`courses:detail:${course.id}`));
      }
    }
  }

  const coursesResult = {
    courses,
    pagination: { page, limit, total, totalPages },
  };

  await setCache(cacheKey, coursesResult, 300); // 5min
  return coursesResult;
}

/**
 * Get single course by ID
 */
export async function getCourseById(id: string, includeRelations = false): Promise<Course | null> {
  const cacheKey = `courses:detail:${id}:${includeRelations}`;
  const cached = await getCache<Course>(cacheKey);

  if (cached) {
    return cached;
  }

  let query = supabase
    .from('courses')
    .select('*, instructor:instructors(*)')
    .eq('id', id)
    .eq('is_deleted', false);

  if (includeRelations) {
    query = query.select('*, instructor:instructors(*), lessons:lessons(*), reviews:course_reviews(*, user:users(name, email))');
  }

  const { data, error } = await retry(
    () => query.maybeSingle(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Course | null; error: any };

  if (error || !data) {
    return null;
  }

  const course = data as Course;

  // Calculate rating if not present
  if (!course.rating) {
    course.rating = await calculateCourseRating(course.id);
  }

  await setCache(cacheKey, course, 600); // 10min
  return course;
}

/**
 * Create new course
 */
export async function createCourse(data: CourseInput): Promise<Course> {
  const { data: course, error } = await retry(
    () =>
      supabase
        .from('courses')
        .insert({
          title: data.title,
          description: data.description || null,
          price: Number(data.price.toFixed(2)),
          duration: data.duration,
          level: data.level,
          format: data.format,
          instructor_id: data.instructor_id,
          image: data.image || null,
          badge: data.badge || null,
          rating: null,
        })
        .select('*, instructor:instructors(*)')
        .single(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Course | null; error: any };

  if (error) {
    logger.error('Failed to create course', error instanceof Error ? error : new Error(String(error)), { data });
    if (error.code === '23503') {
      throw createError.validation('Instructeur introuvable');
    }
    throw createError.database('Erreur lors de la création du cours');
  }

  // Invalidate cache
  await deleteCache('courses:list:*');

  return course as Course;
}

/**
 * Update course
 */
export async function updateCourse(id: string, data: UpdateCourseInput): Promise<Course> {
  const updateData: any = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.price !== undefined) updateData.price = Number(data.price.toFixed(2));
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.level !== undefined) updateData.level = data.level;
  if (data.format !== undefined) updateData.format = data.format;
  if (data.instructor_id !== undefined) updateData.instructor_id = data.instructor_id;
  if (data.image !== undefined) updateData.image = data.image;
  if (data.badge !== undefined) updateData.badge = data.badge;
  if (data.objectives !== undefined) updateData.objectives = data.objectives;
  if (data.prerequisites !== undefined) updateData.prerequisites = data.prerequisites;
  if (data.faq !== undefined) updateData.faq = data.faq;

  updateData.updated_at = new Date().toISOString();

  const { data: course, error } = await retry(
    () =>
      supabase
        .from('courses')
        .update(updateData)
        .eq('id', id)
        .eq('is_deleted', false)
        .select('*, instructor:instructors(*)')
        .single(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Course | null; error: any };

  if (error) {
    logger.error('Failed to update course', error instanceof Error ? error : new Error(String(error)), { id, data });
    if (error.code === 'PGRST116') {
      throw createError.notFound('Cours introuvable');
    }
    throw createError.database('Erreur lors de la mise à jour du cours');
  }

  // Invalidate cache
  await deleteCache(`courses:detail:${id}`);
  await deleteCache('courses:list:*');

  return course as Course;
}

/**
 * Delete course (soft delete)
 */
export async function deleteCourse(id: string): Promise<void> {
  const { error } = await retry(
    () =>
      supabase
        .from('courses')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', id),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { error: any };

  if (error) {
    logger.error('Failed to delete course', error instanceof Error ? error : new Error(String(error)), { id });
    throw createError.database('Erreur lors de la suppression du cours');
  }

  // Invalidate cache
  await deleteCache(`courses:detail:${id}`);
  await deleteCache('courses:list:*');
}

/**
 * Get course lessons
 */
export async function getCourseLessons(courseId: string): Promise<Lesson[]> {
  const cacheKey = `courses:lessons:${courseId}`;
  const cached = await getCache<Lesson[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const { data, error } = await retry(
    () =>
      supabase
        .from('lessons')
        .select('*')
        .eq('course_id', courseId)
        .order('order', { ascending: true }),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Lesson[] | null; error: any };

  if (error) {
    logger.error('Failed to fetch lessons', error instanceof Error ? error : new Error(String(error)), { courseId });
    throw createError.database('Erreur lors de la récupération des leçons');
  }

  const lessons = (data || []) as Lesson[];
  await setCache(cacheKey, lessons, 600); // 10min
  return lessons;
}

/**
 * Create lesson
 */
export async function createLesson(courseId: string, data: LessonInput): Promise<Lesson> {
  const { data: lesson, error } = await retry(
    () =>
      supabase
        .from('lessons')
        .insert({
          course_id: courseId,
          title: data.title,
          duration: data.duration,
          description: data.description || null,
          order: data.order,
        })
        .select()
        .single(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Lesson | null; error: any };

  if (error) {
    logger.error('Failed to create lesson', error instanceof Error ? error : new Error(String(error)), { courseId, data });
    throw createError.database('Erreur lors de la création de la leçon');
  }

  // Invalidate cache
  await deleteCache(`courses:lessons:${courseId}`);
  await deleteCache(`courses:detail:${courseId}:true`);

  return lesson as Lesson;
}

/**
 * Update lesson
 */
export async function updateLesson(lessonId: string, data: UpdateLessonInput): Promise<Lesson> {
  const updateData: any = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.duration !== undefined) updateData.duration = data.duration;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.order !== undefined) updateData.order = data.order;

  // Get course_id before updating
  const { data: lesson } = await supabase
    .from('lessons')
    .select('course_id')
    .eq('id', lessonId)
    .single();

  const { data: updatedLesson, error } = await retry(
    () =>
      supabase
        .from('lessons')
        .update(updateData)
        .eq('id', lessonId)
        .select()
        .single(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Lesson | null; error: any };

  if (error) {
    logger.error('Failed to update lesson', error instanceof Error ? error : new Error(String(error)), { lessonId, data });
    throw createError.database('Erreur lors de la mise à jour de la leçon');
  }

  // Invalidate cache
  if (lesson?.course_id) {
    await deleteCache(`courses:lessons:${lesson.course_id}`);
    await deleteCache(`courses:detail:${lesson.course_id}:true`);
  }

  return updatedLesson as Lesson;
}

/**
 * Delete lesson
 */
export async function deleteLesson(lessonId: string): Promise<void> {
  // Get course_id before deleting
  const { data: lesson } = await supabase
    .from('lessons')
    .select('course_id')
    .eq('id', lessonId)
    .single();

  const { error } = await retry(
    () => supabase.from('lessons').delete().eq('id', lessonId),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { error: any };

  if (error) {
    logger.error('Failed to delete lesson', error instanceof Error ? error : new Error(String(error)), { lessonId });
    throw createError.database('Erreur lors de la suppression de la leçon');
  }

  // Invalidate cache
  if (lesson?.course_id) {
    await deleteCache(`courses:lessons:${lesson.course_id}`);
    await deleteCache(`courses:detail:${lesson.course_id}:true`);
  }
}

/**
 * Get course reviews
 */
export async function getCourseReviews(courseId: string): Promise<any[]> {
  const cacheKey = `courses:reviews:${courseId}`;
  const cached = await getCache<any[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const { data, error } = await retry(
    () =>
      supabase
        .from('course_reviews')
        .select('*, user:users(name, email)')
        .eq('course_id', courseId)
        .order('created_at', { ascending: false }),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: any[] | null; error: any };

  if (error) {
    logger.error('Failed to fetch reviews', error instanceof Error ? error : new Error(String(error)), { courseId });
    throw createError.database('Erreur lors de la récupération des avis');
  }

  const reviews = data || [];
  await setCache(cacheKey, reviews, 300); // 5min
  return reviews;
}

/**
 * Add course review
 */
export async function addCourseReview(
  courseId: string,
  userId: string,
  data: CourseReviewInput
): Promise<any> {
  // Check if user already reviewed this course
  const { data: existingReview } = await supabase
    .from('course_reviews')
    .select('id')
    .eq('course_id', courseId)
    .eq('user_id', userId)
    .single();

  if (existingReview) {
    throw createError.conflict('Vous avez déjà laissé un avis pour ce cours');
  }

  const { data: review, error } = await retry(
    () =>
      supabase
        .from('course_reviews')
        .insert({
          course_id: courseId,
          user_id: userId,
          rating: data.rating,
          comment: data.comment || null,
        })
        .select('*, user:users(name, email)')
        .single(),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: any | null; error: any };

  if (error) {
    logger.error('Failed to create review', error instanceof Error ? error : new Error(String(error)), { courseId, userId, data });
    throw createError.database('Erreur lors de l\'ajout de l\'avis');
  }

  // Recalculate course rating
  const newRating = await calculateCourseRating(courseId);
  if (newRating !== null) {
    await supabase
      .from('courses')
      .update({ rating: newRating })
      .eq('id', courseId);
  }

  // Invalidate cache
  await deleteCache(`courses:reviews:${courseId}`);
  await deleteCache(`courses:detail:${courseId}`);
  await deleteCache('courses:list:*');

  return review;
}

/**
 * Get all instructors
 */
export async function getInstructors(): Promise<Instructor[]> {
  const cacheKey = 'instructors:list';
  const cached = await getCache<Instructor[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const { data, error } = await retry(
    () =>
      supabase
        .from('instructors')
        .select('*')
        .order('name', { ascending: true }),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Instructor[] | null; error: any };

  if (error) {
    logger.error('Failed to fetch instructors', error instanceof Error ? error : new Error(String(error)));
    throw createError.database('Erreur lors de la récupération des instructeurs');
  }

  const instructors = (data || []) as Instructor[];
  await setCache(cacheKey, instructors, 600); // 10min
  return instructors;
}

/**
 * Get courses statistics
 */
export async function getCoursesStats(): Promise<{
  total: number;
  byLevel: Record<string, number>;
  byFormat: Record<string, number>;
  averagePrice: number;
  averageRating: number;
  totalLessons: number;
  totalReviews: number;
  topRated: Course[];
}> {
  const cacheKey = 'courses:stats';
  const cached = await getCache<any>(cacheKey);

  if (cached) {
    return cached;
  }

  // Récupérer tous les cours (non supprimés)
  const { data: courses, error: coursesError } = await retry(
    () =>
      supabase
        .from('courses')
        .select('id, level, format, price, rating')
        .eq('is_deleted', false),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { data: Course[] | null; error: any };

  if (coursesError) {
    logger.error('Failed to fetch courses for stats', coursesError instanceof Error ? coursesError : new Error(String(coursesError)));
    throw createError.database('Erreur lors de la récupération des statistiques');
  }

  const coursesList = (courses || []) as Course[];

  // Compter par niveau
  const byLevel: Record<string, number> = {
    débutant: 0,
    intermédiaire: 0,
    avancé: 0,
  };
  coursesList.forEach((course) => {
    byLevel[course.level] = (byLevel[course.level] || 0) + 1;
  });

  // Compter par format
  const byFormat: Record<string, number> = {
    'en ligne': 0,
    présentiel: 0,
    mixte: 0,
  };
  coursesList.forEach((course) => {
    byFormat[course.format] = (byFormat[course.format] || 0) + 1;
  });

  // Prix moyen
  const totalPrice = coursesList.reduce((sum, course) => sum + Number(course.price), 0);
  const averagePrice = coursesList.length > 0 ? totalPrice / coursesList.length : 0;

  // Note moyenne
  const coursesWithRating = coursesList.filter((c) => c.rating !== null);
  const totalRating = coursesWithRating.reduce((sum, course) => sum + (course.rating || 0), 0);
  const averageRating = coursesWithRating.length > 0 ? totalRating / coursesWithRating.length : 0;

  // Compter les leçons
  const { count: lessonsCount } = await retry(
    () => supabase.from('lessons').select('*', { count: 'exact', head: true }),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { count: number | null };

  // Compter les avis
  const { count: reviewsCount } = await retry(
    () => supabase.from('course_reviews').select('*', { count: 'exact', head: true }),
    { retryable: isSupabaseRetryable, maxRetries: 3 }
  ) as { count: number | null };

  // Top 5 cours les mieux notés
  const topRated = coursesList
    .filter((c) => c.rating !== null)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 5);

  const stats = {
    total: coursesList.length,
    byLevel,
    byFormat,
    averagePrice: Math.round(averagePrice * 100) / 100,
    averageRating: Math.round(averageRating * 10) / 10,
    totalLessons: lessonsCount || 0,
    totalReviews: reviewsCount || 0,
    topRated: topRated as Course[],
  };

  await setCache(cacheKey, stats, 300); // 5min
  return stats;
}
