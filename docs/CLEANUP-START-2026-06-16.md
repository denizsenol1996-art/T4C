# T4C Schoonmaak — Fase 1 voltooid 2026-06-16 22:45

## Aanleiding
User-decreet 2026-06-16: voordat Jurgen's nieuwe pricing-regels worden geïmplementeerd, moet de basis "helemaal schoon" — niet meer breekbaar. 3 forensische audits uitgevoerd (code-archeologie, pricing-data-flow per endpoint, infra-stability) → bevindingen samengevat in commit 0f3b516.

## Acute fixes (Fase 1, vandaag)

### ✅ 1. backup-cron daily-backup HERSTELD
**Probleem**: `backup.sh` glob `cp /opt/t4c/data/*.db $BACKUP_DIR/db_$DATE.db` expandeerde 8 .db-bronnen naar 1 niet-directory-target → cp faalde, stderr unterdrückt door `2>/dev/null`, echo "✅ Backup compleet" draaide door. **53 valse positives in `/opt/t4c/logs/backup.log` sinds 30-04**. 0 `db_*.db` files in `/opt/t4c/backups/`.

**Fix** (commit 0f3b516, `backup.sh:6-30`):
- Expliciet `cp "$DB_SRC"` met enkele bron (`/opt/t4c/data/t4c.db`)
- Integrity-check: `[ -f "$DB_DST" ] && [ -s "$DB_DST" ]` → exit 1 bij fail (cron picks up)
- 30d-retention split: `find -name "db_*.db" -mtime +30 -delete` en `find -name "env_*"`

**Verificatie**: handmatige run produceerde `db_20260616_2243.db` (193.585.152 bytes) + `env_20260616_2243`. Volgende cron-run 17-06 03:00 zal nu een echt .db-file landen.

### ✅ 2. .gitignore prefix-fix
**Probleem**: regels 48-49 (`wal-poc/wal-*`, `wal-poc/*.md`) matchten alleen vanaf repo-root, niet vanuit `backend/wal-poc/`. Bewijs: `git check-ignore -v backend/wal-poc/wal-ab-test.js` gaf geen match → 3 wal-poc files bleven untracked-zichtbaar.

**Fix**: regels 50-54 toegevoegd:
```
backend/wal-poc/wal-*
backend/wal-poc/*.md
backend/db.js.WORKING-*
backend/db.sqljs.bak.js
```

**Verificatie**: `git check-ignore -v` toont nu correct match op alle drie de paden.

### ✅ 3. Drie phantom files weg
- `/opt/t4c/=` (0 bytes, 11 mei — accidental `> =` redirect)
- `/opt/t4c/manifest_new.json` (0 bytes sinds 3 maart)
- `/opt/t4c/backend/db.js.WORKING-sqljs-20260616` (66 KB, byte-identiek aan `db.sqljs.bak.js`)

### ✅ 4. Twee uncommitted source-files committed
- `backend/routes/valuation.js` (regels 884-886, gpt-5.5 reasoning/temperature switch)
- `backend/lib/quick-price-expert.js` (regels 122-126, idem)

Apart commit ac97e8c — geen pricing-logic-wijziging, alleen env-flag conditional.

## Backups
- `/opt/t4c/backup.sh.bak-pre-cleanup-20260616`
- `/opt/t4c/.gitignore.bak-pre-cleanup-20260616`

## Verificatie achteraf
- `git status -s`: leeg (clean working tree)
- `pm2 list`: t4c-server online, geen restart veroorzaakt door deze edits
- `curl localhost:3000/api/health`: 200 OK
- `/opt/t4c/backups/db_20260616_2243.db`: 193.585.152 bytes (correcte DB-snapshot)

