# Data Foundation Audit — 2026-05-21

Read-only audit op `market_listings` tabel. Doel: beantwoorden van twee
fundamentele vragen vóór verdere feature-bouw — (1) wat is de history-
architectuur, en (2) hoe betrouwbaar is de data per veld en per bron.

Aansluitend op `PRODUCTION-AUDIT-2026-05-21.md` en
`PRODUCTION-SPRINT-2026-05-21.md` (v10.19.0/.1 deployment van listing-
normalizer en comp-engine score-fix).

---

## Executive Summary

De `market_listings` tabel telt **239.456 rows** over 9 bronnen, 73 dagen
data (2026-03-09 → 2026-05-21), 81.908 active / 157.472 sold. Schema is
goed ontworpen — 28 kolommen waaronder de hele history-laag (`first_seen`,
`last_seen`, `days_on_market`, `price_changes`, `first_price`, `last_price`,
`status`). Maar de write-paden voor drie van die kolommen leveren niets aan:

1. **`url`** — 99,99% leeg (alleen autoofy 21 rows). Listing-URL's worden
   niet opgeslagen.
2. **`first_price` / `last_price`** — 100% null voor alle 239.456 rows.
3. **`price_changes`** — 0 voor alle rows.

Gevolg: prijsgeschiedenis per auto kan niet gereconstrueerd worden, en de
URL-vergelijking uit brief-vraag 2 is structureel onmogelijk zonder eerst
een capture-fix.

De v10.19.0 listing-normalizer werkt grotendeels (BMW 3-serie pool van 171
→ 1.104, SEAT Altea 13 → 106), maar heeft drie restbugs: hyphen/spatie-
collapse, punctuatie, trim-residu. 23.870 rows (10%) blijven unmatched.

Per-bron is de data zeer ongelijk — `nlmarket` is functioneel maar heeft
geen titles, `src_g` heeft kapotte raw model-data die de normalizer redt,
`src_c` heeft 38% title-vs-model mismatches, `nlretail` is onbruikbaar door
lege fuel/transmission. Totaal "usable" voor pricing: ~19.000 van 81.908
active listings (23%).

Comp-pad is na v10.19.0 + v10.19.1 gestegen van 19% naar 29% — minder dan
de 50%+ die het sprint-doc voorspelde. Engine-filter blijft te strikt voor
de nu wèl correcte pool.

---

## Deel 1 — History-architectuur

### 1.1 Wat gebeurt met listings die uit de bron verdwijnen?

Ze worden gemarkeerd `status='sold'` door de app-code (geen DB-trigger).
Status is binair: `active` of `sold`. Geen `withdrawn`, `inactive`, of
`unknown` waarde.

**Beperking**: een listing die uit de feed verdwijnt door een scrape-fout,
een prijswijziging die de URL veranderde, of een terugtrekking door de
dealer wordt allemaal als `sold` aangemerkt. We kunnen sold vs withdrawn
vs scrape-miss niet onderscheiden.

### 1.2 first_seen / last_seen

Beide kolommen bestaan en zijn altijd gevuld (default `datetime('now')`
bij insert).

- Range: 2026-03-09 → 2026-05-21 (73 dagen data)
- 0% null op beide kolommen
- Betrouwbaarste history-velden in de hele tabel

### 1.3 Prijsgeschiedenis per auto reconstrueren?

**Nee.** Schema-laag is er, write-path niet:

| veld | rows | null/zero | % |
|---|---|---|---|
| `first_price` | 239.456 | 239.456 | **100%** |
| `last_price` | 239.456 | 239.456 | **100%** |
| `price_changes` | 239.456 | 239.456 (=0) | **100%** |

De upsert-logica doet vermoedelijk `INSERT OR REPLACE` zonder diff-detectie
tegen vorige prijs. We zien alleen huidige `price`. Prijsgeschiedenis-feature
is daarmee dood.

### 1.4 Sold vs withdrawn?

