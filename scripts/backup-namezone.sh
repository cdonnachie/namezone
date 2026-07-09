#!/bin/bash
set -euo pipefail

# Backs up the Name Zone app database (Prisma SQLite) and its config to Contabo
# Object Storage, mirroring the PowerDNS backup. Runs as a hot online backup -
# no need to stop the service. Intended for cron on the app host.

DATE="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/namezone-backups"

# Where the app is deployed. In production DATABASE_URL points at data/prod.db.
APP_DIR="/opt/namezone"
DB="$APP_DIR/data/prod.db"
ENV_FILE="$APP_DIR/.env"

S3_ENDPOINT="https://usc1.contabostorage.com"
S3_BUCKET="s3://pdns/namezone/app"

LOCAL_RETENTION_DAYS=7
S3_RETENTION_DAYS=90

mkdir -p "$BACKUP_DIR"

DB_BACKUP="$BACKUP_DIR/namezone.sqlite3.$DATE"
DB_GZ="$DB_BACKUP.gz"
SQL_DUMP="$BACKUP_DIR/namezone.$DATE.sql"
SQL_GZ="$SQL_DUMP.gz"
CONFIG_TAR="$BACKUP_DIR/namezone-config.$DATE.tar.gz"

echo "Starting Name Zone backup: $DATE"

if [ ! -f "$DB" ]; then
    echo "ERROR: database not found at $DB" >&2
    exit 1
fi

# Safe SQLite online backup (consistent, includes any WAL).
sqlite3 "$DB" ".backup '$DB_BACKUP'"
gzip -f "$DB_BACKUP"

# Human-readable SQL dump (analogous to the PowerDNS zone export).
sqlite3 "$DB" ".dump" > "$SQL_DUMP"
gzip -f "$SQL_DUMP"

# Config backup (.env holds AUTH_SECRET and the PowerDNS API key - keep the
# bucket private). Tar from / so the archive records the absolute path.
if [ -f "$ENV_FILE" ]; then
    tar -czf "$CONFIG_TAR" -C / "${ENV_FILE#/}"
else
    echo "WARNING: no .env at $ENV_FILE, skipping config backup" >&2
    CONFIG_TAR=""
fi

# Upload to Contabo Object Storage.
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$DB_GZ" "$S3_BUCKET/"
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$SQL_GZ" "$S3_BUCKET/"
if [ -n "$CONFIG_TAR" ]; then
    aws --endpoint-url "$S3_ENDPOINT" s3 cp "$CONFIG_TAR" "$S3_BUCKET/"
fi

# Keep local backups for LOCAL_RETENTION_DAYS.
find "$BACKUP_DIR" -type f -mtime +"$LOCAL_RETENTION_DAYS" -delete

# Delete S3 backups older than S3_RETENTION_DAYS.
CUTOFF_EPOCH="$(date -u -d "$S3_RETENTION_DAYS days ago" +%s)"

echo "Removing S3 backups older than $S3_RETENTION_DAYS days..."

aws --endpoint-url "$S3_ENDPOINT" s3 ls "$S3_BUCKET/" | while read -r FILE_DATE FILE_TIME FILE_SIZE FILE_NAME; do
    if [ -z "${FILE_NAME:-}" ]; then
        continue
    fi

    FILE_EPOCH="$(date -u -d "$FILE_DATE $FILE_TIME" +%s)"

    if [ "$FILE_EPOCH" -lt "$CUTOFF_EPOCH" ]; then
        echo "Deleting old S3 backup: $FILE_NAME"
        aws --endpoint-url "$S3_ENDPOINT" s3 rm "$S3_BUCKET/$FILE_NAME"
    fi
done

echo "Name Zone backup completed: $DATE"
