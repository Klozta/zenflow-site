# 📋 GUIDE D'EXÉCUTION SQL SUPABASE

> **Objectif** : Exécuter tous les SQL nécessaires pour le projet ZenFlow

---

## 🚀 MÉTHODE RAPIDE (Recommandée)

### Option 1 : Script SQL Complet (1 exécution)

1. **Ouvrir Supabase Dashboard**
   - Aller sur https://supabase.com/dashboard
   - Sélectionner le projet ZenFlow

2. **Ouvrir SQL Editor**
   - Cliquer sur "SQL Editor" dans le menu de gauche

3. **Copier le script complet**
   ```bash
   cat zenflow-site/backend/scripts/sql-complet-supabase.sql
   ```

4. **Coller dans l'éditeur SQL**
   - Coller TOUT le contenu du fichier `sql-complet-supabase.sql`

5. **Exécuter**
   - Cliquer sur "RUN" ou appuyer sur `Ctrl+Enter`

6. **Vérifier les résultats**
   - Les requêtes de vérification à la fin affichent les résultats
   - Vérifier qu'il n'y a pas d'erreurs

**Temps estimé** : 2-3 minutes

---

## 📝 MÉTHODE ÉTAPE PAR ÉTAPE

Si vous préférez exécuter étape par étape :

### Étape 1 : Refresh Tokens (J2)

**Fichier** : `zenflow-docs/03-prompts/_nouvelle-structure/archive/anciens-fichiers/j2-backend-core/sql/refresh-tokens.sql`

**Action** :
1. Ouvrir Supabase SQL Editor
2. Copier le contenu du fichier (sans les commentaires markdown)
3. Exécuter

**Vérification** :
```sql
SELECT * FROM refresh_tokens LIMIT 1;
```

---

### Étape 2 : Products Full-text Search (J2)

**Fichier** : `zenflow-docs/03-prompts/_nouvelle-structure/archive/anciens-fichiers/j2-backend-core/sql/products-fulltext.sql`

**Action** :
1. Copier le contenu SQL (sans les commentaires markdown)
2. Exécuter dans Supabase SQL Editor

**Vérification** :
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'products';
SELECT id, title, search_vector FROM products LIMIT 1;
```

---

### Étape 3 : RLS Policies (J2 - CRITIQUE)

**Fichier** : `zenflow-docs/03-prompts/_nouvelle-structure/archive/anciens-fichiers/j2-backend-core/sql/rls-policies.sql`

**Action** :
1. Copier le contenu SQL (sans les commentaires markdown)
2. Exécuter dans Supabase SQL Editor

**Vérification** :
```sql
-- Vérifier RLS activé
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'products', 'refresh_tokens');

-- Vérifier policies créées
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename IN ('users', 'products', 'refresh_tokens');
```

**Résultat attendu** : RLS activé + 6 policies créées ✅

---

### Étape 4 : Tables J3 (Orders, etc.)

**Fichiers** : `zenflow-docs/03-prompts/_nouvelle-structure/perplexity/sql/j3/*.sql`

**Tables à créer** :
- `orders-tables.sql` - Orders et order_items
- `abandoned-carts-tables.sql` - Paniers abandonnés
- `import-history-tables.sql` - Historique imports
- `pending-products-tables.sql` - Produits en attente
- `product-specifications-tables.sql` - Spécifications produits
- `promo-codes-tables.sql` - Codes promo
- `reviews-tables.sql` - Avis produits

**Action** :
1. Pour chaque fichier, copier le contenu SQL
2. Exécuter dans Supabase SQL Editor

**Vérification** :
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'orders',
    'order_items',
    'abandoned_carts',
    'import_history',
    'pending_products',
    'product_specifications',
    'promo_codes',
    'reviews'
  )
ORDER BY table_name;
```

---

## ✅ VÉRIFICATION COMPLÈTE

Après avoir exécuté tous les SQL, exécuter cette requête de vérification :

```sql
-- Vérifier toutes les tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Vérifier RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true;

-- Vérifier policies
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Vérifier index full-text
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'products'
  AND indexname LIKE '%search%';
```

---

## ⚠️ IMPORTANT

### Ordre d'exécution recommandé

1. ✅ **Refresh Tokens** (avant Prompt 4)
2. ✅ **Products Full-text** (avant Prompt 5)
3. ✅ **RLS Policies** (après Prompt 4+5)
4. ✅ **Tables J3** (après J3)

### Erreurs possibles

**Erreur : "relation already exists"**
- ✅ Normal si la table existe déjà
- Le script utilise `CREATE TABLE IF NOT EXISTS` pour éviter les erreurs

**Erreur : "policy already exists"**
- ✅ Le script SQL complet supprime les policies existantes avant de les recréer
- Si vous exécutez étape par étape, supprimer les policies existantes d'abord

**Erreur : "column already exists"**
- ✅ Normal si la colonne existe déjà
- Le script utilise `ADD COLUMN IF NOT EXISTS`

---

## 🎯 RÉSULTAT ATTENDU

Après exécution complète :

- ✅ **3 tables J2** : refresh_tokens, products (avec search_vector), users (avec RLS)
- ✅ **7 tables J3** : orders, order_items, abandoned_carts, import_history, pending_products, product_specifications, promo_codes, reviews
- ✅ **RLS activé** sur users, products, refresh_tokens
- ✅ **6 policies RLS** créées
- ✅ **Index full-text search** configuré sur products
- ✅ **Tous les index** de performance créés

---

## 📊 TEMPS ESTIMÉ

- **Méthode rapide** (script complet) : 2-3 minutes
- **Méthode étape par étape** : 10-15 minutes

---

**🚀 Une fois terminé, le backend est prêt pour la production !**

