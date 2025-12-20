#!/bin/bash
# Script de configuration admin pour ZenFlow
# Génère un token admin sécurisé et configure l'environnement

set -e

echo "🔐 Configuration Admin - ZenFlow"
echo "================================"
echo ""

# Vérifier si .env existe
if [ ! -f .env ]; then
  echo "⚠️  Le fichier .env n'existe pas. Création depuis .env.template..."
  cp .env.template .env
  echo "✅ Fichier .env créé"
  echo ""
fi

# Générer un token admin sécurisé
echo "🔑 Génération d'un token admin sécurisé..."
ADMIN_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo ""

# Ajouter ou mettre à jour ADMIN_TOKEN dans .env
if grep -q "^ADMIN_TOKEN=" .env; then
  # Remplacer la ligne existante
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$ADMIN_TOKEN|" .env
  else
    # Linux
    sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$ADMIN_TOKEN|" .env
  fi
  echo "✅ ADMIN_TOKEN mis à jour dans .env"
else
  # Ajouter la ligne
  echo "" >> .env
  echo "# Admin Token (généré automatiquement)" >> .env
  echo "ADMIN_TOKEN=$ADMIN_TOKEN" >> .env
  echo "✅ ADMIN_TOKEN ajouté dans .env"
fi

echo ""
echo "✅ Configuration terminée !"
echo ""
echo "📋 Votre token admin :"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "$ADMIN_TOKEN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  IMPORTANT :"
echo "   - Conservez ce token en lieu sûr"
echo "   - Ne le partagez pas publiquement"
echo "   - Utilisez-le pour vous connecter au panneau admin"
echo ""
echo "🌐 Accès admin :"
echo "   URL : http://localhost:3002/admin/products"
echo ""
echo "📝 Note : Après modification du .env, redémarrez le backend :"
echo "   npm run dev"
echo ""








