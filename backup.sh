#!/bin/bash
DATE=$(date +%Y%m%d_%H%M)
BACKUP_DIR="/opt/t4c/backups"
mkdir -p $BACKUP_DIR

cp /opt/t4c/data/*.db $BACKUP_DIR/db_$DATE.db 2>/dev/null
cp /opt/t4c/backend/.env $BACKUP_DIR/env_$DATE 2>/dev/null
find $BACKUP_DIR -mtime +30 -delete

echo "✅ Backup compleet: $DATE"
