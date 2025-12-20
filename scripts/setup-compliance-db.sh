#!/usr/bin/env bash
set -euo pipefail

# Setup Compliance DB schema (products + compliance_audit)
# Requires: psql (postgresql-client)
#
# Usage:
#   COMPLIANCE_DB_HOST=... COMPLIANCE_DB_PORT=5432 COMPLIANCE_DB_NAME=... \
#   COMPLIANCE_DB_USER=... COMPLIANCE_DB_PASSWORD=... \
#   ./zenflow-site/backend/scripts/setup-compliance-db.sh
#
# Notes:
# - This script does NOT store secrets.
# - It applies SQL from scripts/compliance-importer-schema.sql

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="${ROOT_DIR}/scripts/compliance-importer-schema.sql"

if ! command -v psql >/dev/null 2>&1; then
  echo "❌ psql not found. Install it first:"
  echo "   - Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y postgresql-client"
  exit 1
fi

DB_HOST="${COMPLIANCE_DB_HOST:-}"
DB_PORT="${COMPLIANCE_DB_PORT:-5432}"
DB_NAME="${COMPLIANCE_DB_NAME:-}"
DB_USER="${COMPLIANCE_DB_USER:-}"
DB_PASSWORD="${COMPLIANCE_DB_PASSWORD:-}"

if [[ -z "${DB_HOST}" || -z "${DB_NAME}" || -z "${DB_USER}" || -z "${DB_PASSWORD}" ]]; then
  echo "❌ Missing env vars. Required:"
  echo "   COMPLIANCE_DB_HOST, COMPLIANCE_DB_NAME, COMPLIANCE_DB_USER, COMPLIANCE_DB_PASSWORD"
  echo "   Optional: COMPLIANCE_DB_PORT (default 5432)"
  exit 1
fi

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "❌ SQL schema file not found: ${SQL_FILE}"
  exit 1
fi

export PGPASSWORD="${DB_PASSWORD}"

echo "✅ Applying schema to ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
psql \
  "host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME} user=${DB_USER} sslmode=${COMPLIANCE_DB_SSLMODE:-prefer}" \
  -v ON_ERROR_STOP=1 \
  -f "${SQL_FILE}"

echo "✅ Done. To enable audit logging in the app, set:"
echo "   COMPLIANCE_DB_ENABLED=true"
echo "   COMPLIANCE_DB_HOST=${DB_HOST}"
echo "   COMPLIANCE_DB_PORT=${DB_PORT}"
echo "   COMPLIANCE_DB_NAME=${DB_NAME}"
echo "   COMPLIANCE_DB_USER=${DB_USER}"
echo "   COMPLIANCE_DB_PASSWORD=***"

