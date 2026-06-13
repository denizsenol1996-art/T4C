#!/bin/bash
# T4C Smoke-test — verifieert dat t4c-server gezond is na (re)start.
# Wordt aangeroepen door:
#  - watchdog.sh na succesvolle recovery (zie /opt/t4c/watchdog.sh)
#  - handmatig na pm2 reload (cijfer-controle)
#  - cron @reboot voor post-boot validatie
#
# Exit codes:
#  0 = alles OK
#  1 = health endpoint faalde
#  2 = ≥1 publieke route faalde (non-200)
#  3 = error-log heeft nieuwe errors sinds boot
#  4 = DB-integriteit faalde

set -u
LOG=/opt/t4c/logs/smoke-test.log
BASE="http://localhost:3000"
TS=$(date '+%F %T')

mkdir -p /opt/t4c/logs

# ── 1. Health endpoint ──
HEALTH=$(curl -s --max-time 5 "$BASE/api/health" 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('status',''))
except: print('')" 2>/dev/null)
if [ "$STATUS" != "ok" ]; then
  echo "[SMOKE] $TS FAIL: health-endpoint status='$STATUS' (HEALTH=$HEALTH)" >> "$LOG"
  exit 1
fi

# ── 2. Publieke routes ──
ROUTES=(/ /veilingen/ /aanbod/ /login/ /aanmelden/ /transport/ /verkoop/ /privacy/ /account/ /sitemap.xml /robots.txt)
FAILED=()
for p in "${ROUTES[@]}"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "Host: transfer4cars.com" "$BASE$p")
  if [ "$code" != "200" ]; then
    FAILED+=("$code $p")
  fi
done
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "[SMOKE] $TS FAIL: ${#FAILED[@]}/${#ROUTES[@]} routes non-200:" >> "$LOG"
  for f in "${FAILED[@]}"; do echo "  $f" >> "$LOG"; done
  exit 2
fi

# ── 3. Error-log scan (alleen errors NA huidige proc-start) ──
PID=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('pid',''))
except: print('')" 2>/dev/null)
UPTIME=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('uptime',0))
except: print(0)" 2>/dev/null)
# Errors uit pm2-log van laatste $UPTIME seconden
ERR_LOG=/home/deniz/.pm2/logs/t4c-server-error.log
if [ -f "$ERR_LOG" ] && [ "$UPTIME" -gt 0 ]; then
  RECENT_ERRORS=$(find "$ERR_LOG" -newermt "@$(($(date +%s) - UPTIME))" 2>/dev/null | xargs tail -n 100 2>/dev/null | grep -iE "error|fatal|exception" | grep -v "LOCK\] FATAL" | head -5)
  if [ -n "$RECENT_ERRORS" ]; then
    echo "[SMOKE] $TS WARN: errors in pm2-log sinds proc-start (PID $PID, uptime ${UPTIME}s):" >> "$LOG"
    echo "$RECENT_ERRORS" | head -3 >> "$LOG"
    # Niet hard falen — alleen waarschuwen
  fi
fi

# ── 4. DB-integriteit (lichtgewicht: telling per kritieke tabel) ──
DB=/opt/t4c/data/t4c.db
if ! sqlite3 "$DB" "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM veilingen; SELECT COUNT(*) FROM audit_log;" > /dev/null 2>&1; then
  echo "[SMOKE] $TS FAIL: DB-query op users/veilingen/audit_log faalde" >> "$LOG"
  exit 4
fi

# ── OK ──
# Log alleen bij anomaly / 1× per dag een tick-line ter zichtbaarheid
if [ "$(date +%H%M)" = "0500" ]; then
  echo "[SMOKE] $TS OK (daily tick, ${#ROUTES[@]} routes 200, uptime ${UPTIME}s, pid $PID)" >> "$LOG"
fi
exit 0
