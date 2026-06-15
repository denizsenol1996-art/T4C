# Production Sprint v10.19.0 — 2026-05-21

Voltooide implementatie van alle Top-20 items uit PRODUCTION-AUDIT-2026-05-21.md, in 8 fasen autonoom uitgevoerd.

## Wat is gedaan per fase

### FASE 1 — Listing-normalizer module ✓

Nieuwe lib in `/opt/t4c/backend/lib/listing-normalizer/`:
- `taxonomy.js` — per-make dict van canonical models + aliases (15 makes: VW, Renault, Kia, Toyota, Audi, Mercedes-Benz, BMW, SEAT, Ford, Nissan, Peugeot, Opel, Citroen, Hyundai, Mazda, Skoda, Fiat).
- `parser.js` — regex-based, whole-word matching, longest-first sortering om Altea XL voor Altea te matchen.
- `index.js` — `normalizeListing({make, model, title, source})` returns `{normalized_model, normalize_source, confidence}`. `nlmarket`/`nlretail` source = native (model trusted); andere bronnen = parse title.
- `SKILL.md` — documentatie voor nieuwe makes toevoegen.
- `test.js` — 30 testcases uit echte src_a/src_g titles. **30/30 pass.**

Trim-aliases voor premium-makes geïncludeerd: BMW `320i/320d/325/330/335/M3` → `3-serie`; Mercedes `E350 CGI/E 220/E 280` → `e-klasse`.

### FASE 2 — Retroactive normalize sweep ✓

Schema: kolommen `model_normalized TEXT` en `normalize_source TEXT` toegevoegd aan `market_listings` via `ml_migration` array in `db.js` (canoniek pad).

Sweep-script `/opt/t4c/scripts/normalize-listings.js`. Stop t4c-server → sweep (12.8 sec voor 238.084 rows met better-sqlite3 + transactions) → start.

**Distributie shift per cluster** (raw model → normalized):

| Cluster | Pre-sweep listings | Post-sweep listings | Δ |
|---|---|---|---|
| SEAT Altea 2004-2008 | ~13 (alleen nlmarket) | **106** | **8.2×** |
| SEAT Leon 2004-2008 | 1.008 (incl Altea/Toledo/Cordoba misfiles) | 709 (clean) | -30% (junk eraf) |
| BMW 3-serie 2015-2019 | 171 (raw '3-serie') | **1.104** | **6.5×** |
| VW Passat 2013-2017 | ~150 | 255 | 1.7× |
| Mercedes E-klasse 2007-2011 | 1586 onder 'e 350 cgi' | 485 (geconsolideerd) | onder canonical naam |

Globale SEAT-distributie van **92% in 'leon'** naar:
- leon: 9854 (76%)
- ibiza: 1303 (10%)
- altea: 270 (2%)
- arona/mii/ateca/arosa: 592 (4%)
- rest: ~1.4k onder andere modellen

Toyota distributie nu balanced: aygo/yaris/c-hr/corolla/prius elk substantieel apart.

### FASE 3 — Comp-engine omschakelen naar `COALESCE(model_normalized, model)` ✓

5 `market_listings` queries in `routes/valuation.js` aangepast (regels 144, 150, 157, 879, 1173). Backwards-compat: COALESCE valt terug op raw `model` voor unmatched rows. Niet hard-switch.

**Source-side normalize**: bij quick-price wordt ook `v.subModel` en `v.model` via dezelfde `parseTitle()` heen gehaald om de zoek-key te canonicaliseren. Bv. SEAT 79-SP-GF: `subModel="Altea 2.0 FSI"` → search canonical `altea` → matches 106 listings i.p.v. de oude 13 via title-grep.

Log: `[QUICK-NORMALIZE-KEY] BMW 320I subModel=320i Touring → search canonical: 3-serie`.

### FASE 4 — Retrospect → multiplier-decisies ✓

