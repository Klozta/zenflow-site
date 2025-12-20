#!/bin/bash
# 🔄 Script de backup automatique de la base de données
# À exécuter via cron (ex: quotidiennement à 2h du matin)
#
# Configuration cron (crontab -e):
# 0 2 * * * /path/to/backend/scripts/backup-automatic.sh >> /var/log/backup.log 2>&1

set -e

# Couleurs pour logs
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
API_URL="${API_URL:-http://localhost:3001/api}"
ADMIN_TOKEN="${CRON_API_KEY:-${ADMIN_TOKEN}}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo -e "${RED}❌ Erreur: CRON_API_KEY ou ADMIN_TOKEN non configuré${NC}"
  exit 1
fi

echo -e "${GREEN}🔄 Démarrage backup automatique${NC}"
echo "Date: $(date)"
echo ""

# Vérifier que le backend est accessible
if ! curl -f -s "${API_URL%/api}/health" > /dev/null 2>&1; then
  echo -e "${RED}❌ Erreur: Backend non accessible sur ${API_URL}${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Backend accessible${NC}"

# Appeler l'endpoint de backup
RESPONSE=$(curl -s -X POST "${API_URL}/cron/backup" \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_session=$(curl -s -X POST "${API_URL}/admin/login" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"${ADMIN_TOKEN}\"}" \
    -c - | grep admin_session | awk '{print $7}')" \
  2>&1)

# Vérifier le résultat
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ Backup créé avec succès${NC}"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 0
else
  echo -e "${RED}❌ Échec du backup${NC}"
  echo "$RESPONSE"
  exit 1
fi

