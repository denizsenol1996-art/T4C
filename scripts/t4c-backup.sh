#!/bin/bash
# T4C Backup helper
# Usage: bash /opt/t4c/scripts/t4c-backup.sh "<korte-reden>"
# Wordt door Claude Code aangeroepen voor elke wijziging.

set -e

REASON=${1:-manual}
# Sanitize reason: only alphanumeric, dash, underscore
SAFE_REASON=$(echo "$REASON" | tr -c '[:alnum:]-_' '_' | cut -c1-40)
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/opt/t4c/data/backups
SOURCE_DB=/opt/t4c/data/t4c.db
BACKUP_FILE="$BACKUP_DIR/t4c-${SAFE_REASON}-${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$SOURCE_DB" ]; then
    echo "✗ Source DB niet gevonden: $SOURCE_DB" >&2
    exit 1
fi

cp "$SOURCE_DB" "$BACKUP_FILE"
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo "✓ Backup: $BACKUP_FILE ($SIZE)"

# Cleanup: keep last 50 manual/Claude-created backups (auto-daily backups apart, niet met ${SAFE_REASON})
KEEP=50
TO_DELETE=$(ls -t "$BACKUP_DIR"/t4c-*.db 2>/dev/null | tail -n +$((KEEP+1)))
if [ -n "$TO_DELETE" ]; then
    echo "$TO_DELETE" | xargs -r rm
    DELETED_COUNT=$(echo "$TO_DELETE" | wc -l)
    echo "✓ $DELETED_COUNT oudere backup(s) verwijderd (laatste $KEEP behouden)"
fi

# Log naar Claude session log
LOG_DIR=/opt/t4c/data/claude-log
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date +%Y-%m).md"
{
    echo ""
    echo "### $(date '+%Y-%m-%d %H:%M:%S') — Backup gemaakt"
    echo "- Reden: $REASON"
    echo "- Bestand: \`$BACKUP_FILE\`"
    echo "- Grootte: $SIZE"
} >> "$LOG_FILE"
