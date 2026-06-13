#!/bin/bash
# T4C Watchdog v2 — herontworpen 2026-06-09 na zombie-fabriek-incident
#
# WIJZIGINGEN tov v1:
# - flock-gate: max 1 watchdog tegelijk (vorige liet 2 tegelijk → dubbele restarts → zombies)
# - GEEN kill -9 $(lsof -ti:3000) meer — was de zombie-fabriek. PM2 handelt SIGTERM nu netjes.
# - 3-strikes pattern: pas restarten na 3 opeenvolgende health-fails (voorkomt false-positive flap-restarts)
# - cool-down 5min: max 1 restart per 5 minuten (voorkomt restart-storm)
# - DB-integrity-check verwijderd uit hot path: te traag op 179MB DB, geen automatische actie meer

set -u

LOG=/opt/t4c/data/watchdog.log
ALERT_LOG=/opt/t4c/logs/watchdog-alert.log
LOCK=/tmp/t4c-watchdog.lock
FAILS_FILE=/tmp/t4c-watchdog-fails
LAST_RESTART_FILE=/tmp/t4c-watchdog-last-restart
COOLDOWN_S=300       # 5 min tussen restarts
FAIL_THRESHOLD=3     # 3 opeenvolgende fails vóór restart

mkdir -p /opt/t4c/logs

# ── Lock: voorkomt parallel runs ──
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[WATCHDOG] $(date '+%F %T') skip: vorige run nog actief" >> "$LOG"
  exit 0
fi

# ── Health check ──
HEALTH=$(curl -s --max-time 5 http://localhost:3000/api/health 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('status',''))
except: print('')" 2>/dev/null)

if [ "$STATUS" = "ok" ]; then
  # Healthy — reset fail-counter
  echo "0" > "$FAILS_FILE"
  # Tick-log: 1× per uur op minute=00 zodat zichtbaar is dat watchdog leeft.
  # Anders is leeg log = "draait niet" of "alles gezond" — ondoorscheidbaar.
  if [ "$(date +%M)" = "00" ]; then
    UPTIME_STR=$(echo "$HEALTH" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('uptimeStr','?'))
except: print('?')" 2>/dev/null)
    echo "[WATCHDOG] $(date '+%F %T') tick (alive, server uptime $UPTIME_STR)" >> "$LOG"
  fi
  exit 0
fi

# ── Fail-counter ──
FAILS=$(cat "$FAILS_FILE" 2>/dev/null || echo "0")
FAILS=$((FAILS + 1))
echo "$FAILS" > "$FAILS_FILE"

TS=$(date '+%F %T')
echo "[WATCHDOG] $TS health-fail ($FAILS/$FAIL_THRESHOLD)" >> "$LOG"

if [ "$FAILS" -lt "$FAIL_THRESHOLD" ]; then
  exit 0  # nog niet genoeg fails
fi

# ── Cool-down check ──
NOW=$(date +%s)
LAST_RESTART=$(cat "$LAST_RESTART_FILE" 2>/dev/null || echo "0")
ELAPSED=$((NOW - LAST_RESTART))

if [ "$ELAPSED" -lt "$COOLDOWN_S" ]; then
  WAIT=$((COOLDOWN_S - ELAPSED))
  echo "[WATCHDOG] $TS in cool-down ($WAIT s left), skip restart" >> "$LOG"
  echo "[$TS] watchdog: server down maar in cool-down — manual intervention nodig" >> "$ALERT_LOG"
  exit 0
fi

# ── Restart via PM2 (SIGTERM-handler doet de graceful save) ──
echo "[WATCHDOG] $TS RESTART na $FAILS fails" >> "$LOG"
echo "[$TS] watchdog: pm2 restart t4c-server" >> "$ALERT_LOG"
pm2 restart t4c-server --update-env >> "$LOG" 2>&1
echo "$NOW" > "$LAST_RESTART_FILE"
echo "0" > "$FAILS_FILE"

# ── Verify ──
sleep 8
HEALTH2=$(curl -s --max-time 5 http://localhost:3000/api/health 2>/dev/null)
STATUS2=$(echo "$HEALTH2" | python3 -c "import sys,json
try: print(json.load(sys.stdin).get('status',''))
except: print('')" 2>/dev/null)

if [ "$STATUS2" = "ok" ]; then
  echo "[WATCHDOG] $TS recovery SUCCESS" >> "$LOG"
  echo "[$TS] watchdog: recovery SUCCESS" >> "$ALERT_LOG"
  # Diepere validatie na recovery — alleen falen logt
  if ! /opt/t4c/scripts/smoke-test.sh; then
    echo "[WATCHDOG] $TS smoke-test post-recovery FAILED — zie /opt/t4c/logs/smoke-test.log" >> "$LOG"
    echo "[$TS] watchdog: smoke-test FAIL na recovery — handmatige check nodig" >> "$ALERT_LOG"
  fi
else
  echo "[WATCHDOG] $TS recovery FAILED" >> "$LOG"
  echo "[$TS] watchdog: recovery FAILED — server still down" >> "$ALERT_LOG"
fi
