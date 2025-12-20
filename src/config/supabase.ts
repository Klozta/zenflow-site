import { createClient } from '@supabase/supabase-js';

// En mode développement, permettre des valeurs mock si Supabase n'est pas configuré
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Vérifier si ce sont des placeholders
const isPlaceholder = (value: string | undefined): boolean => {
  return !value || value.includes('your_') || value.includes('here');
};

let supabase: any;

if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseKey)) {
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || !process.env.NODE_ENV) {
    console.warn('⚠️  Supabase non configuré - Utilisation de valeurs mock pour le développement');
    console.warn('⚠️  Les fonctionnalités Supabase ne fonctionneront pas. Configurez SUPABASE_URL et SUPABASE_KEY pour les activer.');

    // Créer un client mock (ne fonctionnera pas mais permettra le démarrage)
    const createQueryBuilder = () => {
      const builder: any = {
        eq: function() { return this; },
        gte: function() { return this; },
        lte: function() { return this; },
        order: function() { return this; },
        range: function() {
          return Promise.resolve({ data: [], error: null, count: 0 });
        },
        maybeSingle: function() {
          return Promise.resolve({ data: null, error: null });
        },
        single: function() {
          return Promise.resolve({ data: null, error: { message: 'Supabase non configuré' } });
        },
      };
      return builder;
    };

    supabase = {
      from: () => ({
        select: () => createQueryBuilder(),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'Supabase non configuré' } }),
          }),
        }),
        update: () => ({
          eq: function() { return this; },
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'Supabase non configuré' } }),
          }),
        }),
        delete: () => Promise.resolve({ data: null, error: { message: 'Supabase non configuré' } }),
      }),
      rpc: () => Promise.resolve({ data: [], error: { message: 'Supabase non configuré' } }),
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: null, error: { message: 'Supabase Storage non configuré' } }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
          list: () => Promise.resolve({ data: [], error: null }),
          remove: () => Promise.resolve({ data: null, error: null }),
        }),
        listBuckets: () => Promise.resolve({ data: [], error: { message: 'Supabase Storage non configuré' } }),
        createBucket: () => Promise.resolve({ data: null, error: { message: 'Supabase Storage non configuré' } }),
      },
    };
  } else {
    throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in .env');
  }
} else {
  // Configuration normale
  supabase = createClient(supabaseUrl!, supabaseKey!);
}

export { supabase };