## Wat NIET in Fase 1 zat
- Disk-cleanup van `/opt/t4c/backups/` (6 GB env-snapshots) — Fase 2
- Verwijderen 20 `.bak-*` files in `backend/` — Fase 2
- Verwijderen 849 MB `.bak` DB-files in `/opt/t4c/data/` — Fase 2
- B1 (`finalBod = finalHandel` in valuation.js:1014) — Fase 3 (op bench eerst)
- `kmCorrection` dead-read fix — Fase 3
- Channel-engine wel/niet-promoot beslissing — Fase 3
- Jurgen-regels (motor-blacklist, sloop-criteria, marge-floor) — Fase 4 op schone basis
- Off-site backup (rclone) — Fase 5
- External uptime check + watchdog push-alert — Fase 5

## Open vraag bij volgende sessie
- Atx-admin ecosystem heeft géén kill_timeout/min_uptime/max_restarts/restart_delay — bij syntax-error = 16× restart-loop binnen <0.5s. Fase 5-item, kan eventueel parallel.
- `forceSave()` doet `PRAGMA integrity_check` per SIGTERM op 192MB DB — multi-seconden extra latency per restart. Mogelijk overshot na WAL-cutover.
- cloudflared tunnel error-spam voor localhost:9090 (TLS-mismatch sinds 5d) — geen impact op transfer4cars.com, wel logvervuiling.

## Commits
- `0f3b516` Schoonmaak Fase 1: backup-cron herstel + phantom files weg
- `ac97e8c` gpt-5.5 env-flag conditional
- `9a45759` docs: Fase 1 rapport
- `35c885f` Schoonmaak Fase 2: 4.5 GB rotzooi naar staging-folder

---

# Fase 2 voltooid 2026-06-16 22:55

## Staging-folder (NIET verwijderd — wacht op user-review)
`/opt/t4c/_pending-delete-fase2-20260616/` — 4.5 GB totaal in 7 sub-mappen:

| sub-map | grootte | inhoud |
|---|---|---|
| `data-baks/` | 849 MB | 9 oude `.bak/backup-pre-*.db` (niet in autoRestore-pad) |
| `data-old-backups/` | 1.6 GB | sqljs-tijdperk + corrupted/ |
| `backups-cleanup-old/` | 1.7 GB | cleanup-/pre-/archived-/atx- snapshots |
| `backups-env-old/` | 104 KB | 25 oude env_* (behouden: laatste 7) |
| `full-state/` | 386 MB | FULL-STATE-BACKUPS van 17 mei |
| `backend-baks/` | 1.4 MB | 22 backend/*.bak-* + PATCH-READY + STAGED-* |
| `root-deadcode/` | 3.0 MB | check.js, creative-sources.js, diag-corpus.js, deploy-trade-engine{,_v3}.py, SESSION-STATE.md.bak, backend-test/, backup_20260309*/ |

## Behouden (niet aangeraakt)
- `/opt/t4c/data/t4c.db` (live, 184 MB)
- `/opt/t4c/data/SAFE-*.db` (4 stuks — autoRestore-kandidaat)
- `/opt/t4c/data/groundtruth/` (Jurgen-deal-set)
- `/opt/t4c/data/photos/` (foto-uploads)
- `/opt/t4c/data/state-snapshots/`
- `/opt/t4c/data/manifest.json`
- `/opt/t4c/backups/env_2026061{1..6}_0300/` + `/opt/t4c/backups/env_20260616_2243/` (laatste 7)
- `/opt/t4c/backups/db_20260616_2243.db` (nieuw — eerste echte daily-backup na cron-fix)
- `/opt/t4c/backups/pricing-baseline-v0/` + `/opt/t4c/backups/2026-06-09-zombie-fix/` (ge-tagged momenten)

## Productie-status na Fase 2
- t4c-server: 200 OK, geen restart veroorzaakt
- Disk: 1.7 TB vrij van 1.8 TB (3% in gebruik, was ook 3% — winst zichtbaar pas na echte rm)
- Git working tree: schoon, 4 commits sinds Fase 1-start

## Wat de USER nu moet beslissen
~~Echte rm op staging-folder~~ — **UITGEVOERD 2026-06-16 22:57** door user-akkoord. 4,5 GB vrijgemaakt. Disk gebruikt: 38 GB → 34 GB (Use% 3% → 2%). Productie: 200 OK, geen restart.

