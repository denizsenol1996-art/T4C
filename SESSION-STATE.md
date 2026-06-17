# SESSION STATE — laatst bijgewerkt 2026-06-17 01:05 door Claude

## Waar we zijn
T4C-stack in **stabielere staat** dan ooit deze maand. Cleanup-traject Fase 1+2+5a voltooid op 16-06 (avond). Jurgen's volledige pricing-DNA gevangen in ronde 2 op 17-06. Klaar voor RSPP-fase (Rock-Solid Pricing Pipeline) — proces dat elke pricing-wijziging door 6 gates dwingt.

## Klaar (sessie 16-17 juni)
- **Backup-cron hersteld** na 47 dagen stilte (cp-glob bug fix in `backup.sh`)
- **4,5 GB disk-rotzooi** verwijderd via staging-folder → user-akkoord → rm
- **Phantom files weg**: `=`, `manifest_new.json`, `db.js.WORKING-sqljs-*`
- **`.gitignore` fix**: backend/wal-poc prefix-bug + db.js.WORKING + db.sqljs.bak.js
- **atx-admin restart-bescherming**: `kill_timeout/min_uptime/max_restarts/restart_delay` toegevoegd
- **db.js forceSave fix**: PRAGMA integrity_check skip op 30s-tick + SIGTERM (was multi-sec CPU per call; post-WAL niet nodig)
- **`integrityCheck()` apart**: voor expliciet admin-/cron-gebruik
- **Session-bootstrap**: nieuwe `CLAUDE.md` + `SESSION-START-PROTOCOL.md` + `/home/deniz/CLAUDE.md` + memory-trigger
- **Jurgen-DNA ronde 2**: complete framework in memory + `JURGEN-PRICING-DNA-2026-06-17.md`

## Commits sessie (10 totaal)
- `0f3b516` Fase 1 backup-cron + phantoms
- `ac97e8c` gpt-5.5 env-flag conditional
- `9a45759` Fase 1 doc
- `35c885f` Fase 2 staging 4,5 GB
- `8f6b01f` Fase 2 doc update
- `993fcd8` Fase 2 rm uitgevoerd
- `c502678` Fase 5a db.js forceSave skip
- `a08a9d5` Fase 5a doc (atx + db.js + cloudflared todo)
- `e1fe315` Jurgen pricing-DNA compleet (ronde 2)
- `0e15be7` Session-bootstrap (CLAUDE.md + protocol)

## Productie-status nu
- t4c-server: 200 OK, better-sqlite3 + WAL DB-engine (sinds 16-06 10:54 cutover `d5c6dcb`)
- atx-admin: 200 OK met nieuwe restart-bescherming
- Daily backup-cron: zal morgen 03:00 echt een `db_20260618_0300.db` produceren
- Disk: 34 GB gebruikt (2%), 1.7 TB vrij
- Bench: afgesloten, dir staat nog in `/home/deniz/t4c-bench/`

## Pricing-status (na alle benchmarks)
- **Mediaan bias vs Jurgen-bod**: +5% (gemeten op 660 cases met enrichment-payload — goed)
- **Blinde vlekken**: <€2k auto's (+38%), 16+j gedeeltelijk
- **B1 (`finalBod = finalHandel`)** nog actief — trade-engine `maxBid` weggegooid. Volgens RSPP-aanpak straks via gates herstellen.
- **bod-curve** van 16-06 actief, geleerd uit 661 dealer_feedback rijen
- **Multipliers**: alle 19 in `bod-adjustments.json` actief
- **Onthulling 16-06**: `sold_price` IS Jurgen-bod (niet `our_bod` zoals eerder gedacht — fix in analyse-script)

## Volgende stap — ALLES KLAARGEZET voor andere Claude (2026-06-17 01:00)

**RSPP-fundament + tooling staat klaar.** Andere Claude pakt op met deze takenlijst:

