# 🗺️ 00 — SYSTEEMKAART T4C (geverifieerd op de live server)
*De ENE bron van waarheid. Elke regel is read-only geverifieerd op `ssh t4c` op 2026-06-15 (5 parallelle code/data-audits, file:line + exacte counts). Vervangt losse audit-docs.*

---

## ⚡ UPDATE-OVERLAY 2026-06-17 — wat veranderd is sinds 2026-06-15

**LEES DEZE OVERLAY EERST.** Onderstaande hoofd-tekst is van 2026-06-15. De volgende wijzigingen zijn sinds die datum doorgevoerd en overschrijven de oudere claims:

### DB-engine
- ❌ ~~sql.js in-memory~~ → ✅ **better-sqlite3 + WAL** (cutover commit `d5c6dcb`, 16-06 10:54)
- `forceSave()` doet **geen PRAGMA integrity_check meer** op 30s-tick + SIGTERM (commit `c502678`, 16-06 23:00). Aparte `integrityCheck()` voor admin/cron.

### Restart-cijfers — context
- "92 restarts" en "106 restarts" in §1 zijn **PM2-lifetime-counters**, geen daily-crash-cijfer. Vandaag (16-06): 9 echte boots voor t4c-server, 3 voor atx-admin — allemaal handmatig (SIGINT, geen crashes).
- **Atx-admin restart-bescherming** toegevoegd (16-06 22:55): `kill_timeout: 5000, min_uptime: '10s', max_restarts: 8, restart_delay: 3000`. Eerder ontbrak elk vangnet → 16× restart-loop in <0.5s mogelijk.

### Backup-cron
- ❌ ~~`backup.sh` daily-cron 03:00 werkt~~ → was **stil kapot sinds 30-04** (53 false-positives, cp-glob bug). **Gefixt 16-06** in commit `0f3b516`. Verifieerd: `db_20260616_2243.db` (193 MB) staat in `/opt/t4c/backups/`.

