#!/bin/bash
# 💾 Script de backup Supabase - ZenFlow
# Sauvegarde les données importantes de Supabase

set -e

echo "💾 Backup Supabase - ZenFlow"
echo "=============================="
echo ""

# Couleurs
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/supabase_backup_$TIMESTAMP.sql"

# Créer dossier backup
mkdir -p "$BACKUP_DIR"

echo "📋 Instructions de backup Supabase"
echo ""
echo "Supabase gère automatiquement les backups, mais vous pouvez exporter manuellement :"
echo ""
echo "1. Via Supabase Dashboard:"
echo "   - Aller sur https://supabase.com/dashboard"
echo "   - Sélectionner votre projet"
echo "   - Settings → Database → Backups"
echo "   - Télécharger le backup"
echo ""
echo "2. Via Supabase CLI (si installé):"
echo "   supabase db dump -f $BACKUP_FILE"
echo ""
echo "3. Via pg_dump (si PostgreSQL client installé):"
echo "   pg_dump \$SUPABASE_DB_URL > $BACKUP_FILE"
echo ""
echo "📁 Backup sera sauvegardé dans: $BACKUP_DIR"
echo ""

# Vérifier si Supabase CLI est installé
if command -v supabase &> /dev/null; then
    echo -e "${GREEN}✓${NC} Supabase CLI détecté"
    echo ""
    echo "Pour créer un backup avec Supabase CLI:"
    echo "  supabase db dump -f $BACKUP_FILE"
    echo ""
elif command -v pg_dump &> /dev/null; then
    echo -e "${GREEN}✓${NC} pg_dump détecté"
    echo ""
    echo "Pour créer un backup avec pg_dump:"
    echo "  pg_dump \$SUPABASE_DB_URL > $BACKUP_FILE"
    echo ""
else
    echo -e "${YELLOW}⚠${NC} Aucun outil de backup détecté"
    echo "  Utiliser le dashboard Supabase pour les backups"
fi

echo ""
echo "📊 Tables à sauvegarder:"
echo "  - users"
echo "  - products"
echo "  - orders"
echo "  - order_items"
echo "  - refresh_tokens"
echo "  - pending_products"
echo "  - abandoned_carts"
echo ""

echo "✅ Instructions affichées"
echo ""
echo "Note: Supabase effectue des backups automatiques quotidiens"
echo "      Accessibles via Dashboard → Settings → Database → Backups"