---

# Fase 5a — Veilige infra-wins 2026-06-16 23:00

## ✅ atx-admin restart-bescherming
`/opt/atx-pipeline/ecosystem.config.js` had GEEN restart-bescherming. Defaults PM2 (1.6s/1s/16/0ms) → syntax-error = 16× restart-loop in <0.5s. Toegevoegd:
```js
kill_timeout: 5000,
min_uptime: '10s',
max_restarts: 8,
restart_delay: 3000,
```
Restart uitgevoerd via `pm2 startOrReload`. Atx-admin draait 200 OK, 4 pollers actief (mail/scraper/taxatie/markt).

Backup: `/opt/atx-pipeline/ecosystem.config.js.bak-pre-restartprot-20260616`.
**Niet in git** (atx-pipeline is geen git-repo).

## ✅ db.js forceSave skip PRAGMA integrity_check (post-WAL)
`forceSave()` draaide elke 30s + bij elke SIGTERM/SIGINT/exit een integrity-check op 192 MB DB. Multi-seconden CPU per call. Pre-WAL nodig (sql.js export gate), post-WAL (commit d5c6dcb 16-06 10:54) overbodig — WAL+synchronous=NORMAL maakt writes al duurzaam.

Gewijzigd in commit `c502678`:
- `forceSave()`: nu alleen `wal_checkpoint(TRUNCATE)` — snel.
- Nieuwe `integrityCheck()`: expliciete functie voor admin-endpoint of cron (db-snapshot.sh doet al `PRAGMA quick_check`).

Verificatie na reload: memory 656 MB → 290 MB (lockfile fris), pricing-smoke OK (Mazda 2 €1050 bod, src=ai).

Backup: `backend/db.js.bak-pre-forcesave-fix-20260616`.

## 📋 cloudflared TLS-mismatch (alleen documentatie, fix vereist Cloudflare-dashboard)
Sinds 5 dagen continue error in `journalctl -u cloudflared`:
```
tls: failed to verify certificate: x509: certificate signed by unknown authority
originService=https://localhost:9090
```
Geen impact op `transfer4cars.com` (andere ingress-rule). Wel logvervuiling die echte fouten verbergt.

**Wat USER moet doen** (kan ik niet, vereist CF-dashboard-toegang):
- Open Zero Trust → Networks → Tunnels → t4c-tunnel → Public Hostnames
- Zoek ingress-rule met `https://localhost:9090` als origin
- Verander naar `http://localhost:9090` (cardatax-server serveert plain HTTP)
- Of: verwijder die ingress-rule als hij niet gebruikt wordt
- Test: `journalctl -u cloudflared | grep -i 9090` zou stoppen

## Commits sessie totaal
- `0f3b516` Fase 1: backup-cron herstel + phantoms
- `ac97e8c` gpt-5.5 env-flag conditional
- `9a45759` Fase 1 doc
- `35c885f` Fase 2: 4,5 GB naar staging
- `8f6b01f` Fase 2 doc
- `993fcd8` Fase 2 rm uitgevoerd
- `c502678` Fase 5a: db.js forceSave skip integrity_check

(+ atx-ecosystem niet in git, alleen lokaal backup).

## Wat NOG open staat
- **Off-site backup (rclone)** — vereist Backblaze B2 / S3 / GDrive credentials van USER
- **Watchdog push-alert** (mail-direct) — bij FAILED nu alleen lokaal log
- **OpenAI timeouts uniformeren** — 8s/30s/45s nu inconsistent
- **valuation.js opsplitsen** (1637 regels → 4-5 modulen) — groter werk, op bench
- **Fase 3 pricing dead-code**: B1 + kmCorrection + channel-engine — wachten op Jurgen's vervolg
- **Fase 4 Jurgen-regels** — wachten op zijn volledige verhaal
- **Fase 6 doc-consolidatie** — klein werk, kan tussendoor

