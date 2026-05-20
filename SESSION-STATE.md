# Session State — Last updated: 2026-05-17 15:30 by Claude

## 2026-05-17 — Recovery nacht-11-12-mei patches (v10.18.59)

5 pricing-patches uit nacht 11/12 mei teruggeplaatst in productie:
- TITLE-FILTER safety bij >70% wegfiltering → gebruik ongefilterd
- km-range filter in SQL comp query (`km BETWEEN 40-160% target`)
- Comp confidence drempel 25 → 15
- _dataWeight cap 0.40 → 0.70
- Fallback blend re-enabled (≥15→0.50, ≥8→0.35, ≥3→0.20)
- junk-filter.js MODEL-MATCH logica (+217 regels)

Files: `backend/routes/valuation.js` (60247 b) + `backend/lib/comparable-engine/junk-filter.js` (14564 b). Bron: `backend-test-full.ARCHIVE-20260515/` (= test-versie van 11 mei 20:21).

**Test op 80 Jurgen-feedbacks (PROD vs TEST-NIGHTPATCH)**:
- Gem abs delta: €1174 → €1115 (-5%)
- Gem signed delta: +€720 → +€481 (-33% overshoot)
- Binnen 10%: 24% → 29%
- Win/Loss/Tie: 39/24/17

**Backups**: 
- `FULL-STATE-BACKUPS/2026-05-17-pre-nightpatch-ship/` met ROLLBACK.sh (node_modules preserved)
- Eerder vandaag: `FULL-STATE-BACKUPS/2026-05-17-pre-recovery/` (mislukte 4-patch recovery, gerolld)

**Test-omgevingen gearchiveerd** (PM2 delete + dir rename):
- `backend-test-april.ARCHIVE-20260517/` + `data-test-april.ARCHIVE-20260517/` (+€80 floor test)
- `backend-test-nightpatch.ARCHIVE-20260517/` + `data-test-nightpatch.ARCHIVE-20260517/` (5 patches test)
- DO_NOT_START.txt in beide

### Verliescases — root cause analyse (3 grootste verslechtering)

| Plate | Auto | Issue | Patch verantwoordelijk |
|---|---|---|---|
| RF-673-H | BMW 420i Cabrio | comp `insufficient_data` (cleanCount=0), fallback blend trekt €23950 GPT → €20500 via 4 onrelevante listings | Fallback blend re-enabled met `<8 sample → 0.20 weight` is te agressief bij insufficient data |
| 9-SXS-82 | VW Golf 2014 | TWINS-pollution: 742 Seat/Skoda/Audi listings met mediaan €2701 verdunnen GPT €8300 → €7000 | Confidence drempel 25→15 + twins-pool jaar-filter zwak |
| 31-ZRD-6 | VW Golf 2013 200k | Conf=42 met 26 comps median €1301 (incl. twins) → 63% weight trekt €5500 GPT → €2800 | _dataWeight cap 0.70 te hoog bij twins-vervuilde comps |

### Verfijning-richtingen (open TODO, NIET geïmplementeerd)

1. **Bij `compEngine.status=insufficient_data`**: fallback blend OVERSLAAN → 100% GPT (BMW 420i case)
2. **TWINS-pool jaar-filter verstrakken**: huidig year±1, mogelijk year exact match voor twins (VW Golf cases)
3. **_dataWeight cap differentiëren**: 0.55 bij comp-engine vs 0.70 bij fallback (vs huidig altijd 0.70)
4. **strong/clean ratio in confidence**: 5/26 strong = 19% — lage strong-rate moet confidence verlagen
5. **TITLE-FILTER SKIP-drempel strikter**: huidig <0.3 → ongefilterd; mogelijk 0.2

---


## Waar zijn we

Snelheidswerk: Jurgen klaagde dat taxatie 30s duurt, doel <10s. Profilering wees uit dat 86-100% van wallclock in de hoofd-GPT-5.4 + web_search call (~9-12s) zit, en cold path daarbovenop nog 5-8s aan RDW/Finnik/VIN-decode. Twee fixes live (v10.18.55, v10.18.56). DB-fundament uit 15 mei staat nog open: better-sqlite3/WAL migratie nog niet gedaan.

## 2026-05-17 — Snelheidssessie (Features D + A+)

