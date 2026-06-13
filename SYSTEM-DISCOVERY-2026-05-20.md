# System Discovery — /opt/t4c (peildatum 2026-05-20)

Read-only feitelijk overzicht. Geen aannames, alleen wat in code/op de server staat.

---

## 1. SESSION-STATE

**Huidige versie (git HEAD)**: `92ad3ff` v10.18.61 — UI: sidebar icons weg, action-row admin-only, alleen voorkant foto
**`backend/package.json`**: nog steeds `10.7.0` (drift, niet gesynct — open TODO sinds 15 mei)

**Laatste relevante commits** (uit `git log --oneline -10`):

```
92ad3ff v10.18.61 - UI: sidebar icons weg, action-row admin-only, alleen voorkant foto
804fedc v10.18.60 - Features: model lifecycle + feedback chips
173446d docs: SESSION-STATE update — v10.18.59 recovery + verliescase analyse
2322be0 v10.18.59 - Recovery: 5 nacht-11-12-mei patches teruggeplaatst
e8bf368 v10.18.57 - Docs: VIN onderzoek samenvatting + GT Motive prioriteit
46977a8 v10.18.56 - Feature A+: enrich-cache 24h TTL — 13ms warm hit (52× sneller), admin stats+invalidate endpoints, 0 memory leak
fff948d v10.18.55 - Feature D: Finnik+VIN parallel via Promise.allSettled — 3-4s sneller op cold path, pricing bit-identiek, graceful degradation bij VIN timeout
232227c v10.18.54 - Stabilisatie: race-fix, SAFE backup, watchdog safe, db.js + server.js lock-file
f1d95ff v10.18.53 - Feedback: inkoper kan bod, notitie alleen admin/Jurgen
87fdddd v10.18.52 - Feedback sectie direct zichtbaar voor admin/Jurgen
```

**Openstaande items** (uit SESSION-STATE.md):

Pricing-verfijningen geïdentificeerd, NIET geïmplementeerd:
1. Bij `compEngine.status=insufficient_data` → fallback blend OVERSLAAN → 100% GPT (BMW 420i case)
2. TWINS-pool jaar-filter verstrakken (huidig year±1 → mogelijk exact match)
3. `_dataWeight` cap differentiëren (0.55 bij comp-engine vs 0.70 bij fallback)
4. strong/clean ratio in confidence (5/26 strong = 19% → moet conf verlagen)
5. TITLE-FILTER SKIP-drempel strikter (huidig <0.3 → mogelijk 0.2)

