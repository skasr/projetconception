#!/usr/bin/env bash
set -euo pipefail

DB_USER="${POSTGRES_USER:-studio}"
DB_NAME="${POSTGRES_DB:-studio_riff}"
BACKUP_DIR="backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$OUTPUT"

echo "sauvegarde créée : $OUTPUT"
