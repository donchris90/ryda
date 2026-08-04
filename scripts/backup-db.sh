#!/bin/bash
# Backs up the Ryda Postgres database using the same DB_* env vars the app
# itself reads. Run from the project root: ./scripts/backup-db.sh
set -e

: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_USERNAME:=postgres}"
: "${DB_NAME:=ryda}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="${BACKUP_DIR:-./backups}"
OUT_FILE="$OUT_DIR/ryda-$TIMESTAMP.dump"

mkdir -p "$OUT_DIR"

echo "Backing up $DB_NAME@$DB_HOST:$DB_PORT to $OUT_FILE ..."
PGPASSWORD="$DB_PASSWORD" pg_dump \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" \
  -F c -f "$OUT_FILE"

echo "Done: $OUT_FILE"
echo "Restore with: ./scripts/restore-db.sh $OUT_FILE"
