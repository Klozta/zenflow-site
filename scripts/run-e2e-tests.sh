#!/bin/bash
# Script pour exécuter les tests E2E critiques
# Prérequis: Backend démarré sur http://localhost:3001

set -e

echo "🧪 Exécution des tests E2E critiques..."

# Vérifier que le backend est démarré
if ! curl -f -s http://localhost:3001/health > /dev/null 2>&1; then
  echo "❌ Erreur: Le backend n'est pas démarré sur http://localhost:3001"
  echo "   Veuillez démarrer le backend avec: npm run dev"
  exit 1
fi

echo "✅ Backend accessible"

# Exécuter les tests E2E critiques
npm test -- e2e-critical.test.ts --verbose

echo "✅ Tests E2E critiques terminés"

