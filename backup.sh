#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
BACKUP_DIR="/opt/t4c/backups"
mkdir -p $BACKUP_DIR

set -u
DB_SRC="/opt/t4c/data/t4c.db"
DB_DST="$BACKUP_DIR/db_$DATE.db"

if [ -f "$DB_SRC" ]; then
  cp "$DB_SRC" "$DB_DST"
  if [ -f "$DB_DST" ] && [ -s "$DB_DST" ]; then
    echo "✅ DB backup: $DB_DST ($(stat -c%s "$DB_DST") bytes)"
  else
    echo "❌ DB backup FAILED: target missing or empty"
    exit 1
  fi
else
  echo "❌ DB source missing: $DB_SRC"
  exit 1
fi

# .env backup (non-fatal indien missing)
if [ -f /opt/t4c/backend/.env ]; then
  cp /opt/t4c/backend/.env "$BACKUP_DIR/env_$DATE"
  echo "✅ .env backup: env_$DATE"
fi

# Rotation: 30d retention
find "$BACKUP_DIR" -name "db_*.db" -mtime +30 -delete 2>/dev/null
find "$BACKUP_DIR" -name "env_*" -mtime +30 -delete 2>/dev/null

echo "✅ Backup compleet: $DATE"
