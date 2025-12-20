/**
 * Script de migration des données courses depuis courses.data.ts vers Supabase
 * Usage: tsx scripts/migrate-courses.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL et SUPABASE_KEY doivent être configurés dans .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Données à migrer (depuis courses.data.ts)
const coursesData = [
  {
    id: 'course-1',
    title: 'Initiation au crochet - Découverte',
    description: 'Apprenez les bases du crochet en 1h. Parfait pour débuter votre apprentissage ! Découvrez les points essentiels et créez votre premier projet.',
    price: 19,
    duration: '1h',
    level: 'débutant',
    format: 'en ligne',
    instructor: {
      name: 'Marie Dupont',
      bio: 'Professeure de crochet depuis 10 ans, spécialisée dans l\'enseignement aux débutants',
      image: '/instructors/marie.jpg',
    },
    image: '/courses/initiation.jpg',
    rating: 4.8,
    badge: 'Nouveau',
    lessons: [
      { title: 'Introduction au crochet', duration: '5min', description: 'Découverte du matériel et des bases' },
      { title: 'Les points fondamentaux', duration: '30min', description: 'Maille en l\'air, maille serrée, bride' },
      { title: 'Premier projet : Écharpe simple', duration: '25min', description: 'Création d\'une écharpe pour mettre en pratique' },
    ],
    reviews: [
      { name: 'Sophie L.', rating: 5, comment: 'Parfait pour débuter ! Marie explique très bien.', date: '2024-01-15' },
      { name: 'Julie M.', rating: 4, comment: 'Très bon cours, j\'ai réussi mon premier projet !', date: '2024-01-20' },
    ],
  },
  {
    id: 'course-2',
    title: 'Pack Débutant - Maîtrisez le crochet',
    description: 'Formation complète de 4h pour maîtriser toutes les bases du crochet. De zéro à la création de projets complexes.',
    price: 59,
    duration: '4h',
    level: 'débutant',
    format: 'en ligne',
    instructor: {
      name: 'Sophie Martin',
      bio: 'Créatrice et formatrice certifiée, auteure de 3 livres sur le crochet',
      image: '/instructors/sophie.jpg',
    },
    image: '/courses/pack-debutant.jpg',
    rating: 4.9,
    badge: 'Populaire',
    lessons: [
      { title: 'Module 1 : Les bases complètes', duration: '1h', description: 'Tous les points essentiels' },
      { title: 'Module 2 : Techniques avancées débutant', duration: '1h', description: 'Augmentations, diminutions, changement de couleur' },
      { title: 'Module 3 : Projets pratiques', duration: '2h', description: '3 projets complets : écharpe, bonnet, sac' },
    ],
    reviews: [
      { name: 'Emma D.', rating: 5, comment: 'Excellent pack ! J\'ai créé 3 projets magnifiques.', date: '2024-01-10' },
      { name: 'Lucas P.', rating: 5, comment: 'Très bien structuré, parfait pour progresser.', date: '2024-01-18' },
    ],
  },
  {
    id: 'course-3',
    title: 'Pack Avancé - Techniques expertes',
    description: 'Perfectionnez-vous avec 6h de cours sur les techniques avancées.',
    price: 89,
    duration: '6h',
    level: 'avancé',
    format: 'en ligne',
    instructor: {
      name: 'Claire Bernard',
      bio: 'Artisane professionnelle, 15 ans d\'expérience',
      image: '/instructors/claire.jpg',
    },
    image: '/courses/pack-avance.jpg',
    rating: 5.0,
    badge: 'Meilleur prix',
    lessons: [],
    reviews: [],
  },
  {
    id: 'course-4',
    title: 'Cours Privé Personnalisé',
    description: 'Cours individuel adapté à vos besoins. Choisissez votre horaire et votre programme.',
    price: 25,
    duration: '1h',
    level: 'intermédiaire',
    format: 'mixte',
    instructor: {
      name: 'Marie Dupont',
      bio: 'Professeure de crochet depuis 10 ans',
      image: '/instructors/marie.jpg',
    },
    image: '/courses/cours-prive.jpg',
    rating: 4.7,
    lessons: [],
    reviews: [],
  },
];

async function migrateCourses() {
  console.log('🚀 Début de la migration des cours...\n');

  // Étape 1: Créer les instructeurs
  console.log('📝 Étape 1: Création des instructeurs...');
  const instructorMap = new Map<string, string>();

  for (const course of coursesData) {
    const instructorName = course.instructor.name;

    if (!instructorMap.has(instructorName)) {
      // Vérifier si l'instructeur existe déjà
      const { data: existing } = await supabase
        .from('instructors')
        .select('id')
        .eq('name', instructorName)
        .single();

      if (existing) {
        instructorMap.set(instructorName, existing.id);
        console.log(`  ✓ Instructeur "${instructorName}" existe déjà (${existing.id})`);
      } else {
        // Créer l'instructeur
        const { data: instructor, error } = await supabase
          .from('instructors')
          .insert({
            name: instructorName,
            bio: course.instructor.bio,
            image: course.instructor.image,
          })
          .select('id')
          .single();

        if (error) {
          console.error(`  ❌ Erreur création instructeur "${instructorName}":`, error.message);
          continue;
        }

        instructorMap.set(instructorName, instructor.id);
        console.log(`  ✓ Instructeur "${instructorName}" créé (${instructor.id})`);
      }
    }
  }

  // Étape 2: Créer les cours
  console.log('\n📚 Étape 2: Création des cours...');
  const courseMap = new Map<string, string>();

  for (const courseData of coursesData) {
    const instructorId = instructorMap.get(courseData.instructor.name);
    if (!instructorId) {
      console.error(`  ❌ Instructeur introuvable pour "${courseData.title}"`);
      continue;
    }

    // Vérifier si le cours existe déjà
    const { data: existing } = await supabase
      .from('courses')
      .select('id')
      .eq('title', courseData.title)
      .single();

    if (existing) {
      courseMap.set(courseData.id, existing.id);
      console.log(`  ✓ Cours "${courseData.title}" existe déjà (${existing.id})`);
      continue;
    }

    // Créer le cours
    const { data: course, error } = await supabase
      .from('courses')
      .insert({
        title: courseData.title,
        description: courseData.description,
        price: courseData.price,
        duration: courseData.duration,
        level: courseData.level,
        format: courseData.format,
        instructor_id: instructorId,
        image: courseData.image,
        badge: courseData.badge || null,
        rating: courseData.rating || null,
        objectives: (courseData as any).objectives || [],
        prerequisites: (courseData as any).prerequisites || [],
        faq: (courseData as any).faq || [],
      })
      .select('id')
      .single();

    if (error) {
      console.error(`  ❌ Erreur création cours "${courseData.title}":`, error.message);
      continue;
    }

    courseMap.set(courseData.id, course.id);
    console.log(`  ✓ Cours "${courseData.title}" créé (${course.id})`);

    // Étape 3: Créer les leçons
    if (courseData.lessons && courseData.lessons.length > 0) {
      console.log(`    📖 Création de ${courseData.lessons.length} leçon(s)...`);

      for (let i = 0; i < courseData.lessons.length; i++) {
        const lessonData = courseData.lessons[i];
        const { error: lessonError } = await supabase
          .from('lessons')
          .insert({
            course_id: course.id,
            title: lessonData.title,
            duration: lessonData.duration,
            description: lessonData.description || null,
            order: i,
          });

        if (lessonError) {
          console.error(`      ❌ Erreur création leçon "${lessonData.title}":`, lessonError.message);
        } else {
          console.log(`      ✓ Leçon "${lessonData.title}" créée`);
        }
      }
    }

    // Note: Les reviews nécessitent des utilisateurs existants, on les skip pour l'instant
    // Ils peuvent être ajoutés manuellement ou via l'API plus tard
  }

  console.log('\n✅ Migration terminée !');
  console.log(`\n📊 Résumé:`);
  console.log(`  - ${instructorMap.size} instructeur(s) créé(s) ou existant(s)`);
  console.log(`  - ${courseMap.size} cours créé(s) ou existant(s)`);
  console.log(`\n💡 Note: Les avis nécessitent des utilisateurs existants.`);
  console.log(`   Ils peuvent être ajoutés via l'API /api/courses/:id/reviews`);
}

// Exécuter la migration
migrateCourses()
  .then(() => {
    console.log('\n🎉 Migration réussie !');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Erreur lors de la migration:', error);
    process.exit(1);
  });