### Live sinds 17 mei

- **v10.18.55 — Feature D**: Finnik scrape + VIN-GPT decode parallel via `Promise.allSettled` in `routes/vehicle.js`. Cold path **23s → 19-20s** (3-4s sneller). Pricing bit-identiek bewezen op XR-457-G (VP 15950 vóór = na). Graceful: VIN timeout breekt Finnik niet.
- **v10.18.56 — Feature A+**: nieuwe `lib/enrich-cache.js` (24h TTL, 5000 entries, LRU). Geïntegreerd vooraan in `/api/vehicle/enriched`. Warm hit **676ms → 13ms** (52× sneller). Geen memory leak (50 calls = 0MB delta). Admin endpoints `GET /api/admin/cache/stats` + `POST /api/admin/cache/invalidate`. dealer/price end-to-end warm 10.7s → 9.6s.

### Snelheidsstatus (na D+A+)
| Scenario | Voor | Na |
|---|---|---|
| `/api/vehicle/enriched` warm | ~700ms | **13ms** |
| `/api/dealer/price` warm | 10.7s | 9.6s |
| `/api/dealer/price` cold plate | 23.5s | 19-20s |

### Resterende hoofd-bottleneck
**GPT-5.4 + web_search call = 9-12s per taxatie** (45-60% van warm-pad). Zit in bevroren pricing-laag — niet aan te raken zonder fundament-overhaul. Caching op make/model/year/km-bucket-niveau zou helpen maar raakt pricing-policy.

### Apart probleem ontdekt
**VIN-GPT timeout 15s** zeldzaam: historisch 130/133 succes = **97.7%**. Niet structureel, geen patroon naar merk/model — gpt-5.4 latency-variance. Acceptabel.

**Misverstand uitgesloten**: lokale VIN-decoder (`/home/claude/vin-decoder/`) bestond niet op `/opt/t4c` — zoek op disk: geen resultaat. Mogelijk plan uit web-Claude context dat hier nooit is uitgevoerd. NIET verder onderzoeken.

### Volgende winst-richtingen (TODO, geprioriteerd)
1. **GT Motive integratie** (prio 1) — vervangt VIN-GPT met deterministische decode + levert basis voor damage data. Meeting al gepland 8 mei. Dit ontgrendelt zowel VIN-snelheid (geen 15s GPT) als de damage-correction module.
2. **Damage correction module** — de échte pricing-fix (overshoot +€659 gem). Wacht op GT Motive basis-data.
3. **Price-index batch systeem**: 's nachts pre-computed prijzen per make/model/year/km-bucket, lookup <1s bij taxatie. Pakt de hoofd-bottleneck (GPT-5.4 web_search 9-12s) zonder pricing-policy aan te raken.
4. **better-sqlite3 + WAL migratie** (uit 15 mei TODO) — fundament voor multi-instance + locking.
5. Vehicle-cache DB-tabel + nieuwe enrichCache overlap heroverwegen na metingen (lage prio).

### Niet (verder) onderzoeken
- VIN-timeout root cause — pas heropenen als failure rate >5% wordt
- gpt-4o-mini voor VIN — pricing-risico op courantScore/engineRisk te groot
- Lokale VIN-decoder bouwen — RDW→commercieel mapping niet vrij beschikbaar; GT Motive is juiste route

---

## Eerdere context (15 mei stabilisatie)

Stabilisatie-sessie na ontdekking van **DB race condition**: dubbele PM2 instances (t4c-server + t4c-test) deelden sinds 11 mei dezelfde `DATA_DIR`. Live `/opt/t4c/data/t4c.db` flikkerde elke 2 min tussen vandaag-state (t4c-server win) en 11-mei state (t4c-test in-memory bevroren op boot). Bij PM2 restart was 50% kans op verlies van alle taxaties + feedback van mei 12–15.

Pricing-werk gepauzeerd (productie klaagt structureel +14% overshoot). Status 15 mei: fundament-fix.

## 2026-05-15 — Stabilisatie sessie

### Incident opgelost
- Dubbele PM2 race (t4c-test sinds 11 mei 21:02:33) — `kill -9 3867579` (SIGTERM-trap omzeild) + `pm2 delete t4c-test` (~17:45 UTC).
- `backend-test-full/` → `backend-test-full.ARCHIVE-20260515/` met `DO_NOT_START.txt`.
- `SAFE-2026-05-15.db` (chmod 444) gezet als read-only restore-point buiten `/backups/` rotation.

