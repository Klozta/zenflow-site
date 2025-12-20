#!/bin/bash
# Script de backup automatisé PostgreSQL
# Basé sur recommandations Perplexity - Disaster Recovery
#
# Usage: Cronjob quotidien à 02:00 UTC
# 0 2 * * * /path/to/backup-automated.sh

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups/postgresql}"
DAYS_RETENTION="${DAYS_RETENTION:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="${LOG_FILE:-/var/log/backup.log}"

# Variables d'environnement requises
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-zenflow}"
S3_BUCKET="${S3_BUCKET:-}"

# Fonction de logging
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Démarrage backup PostgreSQL ==="

# Créer le répertoire de backup si nécessaire
mkdir -p "$BACKUP_DIR"

# 1. Full backup PostgreSQL
BACKUP_FILE="$BACKUP_DIR/full_$TIMESTAMP.dump"
log "Création du dump PostgreSQL..."

pg_dump \
  --host="$POSTGRES_HOST" \
  --user="$POSTGRES_USER" \
  --format=custom \
  --verbose \
  --file="$BACKUP_FILE" \
  "$POSTGRES_DB" 2>&1 | tee -a "$LOG_FILE"

if [ $? -ne 0 ]; then
    log "❌ Échec du dump PostgreSQL"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "✅ Dump créé: $BACKUP_FILE ($BACKUP_SIZE)"

# 2. Chiffrer le backup (si GPG_KEY_ID est défini)
if [ -n "$GPG_KEY_ID" ]; then
    log "Chiffrement du backup avec GPG..."
    GPG_FILE="$BACKUP_FILE.gpg"

    gpg --encrypt \
      --recipient "$GPG_KEY_ID" \
      --cipher-algo AES256 \
      --output "$GPG_FILE" \
      "$BACKUP_FILE"

    if [ $? -eq 0 ]; then
        rm "$BACKUP_FILE"
        BACKUP_FILE="$GPG_FILE"
        log "✅ Backup chiffré: $BACKUP_FILE"
    else
        log "⚠️ Échec du chiffrement, backup non chiffré conservé"
    fi
fi

# 3. Upload vers S3 (si S3_BUCKET est défini)
if [ -n "$S3_BUCKET" ] && command -v aws &> /dev/null; then
    S3_PATH="s3://$S3_BUCKET/postgres/$(date +%Y/%m)/"
    log "Upload vers S3: $S3_PATH"

    aws s3 cp \
      "$BACKUP_FILE" \
      "$S3_PATH" \
      --storage-class GLACIER \
      2>&1 | tee -a "$LOG_FILE"

    if [ $? -eq 0 ]; then
        log "✅ Backup uploadé vers S3"
    else
        log "⚠️ Échec de l'upload S3"
    fi
fi

# 4. Nettoyer les backups locaux anciens
log "Nettoyage des backups locaux > $DAYS_RETENTION jours..."
find "$BACKUP_DIR" -name "*.dump*" -mtime +$DAYS_RETENTION -delete
log "✅ Nettoyage terminé"

# 5. Vérifier l'intégrité du backup
log "Vérification de l'intégrité..."
if command -v pg_restore &> /dev/null; then
    # Test de restauration sur un fichier temporaire (dry-run)
    TEMP_TEST="/tmp/backup_test_$TIMESTAMP"
    pg_restore --list "$BACKUP_FILE" > "$TEMP_TEST" 2>&1

    if [ $? -eq 0 ] && [ -s "$TEMP_TEST" ]; then
        log "✅ Intégrité du backup vérifiée"
        rm -f "$TEMP_TEST"
    else
        log "❌ Échec de la vérification d'intégrité"
        exit 1
    fi
fi

# 6. Statistiques finales
FINAL_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "=== Backup terminé avec succès ==="
log "Fichier: $BACKUP_FILE"
log "Taille: $FINAL_SIZE"
log "Timestamp: $TIMESTAMP"

# 7. Notification (optionnel - webhook, email, etc.)
if [ -n "$BACKUP_WEBHOOK_URL" ]; then
    curl -X POST "$BACKUP_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"status\": \"success\", \"file\": \"$BACKUP_FILE\", \"size\": \"$FINAL_SIZE\", \"timestamp\": \"$TIMESTAMP\"}" \
      > /dev/null 2>&1 || true
fi

exit 0