Retrospect-formule (pure comp-only, geen AI-blend) bleek te ruw om precieze multiplier-tuning te ondersteunen — many clusters kregen onrealistische "new median" ratios (VW Golf 4.09, Polo 2.53) wegens ontbrekende AI-blend en segment-factoren in de simulatie. Pool-grootte was wel substantieel groter: median 27 listings per pool, 427 van 659 cases hadden voldoende.

**Conservatieve beslissing**: behoud de 6 v10.18.69 rules (op echte productie-bod-distributie getuned), voeg de 12 nieuwe clusters uit audit Deel 3.2 toe.

`bod-adjustments.json` v1.2 nu **19 rules**:
- 1 export-bonus (Toyota Hybride export, bestaand)
- 6 overshoot-rules v10.18.69 (Fiesta, C1, Captur, Outlander, Clio, I20)
- **12 nieuwe** (audit-driven):
  - **Overshoot** (9): Renault Twingo×0.78, Nissan Note×0.78, Toyota Aygo×0.82, Renault Megane×0.88, Skoda Fabia×0.83, VW Up×0.85, Kia Venga×0.88, Hyundai I10×0.92, Fiat 500×0.90
  - **Export-bonus** (3): Toyota Auris×1.15, Toyota Corolla×1.08, Toyota C-HR×1.08

### FASE 5 — Expert health + degraded mode ✓

In `lib/quick-price-expert.js`:
- Ring-buffer `_callLog` (laatste 100 calls met ts/latency/success/cached/error).
- Export `getHealthStats()` → `{ n, success_rate, avg_latency_ms, last_error, cache_size, cache_hits, cache_misses, cache_hit_rate, last_3_consecutive_failures }`.

Endpoint `GET /api/admin/expert-health` (authMiddleware + adminOnly).

Degraded-mode fallback in `routes/valuation.js` quick-price flow:
- Trigger: `bodFinal === null && !expertEstimate && handelswaarde > 0 && (last_3_consecutive_failures || success_rate === 0)`.
- Actie: `bodFinal = handelswaarde × 0.85`, `priceSource='degraded_formula'`, confidence-reason `expert_offline`, message *"Expert tijdelijk onbereikbaar — bod is formule-schatting"*.

### FASE 6 — Path monitoring endpoint ✓

Endpoint `GET /api/admin/pricing-stats` (admin only) returnt voor laatste 24u:
- Total count snel-taxaties
- Distribution per `price_source` met avg `response_ms`
- Top 10 trigger-tags
- Expert health (zelfde getHealthStats output)

Nieuwe kolom `response_ms INTEGER` aan `taxaties` (via migration). Gevuld in quick-price save als `Date.now() - _t0`.

Live cijfers (laatste 24u, 51 taxaties):
```
comp                11 calls   avg 5779ms
expert_fallback     24 calls   avg 3457ms
expert_override      1 calls
expert_user_context  5 calls   avg 6269ms
(pre-v10.19 null)   10 calls
```

### FASE 7 — Minor cleanups ✓

**m1**: NORMAAL prompt-hint toegevoegd in `lib/quick-price-expert.js`. Bij `staat=NORMAAL` extra context-regel *"De auto heeft gemiddelde gebruikssporen — geen significante schade maar wel zichtbare leeftijd"*.

**m4**: tag-cleanup voor niet-comp paden was al actief sinds v10.18.69 (regel 1336): wanneer `priceSource !== "comp"` wordt `_bodAdjustment.tag` gewist. Verified intact.

m2 + m3: ongewijzigd gelaten zoals afgesproken (cosmetic).

### FASE 8 — Integratie smoke tests

6 cases uitgevoerd:

