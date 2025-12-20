# 📚 Migration des Cours vers Supabase

## 🎯 Objectif

Ce script migre les données des cours depuis `frontend/lib/data/courses.data.ts` vers Supabase.

## 📋 Prérequis

1. **Tables Supabase créées** : Exécuter d'abord la migration SQL
   ```bash
   # Dans Supabase Dashboard > SQL Editor
   # Exécuter le fichier: migrations/create_courses_tables.sql
   ```

2. **Variables d'environnement configurées** :
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```

## 🚀 Utilisation

```bash
cd zenflow-site/backend
npm run migrate:courses
```

## 📊 Ce que fait le script

1. **Création des instructeurs** : Crée les instructeurs s'ils n'existent pas déjà
2. **Création des cours** : Crée les cours avec leurs métadonnées
3. **Création des leçons** : Crée les leçons associées à chaque cours
4. **Note** : Les avis nécessitent des utilisateurs existants, ils ne sont pas migrés automatiquement

## ✅ Résultat attendu

- 3 instructeurs créés (Marie Dupont, Sophie Martin, Claire Bernard)
- 4 cours créés
- Leçons associées aux cours

## 🔄 Après la migration

1. Le frontend utilisera automatiquement l'API au lieu des données statiques
2. Les cours peuvent être gérés via l'API `/api/courses`
3. Les avis peuvent être ajoutés via `/api/courses/:id/reviews` (utilisateurs authentifiés)

## ⚠️ Notes

- Le script est idempotent : il peut être exécuté plusieurs fois sans créer de doublons
- Les instructeurs sont identifiés par leur nom (pas d'UUID dans les données statiques)
- Les avis nécessitent des utilisateurs réels, ils doivent être ajoutés manuellement ou via l'API
