// backend/src/types/courses.types.ts

export interface Instructor {
  id: string;
  name: string;
  bio: string | null;
  image: string | null;
  created_at: string;
}

export interface Lesson {
  id: string;
  course_id: string;
  title: string;
  duration: string;
  description: string | null;
  order: number;
  created_at: string;
}

export interface CourseReview {
  id: string;
  course_id: string;
  user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  user?: {
    name: string;
    email: string;
  };
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface Course {
  id: string;
  title: string;
  description: string | null;
  price: number;
  duration: string;
  level: 'débutant' | 'intermédiaire' | 'avancé';
  format: 'en ligne' | 'présentiel' | 'mixte';
  instructor_id: string;
  image: string | null;
  rating: number | null; // Calculé depuis les reviews
  badge: string | null;
  objectives?: string[]; // Objectifs d'apprentissage
  prerequisites?: string[]; // Prérequis
  faq?: FAQItem[]; // Questions fréquentes
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  // Relations (optionnelles, chargées selon besoin)
  instructor?: Instructor;
  lessons?: Lesson[];
  reviews?: CourseReview[];
}

export interface CourseInput {
  title: string;
  description?: string;
  price: number;
  duration: string;
  level: 'débutant' | 'intermédiaire' | 'avancé';
  format: 'en ligne' | 'présentiel' | 'mixte';
  instructor_id: string;
  image?: string;
  badge?: string;
  objectives?: string[];
  prerequisites?: string[];
  faq?: FAQItem[];
}

export interface UpdateCourseInput {
  title?: string;
  description?: string;
  price?: number;
  duration?: string;
  level?: 'débutant' | 'intermédiaire' | 'avancé';
  format?: 'en ligne' | 'présentiel' | 'mixte';
  instructor_id?: string;
  image?: string;
  badge?: string;
  objectives?: string[];
  prerequisites?: string[];
  faq?: FAQItem[];
}

export interface FilterCoursesInput {
  page?: number;
  limit?: number;
  level?: 'débutant' | 'intermédiaire' | 'avancé';
  format?: 'en ligne' | 'présentiel' | 'mixte';
  minPrice?: number;
  maxPrice?: number;
  instructor_id?: string;
  sort?: 'price_asc' | 'price_desc' | 'rating_desc' | 'created_at_desc';
  search?: string; // Recherche full-text
}

export interface LessonInput {
  title: string;
  duration: string;
  description?: string;
  order: number;
}

export interface UpdateLessonInput {
  title?: string;
  duration?: string;
  description?: string;
  order?: number;
}

export interface CourseReviewInput {
  rating: number;
  comment?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
