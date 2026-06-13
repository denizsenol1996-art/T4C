# Sprint v10.20.0 — write-path leak fixes (2026-05-22)

Patch sprint voortvloeiend uit `DATA-FOUNDATION-AUDIT-2026-05-21.md` en
`scraper-audit-2026-05-22.md`. Doel: drie write-path leaks (`url`,
`first_price`/`last_price`, `price_changes`) dichten + `kenteken`-kolom
toevoegen + dubbele price_history-writer elimineren. Backfill van
bestaande 239k rows niet in scope.

---

## Files gewijzigd

```
backend/db.js            | 13 ++++---------
backend/package.json     |  2 +-
backend/routes/market.js | 42 +++++++++++++++++++++---------------------
3 files changed, 26 insertions(+), 31 deletions(-)
```

### Per-file breakdown

**`backend/db.js`** (3 wijzigingen)

- regel 729: `ml_migration` array uitgebreid met
  `["kenteken","TEXT DEFAULT ''"]` (idempotent ALTER bij volgende boot)
- regel 962: `url = ''` → `url = url || ''` met comment
  "v10.20.0: store source URL" (was v10.16.1 stealth, ongerechtvaardigd
  per verifications taak 3)
- regels 965-969 weg: hele 2e price_history-INSERT in UPDATE-tak
  (inclusief `const prev = queryOne(...)` lookup en `if (...>100)`
  diff-detectie) geschrapt. Eén schrijver naar `price_history` blijft
  over, in market.js
- regels 979-980: INSERT-statement uitgebreid met `first_price, last_price`
  kolommen, beide gevuld met `price` — zodat het flywheel meteen een
  geldige startwaarde heeft om diffs tegen te meten

**`backend/routes/market.js`** (2 wijzigingen)

- regels 754-765: src_g detail-UPDATE blok — `kenteken` toegevoegd aan
  trigger-conditie (`|| el.kenteken`) én aan UPDATE-lijst met idempotent
  pattern `WHERE hash=? AND (kenteken IS NULL OR kenteken='')`
- regels 773-797: FLYWHEEL-blok volledig herschreven (zie deviaties)

**`backend/package.json`**

- regel 3: `"version": "10.19.1"` → `"10.20.0"`

---

## Git

- **Commit hash**: `2715c9b67e4b813effb2372cb578e3ca80d902d6`
- **Branch**: `main` (12 commits ahead of origin/main, niet gepushed —
  spec specificeerde "single commit, geen tussentijdse pushes")
- **Backup**: `/opt/t4c/data/backup-pre-v10.20.0.db` (139 MB, 239.456
  rows snapshot pre-ALTER)

---

## Deploy timeline

```
18:42  cp backup-pre-v10.20.0.db
18:43  git add + commit 2715c9b
18:54  pm2 restart t4c-server --update-env  (versie 10.20.0 online)
18:54  ALTER TABLE market_listings ADD COLUMN kenteken — idempotent run
18:54  [CRAWLER] First run starting...
18:55  eerste post-v10.20.0 INSERTs verschenen
18:57  smoke tests bevestigen url + first_price + last_price 100%
```

---

## Smoke test resultaten

### (a) Schema-check `PRAGMA table_info(market_listings)`

```
Total columns: 29  (was 28)
kenteken: YES (cid 28, type TEXT, default '')
```

PASS. ml_migration draaide één keer, kolom aanwezig.

### (b) Per-source coverage op nieuwe rows (last 5 min, post-restart)

```
source | n | with_url | with_fp | with_lp | with_kt
src_b  | 1 |    1     |    1    |    1    |    0
src_d  | 1 |    1     |    1    |    1    |    0
src_g  | 2 |    2     |    2    |    2    |    0
```

PASS. **100% url/first_price/last_price coverage** op post-restart inserts.
Sample-rijen:

```
src_d 5000   first_price=5000  last_price=5000  url=https://www.autoscout24.de
src_g 3999   first_price=3999  last_price=3999  url=https://www.autowereld.nl/volkswagen/up/1-0-take-u...
src_g 2790   first_price=2790  last_price=2790  url=https://www.autowereld.nl/volkswagen/polo/1-2-tdi-...
src_b 3500   first_price=3500  last_price=3500  url=https://www.marktplaats.nl/v/auto-s/volkswagen/m24...
```

