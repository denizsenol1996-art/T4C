# T4C Scripts — overzicht

> **Doel:** elke script in deze dir gedocumenteerd zodat een crash-pickup direct weet wat draait en hoe te herstellen.
>
> **Cross-link:** `/opt/t4c/docs/STABILITEIT-PROTOCOL.md` §C (fall-back), §E (deploy-flow). En `/opt/t4c/watchdog.sh` (in parent dir, niet hier).

---

## smoke-test.sh

**Wat:** verifieert na (re)start of t4c-server gezond is.

**Checks:**
1. `GET /api/health` → status=ok
2. 11 publieke routes (`/`, `/veilingen/`, `/aanbod/`, `/login/`, `/aanmelden/`, `/transport/`, `/verkoop/`, `/privacy/`, `/account/`, `/sitemap.xml`, `/robots.txt`) → 200
3. PM2 error-log scan: errors sinds proc-start
4. DB-integriteit: telling op `users / veilingen / audit_log` (kritieke tabellen)

**Exit codes:**
- `0` — alles OK
- `1` — health endpoint faalde
- `2` — ≥1 route non-200
- `3` — errors in pm2-log sinds boot
- `4` — DB-query faalde

**Wie roept aan:**
- `/opt/t4c/watchdog.sh` na succesvolle recovery (faal → alert)
- Jij/ik handmatig na pm2 reload

**Log:** `/opt/t4c/logs/smoke-test.log` (alleen bij anomaly + daily tick @05:00)

**Gebruik:**
```bash
/opt/t4c/scripts/smoke-test.sh; echo "exit: $?"
```

---

## restore-db.sh

**Wat:** veilig interactief herstel van `t4c.db` uit een eerdere backup of snapshot.

**Flow (6 stappen):**
1. Lijst backups in `/opt/t4c/backups/**.db` + `/opt/t4c/backups/snapshots/**.db`
2. User kiest nummer + bevestigt met "JA"
3. Pre-restore backup van huidige DB → `/opt/t4c/backups/pre-restore-<datum>.db`
4. PM2 stop t4c-server (graceful, 10s window) + lock-cleanup
5. Integrity-check (`PRAGMA integrity_check`) op gekozen file
6. Swap DB + PM2 start + verify health + telling kritieke tabellen

**Rollback** (als post-restore iets stuk is): script print het rollback-commando — `cp <pre-restore-backup> /opt/t4c/data/t4c.db && pm2 restart t4c-server`.

**Exit codes:** 0=OK, 1=geen file, 2=integrity-fail, 3=post-restore health-fail.

**Gebruik (interactief):**
```bash
/opt/t4c/scripts/restore-db.sh
```

**Gebruik (non-interactief met expliciet pad):**
```bash
/opt/t4c/scripts/restore-db.sh /opt/t4c/backups/snapshots/db-20260610-22.db
```

---

## db-snapshot.sh

**Wat:** hourly snapshot van `t4c.db` naar `/opt/t4c/backups/snapshots/` met 24u rolling retention.

**Werking:**
- Filename: `db-YYYYMMDD-HH.db`
- Idempotent: skip als file dit-uur al bestaat
- Skip als DB ongewijzigd sinds laatste snapshot (mtime-check)
- Quick_check vóór copy — fail = skip + log
- Retention: oudste eruit zodra er > 24 zijn

**Wie roept aan:** cron `15 * * * *`

**RPO impact:** max 60min data-verlies bij server-loss (vs 24u via daily backup-cron).

**Log:** `/opt/t4c/logs/db-snapshot.log` (alleen daily tick @00:15 + bij integrity-fail).

---

## offsite-backup.sh (template — user-setup nodig)

**Wat:** dagelijkse GPG-encrypted push van de meest recente lokale DB-backup naar externe storage via rclone.