Niet af te leiden uit huidige data. Proxy zou een tweede-sighting check
zijn (HEAD-request op de oorspronkelijke URL → 404 = waarschijnlijk
verkocht; nog beschikbaar = teruggetrokken/herplaatst). Maar dat vereist
URLs, wat 99,99% niet het geval is.

### 1.5 Tijd-op-markt per segment

Berekenbaar via `days_on_market` op sold rows, maar de waarden zijn per
bron zeer wisselend door verschil in sold-detectie:

**Per prijsband (sold rows):** redelijk monotoon stijgend van ~5d voor
goedkope auto's naar 10-12d voor 40k+. Plausibel.

**Per leeftijd (sold rows):** opvallend vlak — 5,5 tot 8,7 dagen ongeacht
of de auto 0 of 26 jaar oud is. **Niet plausibel** voor een echte markt;
oudere goedkope auto's staan in werkelijkheid langer. Wijst op artefacten
van sold-detectie (zie 2.4).

**Conclusie 1.5**: aggregaten over alle bronnen heen zijn niet betrouwbaar
voor segment-analyse. Per-bron breakdown is nodig en `src_g`/`src_b` data
moet uitgesloten of zwaar gefilterd worden voor dit doel.

---

## Deel 2 — Data-betrouwbaarheid

### 2.1 Scope-aanpassing

