# 📜 Scripts SQL - Guide d'Utilisation

**Emplacement:** `backend/scripts/`

---

## 🔒 Scripts RLS (Row Level Security)

### 1. `setup-rls-policies.sql` ⭐ **CRITIQUE**

**Description:** Configure toutes les RLS policies pour sécuriser la base de données.

**Quand l'exécuter:**
- ✅ Après création des tables dans Supabase
- ✅ Avant le déploiement en production
- ✅ Pour activer la sécurité au niveau base de données

**Comment l'exécuter:**
1. Ouvrir **Supabase Dashboard** → **SQL Editor**
2. Ouvrir le fichier `setup-rls-policies.sql`
3. Copier-coller **tout le contenu**
4. Cliquer sur **"Run"** ou `Ctrl+Enter`
5. Vérifier les résultats dans la section "Vérification"

**Résultat attendu:**
- ✅ 7 tables avec RLS activé
- ✅ ~15-20 policies configurées
- ✅ Indexes de sécurité créés

**⚠️ Important:**
- Le script est **idempotent** (peut être exécuté plusieurs fois)
- Ne supprime pas les données existantes
- Compatible avec Supabase Auth

---

### 2. `verify-rls-policies.sql`

**Description:** Vérifie que les RLS policies sont correctement configurées.

**Quand l'exécuter:**
- ✅ Après avoir exécuté `setup-rls-policies.sql`
- ✅ Pour diagnostiquer des problèmes d'accès
- ✅ Avant un déploiement

**Comment l'exécuter:**
1. Ouvrir **Supabase Dashboard** → **SQL Editor**
2. Copier-coller le contenu de `verify-rls-policies.sql`
3. Cliquer sur **"Run"**

**Résultat attendu:**
- ✅ Toutes les tables listées avec `rls_enabled = true`
- ✅ Au moins une policy par table
- ✅ Indexes de sécurité présents

---

## 📦 Scripts Autres

### 3. `verify-pending-products.sql`

**Description:** Vérifie et crée la table `pending_products` si elle n'existe pas.

**Quand l'exécuter:**
- ✅ Si la table `pending_products` n'existe pas
- ✅ Pour vérifier la structure de la table

**Comment l'exécuter:**
1. Ouvrir **Supabase Dashboard** → **SQL Editor**
2. Copier-coller le contenu
3. Cliquer sur **"Run"**

---

## 🚀 Workflow Recommandé

### Première Configuration (Nouveau Projet)

```bash
# 1. Créer les tables (si pas déjà fait)
#    → Exécuter les scripts SQL de création de tables

# 2. Configurer RLS (CRITIQUE)
#    → Exécuter setup-rls-policies.sql

# 3. Vérifier la configuration
#    → Exécuter verify-rls-policies.sql
```

### Vérification Rapide

```bash
# Vérifier que RLS est activé
# → Exécuter verify-rls-policies.sql
```

---

## 📋 Checklist Post-Exécution

Après avoir exécuté `setup-rls-policies.sql`, vérifier:

- [ ] Toutes les tables listées dans la vérification ont `rls_enabled = true`
- [ ] Au moins 2-3 policies par table (user/admin/service_role)
- [ ] Aucune erreur dans les résultats SQL
- [ ] Les indexes de sécurité sont créés

---

## ❓ Dépannage

### Erreur: "relation does not exist"
**Cause:** Les tables n'ont pas encore été créées.
**Solution:** Créer les tables d'abord, puis exécuter le script RLS.

### Erreur: "permission denied"
**Cause:** Utilisation d'un compte sans droits admin.
**Solution:** Utiliser le compte admin du projet Supabase.

### RLS activé mais policies manquantes
**Cause:** Le script n'a pas été exécuté complètement.
**Solution:** Ré-exécuter `setup-rls-policies.sql` (idempotent).

---

## 📚 Documentation Complémentaire

- `ETAT-TECHNIQUE-SITE.md` - Documentation technique complète
- `SECURITE-10-10-ATTEINTE.md` - Détails sécurité
- `CHECKLIST-FINALE.md` - Checklist complète projet

---

**✅ Une fois les scripts exécutés, votre base de données est sécurisée au niveau 10/10 !**