**Eenmalige setup (user, ~15 min):**
```bash
# 1. tools
sudo apt install rclone gpg

# 2. rclone remote (B2 / S3 / iDrive / Storj / etc.)
rclone config
#   → New remote
#   → Name: t4c-offsite
#   → Type: kies (b2 / s3 / sftp / ...)
#   → Vul credentials in
#   → test: rclone lsd t4c-offsite:

# 3. GPG-key voor encryption
gpg --gen-key
#   → Real name: Deniz
#   → Email: deniz@transfer4cars.com
#   → Passphrase: kies sterke

# 4. Test
/opt/t4c/scripts/offsite-backup.sh --test
#   verwacht: "TEST OK — remote bereikbaar, GPG-key OK"

# 5. Cron toevoegen
crontab -e
#   voeg toe: 30 3 * * * /opt/t4c/scripts/offsite-backup.sh
#   (na lokale backup-cron 3:00)
```

**Werking:** pakt nieuwste `db_*.db` uit `/opt/t4c/backups/`, GPG-encrypts, rclone copy naar `remote:t4c-backups/<datum>/`, 90 dagen retention op remote (auto-purge).

**Exit codes:** 0=OK 1=tool missing 2=remote not configured 3=GPG-key missing 4=test-fail 5=geen lokale backup 6=encrypt-fail 7=rclone-fail.

**Log:** `/opt/t4c/logs/offsite-backup.log`.

---

## t4c-backup.sh (legacy — niet gebruikt door cron)

Oudere backup-versie, vóór de huidige `/opt/t4c/backup.sh` (in parent). Geen actie nodig — niet aanraken tot besloten is of dit weg mag. Cron-job draait `/opt/t4c/backup.sh`, niet deze.

---

## normalize-listings.js & shadow-backfill-2026-05-22.js

Eenmalige data-migratiescripts uit eerdere sprints. Niet meer gebruiken — historisch.

---

## Recovery-procedures (cross-link STABILITEIT-PROTOCOL §C)

### Scenario A: t4c-server crash (health-endpoint geeft niets)
1. Watchdog probeert auto-recovery (max 3 fails + 5min cooldown). Logs in `/opt/t4c/data/watchdog.log` + `/opt/t4c/logs/watchdog-alert.log`.
2. Handmatig: `pm2 restart t4c-server` → wacht 15s → `/opt/t4c/scripts/smoke-test.sh`
3. Als smoke-test exit ≥1: check `/home/deniz/.pm2/logs/t4c-server-error.log` voor laatste error

### Scenario B: DB corrupt / "INTEGRITY CHECK FAILED"
1. `/opt/t4c/scripts/restore-db.sh` → kies meest recente snapshot of backup
2. Per default neemt het snapshot van het vorige uur — RPO ≤60min
3. Als snapshot ook corrupt: ga 1 uur terug in lijst (`/opt/t4c/backups/snapshots/`)
4. Als ALLE snapshots corrupt: pak `pre-restore-*.db` of daily backup uit `/opt/t4c/backups/db_*.db`

### Scenario C: PM2 startup-loop / "RESTART na 8 fails" in pm2
1. `pm2 logs t4c-server --lines 100` voor root-cause
2. `pm2 stop t4c-server` (stop loop)
3. Check `/opt/t4c/data/.t4c-server.lock` op stale lock — `cat` toont PID, `ps -p <PID>` verifieert
4. Fix root-cause, `pm2 start ecosystem.config.js`, `/opt/t4c/scripts/smoke-test.sh`

### Scenario D: Server reboot
1. PM2 systemd-unit (`pm2-deniz.service`) doet `pm2 resurrect` → laatste `pm2 save` state
2. Wacht 30-60s
3. `/opt/t4c/scripts/smoke-test.sh` om te verifiëren

---

## Wat NIET in deze dir zit (relevante andere paden)

- `/opt/t4c/watchdog.sh` — health-check elke minuut + auto-recovery (parent dir)
- `/opt/t4c/backup.sh` — daily backup-cron (parent dir)
- `/opt/t4c/backups/` — alle backups + snapshots
- `/opt/t4c/docs/STABILITEIT-PROTOCOL.md` — bindende regels
- `/opt/t4c/docs/CRASH-LOG.md` — bij elke disconnect entry
- `/opt/t4c/ecosystem.config.js` — PM2 config (kill_timeout, max_memory_restart, max_restarts)

---

**Onderhoud:** bij toevoeging van nieuw script — voeg sectie hier toe + cross-link in STABILITEIT-PROTOCOL.