### Schoonmaak Fase 1+2+5a (16-06)
- **4,5 GB rotzooi** verwijderd: oude .bak DB-files (849 MB), data/backups/ sqljs-tijdperk (1,6 GB), backups/cleanup-/archived-/atx- snapshots (1,7 GB), FULL-STATE-BACKUPS (386 MB), 22× backend/*.bak-* + PATCH-READY + STAGED-*
- **3 phantom files weg**: `=` (0b), `manifest_new.json` (0b), `db.js.WORKING-sqljs-20260616` (66 KB)
- **`.gitignore` prefix-fix**: `backend/wal-poc/wal-*` + `backend/wal-poc/*.md` + `backend/db.js.WORKING-*` + `backend/db.sqljs.bak.js`

### Pricing-bias-cijfers — nieuwe meting met enrichment-payload
- ❌ ~~Mediaan +11%, bias +59%, +198% op <€2k~~ (was tegen `our_bod` = eigen output, fout)
- ✅ **Mediaan +5%** vs Jurgen-bod (`sold_price`) op 660 cases met enrichment-payload
- Resterende blinde vlekken: <€2k auto's (+38%), 16+j gemengd
- **Onthulling 16-06**: `sold_price` IS Jurgen-bod (niet `our_bod` zoals eerder gedacht). `dealer_feedback.kenteken` is wel gevuld (eerder gedacht: leeg).

### Pricing-leerlus
- ❌ ~~0 sold_price-rijen~~ → de **662 dealer_feedback-rijen** zijn de echte ground truth (Jurgen-bod via `eigen_bod` → `sold_price` kolom). Bod-curve van 16-06 is hieruit gefit.

### Session-bootstrap (17-06)
- `/opt/t4c/CLAUDE.md` herschreven met verplichte leeslijst
- `/opt/t4c/docs/SESSION-START-PROTOCOL.md` nieuw — 12-stap checklist
- `/home/deniz/CLAUDE.md` nieuw — home-bootstrap
- Memory-trigger boven aan `MEMORY.md`

### Jurgen-DNA ronde 2 (17-06)
- `JURGEN-PRICING-DNA-2026-06-17.md` complete framework
- Memory `project_jurgen_pricing_rules.md` uitgebreid met scorematrix per dimensie

---

> **Hoe te lezen:** ✅ = werkt & is aangesloten · ⚠️ = draait maar half/risico · ☠️ = dood/niet-aangesloten (de "schok").

═══════════════════════════════════════════════════════════
## 0. DE SCHOK IN 1 OOGOPSLAG (wat NIET is aangesloten)
═══════════════════════════════════════════════════════════
1. ☠️ **De hele nieuwe CarDataX-engine draait NIET in productie.** `app.cardatax.com` (live container, DB `cardatax_live`) heeft **geen `engine/`, geen `workers/`, geen `/api/auto`** en de DB heeft **niet eens een `market_listings`-tabel**. Alle "accuraat as fuck"-techniek (synthesis, comparables, arbitrage, VIN-moat, scrapers) leeft **alleen op dev** (`dev.cardatax.com`). Publiek live = marketing-pagina op een lege DB.
2. ☠️ **De pricing-leerlus bestaat niet.** Van 4317 taxaties heeft **0** een `sold_price`. `accuracy_log` (8) heeft 0 uitkomsten. `pricing_lessons` (205) wordt **nooit gelezen**. atx `inbound_taxaties` (122): `winning_bid`/`outcome` = 0/leeg. → er is **nergens** een rij "deze auto → ons bod → echte uitkomst". Accuratesse is dus niet meetbaar.
3. ☠️ **EU-arbitrage (#17) bereikt de gebruiker niet** — engine rekent het, maar de whitelist-fix (`c97c305`) is **nooit geredeployed**; in beide draaiende containers wordt `arbitrage` uit de JSON gestript. Kaart blijft verborgen.
4. ☠️ **VIN-registry is write-only** — `lookupVin` heeft 0 call-sites. De moat groeit maar levert niks terug.
5. ⚠️ **B1-bug in t4c live**: `valuation.js:1012` `finalBod = finalHandel` overschrijft het risico-gewogen bod van de trade-engine → de hele risico-engine wordt voor het bod genegeerd.
6. ⚠️ **CarDataX-scrapers negeren `enabled=f`** (Gaspedaal staat uit maar scrapete vandaag 10.022 rijen), en de **worker draait als losse root-proces buiten pm2** (geen restart, sterft bij reboot).
7. ☠️ **`config/snelle-taxatie-multipliers.json` = dood** (nergens geladen, terwijl een comment claimt "655 cases, 5-fold CV"); idem `pricing-protocol.js` + `confidence-engine.js` in t4c.

═══════════════════════════════════════════════════════════
## 1. DE SYSTEMEN (wat draait, geverifieerd via pm2/docker/ss)
═══════════════════════════════════════════════════════════
Server: `t4c-server` (Ubuntu, HP Z440 Langeraar), bereikbaar via `ssh t4c`. Disk 35G/1.8T (3%, geen druk).

| # | Systeem | Proces / poort | Map | Status |
|---|---|---|---|---|
| **1** | **t4c** — DE live web-taxatie transfer4cars.com | PM2 `t4c-server` `*:3000` (92 restarts) | `/opt/t4c` | ✅ live, ⚠️ instabiel-historie + B1-bug |
| **2** | **atx-pipeline** — Autotelex bod-mails | PM2 `atx-admin` `127.0.0.1:3110` (106 restarts) + `admin-dashboard` `:3200` | `/opt/atx-pipeline` | ✅ pipeline draait, ⚠️ uitkomst-loop leeg + wachtwoord-risico |
| **3** | **CarDataX-app DEV** | Coolify container `:3020` → Postgres `cardatax_dev` | `/opt/cardatax-app/dev` | ⚠️ alleen hier draait de engine; arbitrage dood, scraper-bugs |
| **3** | **CarDataX-app LIVE** | Coolify container `:3010` → Postgres `cardatax_live` | `/opt/cardatax-app/live` | ☠️ engine ontbreekt, DB leeg, `/api/auto`=404 |
| — | **cardatax (landing)** | PM2 `cardatax-server` `0.0.0.0:3001` | `/opt/cardatax` | ✅ losse landing, geen taxatie |
| — | **lyra** | PM2 `lyra-server` `127.0.0.1:3100` | `/opt/lyra` | ✅ observeert alleen, raakt prijs NIET |
| — | **outlet4cars** | PM2 `:3005` (localhost) | `~/outlet4cars` | ✅ losse site, proxyt naar :3000 |

**Routing:** alles publiek via een **cloudflared-tunnel** (token in Cloudflare-dashboard, GEEN lokale config → ingress is niet vanaf de server te verifiëren). Traefik/Coolify-proxy route **niks** voor de cardatax-apps; die hangen op kale poorten 3010/3020.

═══════════════════════════════════════════════════════════
## 2. ENGINE #1 — t4c web-taxatie (`/opt/t4c/backend/`)
═══════════════════════════════════════════════════════════
Draaiende versie v10.20.0; **running code == working tree maar ≠ git HEAD** (35 uncommitted entries; `valuation.js` ongecommit op disk, ook `channel-engine.js` untracked).

### Live prijs-pad `/api/dealer/price` (valuation.js, genummerd)
1. enrichment-cache (`getCached`) → 2. `getModelLifecycle` → 3. (als make+model) `market_listings` laden + `getTwinListings` (twins) → `buildComparableSet` → comp-mediaan + confidence → 4. **één GPT-call** `gpt-5.4` + web_search (valuation.js:882) = primaire prijs → 5. **blend** comp×dataWeight(0,20–0,70) + GPT → finalVerkoop → 6. `calculateTradeBid` → 7. **`finalBod = finalHandel` (L1012) ⚠️overschrijft trade-bod** → 8. bod-adjustments.json → 9. save + accuracy-log (fire&forget) + scoring (display) + channel-engine.
- `/quick-price` = zelfde comp-engine + 2e GPT-prijs via `quick-price-expert.js`. **Totaal 2 GPT-prompts die een prijs maken**, beide `gpt-5.4`.

### WIRED vs DOOD (geverifieerd op require + call-site)
- ✅ **WIRED:** comparable-engine (14-staps, incl. `confidence.js`), trade-engine (maar maxBid weggegooid, zie B1), quick-price-expert, channel-engine, twins, listing-normalizer **alleen** `parser.parseTitle`, scoring (display), pricing.js `kmCorrection` (zwak, alleen exportflag), bod-adjustments.json, model-lifecycle, accuracy-loop (alleen loggen).
- ☠️ **DOOD in pricing:** `comparable-engine/pricing-protocol.js` (complete margin-engine, 0 importers) · `comparable-engine/confidence-engine.js` (overschaduwd door confidence.js) · `config/snelle-taxatie-multipliers.json` (nooit `require`d) · `lib/intelligence.js` (wel in 4 andere routes, NIET in pricing) · `lib/helpers.js` `maxPrice/MIN_PRICE/fmtE/safeFetch/setCache` (geïmporteerd, nooit aangeroepen) · `model-normalizer.js` + `listing-normalizer/index.js+taxonomy.js`.

### Routes (allemaal gemount in server.js, geen wees-routes)
misc · vehicle · valuation · taxatie · images · pdf · intelligence · voorraad · dealer · scanner · inspectie · veilingen · extended-taxatie · market · ai-chat · admin · (seo speciaal voor sitemap/robots).

### Bevestigde bugs (file:line)
- **B1** `valuation.js:1012` finalBod=finalHandel → risico-bod weggegooid.
- **B2** `valuation.js:1489-1492` bod-adjustment factor reset naar 1.0 in quick-price niet-comp paden (expert-paden gooien het bod sowieso opnieuw).
- **B3** `scoring.js:70` km-ratio >2.0-tak onbereikbaar (>1.5 vangt alles). Lage impact (display).

═══════════════════════════════════════════════════════════
## 3. ENGINE #2 — atx-pipeline (Autotelex-bod)
═══════════════════════════════════════════════════════════
`server.js` = enige entry: Express :3110 + 4 pollers (mail-watcher 60s · scraper 15s · taxatie 20s · markt 30s). ✅ Pipeline draait (laatste activiteit vandaag 16:03).

**Bod-flow:** IMAP-mail → scraper (bidpagina-parser) → `taxatie-worker` → `t4c-client.js:108` **POST `127.0.0.1:3000/api/extended-taxatie`** → `markt-worker` (Gaspedaal-lookup) → **V2** `computeBodAdvies` → **V3** `computeBodAdviesV3` → **V3 OVERSCHRIJFT V2** (markt-worker.js:207-217) → persist.

**V3-formule (exact, bod-adviseur-v3.js:163):** `bod = round((verkoopprijs − opknap − marge − risico)/50)*50`.
- **Categorie** (auto-categorie.js): SLOOP (niet-rijdbaar / km>350k / opknap>verkoop) · PROBLEEM (motor slecht/gem.+storing) · EXPORT (km>250k&>12j of km>300k) · BUDGET (km>200k of >12j) · REGULIER (default).
- **Opknap:** APK €200, beurt €150-350, motor slecht €2500/gem €800, chassis €400-1500, storing €500, schade €50-300/item, ×cosmetisch- & mechanisch-factor.
- **Marge ×slider(1-10, LIVE hardcoded op 5):** REGULIER 30→8% · BUDGET 25→5% · EXPORT 20→3% · PROBLEEM 40→12% · SLOOP 0.
- **Risico:** standtijd 2-12%, garantie 3%, high-km 2-4%, terugroep €150. Caps: bod ≤2×ATX, ≤95% verkoop.

☠️ **Dood/scaffolding:** markt-worker `options.t4cResult` "race-fix" wordt nooit gevoed (poller roept `processTaxatie(id)` zonder 2e arg) → valt terug op DB (werkt, maar misleidend). Audit/return-log rapporteert **V2**-bod terwijl **V3** is opgeslagen.
⚠️ **RISICO:** `admin-dashboard.js:23` hardcoded wachtwoord **`T4C-admin-2026` is de live-waarde** (geen env-override) + vervalsbare cookie `admin_auth=ok` → wie :3200 bereikt heeft volledige DB/log/PM2-toegang.

**Bereikbaar van buiten:** t4c proxyt → atx:3110 (`/telex-inkoop` → `/admin/inbound`, `/api/taxatie`, `/api/markt` etc.).

═══════════════════════════════════════════════════════════
## 4. ENGINE #3 — CarDataX-app (dev/live) — de grootste afwijking
═══════════════════════════════════════════════════════════
| Domein | poort | container | commit | Postgres |
|---|---|---|---|---|
| **app.cardatax.com** (prod) | 3010 | live | `eed389e` (06-04) | `cardatax_live` |
| **dev.cardatax.com** (staging) | 3020 | dev | `1ffc3e6` (06-13) | `cardatax_dev` |

- ☠️ **Live container heeft GEEN engine/workers/auto.js**; `/api/auto` = 404. `cardatax_live` heeft **geen `market_listings`-tabel** (10 lege tabellen). → publieke prod doet alleen marketing + basisroutes op lege DB.
- ✅/⚠️ **dev**: engine draait. `cardatax_dev` = **310k market_listings** (94% = statische T4C-import van 06-07, niet ververst; scrapers leveren ~18k). external_id **100% uniek** → de "120k dupes" was VALS ALARM (dedup_key is bewuste variant-grouping).
- **Live pricing-flow dev** `/api/auto/:kenteken`: RDW → AI (expert+risk) → loadListings → comparable → synthesis → feedback-correctie → arbitrage → scoring → channel → VIN-upsert → response.
- ☠️ **arbitrage** gestript uit response in beide containers (fix nooit geredeployed). ☠️ **lookupVin** 0 call-sites. ⚠️ **liquidity/risk/marketVelocity = hardcoded 50/40/50 met TODO** (auto.js:306-310) → barometer draait op nepdata. ⚠️ **`enabled=f` stopt scraper niet** (scraper-base.js:59-61 + health 'ok' overschrijft 'error' :90-91); batch-gate dekt AS24-BE/DE niet. ⚠️ **worker buiten pm2** (root, alleen via cron-watchdog levend); live-container draait helemaal geen worker.

═══════════════════════════════════════════════════════════
## 5. lyra (AI-assistent) — observeert, rekent GEEN prijs
═══════════════════════════════════════════════════════════
PM2 `lyra-server` :3100, via t4c-proxy `/api/lyra`. t4c `valuation.js:1145` doet fire-and-forget `emitObservation` → lyra INSERT in `lyra_observations`; **niets stroomt terug naar pricing**. 3-laags brein (KB→gpt-5.4→Claude Code CLI). lyra.db: knowledge 1087, observations 634 (vers), `lyra_review_queue` 903 **allemaal pending (nooit verwerkt)**, conversations 24 (bevroren sinds 05-23).

═══════════════════════════════════════════════════════════
## 6. DE DATABASES (6 stores, status per tabel)
═══════════════════════════════════════════════════════════
**Canonieke live store = `/opt/t4c/data/t4c.db` (190 MB, WAL actief).**

- **t4c.db:** ✅ taxaties 4317 (**sold_price 0/4317**), market_listings 309.709 (33k vers <24u), market_snapshots 98.549, learned_prices 992 (gelezen via pricing.js:33), price_trends 14.065, dv_vehicles 132 (**de echte voorraad**, kenteken 100%), dealer_feedback 662 (sold_price 662, **kenteken 0/662 = ontkoppeld**). ☠️ **WRITE-ONLY/DOOD:** pricing_lessons 205 (nooit gelezen), accuracy_log 8 (actual 0). ☠️ **LEEG-scaffold:** deals_history, inkoop_pipeline, price_history, biedingen, leads, dealer_profiles, notificaties, portfolio, price_alerts, search_history, transport, kosten_items, gebreken, arbitrage_deals, car_photos, veiling_watchers, voorraad_tmp. voorraad 30 (**kenteken 0/30 = wees**).
- **Postgres cardatax_dev:** market_listings 310.047 (100% uniek), price_history 18.293 (dít is de gevulde, niet die in t4c.db). = de echte CarDataX-data.
- **Postgres cardatax_live:** ☠️ leeg (geen market_listings-tabel).
- **atx.db:** inbound_taxaties 122 (104 met BEIDE taxaties T4C+AutoTelex), atx_audit_log 113k. ☠️ winning_bid/outcome/decision/t4c_taxatie_id = 0/leeg.
- **lyra.db:** zie §5.
- **groundtruth/:** ground_truth.db 726 + auto1_purchases.db 34 = de enige echte-uitkomst-sets, **niet gewired in de live tabellen**.

### ⭐ De pricing-leerlus (kern-conclusie)
**De gesloten lus "voorspel → echte verkoop → meet fout → leer" bestaat NIET.** Outcomes zitten alleen in fragmenten: dealer_feedback (662, maar ontkoppeld — geen kenteken/taxatie_id) + losse ground-truth-bestanden. **Geen enkele rij koppelt "deze auto → onze voorspelling → echte uitkomst" in de productie-pijplijn.** Daarom waren alle eerdere "accuracy"-cijfers tegen `our_bod` (oud) of de engine zónder GPT — nooit tegen de realiteit.

### Kenteken/VIN-koppeling
taxaties: kenteken 92%, **VIN 9,5%**. dealer_feedback/atx/voorraad: niet terug te koppelen (geen sleutel). dv_vehicles = enige schone identiteit (kenteken 100%).

═══════════════════════════════════════════════════════════
## 7. CRON / SCHEDULING / SCRAPERS
═══════════════════════════════════════════════════════════
- `0 3 * * *` t4c backup.sh (db+.env, >30d weg) — veilig.
- `* * * * *` t4c watchdog.sh — ⚠️ **restart t4c-server automatisch** bij health-fail (3x, cooldown 5min, flock). Verklaart de 92 restarts.
- `15 * * * *` db-snapshot.sh (24 bewaard) — veilig.
- `* * * * *` cdx-worker-watchdog.sh — ⚠️ `docker exec -d` (re)start de DEV cardatax-worker (Dockerfile start 'm niet zelf). Verwijderen = scraper sterft stil.
- `30 6 * * *` t4c-state.sh → STATE-bestand — veilig.
- ~~`0 4 * * *` cardatax-snapshot-dev.sh~~ ☠️→**UIT gezet 2026-06-13** (overschreef dev-DB vanuit lege live met `--clean`). **Script bestaat nog** → cron-regel weer aanzetten = dataverlies dev.
- ⚠️ **Geen Postgres-backup** op deze host (cardatax_live/dev onbeschermd op cron-niveau).

═══════════════════════════════════════════════════════════
## 8. BEVEILIGING / RISICO
═══════════════════════════════════════════════════════════
- ⚠️ atx admin-dashboard :3200 — hardcoded live-wachtwoord `T4C-admin-2026` + vervalsbare cookie.
- ⚠️ t4c hardcoded default-admin `t4c2025!` (db.js, alleen bij lege tabel — live-pw niet geverifieerd gewijzigd); JWT_SECRET hardcoded in lib/auth.js.
- cloudflared-tunnel flapt af en toe (quic timeout, reconnnect) — nu verbonden.

═══════════════════════════════════════════════════════════
## 9. CLUTTER / OPRUIM-KANDIDATEN (niks autonoom weggooien)
═══════════════════════════════════════════════════════════
- 2 × 0-byte fantoom-`t4c.db` in `backend/` en `backend/data/` (risico verkeerd-pad-write).
- ~3,3 GB backup/SAFE/.bak DB-kopieën in data/ incl. `t4c.db.corrupt` (83 MB), 8 near-identieke van 05-07.
- Dubbele DB-laag-source: `db.js` + `db.bsqlite.js` (+ .bak's).
- Dag-/20-dagen-oude stray `node -e` test-processen (deniz) blijven hangen.
- Doc-wildgroei: server-root ~10 audit-md's + `docs/` 18 md's + lokaal `Desktop\.claude` — **dit document consolideert dat.**

═══════════════════════════════════════════════════════════
## 10. NIET TE VERIFIËREN VANAF DE SERVER (eerlijk)
═══════════════════════════════════════════════════════════
- Welke hostnames de cloudflared-tunnel naar welke poort routeert (token-managed in dashboard).
- Of het live t4c-admin-wachtwoord daadwerkelijk gewijzigd is.
- Of er een runtime-taxatie-call écht door de hele keten loopt (geen live call gedaan in deze audit).

═══════════════════════════════════════════════════════════
## 11. PRIORITEITEN DIE HIERUIT VOLGEN (voorstel, niks gedaan)
═══════════════════════════════════════════════════════════
1. **Grondwaarheid-capture aanzetten** (additief): per taxatie kenteken + later echte uitkomst wegschrijven → leerlus wordt meetbaar. Zonder dit is "accurater dan Indicata" een gevoel.
2. **CarDataX dev→live recht trekken** (Jurgen-beslissing): engine + data staan op dev, live is leeg. Beslis wat canoniek wordt vóór er klanten op komen.
3. **Quick wins, los van elkaar:** arbitrage redeployen (#17), `enabled=f` echt laten stoppen, worker onder pm2, B1 beslissen (risico-bod gebruiken?).
4. **Beveiliging:** atx :3200 wachtwoord uit env, t4c-admin-pw verifiëren.
5. **Opruimen per item** (met backup): fantoom-db's, dode configs/code, doc-wildgroei.
6. **Pas hierna:** de auto-start (sessie-start laadt deze kaart + live-staat automatisch in, elke wijziging werkt 'm bij).

*Bron: 5 read-only audits (infra · t4c-pricing · atx+lyra · cardatax · data) op 2026-06-15. Detail-bewijs met file:line in de agent-rapporten van die sessie.*
