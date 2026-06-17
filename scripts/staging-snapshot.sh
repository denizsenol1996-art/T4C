#!/usr/bin/env bash
# T4C staging DB-snapshot — kopieer dagelijks de live t4c.db naar staging.
#
# Cron: 0 4 * * * /opt/t4c/scripts/staging-snapshot.sh >> /opt/t4c/logs/staging-snapshot.log 2>&1
# (na backup.sh om 03:00 — beide hebben dan een verse snapshot)
#
# Behoud 7 oudere snapshots in staging/data/snapshots/ voor rollback.

set -euo pipefail

SRC="/opt/t4c/data/t4c.db"
DST_DIR="/home/deniz/t4c-staging/data"
SNAP_DIR="$DST_DIR/snapshots"
DATE=$(date +%Y%m%d_%H%M)

mkdir -p "$SNAP_DIR"

if [ ! -f "$SRC" ]; then
  echo "[$DATE] ❌ Bron ontbreekt: $SRC" >&2
  exit 1
fi

# Sluit eventueel draaiende staging-instance kort voor swap (anders WAL-lock)
if pm2 jlist 2>/dev/null | grep -q '"name":"t4c-staging"'; then
  STAGING_WAS_RUNNING=1
  pm2 stop t4c-staging >/dev/null 2>&1 || true
  sleep 3
else
  STAGING_WAS_RUNNING=0
fi

# Archief oudere staging-DB
if [ -f "$DST_DIR/t4c.db" ]; then
  cp "$DST_DIR/t4c.db" "$SNAP_DIR/t4c-${DATE}.db"
fi

# Nieuwe snapshot
cp "$SRC" "$DST_DIR/t4c.db"
SIZE=$(stat -c%s "$DST_DIR/t4c.db")

# 7-d retention
find "$SNAP_DIR" -name "t4c-*.db" -mtime +7 -delete 2>/dev/null

# Herstart staging als die draaide
if [ "$STAGING_WAS_RUNNING" = "1" ]; then
  pm2 start t4c-staging >/dev/null 2>&1 || true
fi

echo "[$DATE] ✅ Staging-snapshot: $SIZE bytes naar $DST_DIR/t4c.db"