### Wat al klaar is (NIET opnieuw doen)
- ✅ `docs/ROCK-SOLID-PIPELINE-2026-06-17.md` — RSPP-doc met 6 gates (commit `085901e`)
- ✅ `backend/config/engine-blacklist.json` — 10 motor-categorieën uit DNA (klaargezet, NIET aangesloten)
- ✅ `backend/config/pricing-rules.json` — marge-floor/standtijd/km-thresholds/aftrek-scores (klaargezet)
- ✅ `backend/config/sloop-detection.json` — <€2k sloop-criteria (klaargezet)
- ✅ `/home/deniz/t4c-staging/` — skelet + ecosystem.config.js (poort 3009, NIET gestart)
- ✅ `scripts/staging-snapshot.sh` + `staging-sync.sh` (executable, niet in cron)
- ✅ `scripts/build-golden-cases.js` — gegenereerd
- ✅ `fixtures/golden-cases-100.json` — 100 gestratificeerde cases klaar
- ✅ `scripts/replay.js` — Gate 4 CLI tool, automatische pass/fail-check
- ✅ `scripts/jurgen-research.js` — top-N modellen GPT-research-tool (NIET gerund, kost credits)
- ✅ Session-bootstrap: nieuwe Claude leest leeslijst automatisch (getest, werkt)

### Wat de andere Claude moet doen (in volgorde)

**Acute fix (vond hij zelf):**
- [ ] Backup-cron 17-06 03:00 heeft niet gedraaid → diagnose + fix

**Daarna eerste RSPP-cyclus:**
- [ ] Eerste echte RSPP-cyclus: `RSPP/engine-blacklist-v1`
  - Gate 1 SPEC: `docs/specs/RSPP-2026-06-17-engine-blacklist-v1.md`
  - Gate 2 REVIEW: tegen JURGEN-DNA + protocol
  - Gate 3 UNIT: matchBodAdjustment-uitbreiding test
  - Gate 4 REPLAY: staging eerst opstarten, dan `node /opt/t4c/scripts/replay.js`
  - Gate 5 SHADOW: 24u op live
  - Gate 6 SIGNOFF: Jurgen op 10 spread-cases
  - PROMOTE

**Wanneer staging niet draait:**
- [ ] Eenmalig opstarten: `staging-sync.sh && staging-snapshot.sh && pm2 start /home/deniz/t4c-staging/ecosystem.config.js`
- [ ] Cron-regel toevoegen: `0 4 * * * /opt/t4c/scripts/staging-snapshot.sh`

**Niet urgent maar nuttig:**
- [ ] `jurgen-research.js` runnen (top-100 modellen, ~€5-10 GPT-cost) → vult `backend/config/model-profiles.json`
- [ ] Off-site backup (rclone)
- [ ] Cloudflared TLS-mismatch in CF-dashboard

## Geparkeerd (op gebruiker)
- **Cloudflare-dashboard**: TLS-mismatch op localhost:9090 → http://localhost:9090 (5d log-spam)
- **Off-site backup**: vereist Backblaze B2 / S3 credentials + GPG-key
- **Watchdog push-alert** (mail/Telegram)
- **Memory-trim**: `project_pricing_baseline_kpi` mogelijk verouderd vs Jurgen-DNA

## Open issues / feiten
- **DB-engine**: better-sqlite3 + WAL (NIET sql.js zoals oudere docs claimen)
- **JWT_SECRET**: in `settings.jwt_secret` (DB), niet alleen .env
- **OpenAI API key**: in `settings.api_key_OPENAI_API_KEY`, .env is fallback
- **CarDataX live**: draait zonder engine op lege DB (separaat traject, niet T4C)

## Bij volgende sessie
1. Lees `/opt/t4c/CLAUDE.md` + `/opt/t4c/docs/SESSION-START-PROTOCOL.md` (verplicht)
2. Beschrijf state aan user vóór actie
3. Wacht op user-akkoord
4. Doorlopen 12-stap-checklist
