# listing-normalizer

Normaliseert `make`/`model` voor incoming market_listings. Bouwt op een per-make taxonomy van canonical models + aliases.

## Usage

```js
const { normalizeListing } = require("./lib/listing-normalizer")
const result = normalizeListing({
  make: "bmw", source: "src_a",
  title: "BMW 535 5-serie Touring 535D High Exe",
  model: "320i"   // wat de scraper schreef — onbetrouwbaar
})
// → { normalized_model: "5-serie", normalize_source: "title_parse", confidence: 0.85 }
```

## Return shape

```
{ normalized_model: string | null, normalize_source: "native" | "title_parse" | "unmatched", confidence: number }
```

- `native`: source is `nlmarket` of `nlretail` — bestaande `model` wordt vertrouwd
- `title_parse`: titel succesvol geparsed naar canonical model uit taxonomy
- `unmatched`: geen alias matchte de titel; `normalized_model` valt terug op raw `model`

## Een nieuw merk toevoegen

1. Open `taxonomy.js`
2. Voeg make-key (lowercase, zoals in DB) toe met dict van `{canonical_model: [aliases]}`
3. Alias-volgorde binnen array: langste/specifieker eerst (`"altea xl"` voor `"altea"`)
4. Trim-aliases die naar parent mappen: zet trim-aliases (bv `"320i"`, `"e350"`) onder hun parent (`3-serie`, `e-klasse`)
5. Voeg testcases toe in `test.js` met echte titels uit `market_listings`
6. Run `node test.js` — moet groen blijven

## Het algoritme

`parser.js`:
1. Lowercase + normaliseer hyphens/spaties
2. Strip merk-naam uit titel (zodat 'mercedes' niet matcht als model voor MB)
3. Pak aliases gesorteerd op lengte desc (langere matches eerst)
4. Whole-word match: alias moet tussen word-boundaries staan (voorkomt dat `"eos"` matcht binnen `"leon"`)
5. Bij meerdere matches: eerste (langste) wint
6. Geen match: return null

Cache is in-memory per make — eerste call bouwt geordende alias-lijst, daarna O(aliases) per call.

## Testen

```bash
cd /opt/t4c/backend/lib/listing-normalizer && node test.js
```

30 cases dekken: SEAT (Cordoba/Toledo/Arosa/Altea misclassified als 'leon'), BMW (trim-as-model 320i → 3-serie), Audi A4/Q5, VW Passat/Tiguan, Mercedes E-klasse trims, plus passthrough voor nlmarket source.

Bij elke nieuwe scraper-bug of bekende misclassificatie: voeg testcase toe vóór taxonomy uit te breiden — TDD-stijl.
