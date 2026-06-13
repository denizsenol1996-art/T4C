# Blend Restore Plan — 2026-05-22

Read-only onderzoek. Géén code-wijzigingen tijdens deze sessie. Doel:
bepalen wat nodig is om "filtered_blend" terug te krijgen op de huidige
(post-v10.20.0) data-baseline, en wat NIET hoeft omdat het er al staat.

Aansluitend op `PRODUCTION-AUDIT-2026-05-21.md`,
`DATA-FOUNDATION-AUDIT-2026-05-21.md`, `scraper-audit-2026-05-22.md`,
`verifications-2026-05-22.md`, en `SPRINT-v10.20.0-2026-05-22.md`.

---

## A. Status quo — waar staat de blend-code nu

### Belangrijke correctie op de probleem-stelling

De brief stelt: *"Sindsdien is de blend uitgezet wegens Mercedes E350 €201
parser-bug. Memory zegt: 'Data blend disabled. v11 blend engine frozen.'"*

**Dat is feitelijk niet (meer) waar in de huidige code.** De blend is op
**2026-05-17** weer aangezet in commit `2322be01` (v10.18.59 "Recovery: 5
nacht-11-12-mei patches teruggeplaatst"). De memory-note was correct op
het moment van schrijven, maar is sinds vijf dagen achterhaald.

### Locaties (actieve code, geen .bak)

| Bestand | Functie | Status |
|---|---|---|
| `backend/routes/valuation.js:880-933` | AI-FIRST blend (full taxatie pad) | **ACTIEF** |
| `backend/routes/valuation.js:1129-1437` | `POST /api/dealer/quick-price` endpoint | **GEEN blend — binair** |
| `backend/lib/comparable-engine/` | Comp-pool bouw + score | gebruikt door beide |
| `backend/lib/quick-price-expert.js` | OpenAI expert call + cache | gebruikt door quick-price |
| `backend/lib/trade-engine.js` | Retail → bid rekenslag | gebruikt door blend-pad |

Code-blok in valuation.js (regels 908-929):

```js
let _blendedVerkoop = aiVerkoop
if (_filteredVerkoop > 0 && _filteredCount >= 1) {
  let _dataWeight = 0.0
  let _useCompEngine = false
  if (compResult && compResult.status === 'ok'
      && compResult.confidenceComparable >= 15
      && compResult.marketMedian > 0) {
    _useCompEngine = true
    const compVerkoop = Math.round(compResult.marketMedian * 0.93 / 50) * 50
    _dataWeight = Math.min(0.70, Math.max(0.20,
                  compResult.confidenceComparable / 100 * 1.5))
    _blendedVerkoop = Math.round(
      (compVerkoop * _dataWeight + aiVerkoop * (1 - _dataWeight)) / 50) * 50
    console.log('[PRICING-COMP]', ...)            // ← actief, dynamic weight
  }
  if (!_useCompEngine) {
    _dataWeight = _filteredCount >= 15 ? 0.50
                : _filteredCount >= 8  ? 0.35
                : _filteredCount >= 3  ? 0.20
                : 0.0                              // ← RE-ENABLED v10.18.59
    _blendedVerkoop = Math.round(
      (_filteredVerkoop * _dataWeight + aiVerkoop * (1 - _dataWeight)) / 50) * 50
    console.log('[PRICING-BLEND]', ...)           // ← actief, statische weights
  } else { }
  console.log('[PRICING-GPT]', ...)               // ← orphan log (zie risico's)
  _auditDataWeight = _dataWeight
}
```

### Verificatie op live data

Path-distribution laatste 14 dagen via `taxaties.data_weight`:

```
data_weight | count
0.63        | 1
0.55        | 7
0.50        | 7
0.49        | 1
0.48        | 1
0.45        | 2
0.405       | 2
0.375       | 3
0.35        | 1
0.30        | 2
0.225       | 2
0.20        | 1
```

**32 AI-FIRST taxaties in 14 dagen, alle 32 met `data_weight > 0`.** De
blend vuurt feitelijk vrijwel altijd op de full-taxatie route. De comp-tak
wint vaker dan de fallback-tak (zichtbaar aan de 0.20-0.63 spreiding, wat
de comp-confidence-formule oplevert; de statische 0.50/0.35/0.20 fallback
wordt minder geraakt).

### Decommit-historie (chronologisch)

| Datum | Commit | Versie | Wat |
|---|---|---|---|
| 2026-03-25 13:29 | `36c90e5` | — | Blend disabled: DB prijzen vervuild (E350 = 201 ipv 7000+) |
| 2026-03-30 19:19 | `29f92f1` | v10.16.7 | Blend re-enabled: 50% bij 15+, 35% bij 8+, 20% bij 3+ |
| 2026-03-30 12:43 | `2f3082e5` | v10.16.1 | Comp-pad blend toegevoegd (dynamic dataWeight) |
| 2026-04-02 12:13 | `0da0107` | v10.18.50 | Blend opnieuw disabled (`_dataWeight = 0.0`): "ongefiltered km-data trok prijzen omhoog" |
| 2026-04-02 17:?? | `19b9a3d` | v10.18.51 | Fix-commit: pm2 cwd + memory bump, blend disable bevestigd |
| 2026-05-17 15:24 | `2322be01` | **v10.18.59** | **Blend RE-ENABLED**: km-range filter in SQL, confidence drempel 25→15, _dataWeight cap 0.40→0.70 |

### Andere wijzigingen die meeliftten

In `2322be01` (de re-enable) zaten:
- TITLE-FILTER safety bij over-filtering (junk-filter.js +225 regels)
- km-range filter in SQL comp query (op `valuation.js:889`-omgeving)
- Comp confidence drempel 25 → 15 (sneller comp-pad activeren)
- `_dataWeight` cap 0.40 → 0.70 (meer ruimte voor data)
- Fallback blend re-enabled (3+/8+/15+ thresholds)
- `junk-filter.js` MODEL-MATCH logica voor variant detection

Test-resultaat in commit-message: op 80 Jurgen feedback entries,
gem. abs delta €1174 → €1115 (5% beter), gem. signed delta +€720 →
+€481 (33% minder overshoot), binnen 10%: 24% → 29%, win/loss/tie 39/24/17.

---

## B. Trigger-analyse — was de parser-bug de oorzaak

### Bug verificatie in DB

Query op Mercedes E-klasse listings met `price BETWEEN 100 AND 999`:

```
source | suspect
src_b  | 27
src_c  | 25
src_g  | 22
src_a  | 12
src_d  | 1
total: 87
```

Verdeling per maand van eerste sighting:

```
2026-03 |  6
2026-04 | 80
2026-05 |  1
```

**Conclusie**: het patroon is gedaald van 80/maand (april) naar 1/maand
(mei). Bug-fix heeft gewerkt. Maar 87 historische rows zitten nog in DB.

Bij steekproef van de 87 rows: een mix van **echte oude wrakken**
(Mercedes 180/200/A140 uit 2000-2006 met 200k+ km @ €500) **en
duidelijke parser-corrupties**:

| Source | Title (truncated) | Year | km | Price | Diagnose |
|---|---|---|---|---|---|
| src_b | Mercedes-Benz E-Klasse 300e Luxury Line LEDER MEMORY... | 2020 | 128.295 | **€518** | parser-corrupt — 300e PHEV 2020 zou €30-45k zijn |
| src_b | Mercedes-Benz E-Klasse Estate E300e AMG SCHUIFDAK/360... | 2020 | 77.924 | **€519** | parser-corrupt |
| src_b | Mercedes-Benz E-Klasse Estate BWJ 2022 E200 211 PK Bu... | 2022 | 94.341 | **€531** | parser-corrupt |
| src_c | Mercedes-Benz A 140 L Avantgarde | 2000 | 153.500 | €500 | aannemelijk reëel |
| src_g | Mercedes-Benz C-klasse Sportcoupé 200 K. Bak schakelt niet g... | 2001 | 274.100 | €599 | aannemelijk reëel (kapot) |

→ ~30% van de 87 rows is vermoedelijk reëel, ~70% parser-corrupt. Alle
corrupte cases dateren uit april 2026 of eerder.

### Parser-fix in code

Huidige `parsePrice(t)` in `helpers.js:39-56`:

```js
function parsePrice(t) {
  if (!t) return 0
  const s = String(t).trim()
  if (/p\/m|per\s*maand|lease|aanbetaling|vanaf|bieden|op\s*aanvraag|n\.?o\.?t\.?k|verkocht|gereserveerd/i.test(s)) return 0
  let c = s.replace(/[€$EUR\s]/ig, '')
  c = c.replace(/\./g, '')        // 8.950 → 8950   ← NL thousand-dot
  c = c.replace(/,-$/, '')        // 8950,-  → 8950
  c = c.replace(/,(\d{2})$/, '')  // 8950,00 → 8950 ← NL decimal-comma
  c = c.replace(/,/g, '')
  const m = c.match(/\d{3,6}/)
  if (!m) return 0
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE ? n : 0
}
```

**Dutch number format wordt expliciet ge-handeld**:
- "€ 23.995" → strip currency → "23.995" → replace `.` → "23995" → 23995 ✓
- "€ 23.995,-" → "23995,-" → ",-$" strip → "23995" ✓
- "€ 23.995,00" → "23995,00" → ",(\d{2})$" strip → "23995" ✓
- "Bieden vanaf €5.000" → REJECTED door regex op `vanaf|bieden` ✓

Per-platform scrapers gebruiken óf `parsePrice()` direct (Method 2,
generic), óf `text().replace(/[^\d]/g, '')` met `parseInt(..., 10)`
(AS24, Marktplaats specifiek) — beide methoden zijn robust tegen Dutch
format.

`MIN_PRICE` zit niet in deze regex maar wordt in `upsertListing`
(`db.js:953`) afgedwongen op €500. Dat verklaart waarom 0 rows < €500
in DB.

### Git-archeologie van de parser

`parsePrice()` is geïntroduceerd toen `helpers.js` werd opgesplitst uit de
oude monolitische server.js (commit `c02ef16c` Sessie 5, 2026-03-23). De
v10.16.5 commit `bfe81b4` ("revert andere chat rommel, restore werkende
pricing, E350=5100-5650, A180=6550-7300, Qashqai=2950-3300") op
2026-03-26 noemt expliciet E350 = €5100-5650 als reference-target —
**direct na de parser-bug periode**. Dat suggereert dat de parser tussen
2026-03-25 (bug visible) en 2026-03-26 (E350 weer correct) is gefixt.
De huidige `parsePrice()` versie is sindsdien stabiel.

### Komt de bug terug?

**Nee, niet in nieuwe data.** Parser is robust. Maar drie subtiele risico's:

1. **Schaalbescherming missing**: bij prijs > MAX_PRICE wordt 0
   geretourneerd. Bij price < MIN_PRICE (= 500) idem. Dat is correct,
   maar betekent dat ALS een toekomstige bron prijs in een vreemd
   formaat geeft (bv. een lease-bedrag van €99 met `vanaf`-keyword fail),
   de listing silently gerejecteerd wordt zonder log.
2. **Historische vervuiling blijft**: de ~60 parser-corrupte E-klasse
   rows uit april zitten nog in DB. Bij blend-activatie zou comp-engine
   die kunnen oppikken als legitieme data. Mitigatie: comp-engine
   gebruikt nu een title-vs-model filter (valuation.js:885-902 +
   v10.18.59 junk-filter MODEL-MATCH); en de outlier-filter zou een
   €518 listing voor een 2020 E-klasse moeten droppen omdat ie buiten
   IQR valt. Niet getest live.
3. **Source-specifieke parsers**: src_c heeft de meeste corrupties
   (25/87). Per scraper-audit gebruikt src_c hetzelfde codepad als
   src_a (`extractListings` AS24-branch). De corrupties zijn dus
   waarschijnlijk **upstream** (AS24.be HTML-structuur ondersteunt
   minder, of dealers gebruiken atypische prijs-notatie). Vergt aparte
   investigatie.

---

## C. Code-delta sinds april (v10.17.4 → HEAD)

### Diff-statistieken

```
4 files changed, 706 insertions(+), 41 deletions(-)

backend/routes/valuation.js                        | 481 ++++++++ |
backend/lib/comparable-engine/junk-filter.js       | 225 +++++++   |
backend/lib/comparable-engine/score-comparable.js  |  34 +-       |
backend/lib/comparable-engine/index.js             |   7 +-       |
```

`trade-engine.js`: 0 wijzigingen sinds v10.17.4. Stabiel.

### Nieuwe functies in valuation.js

- `matchBodAdjustment(vehicle)` — past `bod-adjustments.json` rules toe
  (v10.18.69 multipliers + v10.20.0 19 rules)
- `deriveDataConfidence(compResult, marketCount)` — bouwt structured
  reasons-array voor confidence ("low_comp_count", "comp_engine_x")
- `POST /api/dealer/quick-price` endpoint — **nieuwe routing**, bestond
  niet in v10.17.4

### Comp-engine wijzigingen

- `junk-filter.js`: +225 regels (van ~50 naar ~275). v10.18.59
  MODEL-MATCH variant detection toegevoegd
- `score-comparable.js`: -34 regels netto (filter-strictheid licht
  versoepeld, v10.19.1 fix)
- `index.js`: 7 regels (interface tweaks)

### Verandering in prijs-beslissing

**v10.17.4-era** (april baseline):
- `/api/dealer/price` (full taxatie) was de enige route
- Blend zat in deze route
- "v11" blend engine = de combinatie van comp-engine + AI-FIRST + blend

**HEAD**:
- `/api/dealer/price` blijft (met blend, actief)
- `/api/dealer/quick-price` NIEUW: binaire keten, géén blend
- `quick-price-expert.js` NIEUW: separate OpenAI call met staat/rijdt context
- `bod-adjustments.json` NIEUW: 19 mult-rules
- Daarmee is "v11 blend engine" feitelijk nog steeds aanwezig — alleen
  het verkeer is verschoven van /price naar /quick-price (sneller,
  expert-cached, geen blend).

### Decision tree quick-price (huidige binair-pad, valuation.js:1273-1370)

```
priceSource = "comp"                                       ← start
  ↓
IF thinPool && expertEstimate                              ← cleanCount<3 OR comp_status!=ok
  priceSource = "expert_fallback"                          (48% van calls)
  ↓
IF priceSource=="comp" && delta_pct>50 && expertEstimate
  priceSource = "expert_override"                          (5%)
  ↓
IF isProblematicInput && expertEstimate                    ← SLECHT/DEFECT/NEE
  priceSource = "expert_user_context"                      (10%)
  ↓
IF bodFinal==null && !expertEstimate
  priceSource = "degraded_formula"                         (<1%)
```

**Waar HOORT 'filtered_blend' te zitten**: tussen stap 1 en stap 2.
Wanneer comp `ok` is EN cleanCount >= 3 EN expertEstimate beschikbaar
is, blend de twee in plaats van pure comp te kiezen. Dat zou de
expert_fallback share laten dalen (want ook bij thin pools >= 3
clean comps levert blend signal) en de comp-share aanvullen met
expert-correctie.

---

## D. Huidige baseline (post-v10.20.0)

### Pool-grootte verbetering

| Metric | v10.18 pre-sprint | post-v10.19.0 | post-v10.20.0 |
|---|---|---|---|
| SEAT Altea 2004-2008 pool | 13 | 106 | 106+ |
| BMW 3-serie 2015-2019 pool | 171 | 1.104 | 1.104+ |
| VW Passat 2013-2017 pool | 150 | 255 | 255+ |
| Comp-path % | 19% | 29% | 31% (laatste 7d) |
| URL coverage nieuwe rows | 0% | 0% | **100%** |
| first_price/last_price | 0% | 0% | **100% nieuw** |
| kenteken | n.v.t. | n.v.t. | scraper geactiveerd |
| Schema | 28 col | 28 col | 29 col |

### Write-leaks status

- `url` capture: live, alle 6 active src_a/b/c/d/e/f/g/h bronnen
  schrijven URL bij INSERT
- `first_price/last_price`: gevuld bij INSERT, geüpdatet door FLYWHEEL
  bij prijsverandering >50
- `price_changes`: COALESCE(0)+1 bij elke geobserveerde drift
- `kenteken`: kolom bestaat, scraper-pad geactiveerd; coverage groeit
  langzaam vanwege src_g detail-rate-limit (max 5 per model)
- Backfill 239k bestaande rows: NIET gedaan (per spec)

### Wat is "april + better" exact

**April baseline**: ~100-300 listings per (make,model,year)-bucket in
comp-pool, blend werkte op _filteredCount-thresholds van 3/8/15.

**Nu**:
- Pool-data ~3-7× groter voor populaire buckets (normalizer-effect)
- URL beschikbaar (per nieuwe row sinds vandaag — historisch
  blijft leeg)
- first_price/last_price beschikbaar (idem)
- Expert-route met staat/rijdt context naast comp (nieuw sinds april)
- 19 bod-adjustment rules ipv 0 (nieuw sinds april)
- Health monitoring endpoint (`/api/admin/expert-health`)
- Listing-normalizer maakt comp-pool model-zuiver (was vóór april niet
  gefilterd)

**Wat NOG hetzelfde is als april**: trade-engine.js (0 wijzigingen),
parsePrice() (stabiel sinds v10.16.5), de blend-formule zelf (regel 919:
`(compVerkoop * weight + aiVerkoop * (1-weight))`).

---

## E. Restore-plan voorstel

### Inzicht-zin

De blend hoeft **niet hersteld** te worden — hij draait al, op de
full-taxatie route met goede data-weights (0.20-0.63 distribution).
Het probleem is dat de **quick-price endpoint binair is** en geen
blend tussen comp en expert-output kent. De 48% expert_fallback komt
daarvandaan.

Het restore-plan is dus eigenlijk een **uitbreidings-plan**: blend in
het quick-price pad introduceren, met de full-taxatie blend als
referentie-implementatie.

### Stap 1 — Shadow-mode logging (geen UI-impact)

**Doel**: blend-output BEREKENEN en LOGGEN voor elke quick-price call,
zonder `bodFinal` te wijzigen. Vergelijk over N calls vóór switch.

**Wijzigingen in `valuation.js` quick-price endpoint** (regel 1273-1370):

Direct na `let priceSource = "comp"` (regel 1273):

```js
// SHADOW: bereken blend-bod NAAST huidige bod (logging only)
let _shadowBlendBod = null
let _shadowBlendSource = null
if (compResult && compResult.status === 'ok' && cleanCount >= 3
    && expertEstimate && expertEstimate.bod_low > 0) {
  const compBodMid = Math.round(
    (compResult.marketMedian * 0.93 * hwRatio) / 50) * 50  // retail→handel
  const expertBodMid = Math.round(
    (expertEstimate.bod_low + expertEstimate.bod_high) / 2 / 50) * 50
  const _w = Math.min(0.70, Math.max(0.20,
             (compResult.confidenceComparable || 50) / 100 * 1.5))
  _shadowBlendBod = Math.round(
    (compBodMid * _w + expertBodMid * (1 - _w)) / 50) * 50
  _shadowBlendSource = 'shadow_blend'
}

console.log('[SHADOW-BLEND]', d.make, d.model, ':',
  'currentBod=' + bodFinal, 'shadowBod=' + _shadowBlendBod,
  'currentSource=' + priceSource, 'cleanCount=' + cleanCount,
  'expertBod=' + (expertEstimate ? expertEstimate.bod_low + '-' + expertEstimate.bod_high : 'none'))
```

En kolom `shadow_bod` en `shadow_source` toevoegen aan `taxaties` via
ml_migration. Voor analyse: `SELECT AVG(ABS(shadow_bod - final_bod)),
AVG(shadow_bod - final_bod) FROM taxaties WHERE created_at > ...`.

**Risico's stap 1**:
- Geen, UI wordt niet aangeraakt
- Extra log-lijn per call (1-2 KB per call, negligible)
- Twee extra DB-kolommen (idempotent ALTER)

**Acceptatie-criteria**: na 100+ quick-price calls, analyseer:
- Gemiddelde `|shadowBod − finalBod|` < €500
- Mediaan shadowBod ligt tussen huidige finalBod en expert mid-range
- Geen outliers >25% delta tov calibratie-targets

### Stap 2 — Calibratie tegen 6 reference-cases

**Doel**: voordat shadow naar productie switcht, testen dat shadow
op de 6 calibratie-targets binnen acceptabele range zit.

Calibratie-targets (uit memory):
- BMW 535i F11 289k km → €5.500–5.800
- Mercedes E350 CGI 269k → €4.700–5.350
- Aygo 150k → €2.350–2.600
- Audi A3 200k → €2.150–2.400
- Seat Leon 288k → €1.150–1.300
- MG ZS EV 25k → €7.000

**Methode**: nadat shadow live is, zoek deze cases in `taxaties` op
(`make + model + km` match), of forceer een test-call met deze specs.

**Acceptatie**: shadowBod valt voor minstens 4 van de 6 targets
binnen target-range. Anders: dataWeight-formule tunen.

**Risico's stap 2**:
- Geen blocker voor productie — alleen voor stap 3
- Mogelijk noodzaak om `confidenceComparable / 100 * 1.5` (in formule)
  te calibreren per make/model — fragile

### Stap 3 — Switch quick-price naar blend-output

**Doel**: vervang in quick-price de comp-vs-expert binair-keuze door
blend (met fallback bij thin pool naar expert_fallback).

**Wijziging in valuation.js:1273-1290**:

```js
// OUDE: priceSource = "comp"; if (thinPool && expert) priceSource = "expert_fallback"
// NIEUWE:
let priceSource = "expert_fallback"  // default als thin pool
if (compResult && compResult.status === 'ok' && cleanCount >= 3) {
  if (expertEstimate && expertEstimate.bod_low > 0) {
    // BLEND
    const compBodMid = Math.round((compResult.marketMedian * 0.93 * hwRatio) / 50) * 50
    const expertBodMid = Math.round((expertEstimate.bod_low + expertEstimate.bod_high) / 2 / 50) * 50
    const _w = Math.min(0.70, Math.max(0.20, (compResult.confidenceComparable || 50) / 100 * 1.5))
    bodFinal = Math.round((compBodMid * _w + expertBodMid * (1 - _w)) / 50) * 50
    priceSource = 'filtered_blend'
  } else {
    // Comp-only (expert niet beschikbaar)
    bodFinal = Math.round(compResult.marketMedian * 0.93 * hwRatio / 50) * 50
    priceSource = 'comp'
  }
}
// thin pool blijft expert_fallback flow zoals nu
```

**Risico's stap 3**:
- **Hot path**: dit is de live productie-routering, dus regression
  zichtbaar voor dealers. Mitigatie: deploy in lage-traffic window,
  monitor `[SHADOW-BLEND]` logs nog 24u voor verificatie.
- **expert_override** en **expert_user_context** takken blijven
  ongewijzigd (regel 1310-1340) — die overschrijven blend bij grote
  delta of bij SLECHT/DEFECT input. Goed zo.
- **hwRatio** in formule: moet betrouwbaar zijn (waarschijnlijk uit
  bod-adjustments). Test eerst op één case dat trade-engine.js dezelfde
  ratio zou produceren.
- **Cache invalidation**: quick-price-expert.js heeft LRU cache. Bij
  switch worden nieuwe shadow-blend bodes uitgerekend maar expert
  blijft cached. Geen invalidatie nodig — expert is stabiel signaal.

### Stap 4 — Audit-trail consolidatie

Verwijder of marker de `[PRICING-GPT]` orphan-log op valuation.js:927
(staat buiten if/else braces). Cosmetic.

Add `price_source` enum 'filtered_blend' aan documentatie en
admin-dashboard `pricing-stats` endpoint.

### Volgorde + estimated effort

| Stap | Wijzigingen | Tijd | Reversibel |
|---|---|---|---|
| 1. Shadow-mode logging + 2 kolommen | ~30 regels valuation.js, ml_migration | 1u | ja, comment out |
| 2. Calibratie analyse | DB queries, geen code | 1u | n.v.t. |
| 3. Switch naar blend in productie | ~25 regels valuation.js | 30min | ja, revert commit |
| 4. Cleanup orphan log + docs | 5 regels | 15min | trivial |

### Calibratie-targets als acceptatie-criteria

Switch stap 3 mag pas als shadow-mode (stap 1, na 100+ calls) toont:
- Voor minstens 4 van 6 cases: `shadow_bod` ligt binnen target-range
- Gemiddelde absolute delta naar huidige `final_bod` < €500
- Geen case waar shadow >30% lager of >50% hoger uitkomt dan target

---

## F. Wat NIET in dit plan zit (en waarom)

### Buiten scope huidige restore

1. **Backfill van 87 corrupte Mercedes E-klasse rows** — tijdelijke
   junk-filter MODEL-MATCH catched de meeste; full cleanup is een aparte
   data-hygiene sprint. Niet nodig voor blend-werking.
2. **src_c parser audit** (25 van 87 corrupties vandaan) — zit
   waarschijnlijk in HTML-structuur van AS24.be, niet in onze code.
   Aparte investigatie.
3. **Quick-price-expert cache-strategy tuning** — cache hit-rate is
   bekend (via `/api/admin/expert-health`) maar TTL/size niet
   geoptimaliseerd voor blend-traffic. Pas relevant als stap 3 live
   is en cache-miss-pattern verandert.
4. **nlmarket URL + nlretail Vehicle JSON-LD upgrade** — gepland v10.20.1
   uit eerder sprint-rapport. Onafhankelijk van blend-werk.
5. **PRICING-GPT orphan log** — cosmetic, geen impact op werking.
6. **Banner-versie `T4C Platform v10.16.0` in startup** — cosmetic,
   package.json is leidend.
7. **data_weight=0 edge case in DB** — geen rows in 14 dagen, blend
   firet altijd. Niet nodig om te verifiëren.
8. **Refactor decision tree quick-price** — de 4 if/elseif/elseif/elseif
   met overlap-conditions is fragile maar werkt. Refactor pas na blend
   live.

### Aanbevelingen voor v10.20.2+

1. **Per-make/model dataWeight calibratie**: huidige formule
   `confidenceComparable / 100 * 1.5` is uniform. Mogelijk per
   high-impact make (BMW, Mercedes, Audi) een aparte gain-factor wegens
   premium-prijsspreiding. Vergt 50-100 feedback entries per make.
2. **Confidence breakdown in audit-trail**: log per quick-price call
   waarom dataWeight 0.5 vs 0.3 was, om Jurgen-feedback te kunnen koppelen
   aan blend-strategie.
3. **A/B in shadow-mode**: variant 1 = compMedian, variant 2 =
   compMedian × 0.93 (retail→deal correctie), variant 3 = expert-only.
   Welke variant ligt het dichtst bij Jurgen's accepted prijs?
4. **Decision-tree visualizer** in `/api/admin/pricing-stats`: zichtbaar
   maken welk pad welke prijs gaf voor laatste N taxaties.
5. **Auto-disable mechanism**: als shadow-mode toont dat `|shadow_bod -
   final_bod| > €1500` voor meer dan 10% van calls in een rolling 24h
   window, autopause shadow→live promotion. Veiligheidsnet.

---

## Bijlage — Stap 3 deploy + toggle-procedure (2026-05-22)

Gate-logica `v10.20.2-dev` (commit `aa62309`) is gedeployd op
`/api/dealer/quick-price`. **Default OFF** — pure no-op tot expliciete
enable. Code-locatie: `valuation.js:1387-1403` (na shadow-calc, vóór save).

### Toggle aan

```bash
# 1. Voeg flag toe aan .env (idempotent: of zet bestaande regel om naar =1)
echo 'BLEND_GATE_ENABLED=1' >> /opt/t4c/backend/.env

# 2. Restart pm2 met env-refresh
pm2 restart t4c-server --update-env

# 3. Smoke-verify: comp-eligible call moet priceSource='comp_blend' geven
curl -sS -X POST http://localhost:3000/api/dealer/quick-price \
  -H 'Content-Type: application/json' \
  -d '{"kenteken":"2ZRS37","km":200000,"staat":"GOED","rijdt":"JA"}' \
  | python3 -m json.tool | grep -E 'bod|priceSource'
# Expect: priceSource: comp_blend  bod: <shadow_bod>

# 4. Bevestig in logs
pm2 logs t4c-server --lines 50 --nostream | grep BLEND-PROMOTE
```

### Toggle uit (rollback)

```bash
# Snelste: verwijder de regel
sed -i '/^BLEND_GATE_ENABLED=/d' /opt/t4c/backend/.env

# Of expliciet uit
sed -i 's/^BLEND_GATE_ENABLED=1$/BLEND_GATE_ENABLED=0/' /opt/t4c/backend/.env

# Restart
pm2 restart t4c-server --update-env
```

Geen DB-rollback nodig — gate is pure code-side. `shadow_bod` blijft
geschreven worden ongeacht flag-stand (forward-shadow blijft draaien).

### Gate-condities (recap)

Promote vuurt alleen wanneer **alle** 5 condities matchen:

```
process.env.BLEND_GATE_ENABLED === "1"  ← master flag
priceSource === "comp"                  ← alleen comp-pad
!isProblematicInput                     ← geen SLECHT/DEFECT/NEE
bodFinal >= 1000                        ← excl <€1k band (shadow oversoot +€908)
_shadowBlendBod !== null                ← defensive: shadow had to fire
```

Bij niet-match valt het systeem terug op de pre-stap-3 binaire keuze
(comp / expert_fallback / expert_override / expert_user_context /
degraded_formula). Géén regression mogelijk voor non-eligible cases.

### Monitor-queries

```sql
-- Distributie van comp_blend vs comp sinds toggle
SELECT price_source, COUNT(*) AS n,
       ROUND(AVG(final_bod),0) AS avg_bod,
       ROUND(AVG(shadow_bod),0) AS avg_shadow
  FROM taxaties
 WHERE created_at > datetime('now','-24 hours')
   AND price_source IN ('comp','comp_blend')
 GROUP BY price_source;

-- Delta tussen wat blend deed en wat comp zou hebben gegeven
-- (final_bod = blend; bod_voor_blend = niet apart opgeslagen, gebruik
-- handelswaarde × 0.90 × bod_adjustment_factor als proxy)
SELECT kenteken, make, model, comp_count, final_bod,
       ROUND(handelswaarde * 0.90 * COALESCE(bod_adjustment_factor,1.0)/50)*50
         AS would_be_comp_bod,
       final_bod - ROUND(handelswaarde*0.90*COALESCE(bod_adjustment_factor,1.0)/50)*50
         AS blend_delta
  FROM taxaties
 WHERE price_source = 'comp_blend'
   AND created_at > datetime('now','-24 hours')
 ORDER BY ABS(blend_delta) DESC LIMIT 20;
```

### Stop-criteria — wanneer flag terug uit

Toggle UIT als:
- Klacht van Jurgen / dealer over een specifieke `comp_blend` bod
- `AVG(ABS(blend_delta)) > 500` over rolling 24h window
- Meer dan 10% van comp_blend calls heeft `blend_delta > 1500` (single case big swing)

---

## Bijlage — proxy_weight bucket-mapping (shadow_backfill, 2026-05-22)

Live shadow-code (`valuation.js:1369-1383`) berekent weight via:

```js
weight = clamp(0.20..0.70, (compResult.confidenceComparable || 50) / 100 * 1.5)
```

`confidenceComparable` wordt door comp-engine per-call berekend en is
**niet opgeslagen** in `taxaties`. Voor de retroactieve backfill van de
22 historische eligible rijen (`shadow_source='shadow_backfill'`,
commit afgeleid uit `scripts/shadow-backfill-2026-05-22.js`) gebruiken
we een proxy via `comp_count`:

| comp_count | proxy weight | benadering confidence | rationale |
|---|---|---|---|
| `>= 30` | **0.55** | ~37/100 | Veel comps → hoge betrouwbaarheid, blend leunt op data |
| `15-29` | **0.50** | ~33/100 | Mediaan-bucket, gelijk aan oude fallback-blend 15+ regel |
| `8-14` | **0.35** | ~23/100 | Identiek aan oude fallback-blend 8+ regel |
| `3-7`  | **0.20** | ~13/100 | Clamp-floor; identiek aan live-formule lower bound |

De buckets corresponderen met de fallback-blend thresholds uit v10.16.7
(`_filteredCount >= 15 ? 0.50 : >= 8 ? 0.35 : >= 3 ? 0.20`). De extra
`>= 30 → 0.55` bucket reflecteert de hogere cap (0.70) uit v10.18.59.

**Verwachte afwijking vs echte live shadow**: weight-delta van 0.05-0.10
in plaats van een continue functie. Dat vertaalt zich naar ~€50-150
verschil in `shadow_bod` per case. Voor backtest-aggregaten acceptabel.

**Marker-onderscheid in analyse**:
- `shadow_source='shadow_blend'` → live forward-shadow (v10.20.1-dev, per
  call sinds 2026-05-22)
- `shadow_source='shadow_backfill'` → retroactief via SQL UPDATE (22 rijen,
  alleen historie 2026-04-25 t/m 2026-05-21)

Voor stap 2-3 calibratie zou je beide kunnen mengen of expliciet
filteren — backfill heeft de hierboven beschreven proxy-bias, live heeft
de echte continue weight.

---

## Conclusie (zin per zin)

1. Blend is **niet uit** — sinds 2026-05-17 actief op AI-FIRST pad.
2. Memory-note "v11 blend frozen" is verouderd; current code is
   v10.18.59+ recovery van die freeze.
3. De 48% expert_fallback komt van quick-price endpoint dat geen
   blend kent — niet van een uitgeschakelde blend.
4. Parser-bug (E350=201) is gefixt; 87 historische artefact-rows zitten
   nog in DB (mei: 1, dalend).
5. Restore-plan is een **uitbreidings-plan**: blend naar quick-price
   brengen, met shadow-mode log eerst (stap 1-2 risk-free), dan switch
   (stap 3 reversible) na calibratie-acceptatie op 6 reference-cases.
6. Trade-engine.js: ongewijzigd sinds april — geen werk daar.
7. Data-baseline post-v10.20.0 is "april + better": pools 3-7× groter,
   write-leaks dicht, normalizer 90% match.
