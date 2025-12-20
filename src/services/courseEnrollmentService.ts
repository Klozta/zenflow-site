// backend/src/services/courseEnrollmentService.ts
import { supabase } from '../config/supabase.js';
import { createError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getCourseById } from './coursesService.js';

export interface CourseEnrollment {
  id: string;
  user_id: string;
  course_id: string;
  order_id: string | null;
  enrolled_at: string;
  progress: {
    lessons_completed?: string[];
    last_accessed?: string | null;
    completion_percentage?: number;
  };
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateEnrollmentInput {
  userId: string;
  courseId: string;
  orderId?: string | null;
}

export interface UpdateProgressInput {
  enrollmentId: string;
  lessonId: string;
  completed?: boolean;
}

/**
 * Crée une inscription à un cours pour un utilisateur
 */
export async function enrollUserInCourse(input: CreateEnrollmentInput): Promise<CourseEnrollment> {
  const { userId, courseId, orderId } = input;

  // Vérifier que le cours existe
  const course = await getCourseById(courseId);
  if (!course) {
    throw createError.notFound(`Cours ${courseId} introuvable`);
  }

  // Vérifier si l'utilisateur est déjà inscrit
  const { data: existing } = await supabase
    .from('course_enrollments')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .single();

  if (existing) {
    logger.info('User already enrolled in course', { userId, courseId });
    // Retourner l'inscription existante
    const { data: enrollment } = await supabase
      .from('course_enrollments')
      .select('*')
      .eq('id', existing.id)
      .single();

    if (enrollment) {
      return enrollment as CourseEnrollment;
    }
  }

  // Créer l'inscription
  const { data: enrollment, error } = await supabase
    .from('course_enrollments')
    .insert({
      user_id: userId,
      course_id: courseId,
      order_id: orderId || null,
      progress: {
        lessons_completed: [],
        last_accessed: null,
        completion_percentage: 0,
      },
    })
    .select()
    .single();

  if (error) {
    logger.error('Failed to create course enrollment', new Error(error.message), { userId, courseId, orderId });
    throw createError.database(`Erreur lors de l'inscription au cours: ${error.message}`, new Error(error.message));
  }

  logger.info('User enrolled in course', { userId, courseId, enrollmentId: enrollment.id, orderId });
  return enrollment as CourseEnrollment;
}

/**
 * Inscrit un utilisateur à plusieurs cours (après achat)
 */
export async function enrollUserInMultipleCourses(
  userId: string,
  courseIds: string[],
  orderId?: string | null
): Promise<CourseEnrollment[]> {
  const enrollments: CourseEnrollment[] = [];

  for (const courseId of courseIds) {
    try {
      const enrollment = await enrollUserInCourse({ userId, courseId, orderId });
      enrollments.push(enrollment);
    } catch (error) {
      // Logger l'erreur mais continuer pour les autres cours
      logger.warn('Failed to enroll user in course', error instanceof Error ? error : new Error(String(error)), {
        userId,
        courseId,
        orderId,
      });
    }
  }

  return enrollments;
}

/**
 * Met à jour la progression d'un utilisateur dans un cours
 */
export async function updateCourseProgress(input: UpdateProgressInput): Promise<CourseEnrollment> {
  const { enrollmentId, lessonId, completed = true } = input;

  // Récupérer l'inscription actuelle
  const { data: enrollment, error: fetchError } = await supabase
    .from('course_enrollments')
    .select('*')
    .eq('id', enrollmentId)
    .single();

  if (fetchError || !enrollment) {
    throw createError.notFound(`Inscription ${enrollmentId} introuvable`);
  }

  const progress = (enrollment.progress as any) || {
    lessons_completed: [],
    last_accessed: null,
    completion_percentage: 0,
  };

  // Mettre à jour la progression
  if (completed) {
    if (!progress.lessons_completed) {
      progress.lessons_completed = [];
    }
    if (!progress.lessons_completed.includes(lessonId)) {
      progress.lessons_completed.push(lessonId);
    }
  } else {
    // Retirer la leçon si elle était complétée
    if (progress.lessons_completed) {
      progress.lessons_completed = progress.lessons_completed.filter((id: string) => id !== lessonId);
    }
  }

  progress.last_accessed = new Date().toISOString();

  // Calculer le pourcentage de complétion (nécessite le nombre total de leçons)
  const course = await getCourseById(enrollment.course_id);
  if (course && course.lessons) {
    const totalLessons = course.lessons.length;
    const completedLessons = progress.lessons_completed?.length || 0;
    progress.completion_percentage = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    // Marquer comme complété si toutes les leçons sont terminées
    if (progress.completion_percentage === 100 && !enrollment.completed_at) {
      const { data: updated } = await supabase
        .from('course_enrollments')
        .update({
          progress,
          completed_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId)
        .select()
        .single();

      if (updated) {
        logger.info('Course completed', { enrollmentId, courseId: enrollment.course_id, userId: enrollment.user_id });
        return updated as CourseEnrollment;
      }
    }
  }

  // Mettre à jour l'inscription
  const { data: updated, error: updateError } = await supabase
    .from('course_enrollments')
    .update({ progress })
    .eq('id', enrollmentId)
    .select()
    .single();

  if (updateError) {
    logger.error('Failed to update course progress', new Error(updateError.message), { enrollmentId, lessonId });
    throw createError.database(`Erreur lors de la mise à jour de la progression: ${updateError.message}`, new Error(updateError.message));
  }

  return updated as CourseEnrollment;
}

/**
 * Récupère les inscriptions d'un utilisateur
 */
export async function getUserEnrollments(userId: string): Promise<CourseEnrollment[]> {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('*')
    .eq('user_id', userId)
    .order('enrolled_at', { ascending: false });

  if (error) {
    logger.error('Failed to get user enrollments', new Error(error.message), { userId });
    throw createError.database(`Erreur lors de la récupération des inscriptions: ${error.message}`, new Error(error.message));
  }

  return (data || []) as CourseEnrollment[];
}

/**
 * Récupère une inscription spécifique
 */
export async function getEnrollmentById(enrollmentId: string): Promise<CourseEnrollment | null> {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('*')
    .eq('id', enrollmentId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    logger.error('Failed to get enrollment', new Error(error.message), { enrollmentId });
    throw createError.database(`Erreur lors de la récupération de l'inscription: ${error.message}`, new Error(error.message));
  }

  return data as CourseEnrollment;
}

/**
 * Vérifie si un utilisateur est inscrit à un cours
 */
export async function isUserEnrolled(userId: string, courseId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('course_enrollments')
    .select('id')
    .eq('user_id', userId)
    .eq('course_id', courseId)
    .single();

  if (error || !data) {
    return false;
  }

  return true;
}