### Data-loss tijdbommen ontmanteld
- **`watchdog.sh`**: autoRestore `cp $LATEST t4c.db` deel verwijderd. Behoudt: health check + `pm2 restart`. Nieuw: alert log `/opt/t4c/logs/watchdog-alert.log`.
- **`db.js` autoRestore**: alfabetisch sort vervangen door `SAFE-*` eerst (mtime desc), dan `t4c-backup-{ISO-ts}.db` (mtime desc). `t4c-pre-*`/`t4c-fix-*`/`*PRE-*` snapshots niet meer kandidaat (zouden 11-mei state of ouder restoren).
- **`db.js` forceSave frequentie**: `setInterval(forceSave, 120000)` → `30000`. Code-comment zei al "every 30 seconds" maar value was 2 min. Drift hersteld + window naar 30s gekrompen.
- **`server.js` lock-file** (`/opt/t4c/data/.t4c-server.lock`): tweede instance met levend PID → `process.exit(1)` + CRASH.txt + alert. Stale lock (PID dood) → safe overschrijven.

### Backups gemaakt vandaag
- `t4c-pre-pm2-delete-t4c-test-race-fix_-20260515-174519.db` — pre-killing van t4c-test
- `SAFE-2026-05-15.db` — read-only expliciete restore-point
- `watchdog.sh.PRE-fix-20260515` — pre-autoRestore-removal
- `db.js.PRE-fix-20260515` — pre-autoRestore sort fix
- `db.js.PRE-savefreq-20260515` — pre-30s-interval
- `server.js.PRE-lockfile-20260515` — pre-lockfile
- `CLAUDE.md.PRE-stabilisatie-20260515` + `SESSION-STATE.md.PRE-stabilisatie-20260515` — pre-doc-update

### Status na fixes (allemaal in working tree, niet gecommit)
| File | Wijziging | Actief? |
|---|---|---|
| `/opt/t4c/watchdog.sh` | autoRestore weg, alert log toegevoegd | **Ja** (cron pakt direct op) |
| `/opt/t4c/backend/db.js` | autoRestore sort fix + forceSave 30s | Nee — actief bij volgende boot |
| `/opt/t4c/backend/server.js` | Lock-file boot-check | Nee — actief bij volgende boot |
| `backend-test-full/` | → `.ARCHIVE-20260515/` | **Ja** |
| `/opt/t4c/data/SAFE-2026-05-15.db` | Aangemaakt, chmod 444 | **Ja** |

### Niet herstart — bewuste keuze
t4c-server PID 3940995 sinds mei 11 22:08:26 (4d uptime). Code-fixes worden actief bij volgende boot. Reden: in-memory state is heilig zolang we niet zeker zijn dat fix-keten compleet werkt bij boot. Volgende boot moet gepland zijn (Jurgen bepaalt wanneer, idealiter na een save-cycle en met SAFE backup als parachute).

### Open TODO's (prioriteit hoog → laag)
- [ ] **better-sqlite3 + WAL migratie**: groot werk, fundament voor echt professional. Komende dagen.
- [ ] Geplande t4c-server PM2 restart (na Jurgen OK) → fixes server.js + db.js worden actief
- [ ] `package.json` 10.7.0 → git HEAD (10.18.53) syncen
- [ ] Uncommitted code in working tree (`git status -s` toont 10+ M): committen of weggooien
- [ ] Audit "frozen files" lijst heroverwegen na pricing-fundament
- [ ] **Dubbele inserts** bij save: 4 van 5 unieke 15-mei taxaties dubbel ingevoerd, zelfde seconde → react double-render of double-POST. Latente bug.
- [ ] `taxaties.user_id` NULL bij save → analytics breken (alle 9 taxaties 15 mei NULL)
- [ ] `taxaties.final_bod` NULL → kolom niet gevuld
- [ ] `safe-start.sh` documenteren als enige officiële PM2 boot-route