De originele brief vraagt om 100 random listings per bron URL-vergelijken.
**Dit is structureel onmogelijk** — er zijn geen URLs opgeslagen (zie 1.3 /
Write-path leak #1).

Alternatieve verificatie-strategieën die wèl mogelijk zijn:
- Cross-source price agreement op identieke MMY+km combinaties (2.5)
- Title-vs-fields consistency check (2.2)
- NULL-coverage per veld per bron (2.3)
- Distributie-plausibiliteit per bron (2.4)

Deze 4 samen geven een redelijke proxy voor URL-by-URL audit, maar zijn
structureel zwakker — we kunnen niet vaststellen dat een listing klopt met
de bron-pagina, alleen dat de listing intern consistent is en met andere
bronnen agreement vertoont.

### 2.2 Title-vs-fields consistency

Aandeel rows waar title `make` of `model_normalized` NIET bevat:

| source | title_missing_make | title_missing_norm_model |
|---|---|---|
| nlmarket | **98,6%** | 98,6% |
| src_c | 38% | 38% |
| src_a / src_b / src_d | laag | laag |
| src_g | gemiddeld | gemiddeld |

**Bevindingen:**
- `nlmarket` heeft 98,6% titles die de make niet bevatten → vrijwel zeker
  lege titles. Wat het sprint-doc als "schone bron" classificeerde was
  eigenlijk "vertrouw het model-veld, geen title om tegen te verifiëren".
  Nlmarket is blind voor title-based debugging.
- `src_c`: 38% mismatch is hoog. Ofwel titles zijn cryptisch (afkortingen)
  ofwel normalizer raadt te vaak. Vergt nadere analyse.
- `src_g` raw `model` is verwoest (alle Citroëns hebben `model='c-zero'`),
  maar `model_normalized` herstelt naar de juiste waarde via title-parse.
  Pre-v10.19 was dit dodelijk; nu opgevangen door normalizer.

### 2.3 NULL-coverage kritieke velden

Globaal over alle bronnen:

| veld | null/leeg | % | conclusie |
|---|---|---|---|
| `first_price` | 239.456 | **100%** | write-path dood |
| `last_price` | 239.456 | **100%** | write-path dood |
| `url` | 239.435 | **99,99%** | write-path dood |
| `transmission` | 165.634 | 69% | substantieel gat |
| `dealer` | 56.278 | 23% | sterke per-bron variantie |
| `fuel` | 39.516 | 16,5% | acceptabel maar verbeterbaar |
| `year` | 749 | <0,5% | ok |
| `km` | 1.376 | <1% | ok |

**Per bron `no_dealer`:**
- `src_g`: 71% — gecombineerd met andere src_g-signalen problematisch
- `src_c`: 43%
- `src_d`: 26%
- `src_a`: 14%
- `nlmarket` / `nlretail`: 0% — beide hebben dealer altijd

### 2.4 Sold-detectie betrouwbaarheid per bron

Histogram van `days_on_market` voor sold rows (relatieve verdeling):

| bron | 0-1d | overig | verdict |
|---|---|---|---|
| `src_g` | **68%** | rest | "sold" = feed-noise |
| `src_b` | **54%** | rest | sold-detect suspect |
| `src_a` | laag | zwaartepunt 8-30d | plausibel patroon |
| `src_d` | medium | zwaartepunt 8-30d | gemiddeld |
| `src_c` | medium | zwaartepunt 8-30d | gemiddeld |
| `nlmarket` | — | alle NULL | bug in sold-marker |

**Bevindingen:**
- `src_g` met 68% sold in 0-1 dag is **geen echte verkoop-velocity** maar
  "uit feed na 1 scrape-cycle". `sold_estimate` op deze bron is daarmee
  onbetrouwbaar — een 1-dags listing is meer feed-noise dan een verkochte
  auto.
- `src_b` zelfde patroon, milder.
- `src_a` heeft het meest plausibele patroon (zwaartepunt bij 8-30d), het
  meest bruikbaar voor real-world tijd-op-markt analyse.
- `nlmarket` heeft 2.062 sold rows maar `days_on_market` is NULL voor
  allen → **bug in sold-marker code path** specifiek voor deze bron.

### 2.5 Cross-source price agreement (URL-sample alternatief)

Identieke MMY+km buckets met >1 source:

**Echte matches (smal):**
- Fiat Panda 2017 — spread 0,8%
- VW Caddy 2019 — spread 2,6%
- Ford Transit Custom 2024 — spread 3%

Bronnen zijn intern consistent voor dezelfde auto.

**Schijn-matches (te coarse bucket):**
- Ford Transit Connect 2022/65.681km — spread 106%
- Mercedes Vito 2023 — spread 93%
- VW Golf 2026 — spread 51%

De MMY+km combinatie matched in werkelijkheid meerdere trims/configuraties.

→ Een betrouwbare dedup-heuristic moet alleen vuren bij spread <10% binnen
de bucket.

→ Volume van echte cross-source dupes is laag (max 3 in top-20 buckets).
**Cross-source dedup is geen volume-probleem.**

### 2.6 Outliers

- 2.519 prijzen >€100k (waarschijnlijk supercars, valide maar filterwaardig)
- 906 oude auto's (<2024) met <1.000 km (verdacht, import-fraude of noise)
- 1.241 implausibele jaren (<1990 of >2027)
- 0 prijzen <€100, 0 km >1M (clean op deze hoek)

Outliers zijn klein in volume (<2% totaal). Filter in queries voldoende,
geen DB-cleanup nodig.

### 2.7 Intra-source bundeling

Cross-source dedup is klein, maar **intra-source bundeling is groot**:
zelfde MMY+km combinatie 8-12 keer in één feed, vrijwel altijd fleet-imports
of lease-uitruil. Bv. Mercedes V-klasse 2022/110.547km verschijnt 12× in
1 bron.

Impact: comp-engine ziet 12 "vergelijkbare auto's" maar in werkelijkheid is
het 1 auto met 12 listings. Mediaan-berekening wordt scheefgetrokken naar
fleet-prijzen.

---

## Deel 3 — Per-bron profiel

Samengevat per bron, gerangschikt op betrouwbaarheid voor pricing:

| bron | volume | usable% | sold-detect | norm | titles | dealer | verdict |
|---|---|---|---|---|---|---|---|
| **nlmarket** | 16.970 | **77,6%** | broken (NULL) | native ok | leeg | 100% | best, blind voor titles |
| **src_a** | 73.274 | 8,2% | plausibel | 81% gematcht | aanwezig | 86% | grootste volume, lage usable% |
| **src_c** | 20.299 | 12,6% | matig | onbekend | 38% mismatch | 57% | data-quality concern |
| **src_b** | 49.937 | 11,7% | suspect (54% in 1d) | grotendeels | aanwezig | 99,99% | volume ok, sold zwak |
| **src_d** | 40.614 | 7,1% | matig | grotendeels | aanwezig | 74% | gemiddeld |
| **src_g** | 37.585 | 60,1% | broken (68% in 1d) | normalizer redt | aanwezig | 29% | raw model kapot, sold-detect dood |
| **nlretail** | 755 | **0%** | onbekend | 100% | leeg | 100% | onbruikbaar (geen fuel/transmission) |
| autoofy | 21 | n.v.t. | n.v.t. | 100% | aanwezig | 100% | te klein |
| Marktplaats | 1 | n.v.t. | n.v.t. | n.v.t. | n.v.t. | n.v.t. | stray row, verwijderen |

**Totaal usable active = ~19.000 van 81.908 (23%).**

---

## Deel 4 — v10.19.x effect op comp-engine

Path-distributie taxaties laatste 7 dagen:

| price_source | n | % |
|---|---|---|
| `comp` | 17 | 29% |
| `expert_fallback` | 28 | 48% |
| `expert_user_context` | 6 | 10% |
| `expert_override` | 3 | 5% |
| overig | 4 | 8% |

- Pre-v10.19: comp pad 19%
- Post v10.19.0 + v10.19.1: comp pad 29%
- Sprint-doc voorspelling: 50%+

De pool-verbetering werkt (data is er), maar `buildComparableSet()` filtert
nog steeds de meeste rows weg. De v10.19.1 score-comparable fix was niet
voldoende. Engine-filter strictheid is een aparte vector die nog open staat.

---

## Deel 5 — Normalizer restbugs (v10.19.0)

Drie collapse-issues in de post-sweep `model_normalized` distributie:

1. **Hyphen vs spatie niet samengevoegd**:
   - BMW `3-serie` (3.538) + `3 serie` (179)
   - BMW `1-serie` (3.067) + `1 serie` (112)
   - BMW `5-serie` (2.873) + `5 serie` (77)
2. **Punctuatie niet genormaliseerd**: VW `up` (1.028) + `up!` (56).
3. **Trim-residu**: 94 rows blijven onder `e 350 cgi`.

**23.870 rows (10%) hebben `normalize_source='unmatched'`**, waarvan
13.966 uit src_a (19% van die bron). Die rows leunen via `COALESCE` terug
op de raw `model`-string. Voor src_a (grootste bron) betekent dat 1 op de
5 listings onbetrouwbaar gelabeld blijft.

---

## Verdict

### Wat werkt
- Schema goed ontworpen, 28 kolommen, indexes op (make,model,year,status)
  en hash, hash 100% uniek (geen DB-dupes).
- `first_seen` / `last_seen` betrouwbaar voor alle rows.
- Status-classificatie binair maar gevuld (66% sold / 34% active).
- v10.19.0 normalizer doet substantieel werk (~90% gematcht).
- `nlmarket` (7% van volume) is de gouden bron qua usable% en
  model-correctheid.

### Wat dood is
- **Write-path leak #1**: `url` 99,99% leeg. Brief vraag 2
  (URL-vergelijking) structureel onmogelijk.
- **Write-path leak #2**: `first_price` / `last_price` 100% null. Geen
  prijsgeschiedenis per listing.
- **Write-path leak #3**: `price_changes` 0 voor alle rows. Geen
  price-drop signaal.

### Wat onbetrouwbaar is
- `src_g` sold-detectie (68% in 0-1d → feed-noise, geen echte verkopen).
- `src_b` sold-detectie (54% in 0-1d → idem, milder).
- `nlmarket` sold rows: `days_on_market` NULL door bug in sold-marker.
- `src_c` title-vs-fields 38% mismatch.
- `src_a` 19% van rows blijft unmatched in normalizer.
- `nlretail` (755 rows) onbruikbaar door lege fuel/transmission.

### Wat structureel niet bestaat
- Onderscheid sold vs withdrawn vs scrape-miss.
- Prijsgeschiedenis op listing-niveau.
- Cross-source ID-matching zonder URLs.

---

## Aanbevolen prioriteitsvolgorde

Op volgorde van impact-per-effort. Geen sprint-prompt, beslissings-
ondersteuning.

### Tier 0 — write-path leaks dichten

Data begint zich op te bouwen vanaf het moment van fix; elke dag uitstel
= nog een dag listings zonder traceability.

1. **`url` capture** in alle scrapers. Lage code-effort per bron, hoogste
   hefboom: zonder URLs is herverificatie, sold-vs-withdrawn detectie, en
   cross-source ID-matching allemaal onmogelijk. **Eerst.**
2. **`first_price` / `last_price` / `price_changes` write-path** in de
   upsert-logica. Bij `UPDATE` op bestaande hash: vergelijk nieuwe prijs
   met huidige, bij verschil
   `last_price=NEW, first_price=COALESCE(first_price, OLD_price),
   price_changes=price_changes+1`. Compact, één codepad.

### Tier 1 — datakwaliteit acuut (raakt pricing nu)

3. **`src_g` sold-detectie patch**: minimum 2 scrape-cycles missend vóór
   `status='sold'`. Niet 1.
4. **`nlmarket` sold-marker bug**: `days_on_market` wordt niet berekend
   bij sold-mark voor deze bron. Aparte code path.
5. **Normalizer collapse-fixes**: hyphen/spatie/punctuatie pre-processing
   in taxonomy lookup. Trim-residu `e 350 cgi`-family in alias-table.
6. **Comp-engine filter doorlichting**: pool is nu wèl gevuld, engine
   pakt 'm niet. Waar de pool shrinkt van 1.104 → 0 in
   `buildComparableSet()` lokaliseren.

### Tier 2 — cleanup

7. `Marktplaats` stray row verwijderen.
8. `nlretail` fuel/transmission verrijking of bron-decommission.
9. Intra-source dedup heuristic (clustering op MMY+km+dealer binnen één
   bron, signaal voor fleet imports).
10. Cross-source dedup spread <10% gate.

### Tier 3 — performance (15+s response time)

Niet behandeld in deze audit, vergt aparte analyse. Hypothese: 47%
expert_fallback op cold cache → 2,5-5s API call in hot path. Aanbeveling
uit vorige chat (expert achterwacht voor 5-10% randgevallen, niet hot
path) is na deze audit nog steeds geldig — sterker, de data ondersteunt
het. Maar Tier 3 omdat het bouwt op Tier 0+1.

---

## Open vragen voor volgende sessie

- Wat is de root cause van de `url` write-leak? Per-scraper investigatie
  of architectuur-keuze (bv. URL is wel binnen scraper aanwezig maar valt
  ergens in de pipeline weg)?
- Heeft `t4c-test` (de inmiddels gekilde test PM2-process) destijds rows
  zonder URL geschreven die nu nog in DB zitten, of is dit alle scrapers
  all-time?
- Is er een retroactieve URL-recovery mogelijk via scrape-bron logs (PM2
  stdout) of is alles historisch verloren?
- Hoe lang duurt het om de write-path patches te bouwen + retro-sweep te
  draaien voor first_price/last_price (op basis van scrapes vanaf nu —
  bestaande rows blijven leeg)?
- Wat is de daadwerkelijke pool-shrink in `buildComparableSet()` voor BMW
  3-serie 2017 (1.104 raw → ? na fuel/transmission/scoring filters)?
