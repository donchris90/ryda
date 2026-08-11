#!/bin/bash
# Restores a Ryda Postgres database from a pg_dump custom-format file
# produced by backup-db.sh. Usage: ./scripts/restore-db.sh path/to/dump.dump
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <path-to-dump-file>"
  exit 1
fi

: "${DB_HOST:=localhost}"
: "${DB_PORT:=5432}"
: "${DB_USERNAME:=postgres}"
: "${DB_NAME:=ryda}"

echo "WARNING: this will restore into $DB_NAME@$DB_HOST:$DB_PORT, overwriting conflicting objects."
read -p "Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

PGPASSWORD="$DB_PASSWORD" pg_restore \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d "$DB_NAME" \
  --clean --if-exists --no-owner \
  "$1"

echo "Restore complete."
