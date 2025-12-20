# 🔐 Configuration Admin - ZenFlow

> **Guide complet pour configurer et utiliser le panneau d'administration**

---

## 🚀 Configuration Rapide

### Option 1 : Script Automatique (Recommandé)

```bash
cd zenflow-site/backend
./scripts/setup-admin.sh
```

Le script va :
- ✅ Générer un token admin sécurisé
- ✅ L'ajouter dans le fichier `.env`
- ✅ Afficher le token pour que vous puissiez vous connecter

### Option 2 : Configuration Manuelle

1. **Générer un token** :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **Ajouter dans `.env`** :
```env
ADMIN_TOKEN=votre_token_genere_ici
```

3. **Redémarrer le backend** :
```bash
npm run dev
```

---

## 🔑 Utilisation

### Connexion au Panneau Admin

1. **Accéder à la page de login** :
   - URL : `http://localhost:3002/admin/login`
   - Ou : `http://localhost:3002/admin/products` (redirige automatiquement)

2. **Entrer le token** :
   - Le token se trouve dans `backend/.env` (variable `ADMIN_TOKEN`)
   - Copier-coller le token dans le champ

3. **Se connecter** :
   - Cliquer sur "Se connecter"
   - Vous serez redirigé vers le panneau admin

### Pages Disponibles

- **`/admin/products`** - Gestion des produits
- **`/admin/orders`** - Gestion des commandes
- **`/admin/analytics`** - Statistiques et analytics
- **`/admin/metrics`** - Métriques détaillées

---

## 🔒 Sécurité

### Bonnes Pratiques

1. **Token Sécurisé** :
   - ✅ Utilisez un token long (minimum 32 caractères)
   - ✅ Ne le partagez pas publiquement
   - ✅ Changez-le régulièrement

2. **Environnement** :
   - ✅ Ne commitez jamais `.env` dans Git
   - ✅ Utilisez des tokens différents pour dev/prod
   - ✅ Limitez l'accès au fichier `.env`

3. **Session** :
   - ✅ Les sessions expirent après 7 jours
   - ✅ Les cookies sont httpOnly et sécurisés
   - ✅ Déconnexion automatique si token invalide

### Régénérer un Token

Si vous devez changer le token :

```bash
cd zenflow-site/backend
./scripts/setup-admin.sh
```

Ou manuellement :
```bash
# Générer nouveau token
NEW_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Mettre à jour .env
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$NEW_TOKEN/" .env
```

---

## 📋 Variables d'Environnement

### Backend (`.env`)

```env
# Token admin (obligatoire pour l'accès admin)
ADMIN_TOKEN=votre_token_secret_ici

# Alternative : CRON_API_KEY (peut servir de token admin aussi)
CRON_API_KEY=votre_cle_alternative
```

### Frontend (`.env.local`)

```env
# Activer le panneau admin
NEXT_PUBLIC_ADMIN_ENABLED=1

# URL de l'API backend
NEXT_PUBLIC_API_URL=http://localhost:3001/api
```

---

## 🛠️ Dépannage

### Erreur "Token invalide"

**Causes possibles** :
- Token mal copié (espaces en trop)
- Token incorrect dans `.env`
- Backend non redémarré après modification du `.env`

**Solution** :
1. Vérifier le token dans `.env`
2. Redémarrer le backend
3. Réessayer la connexion

### Erreur "Admin authentication not configured"

**Cause** : La variable `ADMIN_TOKEN` n'est pas définie dans `.env`

**Solution** :
```bash
cd zenflow-site/backend
./scripts/setup-admin.sh
```

### Session expirée

**Solution** : Se reconnecter simplement avec le même token

---

## 🔄 Déconnexion

Pour vous déconnecter :

1. Cliquer sur "Déconnexion" dans le panneau admin
2. Ou aller sur : `http://localhost:3002/admin/logout`
3. Ou supprimer le cookie `admin_session` dans le navigateur

---

## 📞 Support

Pour toute question :
- Consulter les logs backend : Vérifier la console
- Vérifier les logs frontend : Console du navigateur (F12)
- Documentation API : `http://localhost:3001/api-docs/swagger`

---

**Configuration terminée ? Passez à l'ajout de produits ! 🎉**








