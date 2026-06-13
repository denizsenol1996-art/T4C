#!/bin/bash
# T4C Restore-DB — interactief, veilig DB-herstel uit backup.
#
# Werking:
#  1. Toon lijst backups in /opt/t4c/backups/ + /opt/t4c/backups/snapshots/
#  2. User kiest een file
#  3. Backup huidige DB → /opt/t4c/backups/pre-restore-<datum>.db
#  4. PM2 stop t4c-server (forceer release lock)
#  5. Integriteits-check op gekozen backup
#  6. Swap DB
#  7. PM2 start t4c-server
#  8. Verify health + telling per kritieke tabel
#
# Gebruik:  /opt/t4c/scripts/restore-db.sh
# Of:       /opt/t4c/scripts/restore-db.sh /pad/naar/backup.db    (non-interactief)

set -euo pipefail

DB=/opt/t4c/data/t4c.db
LOCK=/opt/t4c/data/.t4c-server.lock
TS=$(date '+%Y%m%d-%H%M%S')

echo "═══ T4C Restore-DB ═══"
echo "Huidige DB: $DB ($(du -h "$DB" | cut -f1), laatste write: $(stat -c %y "$DB"))"
echo

# ── Backup-bron kiezen ──
if [ $# -ge 1 ]; then
  CHOICE="$1"
else
  echo "Beschikbare backups:"
  mapfile -t BACKUPS < <(find /opt/t4c/backups -maxdepth 3 -name "*.db" -type f 2>/dev/null | sort)
  if [ ${#BACKUPS[@]} -eq 0 ]; then
    echo "GEEN backups gevonden in /opt/t4c/backups"
    exit 1
  fi
  for i in "${!BACKUPS[@]}"; do
    SIZE=$(du -h "${BACKUPS[$i]}" | cut -f1)
    DATE=$(stat -c %y "${BACKUPS[$i]}" | cut -d. -f1)
    printf "  [%2d] %s  %s  %s\n" "$i" "$SIZE" "$DATE" "${BACKUPS[$i]}"
  done
  echo
  read -p "Kies nummer (q=quit): " IDX
  [ "$IDX" = "q" ] && exit 0
  CHOICE="${BACKUPS[$IDX]}"
fi

if [ ! -f "$CHOICE" ]; then
  echo "FAIL: $CHOICE bestaat niet"
  exit 1
fi

echo
echo "Gekozen: $CHOICE ($(du -h "$CHOICE" | cut -f1))"
read -p "Bevestig restore (typ 'JA' voluit): " CONFIRM
[ "$CONFIRM" = "JA" ] || { echo "Geannuleerd."; exit 0; }

# ── Stap 1: pre-restore backup van huidige DB ──
PRE_BACKUP="/opt/t4c/backups/pre-restore-${TS}.db"
echo
echo "[1/6] Backup huidige DB → $PRE_BACKUP"
cp "$DB" "$PRE_BACKUP"
echo "      ✓ $(du -h "$PRE_BACKUP" | cut -f1)"

# ── Stap 2: integriteits-check op gekozen backup ──
echo "[2/6] Integriteits-check op $CHOICE"
INTEGRITY=$(sqlite3 "$CHOICE" "PRAGMA integrity_check;" 2>&1)
if [ "$INTEGRITY" != "ok" ]; then
  echo "      ❌ FAIL: $INTEGRITY"
  echo "      → Restore afgebroken, huidige DB ongewijzigd"
  exit 2
fi
echo "      ✓ OK"

# ── Stap 3: pm2 stop t4c-server ──
echo "[3/6] PM2 stop t4c-server (graceful, 10s kill_timeout)"
pm2 stop t4c-server > /dev/null
sleep 2
# Wacht tot lock-file weg is (max 12s)
for i in {1..12}; do
  [ ! -f "$LOCK" ] && break
  sleep 1
done
if [ -f "$LOCK" ]; then
  echo "      ⚠ lock-file nog aanwezig na 12s — manual remove"
  rm -f "$LOCK"
fi
echo "      ✓ gestopt"

# ── Stap 4: swap DB ──
echo "[4/6] Swap DB"
cp "$CHOICE" "$DB"
echo "      ✓ $(du -h "$DB" | cut -f1)"

# ── Stap 5: pm2 start ──
echo "[5/6] PM2 start t4c-server"
cd /opt/t4c && pm2 start ecosystem.config.js > /dev/null
echo "      Wacht 15s voor sql.js DB-load..."
sleep 15

# ── Stap 6: verify ──
echo "[6/6] Verify"
HEALTH=$(curl -s --max-time 5 http://localhost:3000/api/health)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('status',''))
except: print('')" 2>/dev/null)
if [ "$STATUS" != "ok" ]; then
  echo "      ❌ FAIL: health=$STATUS"
  echo "      Rollback: cp $PRE_BACKUP $DB && pm2 restart t4c-server"
  exit 3
fi
echo "      ✓ health=ok"

# Telling per kritieke tabel
echo
echo "Telling per kritieke tabel:"
sqlite3 "$DB" <<'SQL'
SELECT 'users:        ' || COUNT(*) FROM users;
SELECT 'veilingen:    ' || COUNT(*) FROM veilingen;
SELECT 'veiling_biedingen: ' || COUNT(*) FROM veiling_biedingen;
SELECT 'facturen:     ' || COUNT(*) FROM facturen;
SELECT 'contact_requests: ' || COUNT(*) FROM contact_requests;
SELECT 'audit_log:    ' || COUNT(*) FROM audit_log;
SQL

echo
echo "✓ Restore klaar"
echo "  Pre-restore backup: $PRE_BACKUP"
echo "  Rollback bij twijfel: cp $PRE_BACKUP $DB && pm2 restart t4c-server"
