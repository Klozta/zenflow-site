# Tests E2E Critiques

## Vue d'ensemble

Les tests E2E critiques vérifient les flux principaux de l'application en conditions réelles, nécessitant un backend démarré et une base de données accessible.

## Prérequis

1. **Backend démarré** : Le serveur doit être lancé sur `http://localhost:3001`
   ```bash
   npm run dev
   ```

2. **Variables d'environnement** : Configurer au minimum :
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
   - `CRON_API_KEY` ou `ADMIN_TOKEN` (pour les tests admin)

3. **Base de données** : Supabase doit être accessible et les tables créées

## Exécution

### Tous les tests E2E
```bash
npm run test:e2e
```

### Un fichier de test spécifique
```bash
npm test -- e2e-critical.test.ts
```

### Via script shell
```bash
./scripts/run-e2e-tests.sh
```

## Tests inclus

### 1. Health Checks
- Vérification du statut `/health`
- Health check détaillé avec services

### 2. Authentification Admin
- Login avec token admin
- Vérification de session
- Rejet de token invalide

### 3. Flux Commande
- Création de commande avec données valides
- Rejet de données invalides
- Récupération du statut de commande (endpoint public)

### 4. API Produits
- Liste des produits
- Recherche de produits

### 5. Monitoring & Métriques
- Récupération des métriques de monitoring (admin)
- Récupération des alertes actives (admin)

### 6. Notifications Admin
- Récupération des notifications admin
- Marquage comme lue

### 7. Analytics
- Endpoints analytics (revenue, top-products, funnel, conversion)

### 8. Gestion d'erreurs
- 404 pour endpoints inexistants
- Format d'erreur correct

## Configuration

Les tests utilisent les variables d'environnement suivantes :
- `API_URL` : URL de l'API (défaut: `http://localhost:3001/api`)
- `ADMIN_TOKEN` ou `CRON_API_KEY` : Token admin pour les tests
- `FRONTEND_URL` : URL du frontend (optionnel, défaut: `http://localhost:3002`)

## Notes

- Les tests E2E sont **exclus par défaut** des tests unitaires (`npm test`)
- Utilisez `npm run test:unit` pour exécuter uniquement les tests unitaires
- Les tests E2E ont un timeout de 30 secondes (vs 10s pour les unitaires)
- Certains tests peuvent être skippés si les prérequis ne sont pas remplis (ex: commande de test)

## CI/CD

Les tests E2E ne sont **pas** exécutés automatiquement dans le CI/CD car ils nécessitent :
- Un backend démarré
- Une base de données accessible
- Des variables d'environnement configurées

Pour exécuter les tests E2E en CI/CD, il faudrait :
1. Démarrer le backend dans un conteneur/service
2. Configurer Supabase (ou utiliser une DB de test)
3. Ajouter un job dédié dans `.github/workflows/backend-ci.yml`

