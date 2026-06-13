# T4C Stabiliteits-Protocol — 100% uptime + crash-prevention

> **Doel:** transfer4cars.com móet altijd online en werkend zijn. Dit document is de bindende set regels voor (a) wat ik (Claude) wel/niet mag, (b) welke technische vangnetten verplicht draaien, (c) hoe we fall-back doen, (d) hoe we elke wijziging documenteren zodat geen verlies optreedt bij crash/disconnect.
>
> **Cross-link:** `T4C-MAP-COMPLEET-2026-06-10.md` §9 (anti-break-regels), `CRASH-LOG.md`, `T4C-FIX-LOG-2026-06-10.md`, `AUDIT-TRANSFER4CARS-2026-06-10.md`.
>
> **Status:** v1.0 — 2026-06-10 22:30. Aanvullen na elke incident.

---

## A. Harde regels voor Claude (mij)

### A0. DATA-INTEGRITEIT IS HEILIG (overruling alles)
> **User-decreet 2026-06-10 22:35:** *"Alles van veilingen, klanten, transacties, betalingen etc. gegevens moeten altijd beschermd zijn — zonder dat zijn we fucked."*

Deze data MAG NOOIT verloren gaan, gecorrumpeerd raken, of zonder backup overschreven worden:

- **`users`** (incl. password-hashes, PII, role, audit-trail) — `/opt/t4c/data/t4c.db`
- **`veilingen`** + **`veiling_biedingen`** (bid-records, winnaar, prijs) — `/opt/t4c/data/t4c.db`
- **`facturen`** (transactie-records, BTW, betaal-status) — `/opt/t4c/data/t4c.db`
- **`contact_requests`** + **`leads`** (aanmeldingen, B2B-aanvragen) — `/opt/t4c/data/t4c.db`
- **`audit_log`** (financiële + AVG-trail, art. 15-20 compliance) — `/opt/t4c/data/t4c.db`
- **`taxaties`** + **`dealer_feedback`** + **`inbound_taxaties`** (rapport-data, klant-input) — `/opt/t4c/data/t4c.db` + `/opt/atx-pipeline/data/atx.db`
- **Foto-uploads** — `/opt/t4c/data/photos/` + `/opt/atx-pipeline/data/photos/`
- **`.env` secrets** (JWT_SECRET — recoverable, maar verlies = alle JWT's invalid → klant-sessions weg)

**Verplichte hand-rules voor deze data:**

1. **Backup VÓÓR elke wijziging die deze tabellen aanraakt** (ALTER, UPDATE/INSERT massaal, schema-rename, DELETE). Backup-naam = `/opt/t4c/backups/pre-<reden>-YYYYMMDD-HHMM.db` (volledige DB-copy). Test integrity met `PRAGMA integrity_check;` of equivalent.
2. **Geen DELETE/DROP zonder regel-voor-regel-akkoord** van user — ook niet "even oude rows opruimen". Cleanup-jobs gaan via aparte script + dry-run-eerst.
3. **Geen UPDATE op > 1 row in `users`/`veilingen`/`facturen`/`veiling_biedingen` zonder backup + WHERE-clause-review** met user.
4. **Geen `forceSave()` op stale state** — als sql.js-snapshot in memory mogelijk verouderd is (na crash, na restart, na lange idle), eerst `initDB()` opnieuw lezen.
5. **Geen overschrijven van `/opt/t4c/data/t4c.db`** met een backup zonder pm2 stop t4c-server + lock-file verwijderen + verify backup integrity.
6. **Geen schema-change in productie zonder rollback-plan** — minimaal: backup vóór, kunnen herstellen binnen 5 min.
7. **Geen wijziging aan `db.js` save-strategie** (`scheduleSave`/`forceSave`/per-PID-tmp/jitter) zonder uitgebreide unit-test in `/tmp/`.
8. **Bij elke crash:** verifieer DB-integrity vóór hervatten (`SELECT COUNT(*) FROM users/veilingen/facturen`).
9. **AVG-data** (PII, soft-delete via `account_deleted` audit-entry): wijzigen alleen via bestaande `/api/profiel/verwijderen`-flow, niet direct DB. Audit-log MAG NOOIT gewist worden (regulatory record).
10. **Foto-uploads** (`/opt/t4c/data/photos/`): geen mass-delete; verwijderen alleen via `/api/admin/veiling/:id/photos/:filename` met admin-token.

**Als ik twijfel of een actie deze data raakt → ASK first. Geen "ik denk wel veilig". Het verschil tussen €0 en €100k+ verlies aan klant-bid-data zit hier.**

### A1. Vóór elke wijziging
> **HARDE REGEL — user-decreet 2026-06-10 22:42:** *"Altijd een back-up maken bij dit soort dingen voor je de server.js aanraakt. (ALTIJD HARDE REGEL)"*
> Geldt voor `server.js`, `db.js`, `lib/auth.js`, `lib/audit.js`, `lib/mailer.js`, alle `routes/*.js`, `ecosystem.config.js`, `package.json`, `package-lock.json`, en elke `.html` onder `/opt/t4c/sites/`. **GEEN UITZONDERING.** Voor elke Edit/Write zeg ik vooraf: "backup in: `<pad>`" — anders niet bewerken.

1. **Backup eerst — verplicht voor server.js + critical backend + frontend** (zie boven). Doe het direct vóór de Edit, niet "ergens vandaag al". Geef het backup-pad in chat.
2. **Lees het bestand eerst** (Read tool) — Edit faalt zonder Read. (Zie incident 22:15 vandaag: 2× Edit op server.js faalde voordat ik Read had gedaan.)
3. **Diff/intent uitleggen** voordat ik een irreversible actie doe. User OK = expliciet, niet "ik denk dat dat wel mag".
4. **Eén logische wijziging per keer** — dan verifiëren. Geen 5 dingen in 1 batch zonder test ertussen.

### A2. Tijdens wijziging
5. **Géén `kill -9`** op t4c-server, atx-admin, cardatax-server. Graceful SIGTERM (10s window via `kill_timeout`).
6. **Géén `pm2 delete`** zonder regel-voor-regel-akkoord van user.
7. **Géén `rm`** in `/opt/t4c/data/`, `/opt/t4c/backups/`, `/opt/atx-pipeline/data/`.
8. **Géén schema-change** (ALTER TABLE, DROP, etc.) zonder eerst: (a) pm2 stop t4c-server, (b) DB-backup, (c) ALTER, (d) DB-integriteits-check, (e) pm2 start.
9. **Géén `git push --force`** of `git reset --hard` zonder expliciet user-akkoord.

### A3. Na wijziging
10. **Syntax-check** voor JS-files: `node -c <file>` of `node --check <file>`.
10b. **HTML inline-JS parse-test** voor HTML-edits: extract `<script>` (zonder `type="application/ld+json"`-skip) en `new Function(code)`. **Verplicht sinds 2026-06-11 — `/account/`-bug toonde dat HTML inline-JS niet door `node -c` worden geraakt, syntax-error gaat door tot browser-load.**
10c. **Script-load-order check** voor externe JS in HTML: parse-test laat geen runtime-fouten zien. Als inline-script externe globals (`t4cUserNav`, `t4cToast`) gebruikt, controleer dat `<script src="..."></script>` zonder `defer` is OF dat inline-call binnen DOMContentLoaded zit. **Verplicht sinds 2026-06-11 — NAV-UNIFY-bug: defer-attribute liet inline-script crashen omdat deferred src nog niet geladen was tijdens parsing.**
11. **PM2 graceful restart** + verifieer `restart_time` is geen +1 op crash-loop (status `online`, niet `errored`).
12. **Smoke-test**: `curl -sI http://localhost:3000/api/health` → 200 + JSON. + minimaal 3 publieke routes 200.
13. **Browser-test** indien UI-wijziging (cleared localStorage per `feedback_cleanup_test_authflow`). **Verplicht na elke edit aan `/account/`, `/admin/*`, `/veilingen/*`-pages — niet alleen "indien".**
13b. **Template-string escapes vermijden voor strings die HTML-attrs met aanhalingstekens bevatten.** Gebruik in plaats van `'<span style="font-family:\\\'X\\\',y">'`: een CSS-class of CSS-variabele (`var(--mono)`). Bewezen vatbaar voor escape-error 2026-06-11.
14. **Fix-log entry** in `T4C-FIX-LOG-2026-06-10.md` of nieuwere fix-log met: FIXCODE, bron, files, backups, verify-commando, PM2-actie.

### A4. Bij twijfel
15. **ASK over GOK** — vragen kost 10 seconden, een verkeerde rollback kost uren.
16. **Bij memory-conflict met current state**: trust observation, update memory.
17. **Geen "even snel" wijzigingen** in `server.js`, `db.js`, `lib/auth.js`, `routes/veilingen.js` — dat zijn de hot-paths. Plan eerst.

### A5. Wat is "irreversible" (= altijd vragen)?
- DB-write die niet via `forceSave()`/`scheduleSave()` loopt
- File-delete buiten /tmp
- Cloudflare DNS/redirect-wijziging
- pm2 startup-config (`pm2 save`) overschrijven
- `.env` keys veranderen (anders dan toevoegen)
- crontab-wijziging
- npm uninstall van een productie-dependency
- Schema-change (ALTER/DROP/RENAME)

---

## B. Verplichte technische vangnetten

### B1. Al actief (NIET aanraken zonder reden)
| Vangnet | Waar | Doel |
|---|---|---|
| Single-instance lock | `server.js:48-72` + `/opt/t4c/data/.t4c-server.lock` | Voorkomt 2 t4c-server's tegelijk → DB-race |
| SIGTERM-handler | `server.js` (`forceSave() + releaseLock() + exit(0)`) | Graceful save bij `pm2 restart` |
| sql.js per-PID tmp-file | `db.js` `t4c.db.<PID>.tmp` + jitter 5-7s | Voorkomt overlappende writes |
| PM2 ecosystem | `kill_timeout: 10000`, `min_uptime: 10s`, `max_restarts: 8`, `restart_delay: 3000` | Restart-storm preventie |
| pm2-logrotate | module id 0 | Disk-loop preventie |
| Watchdog v2 | `/opt/t4c/watchdog.sh` + cron `* * * * *` | Flock-gate + 3-strikes + 5min cooldown → auto-recovery |
| Backup-cron | crontab `0 3 * * *` → `/opt/t4c/backups/db_YYYYMMDD_HHMM.db` | Daily DB-snapshot, 30d retain |
| Disk-alert-cron | crontab `0 8 * * *` → >80% mailt | Disk-vol preventie |
| Trust-proxy loopback | `server.js:19` | Cloudflared-IPs correct voor rate-limit |
| Login rate-limit | `server.js:131` (5/15min per IP) | Brute-force preventie |
| Audit-log | `lib/audit.js` + `audit_log` tabel | Forensische trail |

### B2. **Toe te voegen** (ontbrekend → BLOCKER vóór dealer-launch)
- [ ] `max_memory_restart` op t4c-server (1500MB) en atx-admin (256MB) in `ecosystem.config.js` — voorkomt geheugen-lek-zombies
- [ ] Off-site backup (rclone naar B2/S3, GPG-encrypted) — daily 4:00
- [ ] Post-restart smoke-test script `/opt/t4c/scripts/smoke-test.sh` — run automatisch na watchdog-recovery
- [ ] Health-check timeout in watchdog (kill > 30s health-check)
- [ ] DB-snapshot-cron voor t4c.db (analoog aan cardatax-snapshot-dev.sh)
- [ ] Alert-channel bij watchdog recovery FAIL (Telegram-webhook of mail-direct) — geen alleen-log
- [ ] Cloudflare Health-Check op `https://transfer4cars.com/api/health` (≤30s interval, alert bij 3 fails)
- [ ] Atx-admin restart-loop diagnose (95 restarts vandaag) — heapdump aanzetten, leak vinden

### B3. Verbeteringen aan bestaande vangnetten
- [ ] Watchdog logt nu alleen bij fail — onduidelijk of hij draait. Voeg "tick"-log toe (1× per uur) zodat zichtbaar is dat hij leeft.
- [ ] Lock-file moet ouderdom checken: stale lock > 60s = remove.
- [ ] PM2 systemd unit: `Restart=on-failure` + `RestartSec=10` (default OK, verifiëren).

---

## C. Fall-back & herstel

### C1. Wanneer val ik terug op wat?
| Scenario | Symptoom | Fall-back |
|---|---|---|
| t4c-server crash | curl `:3000/api/health` faalt | Watchdog herstart (≤3 min). Bij FAILED: pm2 reload manueel. |
| sql.js DB-corrupt | `[DB] INTEGRITY CHECK FAILED` | Restore uit `/opt/t4c/backups/db_LATEST.db` (max 24u verlies) |
| Disk vol | df > 95% | Cron alert + opruim ARCHIVE-dirs (≥1GB beschikbaar) |
| Cloudflared tunnel down | `transfer4cars.com` timeout | Cloudflare-edge ziet het, mail naar deniz@. Backup: SSH via Tailscale-tunnel (WIP — niet operationeel). |
| Atx-admin OOM | 95 restarts/dag | Memory-cap (B2 item) + restart-loop-detector → mail-alert |
| Server full down | SSH werkt niet | Cloudflare-tunnel laat staan → niet bereikbaar. Plan B: hetzelfde via Tailscale (WIP) |
| Cloudflare-account compromise | DNS gehijacked | Backup-DNS-zone-export bewaren in `/opt/t4c/secrets/cf-zone-export-YYYYMMDD.txt` (NU NOG NIET, voeg toe) |

### C2. Recovery Time Objective (RTO) + Recovery Point Objective (RPO)
- **RTO** (hoe snel weer up): **<5 min** voor app-crash (watchdog), **<30 min** voor server-reboot (pm2 startup), **<2 uur** voor full restore (DB uit backup).
- **RPO** (max dataverlies): **<60 min** voor DB-data (sql.js scheduleSave 5-7s + watchdog), **<24u** voor file-upload (foto's) — geen off-site nu = single-point-of-failure.

### C3. Herstel-procedures (test-scripts)
- [ ] **`/opt/t4c/scripts/restore-db.sh`** — interactief: kies backup-file → stop pm2 → swap DB → integrity → start pm2 → verify
- [ ] **`/opt/t4c/scripts/full-rollback.sh`** — wijst pm2 naar backup-branch, voor noodgevallen
- [ ] **Maandelijkse restore-drill** — 1× per maand backup terugzetten in `/tmp/t4c-drill/`, integrity OK, dan weg

Geen van bovenstaande bestaat nog. Maak ze vóór dealer-launch.

---

## D. Documentatie-flow (crash-bestendigheid)

### D1. Bij elke crash/disconnect
1. **CRASH-LOG.md** entry (template bovenaan dat bestand) — wat, wanneer, stand-vóór, verloren werk, actie genomen.
2. Lees `AUDIT-TRANSFER4CARS-2026-06-10.md` + `PICKUP-*-2026-06-10.md` + `STABILITEIT-PROTOCOL.md` bij hervatten.
3. Open tasks via Claude task-list (subjects beginnend met "Existing audit docs…", "Code/feature audit…", etc.).

### D2. Bij elke fix
1. **T4C-FIX-LOG entry** — FIXCODE, bron, files met regel-nrs, backup-naam, verify-curl, PM2-actie.
2. Backup-conventie: `<file>.bak-<FIXCODE>-YYYYMMDD` naast origineel **OF** `/opt/t4c/backups/pre-<FIXCODE>-YYYYMMDD-HHMM/`.

### D3. Bij elke major change
1. **ROADMAP entry** in `T4C-ROADMAP-2026-06-09.md` (of opvolger).
2. **AUDIT-doc update** (sectie "Wijzigingen aan deze doc" onderaan).

### D4. Bij elke architecturale keuze
1. **Apart design-doc** in `/opt/t4c/docs/` met datum in filenaam (zoals `AUCTION-V2-DESIGN-2026-06-09.md`).
2. Cross-link in `T4C-INFOARCHITECTUUR-2026-06-10.md` of opvolger.

---

## E. Deploy-flow (verplicht volgen)

1. **Plan** — wat verandert, welke files, wat kan breken.
2. **Backup** — `cp` of `tar -czf /opt/t4c/backups/pre-<FIX>-YYYYMMDD-HHMM/`.
3. **Edit** — één logische unit per Edit.
4. **Syntax-check** — `node -c` voor JS; HTML-validatie via curl + grep marker.
5. **PM2 graceful restart** — `pm2 reload t4c-server` (niet `restart` — `reload` is zero-downtime in cluster, voor fork = zelfde als restart maar netjes).
6. **Wait** — 12-15s voor sql.js graceful save.
7. **Smoke-test** — `curl /api/health` + 3 publieke routes 200.
8. **Browser-test** — als UI-change: cleared localStorage, primary auth-flow, 1 page minimum.
9. **Fix-log entry** — direct na succes.
10. **Bij fout** — kop in CRASH-LOG, restore uit backup, geen tweede poging zonder root-cause-analysis.

---

## F. Wat NU absoluut niet mag gebeuren

(Een lijst van anti-patterns die bewezen schade hebben gedaan of risico zijn.)

- ❌ **Geen `kill -9` op t4c-server** — zombie-fabriek per 2026-06-09 incident
- ❌ **Geen tmux-auto-attach** (memory `feedback_no_auto_tmux_in_bashrc`)
- ❌ **Geen cleanup-deploy zonder cleared-localStorage-test** (memory `feedback_cleanup_test_authflow`)
- ❌ **Geen biedingen naar Autotelex** (memory `feedback_no_autotelex_bidding`)
- ❌ **Geen km-misleiding/schade-verzwijging tooling** (memory `feedback_cardatax_integrity_guardrail`)
- ❌ **Geen dev.cardatax wijzigingen** vanuit T4C-sessie (memory `feedback_cardatax_dev_not_live`)
- ❌ **Geen 3e design-iteratie zonder mode-wissel** (memory `feedback_design_iteration_ceiling`)
- ❌ **Geen reset/drop op `/opt/t4c/data/t4c.db`** zonder backup-bevestiging
- ❌ **Geen overschrijven van `lib/auth.js` JWT-secret-logic** — getest, werkt, blijf van af
- ❌ **Geen overschrijven van `/opt/t4c/secrets/ga4-sa.json`** — Google service-account-key

---

## G. Wat er nog ontbreekt (zelf-aanvullen)

Dit doc is v1.0. Aanvullen na elke crash. Pull-requests / Edit's mogen.

| Categorie | Wat nog niet gedekt |
|---|---|
| Monitoring | Geen external uptime-check (UptimeRobot of CF Health-Check) — alleen lokale watchdog |
| Alerting | Watchdog alleen logt — geen push naar Telegram/mail bij FAILED |
| Off-site backup | Lokaal-only — RPO niet gegarandeerd bij server-loss |
| Staging | Geen `dev.transfer4cars.com` of staging-branch — alles direct prod |
| CI/CD | Geen automated tests, geen deploy-pipeline — alles handmatig via SSH |
| Cron-monitoring | Geen check of crontab-jobs daadwerkelijk runnen |

---

## H. Crash-pickup voor deze doc zelf

Als deze sessie crasht of context kwijt is:
1. Lees deze doc eerst.
2. Pas regels in §A toe op alles wat volgt.
3. Check §B1 vangnetten zijn nog actief (`pm2 list`, `crontab -l`, `cat /opt/t4c/data/.t4c-server.lock`).
4. Pak openstaande items uit §B2 + §C3 op in volgorde van AUDIT-doc BLOCKERS.

---

**Einde v1.0.** Aanvullen mag, maar **§A regels mogen alleen wijzigen op expliciet user-akkoord**.
