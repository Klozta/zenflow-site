#!/bin/bash
# 🔍 Script de vérification du monitoring
# Vérifie que Sentry et les autres services de monitoring sont correctement configurés

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🔍 Vérification du monitoring - ZenFlow"
echo "=========================================="
echo ""

# Vérifier Sentry
echo "📊 Sentry Error Tracking:"
if [ -n "$SENTRY_DSN" ]; then
  if echo "$SENTRY_DSN" | grep -q "https://.*@.*\.ingest\.sentry\.io"; then
    echo -e "${GREEN}✅ SENTRY_DSN configuré${NC}"
    echo "   DSN: ${SENTRY_DSN:0:30}..."
  else
    echo -e "${YELLOW}⚠️  SENTRY_DSN semble invalide${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  SENTRY_DSN non configuré (optionnel)${NC}"
  echo "   Pour activer: Ajouter SENTRY_DSN dans .env"
  echo "   Obtenir un DSN: https://sentry.io → Créer un projet"
fi
echo ""

# Vérifier les variables de monitoring
echo "📈 Variables de monitoring:"
MONITORING_VARS=(
  "SUPABASE_URL:Base de données"
  "UPSTASH_REDIS_URL:Cache Redis"
  "STRIPE_SECRET_KEY:Paiements Stripe"
  "RESEND_API_KEY:Emails"
)

for var_info in "${MONITORING_VARS[@]}"; do
  IFS=':' read -r var_name var_desc <<< "$var_info"
  if [ -n "${!var_name}" ]; then
    echo -e "${GREEN}✅${NC} $var_desc: Configuré"
  else
    echo -e "${RED}❌${NC} $var_desc: Non configuré"
  fi
done
echo ""

# Vérifier que le backend répond
echo "🌐 Vérification backend:"
API_URL="${API_URL:-http://localhost:3001}"
if curl -f -s "${API_URL}/health" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Backend accessible${NC}"

  # Tester health détaillé
  HEALTH_RESPONSE=$(curl -s "${API_URL}/health/detailed" 2>/dev/null || echo "")
  if [ -n "$HEALTH_RESPONSE" ]; then
    echo -e "${GREEN}✅ Health check détaillé fonctionne${NC}"
  fi
else
  echo -e "${RED}❌ Backend non accessible sur ${API_URL}${NC}"
  echo "   Vérifier que le backend est démarré: npm run dev"
fi
echo ""

# Vérifier les endpoints de monitoring
echo "📊 Endpoints de monitoring:"
if [ -n "$ADMIN_TOKEN" ] || [ -n "$CRON_API_KEY" ]; then
  TOKEN="${ADMIN_TOKEN:-$CRON_API_KEY}"

  # Login admin
  LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/admin/login" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"${TOKEN}\"}" \
    -c /tmp/admin_cookies.txt 2>/dev/null || echo "")

  if echo "$LOGIN_RESPONSE" | grep -q '"ok":true'; then
    echo -e "${GREEN}✅ Authentification admin OK${NC}"

    # Tester monitoring metrics
    METRICS_RESPONSE=$(curl -s -b /tmp/admin_cookies.txt "${API_URL}/api/monitoring/metrics" 2>/dev/null || echo "")
    if [ -n "$METRICS_RESPONSE" ] && echo "$METRICS_RESPONSE" | grep -q "timestamp"; then
      echo -e "${GREEN}✅ Endpoint /api/monitoring/metrics fonctionne${NC}"
    else
      echo -e "${YELLOW}⚠️  Endpoint /api/monitoring/metrics non accessible${NC}"
    fi

    # Tester alerts
    ALERTS_RESPONSE=$(curl -s -b /tmp/admin_cookies.txt "${API_URL}/api/monitoring/alerts" 2>/dev/null || echo "")
    if [ -n "$ALERTS_RESPONSE" ] && echo "$ALERTS_RESPONSE" | grep -q "alerts"; then
      echo -e "${GREEN}✅ Endpoint /api/monitoring/alerts fonctionne${NC}"
    else
      echo -e "${YELLOW}⚠️  Endpoint /api/monitoring/alerts non accessible${NC}"
    fi

    rm -f /tmp/admin_cookies.txt
  else
    echo -e "${YELLOW}⚠️  Impossible de se connecter en admin${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  ADMIN_TOKEN ou CRON_API_KEY non configuré${NC}"
  echo "   Les endpoints de monitoring nécessitent une authentification admin"
fi
echo ""

# Résumé
echo "=========================================="
echo "📋 Résumé:"
echo ""
echo "Pour activer le monitoring complet:"
echo "1. Configurer SENTRY_DSN (optionnel mais recommandé)"
echo "2. Vérifier que tous les services externes sont configurés"
echo "3. Tester les endpoints de monitoring via /admin/monitoring"
echo ""
echo "Documentation:"
echo "- Guide déploiement: docs/GUIDE-DEPLOIEMENT-COMPLET.md"
echo "- Guide admin: docs/GUIDE-UTILISATEUR-ADMIN.md"