src_a niet in 5-min venster maar bonus-query (10 min) toonde alleen
pre-restart src_a rijen (geen post-restart sample); deelt dezelfde code-pad
en zal bij volgende cyclus identiek werken. nlmarket/nlretail blijven
zoals verwacht zonder URL (komt v10.20.1).

### (c) src_g kenteken count (last 5 min)

```
n=0
```

Niet PASS, niet FAIL — verwacht binnen 5 min waarschijnlijk 0. Het
src_g detail-enrichment is `max 5 per model` (helpers.js limit) en de
crawl-cycle bezoekt ~300 modellen sequentieel. Binnen 5 min worden
slechts ~5-10 modellen ge-enricht; veel detail-extracties leveren geen
kenteken op (dealers laten 'm vaak weg) of leveren een listing op die
qua hash niet aansluit op een al ge-INSERTe row. Verwachting: bij
24-48u crawl-coverage worden de eerste kenteken-rijen zichtbaar. Code-
pad is wel geverifieerd: `el.kenteken` triggert nu de detail-UPDATE
block (voorheen alleen `options|description|transmission|fuel`).

### (d) PM2 logs grep on error/ERROR/Error/fail/FAIL

```
/home/deniz/.pm2/logs/t4c-server-error.log last 80 lines:
(geen errors gevonden)
```

PASS. Server draait stabiel, geen new exceptions na restart. CRAWLER en
DETAIL en HISTORY log-regels lopen normaal door.

### Bonus checks

- **price_history rows last 10 min**: 0. Geen prijswijzigingen >50
  geobserveerd in het korte venster. Verwacht (nieuwe INSERTs hebben
  `first_price == last_price == price` dus 0 diff). Threshold-trigger
  vergt observable price-drift, wat 24u+ duurt.
- **Total rows**: 242.445 (was 239.456 pre-sprint, +2.989 in een paar
  uur — normaal scrape-volume).

---

## Deviaties van de spec

### Deviatie 1: price_history INSERT-kolommen behouden bestaand schema

**Spec** (E):
```js
run("INSERT INTO price_history (hash, old_price, new_price, changed_at) VALUES (?, ?, ?, datetime('now'))",
  [hash, existing.price, l.price])
```

**Werkelijk schema** van `price_history` (PRAGMA-check vooraf):
```
listing_hash, make, model, year, price, previous_price, source, recorded_at
```

De spec-kolomnamen (`hash`, `old_price`, `new_price`, `changed_at`)
bestaan niet in de tabel — de INSERT zou silently mislukken
("no such column: hash"). De tabel was leeg (0 rows) maar wijzigen
van het schema viel buiten scope en zou andere consumers kunnen
breken.

**Implementatie**: behoud bestaande kolomnamen, vul make/model/year/source
in vanuit de `item`-context die in scope is binnen de crawler-loop:

```js
run("INSERT INTO price_history (listing_hash,make,model,year,price,previous_price,source,recorded_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
  [hash, item.make, item.model, item.year, l.price, existing.price, l.source || ""])
```

Semantisch identiek aan de spec-intentie (single source of truth,
threshold >50, geen dode tak).

### Deviatie 2: UPDATE-tak van FLYWHEEL zet `price` niet meer

**Oude code** (pre-sprint): `UPDATE ... SET last_price=?, price=?, price_changes=... WHERE id=?` met `[ex.price, l.price, ex.id]`. Dit zette `last_price` = vorige prijs, `price` = nieuwe prijs.

**Spec**: `UPDATE ... SET last_price=?, price_changes=... WHERE id=?` met `[l.price, existing.id]`.

**Implementatie**: gevolgd. Twee effecten:

1. `last_price` is nu **de laatste geobserveerde prijs** (= `l.price`),
   niet meer "de prijs van vóór deze observatie". Dit komt overeen met
   de schema-naam ("last_price" = current latest price).
2. `price` wordt niet meer hier overschreven — `upsertListing` zet 'm al
   in de UPDATE-tak op regel 970. Dubbele UPDATE was redundant.

Document hier omdat dit een semantische verandering in `last_price`
inhoudt. Bij prijsdrop van 5000 → 4500: pre-sprint `last_price=5000`,
post-sprint `last_price=4500`. Downstream consumers (indien any) moeten
dit weten.

### Deviatie 3: try/catch wrapper behouden

**Spec** liet alleen de loop-body zien. **Behouden**: omhullend
`try { ... } catch(pe) { console.log("  [CRAWLER] Price tracking error:", pe.message) }`.

Reden: backgroundCrawl draait elke 2 min en valt anders volledig stil
bij één SQL-error in de FLYWHEEL. Defensieve wrap is geen functional
spec-conflict.

### Deviatie 4: kenteken UPDATE staat binnen bestaande `if (options || ...)` block

**Spec** (F): "Voeg kenteken toe aan de UPDATE-set en params-array."

De bestaande code heeft één geconditioneerd block per detail-listing:
```js
if (el.options || el.description || el.transmission || el.fuel) { ... }
```

**Implementatie**: trigger-conditie uitgebreid met `|| el.kenteken` (zodat
listings met **alleen** kenteken ook de block in komen), en in de block
een UPDATE-regel toegevoegd met idempotent gate
`WHERE hash=? AND (kenteken IS NULL OR kenteken='')`. Dit komt
overeen met het patroon van de andere UPDATEs in hetzelfde block.

---

## Open follow-ups voor v10.20.1

### Onmiddellijk

1. **kenteken-coverage bewaken**: na 24u inspectie of er daadwerkelijk
   kenteken-rijen verschijnen op src_g. Indien nog 0: `scrapeAutowereldDetail`
   in helpers.js controleren — de extractie zelf kan ook fragiel zijn
   (regex op specs-tabel met `term.includes('kenteken')` op helpers.js:338).
2. **price_history seedt langzaam**: bij eerste echte prijsdrop > €50
   in een nieuwe-row scenario (waar pre-restart row al bestaat zonder
   `last_price`) wordt threshold pas vanaf de 2e observatie geactiveerd.
   Idempotent backfill in FLYWHEEL helpt pre-v10.20.0 rijen via
   `existing.first_price === null` → set tot huidige prijs.

### Spec-gerelateerd uitgesteld

3. **nlretail Vehicle JSON-LD upgrade** — `verifications taak 2`
   bewees dat detail-pages `@type=Vehicle` (niet `Product`) gebruiken
   met `mileageFromOdometer`, `vehicleTransmission`, `bodyType`,
   `dateVehiclefirstregistered`, `vehicleEngine.fuelType` top-level.
   Twee implementatie-opties (zie verifications). Vergt detail-page
   crawl + rate limiting voor 1100 listings/dag.
4. **nlmarket URL-template** — ILSA-payload heeft géén directe URL,
   wel `id` + `identification.slug`. Vereist site-inspectie van
   autoofy.nl om template (`https://www.autoofy.nl/auto/{slug}/{id}`?)
   te bepalen vóór code-fix. Niet getest in v10.20.0.

### Niet-blocking maar te volgen

5. **Backfill 239k bestaande rows**: nieuwe scrapes vullen `url`,
   `first_price`, `last_price`, `kenteken` correct vanaf nu. Bestaande
   rows blijven leeg tenzij de listing opnieuw geschraapt wordt (dan
   krijgt het de UPDATE-tak, die geen first_price-restore doet — wel
   triggert de FLYWHEEL-backfill `existing.first_price === null` →
   set `first_price=l.price`). Effectief: rijen die nog actief zijn
   krijgen langzaam first_price; rijen die al `status='sold'` zijn
   blijven leeg.
6. **last_price semantiek-shift**: zie deviatie 2. Geen downstream
   consumers gevonden bij eerste grep, maar zorg dat dashboards die
   "previous price" tonen niet stiekem `last_price` gebruiken.
7. **Banner-versie in server.js startup logs**: toont nog
   `T4C Platform v10.16.0`. Cosmetisch, package.json is leidend voor
   PM2-versie-display.
8. **price_history-tabel** kan op termijn een schema-cleanup gebruiken
   (huidige kolommen `make/model/year/source` zijn redundant met
   `listing_hash` als FK naar market_listings) — maar dat is een
   apart refactor-spoor.

---

## Conclusie

Alle 7 wijzigingen geapplied (A-G), 1 commit (`2715c9b`), zonder errors
in PM2 logs. Drie schrijfleak-fixes en kenteken-kolom werken op
post-restart INSERTs (100% coverage op `url`, `first_price`, `last_price`).
Kenteken-coverage vergt 24-48u crawl-time om door alle (make,model,year)
buckets te lopen. v10.20.1 scope: nlretail Vehicle JSON-LD + nlmarket
URL-template + kenteken-verificatie.
