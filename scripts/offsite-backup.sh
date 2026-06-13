#!/bin/bash
# T4C Off-site backup — daily push naar externe storage (B2, S3, etc.).
# Werkt met rclone (multi-provider) + GPG-encrypt.
#
# Eenmalige setup (user moet doen):
#   1. apt install rclone gpg
#   2. rclone config → maak remote aan met naam "t4c-offsite"
#      (kies: Backblaze B2 / AWS S3 / iDrive / wat dan ook)
#   3. gpg --gen-key (recipient: deniz@transfer4cars.com)
#   4. Test: /opt/t4c/scripts/offsite-backup.sh --test
#   5. Crontab toevoegen: 30 3 * * * /opt/t4c/scripts/offsite-backup.sh
#      (na de lokale backup 3:00, voor de disk-alert 8:00)
#
# Werking:
#   - Pakt nieuwste lokale backup uit /opt/t4c/backups/ (db_*.db)
#   - GPG-encrypted naar /tmp/
#   - rclone copy naar remote:t4c-backups/<datum>
#   - Retain N days op remote (auto-purge)
#   - Daily tick @04:00 / fail-log altijd

set -u
LOG=/opt/t4c/logs/offsite-backup.log
REMOTE_NAME="t4c-offsite"        # rclone remote naam
REMOTE_PATH="t4c-backups"        # bucket / pad op remote
GPG_RECIPIENT="deniz@transfer4cars.com"  # encrypt-recipient
RETAIN_DAYS=90                   # off-site retention

mkdir -p /opt/t4c/logs

TS=$(date '+%F %T')
DATE=$(date '+%Y%m%d')

# ── Mode flag ──
if [ "${1:-}" = "--test" ]; then
  echo "[OFFSITE] $TS TEST-MODE: probeert connectie zonder daadwerkelijke upload" >> "$LOG"
  TEST_MODE=1
else
  TEST_MODE=0
fi

# ── Preflight: tools aanwezig? ──
for tool in rclone gpg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[OFFSITE] $TS FAIL: '$tool' niet geinstalleerd. apt install rclone gpg" >> "$LOG"
    exit 1
  fi
done

# ── Preflight: rclone remote geconfigureerd? ──
if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE_NAME}:$"; then
  echo "[OFFSITE] $TS FAIL: rclone remote '$REMOTE_NAME' niet geconfigureerd. Run: rclone config" >> "$LOG"
  exit 2
fi

# ── Preflight: GPG-key aanwezig? ──
if ! gpg --list-keys "$GPG_RECIPIENT" >/dev/null 2>&1; then
  echo "[OFFSITE] $TS FAIL: GPG-key voor '$GPG_RECIPIENT' niet aanwezig. Run: gpg --gen-key" >> "$LOG"
  exit 3
fi

if [ "$TEST_MODE" = "1" ]; then
  # Test alleen connectie
  if rclone lsd "${REMOTE_NAME}:" >/dev/null 2>&1; then
    echo "[OFFSITE] $TS TEST OK — remote bereikbaar, GPG-key OK"
    exit 0
  else
    echo "[OFFSITE] $TS TEST FAIL — kan remote niet bereiken"
    exit 4
  fi
fi

# ── Pak nieuwste lokale backup ──
LATEST=$(ls -t /opt/t4c/backups/db_*.db 2>/dev/null | head -1)
if [ -z "$LATEST" ] || [ ! -f "$LATEST" ]; then
  echo "[OFFSITE] $TS FAIL: geen lokale backup gevonden in /opt/t4c/backups/db_*.db" >> "$LOG"
  exit 5
fi

BASENAME=$(basename "$LATEST")
ENCRYPTED="/tmp/${BASENAME}.gpg"

# ── GPG-encrypt naar /tmp ──
if ! gpg --batch --yes --trust-model always -r "$GPG_RECIPIENT" -o "$ENCRYPTED" -e "$LATEST"; then
  echo "[OFFSITE] $TS FAIL: GPG-encrypt $LATEST faalde" >> "$LOG"
  exit 6
fi

ENC_SIZE=$(du -h "$ENCRYPTED" | cut -f1)

# ── Push naar remote ──
if ! rclone copy "$ENCRYPTED" "${REMOTE_NAME}:${REMOTE_PATH}/${DATE}/" --transfers 1 --checksum 2>>"$LOG"; then
  echo "[OFFSITE] $TS FAIL: rclone copy faalde" >> "$LOG"
  rm -f "$ENCRYPTED"
  exit 7
fi

# ── Cleanup local tmp ──
rm -f "$ENCRYPTED"

# ── Retention: verwijder remote files ouder dan $RETAIN_DAYS ──
rclone delete "${REMOTE_NAME}:${REMOTE_PATH}/" --min-age "${RETAIN_DAYS}d" 2>>"$LOG" || true

# ── Tick-log @04:00 daily ──
if [ "$(date +%H)" = "04" ]; then
  REMOTE_COUNT=$(rclone size "${REMOTE_NAME}:${REMOTE_PATH}/" --json 2>/dev/null | grep -oE '"count":[0-9]+' | grep -oE '[0-9]+' || echo "?")
  echo "[OFFSITE] $TS OK: pushed $BASENAME ($ENC_SIZE encrypted), remote heeft $REMOTE_COUNT files" >> "$LOG"
fi
exit 0