### Pricing — VOLGENDE sessie (NIET vandaag)
- Damage correction module bouwen + Vident OBD parser koppelen
- Comp engine drempel verlagen (33 listings = bruikbaar, geen `insufficient_data` meer)
- Blend gewicht adaptief op comp confidence (niet hard 0.4 cap)
- Sub-€2k aparte logica of bewust "geen geautomatiseerde prijs"
- Pricing-code aanrakingen ALLEEN na fundament-fix is af

### Pricing-quality benchmark
Jurgen wil exact bod = wat hij zou betalen, weinig handmatige correctie.

- **Huidige meting**: 35% binnen 10%, gem **+€659 te hoog** (overshoot)
- **Target**: 70% binnen 10%, gem afwijking **<€200**

15 mei observaties (2 feedback entries vandaag):
- HYUNDAI I20: ons bod €9800 vs Jurgen €8800 → +€1000 overshoot (10%)
- MERC SLK 230: ons bod €4850 vs Jurgen €1500 → +€3350 overshoot (220%) — comp engine `insufficient_data` bij 33 listings (mediaan €2250), 100% GPT fallback gaf €6950

---

## Eerder relevant (pre-15-mei)

### 2026-05-08 fixes (audit & runtime)
- `dv-webhook.js:792` `scheduleSaveFn` → `scheduleSave && scheduleSave()` (fix unhandled rejection bij 06:00 cleanup)
- `server.js:226-330` daily-scrapers refactor: top-level i.p.v. ingenest in email-poller. Skip-recovery + `last_daily_scraper_run` marker in `settings`.

### Audit 2026-05-08 nog open
- `/api/search-history` GET 404-storm (frontend admin doet GET, backend alleen POST)
- Schema mismatch `/api/taxatie/feedback` in `routes/misc.js`
- 66 `.bak` files cleanup
- `pricing_lessons` write-only beslissing (inhaken op blend, of schrijflogica weghalen)

### DB-status (16:08 backup, post-fix snapshot)

```
taxaties        : 3025  (vandaag 15 mei: 9 rijen = 5 unieke auto's door dubbel-insert bug)
dealer_feedback : 551   (vandaag: 2, beide overshoot)
market_listings : 224136
voorraad        : 30
dv_vehicles     : 80
```

## Belangrijke paden

- Audit rapport: `/opt/t4c/AUDIT-2026-05-08.md`
- SAFE restore-point: `/opt/t4c/data/SAFE-2026-05-15.db` (chmod 444)
- Backups vandaag: `/opt/t4c/data/backups/*-20260515*`
- Claude log: `/opt/t4c/data/claude-log/2026-05.md` (incident + alle fix-stappen)
- Archive: `/opt/t4c/backend-test-full.ARCHIVE-20260515/` (NIET starten)

---

## 2026-05-20 — Operationele update

**15-mei stabilisatie-fixes zijn al actief sinds boot na recovery 17 mei**
(t4c-server created at 2026-05-17T15:57:06.958Z): `[LOCK] Stale lock (PID X
bestaat niet) — overschrijven` regels uit 18-mei err log bewijzen dat de
`server.js` lock-file check live is; tegelijk zijn de `[DB] ENOENT t4c.db.tmp`
errors uit 15-mei niet terug in 18+19+20-mei logs, dus de `db.js` save+sort
fixes draaien ook. Beide TODOs uit 15-mei SESSION-STATE ("actief bij volgende
boot") kunnen worden afgevinkt.

**Recovery-procedure moet `npm install --omit=dev` includen.** 17-18 mei bracht
44 PM2 restarts, allemaal hetzelfde patroon: `Error: Cannot find module 'express'`
op `server.js:5`. Root cause: v10.18.59 recovery heeft node_modules overschreven
zonder reinstall. PM2 backoff-loopte tot iemand handmatig npm install draaide.
Toegevoegd aan safe-restart.sh.

**Finnik parser uitgebreid (v10.18.62)** — `Uitvoering` (trim) en `Soort
transmissie` (genormaliseerd: Handgeschakeld/Automaat/null) worden nu uit
Finnik HTML gehaald. Bij aanwezigheid winnen ze van VIN-GPT output voor
`trimLevel` en `transmission`. Test: 6/6 trim-extractie, 3/6 transmissie
(rest Onbekend → fallback VIN-GPT). 28-SJK-6: trim = "Pro Line S" (was null),
transmissie = "Automaat" (was Handgeschakeld door VIN-GPT fout).
