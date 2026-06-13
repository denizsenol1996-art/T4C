#!/bin/bash
# T4C Hourly DB-snapshot — finere RPO dan daily backup-cron.
#
# Werking:
#  - Cron @ minute=15 elk uur (na backup-cron 3:00 zit er buffer)
#  - Kopieert /opt/t4c/data/t4c.db naar /opt/t4c/backups/snapshots/db-<datum>-<uur>.db
#  - Houdt 24 snapshots vast (24u rollende window), oude weg
#  - Skip als DB ongewijzigd sinds laatste snapshot (mtime-check)
#
# RPO impact: max 60 min data-verlies bij server-loss (was: 24u via daily backup)

set -u
DB=/opt/t4c/data/t4c.db
SNAPSHOT_DIR=/opt/t4c/backups/snapshots
RETAIN_HOURS=24
LOG=/opt/t4c/logs/db-snapshot.log

mkdir -p "$SNAPSHOT_DIR" /opt/t4c/logs

TS=$(date '+%Y%m%d-%H')
TARGET="$SNAPSHOT_DIR/db-$TS.db"

# Skip als deze snapshot al bestaat (idempotent — meerdere cron-runs in zelfde uur)
if [ -f "$TARGET" ]; then
  exit 0
fi

# Skip als DB ongewijzigd sinds laatste snapshot
LAST_SNAPSHOT=$(ls -t "$SNAPSHOT_DIR"/db-*.db 2>/dev/null | head -1)
if [ -n "$LAST_SNAPSHOT" ] && [ "$DB" -ot "$LAST_SNAPSHOT" ]; then
  exit 0
fi

# Snapshot maken — eerst integrity-check
if ! sqlite3 "$DB" "PRAGMA quick_check;" 2>&1 | grep -q "^ok$"; then
  echo "[SNAPSHOT] $(date '+%F %T') FAIL: DB quick_check faalde — snapshot overgeslagen" >> "$LOG"
  exit 1
fi

cp "$DB" "$TARGET"
SIZE=$(du -h "$TARGET" | cut -f1)

# Retention: alleen $RETAIN_HOURS nieuwste behouden
mapfile -t SNAPSHOTS < <(ls -t "$SNAPSHOT_DIR"/db-*.db 2>/dev/null)
if [ ${#SNAPSHOTS[@]} -gt "$RETAIN_HOURS" ]; then
  for ((i=RETAIN_HOURS; i<${#SNAPSHOTS[@]}; i++)); do
    rm -f "${SNAPSHOTS[$i]}"
  done
fi

# Log alleen 1× per dag (00:15) een tick — anders elke uur = log-spam
if [ "$(date +%H)" = "00" ]; then
  COUNT=$(ls "$SNAPSHOT_DIR"/db-*.db 2>/dev/null | wc -l)
  echo "[SNAPSHOT] $(date '+%F %T') daily tick: $COUNT snapshots, latest=$TARGET ($SIZE)" >> "$LOG"
fi
exit 0
