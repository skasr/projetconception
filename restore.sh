#!/usr/bin/env bash
set -euo pipefail

DB_USER="${POSTGRES_USER:-studio}"
SOURCE_DB="${POSTGRES_DB:-studio_riff}"
TARGET_DB="${SOURCE_DB}_restore"
DUMP="${1:-$(ls -t backups/*.dump | head -1)}"

echo "restauration de $DUMP dans la base $TARGET_DB"

docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$TARGET_DB"
docker compose exec -T postgres createdb -U "$DB_USER" "$TARGET_DB"
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$TARGET_DB" < "$DUMP"

echo "--- comparaison du nombre de lignes ---"
for table in rooms members bookings; do
  src=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$SOURCE_DB" -tAc "select count(*) from $table" | tr -d '[:space:]')
  dst=$(docker compose exec -T postgres psql -U "$DB_USER" -d "$TARGET_DB" -tAc "select count(*) from $table" | tr -d '[:space:]')
  echo "$table : origine=$src restaurée=$dst"
done