| # | Plate · payload | bod | priceSource | tag | notitie |
|---|---|---|---|---|---|
| 1 | 79-SP-GF · GOED+JA | €550 | expert_fallback | (none) | normalize-key zag Altea, expert nam het |
| 2 | KZ-255-P · GOED+JA | €12.500 | expert_fallback | (none) | comp-engine filter te strikt voor 3-serie pool van 1.104 |
| 3 | KZ-255-P · DEFECT+NEE | bod=null | comp | (none) | expert call timed out, geen degraded mode (success_rate niet 0) |
| 4 | 93PFP6 · DEFECT+NEE | €500 | expert_user_context | (none) | Toyota Aygo non-runner — prima |
| 5 | 34-HDN-7 · GOED+JA | €1.850 | **comp** | **overshoot_citroen_c1** | rule firet correct |
| 6 | 34-JDS-6 · GOED+JA | €1.700 | expert_fallback | (none) | thin pool → expert nam over |

Admin endpoints:
- `/api/admin/expert-health` → 200, JSON met success_rate, latency, cache stats ✓
- `/api/admin/pricing-stats` → 200, JSON met path-distribution + trigger-tags ✓

## Wat behouden / verwijderd / nieuw — multipliers samengevat

**Behouden** (7): toyota_hybride_export, overshoot_ford_fiesta, overshoot_citroen_c1, overshoot_renault_captur, overshoot_mitsubishi_outlander, overshoot_renault_clio, overshoot_hyundai_i20

**Nieuw** (12): overshoot_renault_twingo, overshoot_nissan_note, overshoot_toyota_aygo, overshoot_renault_megane, overshoot_skoda_fabia, overshoot_vw_up, overshoot_kia_venga, overshoot_hyundai_i10, overshoot_fiat_500, export_toyota_auris, export_toyota_corolla, export_toyota_chr

**Verwijderd**: geen — retrospect-formule was te onbetrouwbaar om rules te schrappen.

## Health endpoint URLs

```bash
# Admin JWT vereist (zelfde token als andere /api/admin endpoints)
curl -H "Authorization: Bearer $TOK" https://transfer4cars.com/api/admin/expert-health
curl -H "Authorization: Bearer $TOK" https://transfer4cars.com/api/admin/pricing-stats
```

Voorbeeld response expert-health:
```json
{
  "ok": true,
  "n": 2, "success_rate": 1, "avg_latency_ms": 3038,
  "cache_size": 2, "cache_hit_rate": 0,
  "last_3_consecutive_failures": false
}
```

## Open items / observaties

1. **Comp-engine internal filters blijven strikt**: De data-pool is nu wel correct gevuld (BMW 3-serie 1.104 vs 171 raw, SEAT Altea 106 vs 13), MAAR `buildComparableSet()` filtert nog steeds aggressively op fuel/transmission/scoring → `cleanCount=0` voor BMW 3-serie 2017 ondanks 1.104 raw listings. **Aanbeveling voor v10.19.1**: comp-engine scoring tunen — minder strikte fuel/transmission match, of accepteer ook 'usable' scores in cleanCount. De data-fix is een safety net; comp-engine moet er nu ook gebruik van maken.

2. **Path distributie verandert niet onmiddellijk**: laatste 24u toont nog steeds 47% expert_fallback. Pool-size verbetering helpt query side; comp-engine moet die ook benutten. Verwachting na v10.19.1 (engine-tuning): comp pad 19% → 50%+.

3. **Degraded-mode niet getest live** — vereist expert offline scenario. Logic is verified door code-inspectie; live activatie zou een expert-API-uitval vergen.

4. **NORMAAL-hint nieuw**: nu krijgt expert "auto heeft gemiddelde gebruikssporen" tekst. Effect: kleine consistente discount tussen GOED en SLECHT, monitor live of dit gewenste niveau geeft.

5. **Retrospect-script was te ruw**: pure formule-simulatie zonder AI-blend gaf ongeloofwaardige medians voor mainstream clusters. Echte retrospect zou per-case via levende endpoint moeten draaien (~50min). Voor v10.19.0 voldoende de coverage-audit-data te volgen.

## Commit + versie

- package.json: 10.18.71 → **10.19.0**
- Commit hash: zie git log
- 8 files changed (taxonomy.js, parser.js, index.js, test.js, SKILL.md, normalize-listings.js, bod-adjustments.json, valuation.js, quick-price-expert.js, db.js, admin.js, package.json)
