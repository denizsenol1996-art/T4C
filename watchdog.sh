#!/bin/bash
# T4C Watchdog — draait elke minuut via cron
# Sinds 15 mei 2026: autoRestore deel verwijderd (data-loss tijdbom)
# Behoudt: health check + alert log + PM2 restart bij DOWN

LOG=/opt/t4c/data/watchdog.log
ALERT_LOG=/opt/t4c/logs/watchdog-alert.log
mkdir -p /opt/t4c/logs

HEALTH=$(curl -s --max-time 5 http://localhost:3000/api/health 2>/dev/null)
STATUS=$(echo "$HEALTH" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

if [ "$STATUS" = "ok" ]; then
  exit 0
fi

# Server is down — log het
TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "[WATCHDOG] $TS — Server DOWN, attempting recovery" >> "$LOG"

# DB integrity check (alleen voor diagnostiek/alerting — GEEN auto-restore meer)
DB_CHECK=$(cd /opt/t4c/backend && node -e "
const{initDB}=require('./db');
initDB().then(()=>{console.log('OK');process.exit()}).catch(e=>{console.log('CORRUPT');process.exit(1)})
" 2>/dev/null)

REASON="health=down db_check=${DB_CHECK:-unknown}"

if [ "$DB_CHECK" = "CORRUPT" ]; then
  # CRITICAL alert — schrijf naar alert log, GEEN automatische rollback meer
  echo "[$TS] CRITICAL: DB load failed — manual inspection required. NO auto-restore performed (disabled 15 mei 2026 post-race-incident)." >> "$ALERT_LOG"
  echo "[WATCHDOG] $TS — DB load failed, NO auto-restore (alert logged to $ALERT_LOG)" >> "$LOG"
fi

# Alert ALWAYS bij DOWN (niet alleen bij CORRUPT)
echo "[$TS] watchdog: server DOWN ($REASON), attempting PM2 restart" >> "$ALERT_LOG"

# Kill dubbele node processes op poort 3000
PIDS=$(lsof -ti:3000 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null
  sleep 2
fi

# Restart via PM2
pm2 restart t4c-server --update-env
sleep 5

# Verify
HEALTH2=$(curl -s --max-time 5 http://localhost:3000/api/health 2>/dev/null)
STATUS2=$(echo "$HEALTH2" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))" 2>/dev/null)

if [ "$STATUS2" = "ok" ]; then
  echo "[WATCHDOG] $TS — Recovery SUCCESS" >> "$LOG"
  echo "[$TS] watchdog: recovery SUCCESS" >> "$ALERT_LOG"
else
  echo "[WATCHDOG] $TS — Recovery FAILED" >> "$LOG"
  echo "[$TS] watchdog: recovery FAILED ($REASON) — server still DOWN" >> "$ALERT_LOG"
fi