Lange-termijn TODO's (prio hoog → laag):
1. GT Motive integratie (prio 1) — vervangt VIN-GPT, ontgrendelt damage-correction
2. Damage correction module — wacht op GT Motive
3. Price-index batch systeem ('s nachts pre-computed)
4. better-sqlite3 + WAL migratie
5. Vehicle-cache DB-tabel vs nieuwe enrichCache overlap heroverwegen

15-mei stabilisatie-fixes nog niet actief (in working tree, wachten op geplande boot):
- `backend/db.js` autoRestore sort fix + forceSave 30s
- `backend/server.js` lock-file boot-check

Open punten uit 15 mei:
- `package.json` 10.7.0 → 10.18.x sync
- Uncommitted M's committen/weggooien
- Dubbele inserts (4 van 5 unieke 15-mei taxaties dubbel)
- `taxaties.user_id` NULL bij save (analytics breken)
- `taxaties.final_bod` NULL
- `safe-start.sh` documenteren als officiële PM2 boot-route

Audit 2026-05-08 nog open:
- `/api/search-history` GET 404-storm
- Schema mismatch `/api/taxatie/feedback` in `routes/misc.js`
- 66 `.bak` files cleanup
- `pricing_lessons` write-only beslissing

**Waarschuwingen**:
- t4c-server PM2 PID 256909 = **44 restarts** in 2 dagen (was 0 op 15 mei)
- 6 archief-/recovery-failed dirs untracked in working tree

---

## 2. Structuur

### PM2 status

```
┌────┬────────────────────┬───────────┬─────────┬──────┬─────────┬────────┬─────┬─────────┬─────┬────────┬───────┐
│ id │ name               │ namespace │ version │ mode │ pid     │ uptime │ ↺   │ status  │ cpu │ mem    │ user  │
├────┼────────────────────┼───────────┼─────────┼──────┼─────────┼────────┼─────┼─────────┼─────┼────────┼───────┤
│ 7  │ cardatax-server    │ default   │ 0.1.0   │ fork │ 3907503 │ 13h    │ 0   │ online  │ 0%  │ 72.9mb │ deniz │
│ 3  │ t4c-server         │ default   │ 10.7.0  │ fork │ 256909  │ 2D     │ 44  │ online  │ 0%  │ 2.4gb  │ deniz │
└────┴────────────────────┴───────────┴─────────┴──────┴─────────┴────────┴─────┴─────────┴─────┴────────┴───────┘
Module
┌────┬───────────────┬─────────┬─────────┬────────┬────┬─────┬────────┬───────┐
│ id │ module        │ version │ pid     │ status │ ↺  │ cpu │ mem    │ user  │
├────┼───────────────┼─────────┼─────────┼────────┼────┼─────┼────────┼───────┤
│ 0  │ pm2-logrotate │ 3.0.0   │ 4069385 │ online │ 0  │ 0%  │ 81.1mb │ deniz │
└────┴───────────────┴─────────┴─────────┴────────┴────┴─────┴────────┴───────┘
```

### git status + log

```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	FULL-STATE-BACKUPS/
	backend-test-april.ARCHIVE-20260517/
	backend-test-nightpatch.ARCHIVE-20260517/
	backend.RECOVERY-FAILED/
	data-test-april.ARCHIVE-20260517/
	data-test-nightpatch.ARCHIVE-20260517/

nothing added to commit but untracked files present
```

```
92ad3ff v10.18.61 - UI: sidebar icons weg, action-row admin-only, alleen voorkant foto
804fedc v10.18.60 - Features: model lifecycle + feedback chips
173446d docs: SESSION-STATE update — v10.18.59 recovery + verliescase analyse
2322be0 v10.18.59 - Recovery: 5 nacht-11-12-mei patches teruggeplaatst
e8bf368 v10.18.57 - Docs: VIN onderzoek samenvatting + GT Motive prioriteit
46977a8 v10.18.56 - Feature A+: enrich-cache 24h TTL
fff948d v10.18.55 - Feature D: Finnik+VIN parallel via Promise.allSettled
232227c v10.18.54 - Stabilisatie: race-fix, SAFE backup, watchdog safe, db.js + server.js lock-file
f1d95ff v10.18.53 - Feedback: inkoper kan bod, notitie alleen admin/Jurgen
87fdddd v10.18.52 - Feedback sectie direct zichtbaar voor admin/Jurgen
```

### Top-level layout (tree niet beschikbaar — `ls -la` gebruikt)

Relevant in `/opt/t4c/`:

```
backend/                          # prod backend (echte code)
backend.RECOVERY-FAILED/          # 17 mei mislukte recovery
backend-test/                     # leeg (mei 11)
backend-test-april.ARCHIVE-20260517/      # +€80 floor test
backend-test-nightpatch.ARCHIVE-20260517/ # 5-patches test
backend-test-full.ARCHIVE-20260515/       # 15 mei archief (DO_NOT_START.txt)

data/                             # prod DB + backups
data-test-april.ARCHIVE-20260517/
data-test-nightpatch.ARCHIVE-20260517/

FULL-STATE-BACKUPS/               # 17 mei pre-nightpatch / pre-recovery
backups/
backup_20260309_113435/

frontend/  sites/cardatax/  apps/  capacitor-app/   # frontends
logs/  photos/  scripts/  uploads/  t4c-scraper/   # ops

CLAUDE.md  SESSION-STATE.md  AUDIT-2026-05-08.md
package.json (dummy: blessed only)  package-lock.json
backend/package.json → v10.7.0
.env
watchdog.sh  safe-start.sh  safe-restart.sh  start.sh
```

---

## 3. Vehicle/enrichment pipeline — welke files raken het écht

### finnik (`grep -rln "finnik" --include="*.js"`)

```
backend/routes/vehicle.js                                — definieert fetchFinnikData() + /api/vehicle/enriched
backend/routes/valuation.js                              — gebruikt finnikWaardeLow/High in GPT-prompt + response
backend/lib/scoring.js                                   — input doc-comment verwijst naar finnikData
backend/lib/comparable-engine/confidence-engine.js       — finnik in cross-checks
backend/db.js                                            — finnik_data kolom in vehicle_cache
sites/cardatax/app/assets/index-aET57dF3.js              — frontend bundle
```

### RDW/opendata (`grep -rln "RDW\|opendata" --include="*.js"`)

```
backend/routes/vehicle.js                — alle RDW calls (opendata.rdw.nl/resource/...)
backend/routes/valuation.js              — RDW-derived velden in GPT prompt
backend/routes/admin.js                  — admin RDW endpoints
backend/routes/scanner.js                — VIN/plate scanner
backend/lib/smart-sold-rdw.js            — RDW extra-data + smart sold estimator (geen VIN-decode)
sites/cardatax/m/js/scanner.js           — frontend scanner
sites/cardatax/m/js/taxatie.js           — frontend taxatie
sites/cardatax/app/assets/index-aET57dF3.js  — frontend bundle
```

### VIN (`grep -rln "VIN" --include="*.js"`)

```
backend/routes/vehicle.js     — VIN decode via OpenAI GPT (regel 510-640)
backend/routes/valuation.js   — VIN-insights in GPT prompt (regel 552)
backend/routes/admin.js       — admin VIN endpoints
backend/lib/intelligence.js   — market scanner/source-scoring (NIET VIN-decode)
sites/cardatax/app/assets/index-aET57dF3.js  — frontend bundle
```

---

## 4. Vehicle endpoint specifiek

**Bestand**: `backend/routes/vehicle.js`
**`wc -l`**: **899 regels**
**Endpoint definitie**: `router.get("/api/vehicle/enriched", ...)` op **regel 312**

### Aanroep-volgorde binnen endpoint

```
312      router.get("/api/vehicle/enriched", ...)
318-321  enrichCache.get() + getCached()        — memcache hit-check
324-337  vehicle_cache DB lookup                — static_data + gpt_data + finnik_data
347-354  Dynamic RDW Promise.all (6 endpoints)  — APK, recalls, defects, meldingen, eigenaar, milieu
365-375  Static RDW Promise.all (9 endpoints)   — main, cat, body, fuel, object, handels, brandstof, type, ovi
379      Promise.all([_dynPromise, _statPromise])
390-505  Parse RDW: fuel, power, year, APK+KM history, recalls, owners, milieu, BPM
510      ═══ PARALLEL: Finnik scrape + VIN decode (Promise.allSettled) ═══
540-640  VIN decode via OpenAI GPT
647      log [PARALLEL] Finnik+VIN total
... res.json + cache.set
```

### Andere routes/functies in vehicle.js

```
11   router.post("/api/plate/validate", ...)
52   function toLOpts(c)
56   function toDOpts(c)
60   function serverSidecodeCandidates(raw)
95   function runSystemTesseract(imgPath)
105  async function preprocessPlate(base64Data)
130  router.post("/api/plate/scan", ...)
240  async function fetchFinnikData(plate)
312  router.get("/api/vehicle/enriched", ...)
768  router.get("/api/known-issues", ...)
```

### "Regel 550-625" plausibiliteit

In `vehicle.js` (899 regels): valt midden in VIN-decode block (510-640). Plausibel.
In `valuation.js` (1047 regels): valt rond `// ── VIN decode insights ──` (regel 552). Ook plausibel.
Welke van de twee — afhankelijk van context.

---

## 5. VIN-decoder module status

```
$ ls /opt/t4c/backend/lib/vin-decoder/
ls: cannot access '/opt/t4c/backend/lib/vin-decoder/': No such file or directory

$ find /opt/t4c -type d -name "vin-decoder" (excl. node_modules/ARCHIVE/RECOVERY)
(geen resultaat)
```

**Bevestigd**: `lib/vin-decoder/` bestaat niet in /opt/t4c.

SESSION-STATE bevestigt expliciet (regel 73): *"lokale VIN-decoder (/home/claude/vin-decoder/) bestond niet op /opt/t4c — Mogelijk plan uit web-Claude context dat hier nooit is uitgevoerd. NIET verder onderzoeken."*

**Lokale VIN-decode logica buiten GPT-call**: geen. Alle VIN-decoding gebeurt via OpenAI GPT call in `backend/routes/vehicle.js:540-640`. `backend/lib/intelligence.js` is een market scanner / source-scoring module, geen VIN-decoder.

---

## 6. Pricing engine status

**Bestand**: `backend/routes/valuation.js` — `router.post("/api/dealer/price", ...)` (regel 17)

### `_dataWeight`

```js
// regel 862-869 — comp-engine pad
let _dataWeight = 0.0
if (compResult && compResult.status === 'ok' && compResult.confidenceComparable >= 15 && compResult.marketMedian > 0) {
  const compVerkoop = Math.round(compResult.marketMedian * 0.93 / 50) * 50
  _dataWeight = Math.min(0.70, Math.max(0.20, compResult.confidenceComparable / 100 * 1.5))
  _blendedVerkoop = Math.round((compVerkoop * _dataWeight + aiVerkoop * (1 - _dataWeight)) / 50) * 50
}

// regel 872 — fallback-blend pad
if (!_useCompEngine) {
  _dataWeight = _filteredCount >= 15 ? 0.50 : _filteredCount >= 8 ? 0.35 : _filteredCount >= 3 ? 0.20 : 0.0
  ...
}
```

- Comp-engine cap: **0.70**
- Fallback-blend: 0.50 / 0.35 / 0.20 / 0.0 op basis van listing-count

### GPT model

```
backend/routes/valuation.js:791:          model: "gpt-5.4",
```

### Versie

- `git HEAD`: v10.18.61
- `backend/package.json`: 10.7.0
- SESSION-STATE.md beschrijft pricing-staat na v10.18.59 recovery
- Drift staat als open TODO sinds 15 mei

---

## 7. GT Motive — na 8 mei

```
$ grep -rn "gtmotive\|GT Motive\|gt_motive\|gt-motive" --include="*.js" --include="*.md" --include="*.json"
```

Resultaat (alleen doc-vermeldingen, GEEN code):

```
SESSION-STATE.md:76: 1. GT Motive integratie (prio 1) — vervangt VIN-GPT met deterministische decode + levert basis voor damage data. Meeting al gepland 8 mei.
SESSION-STATE.md:77: 2. Damage correction module — wacht op GT Motive basis-data.
SESSION-STATE.md:85: - Lokale VIN-decoder bouwen — RDW→commercieel mapping niet vrij beschikbaar; GT Motive is juiste route
CLAUDE.md:227: - VIN data integratie wacht op GT Motive output (8 mei 2026 meeting).
FULL-STATE-BACKUPS/2026-05-17-pre-recovery/SESSION-STATE.md:30..39  (identieke kopie)
FULL-STATE-BACKUPS/2026-05-17-pre-recovery/CLAUDE.md:227             (identieke kopie)
```

- **0 code-hits** in prod tree
- Geen GT Motive credentials in `.env`
- Geen API-client, geen module, geen integratie
- Geen vermelding van meeting-uitkomst (8 mei)
- Status: zelfde TODO als vóór 8 mei

---

## 8. Autotelex / telex-bid

```
$ grep -rni "autotelex\|telex" --include="*.js" --include="*.md" --include="*.json" --include="*.env" (excl. node_modules/ARCHIVE/RECOVERY)
(geen resultaat)
```

**0 hits** in /opt/t4c. Niet in code, niet in docs, niet in `.env`.

`.env` bevat wel andere VIN/data bronnen:

```
ANTHROPIC_API_KEY
CARFAX_API_KEY + CARFAX_API_URL
DV_WEBHOOK_PASS + DV_WEBHOOK_USER
FINNIK_API_KEY
OPENAI_API_KEY
VINACLES_API_KEY + VINACLES_API_URL
SMTP_*
JWT_SECRET
```

Geen autotelex/telex-bid sleutel. Geen documentatie van "blocked" status in dit project — als die staat ergens bestaat, is hij niet in deze repo vastgelegd.
