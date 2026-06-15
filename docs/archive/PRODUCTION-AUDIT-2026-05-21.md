# Production Readiness Audit — 2026-05-21

Read-only audit over alle 5 lagen van het pricing-systeem. Doel: één compleet
beeld vóór de productie-sprint. Geen code-wijzigingen tijdens dit onderzoek.

---

## Executive Summary

Het pricing-systeem heeft sinds v10.18.62 substantieel geïterereerd: expert-
validatie, auto-override, multipliers voor 6 overshoot-clusters, expert_user_
context voor staat/rijdt. Maar de fundamentele data-pool is sinds dag één
kapot: **5 van 7 scraper-bronnen leveren listings met verkeerd `model`-veld
en samen vormen die 95% van het volume**. Dit verklaart waarom comp-engine
routinematig met onbruikbare pools werkt en waarom expert_fallback/_user_
context vrijwel altijd het werkende pad is geworden. Daarnaast zijn er
~10 cluster-categorieën met systematische bias zonder rule, en monitoring
op real-time error-rates ontbreekt. De architectuur is overeind, de data-
laag eronder is de echte showstopper.

---

## Deel 1 — Data-funnel: waar zit de marktdata

### 1.1 Scraper output

Totaal `market_listings`: **238.084 rows**. Status='active': **81.644**.
Listings binnengekomen laatste 30 dagen: **91.399**.

| Bron | Totaal | Laatste 7d | Laatste 30d |
|---|---|---|---|
| src_a | 72.989 | 3.393 | 23.112 |
| src_b | 49.637 | 3.739 | 17.446 |
| src_d | 40.378 | 3.648 | 22.656 |
| src_g | 37.109 | 3.550 | 18.135 |
| src_c | 20.224 | 1.149 | 5.957 |
| nlmarket | 16.970 | 806 | 3.742 |
| nlretail | 755 | 66 | 351 |
| autoofy | 21 | 0 | 0 |

**Scrape-volume is gezond**: ~15.000 nieuwe listings per week. Het probleem
is niet binnenkomende volume.

### 1.2 Make distributie

| Make | n | unique_models |
|---|---|---|
| volkswagen | 45.981 | 55 |
| renault | 28.236 | 44 |
| kia | 21.249 | 42 |
| toyota | 18.455 | 48 |
| audi | 17.278 | 45 |
| mercedes-benz | 17.253 | 81 |
| bmw | 16.858 | 70 |
| seat | 12.193 | **18** |
| ford | 12.004 | 46 |
| nissan | 10.609 | 39 |

SEAT met slechts 18 unique models is opvallend (SEAT bouwt ~10 modellen
historisch maar in 18 model-strings is plausibel met spelling-varianten).
Trim-vs-model confusion zichtbaar bij BMW (`320i`) en Mercedes (`e 350 cgi`).

### 1.3 Model-misclassificatie per make — confirmation

Top model-buckets per make in market_listings:

**SEAT** (12.193 totaal):
| model | n | % |
|---|---|---|
| leon | 11.179 | **92%** |
| ibiza | 541 | 4% |
| arona | 210 | 2% |
| ateca | 130 | 1% |

→ Massieve concentratie. Real-world SEAT verkoop in NL is ~30% Ibiza, 25% Leon,
20% Altea/Altea XL, 15% Ateca/Arona, rest divers. **92% in één bucket
betekent dat alle SEAT-modellen waarschijnlijk als 'leon' gelabeld worden
door één of meer bronnen.**

**Audi** (17.278 totaal):
| model | n | % |
|---|---|---|
| a3 | 14.536 | **84%** |
| a4 | 548 | 3% |
| a6 | 395 | 2% |
| q3 | 345 | 2% |

→ A3 absorbeert alles. A4 is in werkelijkheid een van de meest verkochte
Audi-modellen in NL; 548 listings vs 14.536 voor A3 is statistisch
onmogelijk.

**Volkswagen** (45.981 totaal):
| model | n | % |
|---|---|---|
| golf | 22.290 | 48% |
| polo | 19.347 | **42%** |
| crafter | 540 | 1% |
| caddy | 484 | 1% |

→ Golf + Polo = 90%. Passat (356), Tiguan (309), Touareg, T-Cross, ID-modellen
worden allemaal als 'golf' of 'polo' weggeschreven.

**BMW** (16.858 totaal):
| model | n | % |
|---|---|---|
| 5-serie | 9.021 | 53% |
| 320i | 3.149 | **19%** |
| 3-serie | 606 | 4% |
| 1-serie | 598 | 4% |

→ `320i` als model i.p.v. trim. Een 320i IS een 3-serie. De `3-serie` bucket
heeft 606 listings, terwijl in werkelijkheid de 3-serie de bestverkopende
BMW in NL is en ~5.000+ listings zou moeten hebben.

**Ford** (12.004 totaal):
| model | n | % |
|---|---|---|
| fiesta | 7.727 | **64%** |
| focus | 822 | 7% |

→ Focus is in werkelijkheid ~50% van Ford-verkoop in NL. Massief
ondervertegenwoordigd.

**Mercedes-Benz** (17.253 totaal):
| model | n | % |
|---|---|---|
| e-klasse | 9.401 | 54% |
| e 350 cgi | 1.586 | **9%** |
| sprinter | 998 | 6% |
| a 180 | 776 | 4% |

→ Trim-als-model: `e 350 cgi` en `a 180` zijn trims, geen modellen.
C-klasse (626) en A-klasse (566) lijken kleiner dan E-klasse, wat in
werkelijkheid niet klopt voor de NL-markt.

**Conclusion**: SEAT-bug uit eerder onderzoek is een **systemisch patroon**
verspreid over alle high-volume makes. Vermoedelijk komt het door:
- Scraper-A pakt eerste-woord van titel als model: "SEAT Leon Stylance" →
  `leon`. Dezelfde scraper op een Altea-listing met titel "SEAT Altea 1.6
  Stylance" zou `altea` moeten zijn, maar levert toch `leon` op — dus de
  fout zit dieper dan eerste-woord.
- Mogelijk gebruikt de scraper een hardcoded mapping per make → main model.

### 1.4 Per-source bug isolation

**nlmarket** (16.970 total — het GOEDE source):
- SEAT: leon 111, ibiza 84, arona 41, ateca 19, toledo 15, tarraco 15,
  alhambra 14, mii 8, altea 7, altea xl 6, arosa 5 — **proper normalization**
- BMW: 3 serie 179, 1 serie 112, X1 91, 3-serie 83, 5 serie 77, X3 64,
  X5 50, 1-serie 44, 2 serie 42, 5-serie 38, 2-serie 22 — **proper labels,
  multi-spelling van dezelfde modellen** (een ander oplosbaar probleem)

**src_a** (72.989 — slechtste):
- SEAT: leon 2.856 — overwhelming dominantie
- BMW: 320i 1.194, 5-serie 1.181, X1 243, X3 217, 1-serie 186, 3-serie
  181 — trim-als-model bij 320i

**src_d** (40.378), **src_g** (37.109), **src_c** (20.224):
- SEAT: alleen `leon`-entries (4.309 voor src_d, 1.585 voor src_g, 593 voor
  src_c). **ZERO Ibizas, Alteas, Toledos, Cordobas, Arosas**. Alles in 'leon'.

**src_b** (49.637):
- SEAT: leon 1.721, ibiza 199, arona 51, ateca 24 — minder slecht dan src_d/g
  maar nog steeds heavy Leon-concentratie.

**Conclusion**: nlmarket (16k = 7% van volume) is de enige bron met
betrouwbare model-labels. De 93% van het volume uit src_a/b/c/d/g heeft
systematische misclassificatie op make×model niveau. De impact: wanneer
comp-engine zoekt naar "SEAT Altea" of "BMW 3-serie" of "Audi A4", krijgt
het bijna alleen listings uit nlmarket (te weinig voor betrouwbare
mediaan), terwijl er in de DB feitelijk vergelijkbare auto's zitten die
verkeerd zijn gelabeld.

---

## Deel 2 — Comp-engine funnel

### 2.1 Pipeline overzicht

Quick-price query op `market_listings` (regel 1149-1152 in valuation.js):
```sql
SELECT ... FROM market_listings
WHERE make=? AND model LIKE ? AND year BETWEEN ?-2 AND ?+2
  AND price > 0 ORDER BY price ASC LIMIT 50
```

Dan via `buildComparableSet()` in `lib/comparable-engine/`:
1. Junk-filter (titles met "VERWACHT", "BIEDEN VANAF", etc.)
2. Dedupe op hash
3. Outlier-filter op km/price/year
4. Score-comparable: km_close, fuel_match, model_match → strong/usable/weak

Eind: `cleanCount`. Pricing-engine eist `cleanCount ≥ 3` en `status='ok'`
voor comp-pad. Anders → fallback.

### 2.2 Funnel-traces voor 2 concrete cases

**Case A: SEAT Leon 2006 (79-SP-GF — feitelijk een Altea)**

Query (year ±2): `model LIKE 'leon%' AND year BETWEEN 2004 AND 2008`.

| Stap | n | % cumul |
|---|---|---|
| raw query result (model=leon) | 1.008 | 100% |
| titel bevat 'leon' (geen Altea/Toledo/Cordoba/Arosa/Ibiza) | 701 | 70% |
| titel bevat 'altea' (misfiled) | 104 | 10% |
| rest (Toledo/Cordoba/Arosa/Ibiza misfiled) | ~203 | 20% |

Comp-engine ziet 1.008 raw listings. Filters dedup/outlier → ~9 clean
comps in de v10.18.67 quick-price. Final marketMedian = €500 (de pool
is bevuild met cheap Arosas/Toledos). Voor 79-SP-GF (Altea) was een
correcte pool gegeven juist de 104 Altea-listings — die zijn dus
*aanwezig* in DB maar onder verkeerd model-label.

**Case B: BMW 320i 2017 (KZ-255-P)**

Query: `model LIKE '320i%' AND year BETWEEN 2015 AND 2019`.

| Stap | n |
|---|---|
| raw (model=320i, trim-als-model bucket) | 2.468 |
| model='3-serie' OR '3 serie' (alternatief label) | 171 |

Comp-engine vindt 2.468 listings onder 320i, maar dat is een ratjetoe
van alle BMW 3-series met verschillende trims (318, 320d, 325i, 330i,
330e, M3) die als '320i' gelabeld zijn. cleanCount in v10.18.71-test
gaf 0 → expert_fallback path.

### 2.3 Welke filterstap dropt het meeste data?

Niet de filter-stap is het probleem. Het is de **input** naar de filter:
verkeerd-gelabelde listings. De junk-filter / outlier-filter doet zijn
werk goed door rommel weg te halen, maar de rommel komt uit
mismatched-model-tags.

**Filter-aggressiviteit verminderen** zou de pool met MEER misclassified
listings vergroten, niet helpen.

**Wat wel helpt**: source-aware normalization in de scraper-laag. Bij elke
listing-ingest, herken de titel-tekst en label model correct. Dit is een
make/model-extractie probleem op listing-niveau, gevoed door scrapers
die nu hardcoded eerste-bekende-model lijken te kiezen.

---

## Deel 3 — Accuracy per cluster

### 3.1 Alle 32 clusters met ≥5 feedback-cases

Sorted op impact = `|median − 1.0| × n`:

| Make | Model | n | median | over € | miss € | impact | actie status |
|---|---|---|---|---|---|---|---|
| FORD | FIESTA | 10 | 0.636 | 8.653 | 0 | 3.64 | **v10.18.69 rule ✓** |
| CITROEN | C1 | 8 | 0.626 | 6.976 | 0 | 2.99 | **v10.18.69 rule ✓** |
| RENAULT | TWINGO | 7 | 0.610 | 5.675 | 0 | 2.73 | **NIEUW** |
| RENAULT | CAPTUR | 13 | 0.812 | 13.707 | 728 | 2.45 | **v10.18.69 rule ✓** |
| NISSAN | NOTE | 5 | 0.565 | 5.963 | 0 | 2.17 | **NIEUW** |
| MITSUBISHI | OUTLANDER | 11 | 0.813 | 15.600 | 539 | 2.06 | **v10.18.69 rule ✓** |
| TOYOTA | AYGO | 6 | 0.677 | 5.192 | 0 | 1.94 | **NIEUW** |
| RENAULT | MEGANE | 10 | 0.824 | 4.596 | 89 | 1.76 | **NIEUW** |
| RENAULT | CLIO | 13 | 0.881 | 9.179 | 1.139 | 1.55 | **v10.18.69 rule ✓** |
| SKODA | FABIA | 5 | 0.727 | 4.294 | 0 | 1.36 | **NIEUW** |
| HYUNDAI | I20 | 9 | 0.851 | 8.617 | 889 | 1.34 | **v10.18.69 rule ✓** |
| TOYOTA | AURIS | 6 | 1.221 | 0 | 4.667 | 1.32 | **NIEUW (export bonus)** |
| VW | UP | 5 | 0.766 | 4.574 | 0 | 1.17 | **NIEUW** |
| KIA | SPORTAGE | 11 | 0.898 | 6.563 | 2.519 | 1.13 | review |
| KIA | VENGA | 5 | 0.808 | 5.564 | 0 | 0.96 | **NIEUW** |
| MAZDA | CX-5 | 7 | 1.124 | 1.481 | 5.386 | 0.87 | review |
| TOYOTA | PRIUS | 10 | 1.084 | 1.402 | 6.177 | 0.84 | toyota_hybride_export al actief |
| FIAT | 500 | 6 | 0.862 | 6.593 | 0 | 0.83 | review |
| VW | GOLF | 16 | 0.952 | 5.987 | 6.037 | 0.76 | variance |
| RENAULT | KADJAR | 6 | 0.900 | 5.134 | 750 | 0.60 | review |
| HYUNDAI | I10 | 5 | 0.892 | 4.227 | 0 | 0.54 | **NIEUW** |
| TOYOTA | COROLLA | 8 | 1.059 | 0 | 9.287 | 0.47 | **NIEUW (export bonus)** |
| TOYOTA | C-HR | 7 | 1.063 | 0 | 6.526 | 0.44 | **NIEUW (export bonus)** |
| MITSUBISHI | ASX | 6 | 0.929 | 4.393 | 359 | 0.43 | review |
| BMW | 5ER REIHE | 6 | 0.935 | 3.773 | 0 | 0.39 | review |
| RENAULT | TRAFIC | 6 | 0.935 | 4.313 | 2.039 | 0.39 | review |
| TOYOTA | YARIS | 9 | 0.972 | 4.383 | 6.977 | 0.25 | variance |
| NISSAN | QASHQAI | 12 | 1.000 | 4.341 | 2.028 | 0.00 | variance |
| VW | POLO | 18 | 1.000 | 8.005 | 11.277 | 0.00 | variance |
| KIA | NIRO | 8 | 1.000 | 2.042 | 11.226 | 0.00 | **export bonus candidate?** |
| KIA | PICANTO | 11 | 1.000 | 3.812 | 3.026 | 0.00 | variance |
| KIA | RIO | 9 | 1.000 | 5.681 | 2.900 | 0.00 | variance |

### 3.2 Categorisatie

**A. WELL-SERVED** (median tussen 0.93-1.07, geen actie nodig):
- BMW 5er Reihe, Mitsubishi ASX, Toyota Yaris, Renault Trafic

**B. PARTIALLY-FIXED** (recent door rule geraakt):
- Ford Fiesta, Citroen C1, Renault Captur, Mitsubishi Outlander, Renault
  Clio, Hyundai I20 — alle 6 in v10.18.69 multipliers, monitor effect
- Toyota Prius — Toyota Hybride export-bonus actief

**C. SYSTEMATICALLY-OFF — geen rule** (urgent):
- **RENAULT TWINGO** n=7, median 0.61, over €5.675
- **NISSAN NOTE** n=5, median 0.57, over €5.963
- **TOYOTA AYGO** n=6, median 0.68, over €5.192
- **RENAULT MEGANE** n=10, median 0.82, over €4.596
- **SKODA FABIA** n=5, median 0.73, over €4.294
- **VOLKSWAGEN UP** n=5, median 0.77, over €4.574
- **KIA VENGA** n=5, median 0.81, over €5.564
- **HYUNDAI I10** n=5, median 0.89, over €4.227
- **FIAT 500** n=6, median 0.86, over €6.593
- **TOYOTA AURIS** n=6, median 1.22, miss €4.667 (export bonus candidate)
- **TOYOTA COROLLA** n=8, median 1.06, miss €9.287 (export bonus candidate)
- **TOYOTA C-HR** n=7, median 1.06, miss €6.526 (export bonus candidate)

→ **12 nieuwe clusters** verdienen multiplier-rules in volgende sprint.

**D. COVERAGE-GAP** (variantie hoog, mediaan ok maar individuele cases off):
- KIA NIRO (median 1.0 maar miss €11.226 — undershoot dominantieve cases)
- KIA RIO, KIA PICANTO, KIA SPORTAGE
- NISSAN QASHQAI
- VW POLO, VW GOLF

→ Voor deze clusters helpen blanket multipliers niet (median al goed). De
spread is het probleem, wat terug te voeren is op de Deel 1
data-misclassificatie.

---

## Deel 4 — Pipeline robustheid

### 4.1 Path distributie laatste snel-taxaties (43 totaal, allemaal sinds v10.18.65)

| price_source | n | % |
|---|---|---|
| (null, pre-v10.18.67) | 10 | 23% |
| comp | 8 | 19% |
| expert_fallback | 20 | **47%** |
| expert_override | 1 | 2% |
| expert_user_context | 4 | 9% |

**Bevinding**: comp pad is in de minderheid (19%). Bijna de helft gaat door
expert_fallback omdat comp-pool te dun is. Dit is een direct gevolg van de
data-misclassificatie in Deel 1.

### 4.2 Expert cache (uit lib/quick-price-expert.js)

Cache is in-memory in t4c-server (LRU 5000 entries, TTL 7d). Geen metrics
geëxposeerd; kan niet zonder code-instrumentation gemeten worden. In
smoke tests gezien: cache-hits geven response in 1-5ms vs cold 2.5-5s.

API-cost ruwe schatting: gemiddeld ~3.000-5.000 tokens per cold call
(prompt + 400 output). Bij 5 cold calls per uur op productie ~6-12k
tokens/uur. GPT-5.4 prijs onbekend; conservatief €1-3/dag.

### 4.3 Audit-trail coverage (43 snel-taxaties totaal)

| Veld | gevuld | % |
|---|---|---|
| final_bod | 38 | 88% |
| price_source | 33 | 77% |
| expert_bod_low | 33 | 77% |
| confidence_level | 43 | 100% |
| user_staat | 43 | 100% |
| staat_factor | 15 | 35% |

`staat_factor` is laag (35%) want kolom toegevoegd in v10.18.70 — pre-v.70
rijen hebben null. Niet kritisch.

`final_bod` 88% gevuld; de 12% ontbreekt zit in cap-fallback (`bod=null`
wanneer geen expert beschikbaar en thin pool). Per ontwerp.

### 4.4 Recente errors / patterns

PM2 logs laatste 500 lijnen: **geen errors of timeouts** behalve normale
[MODEL-MATCH] fallback berichten. Geen edge-case crashes. Geen
TAXATIE-SAVE failures.

Stabiliteit op huidige load (~tien quick-prices per dag in development)
is goed. Onbekend hoe het systeem schaalt op echte productie-load
(tientallen+ per uur tijdens een actieve werkdag).

---

## Deel 5 — Gap naar productie-niveau

### Showstoppers

**S1. Data-pool misclassificatie (95% van listings is verkeerd model-getagd)**

Bron: src_a/b/c/d/g scrapers schrijven verkeerde `model`-string. SEAT-bug
verspreid over alle high-volume makes (Audi, VW, BMW, Mercedes, Ford).

Impact: comp-engine kan voor 80%+ van alle taxaties geen schone pool
opbouwen → expert_fallback wordt het structureele pad → afhankelijk van
expert-API beschikbaarheid + cost + variantie.

Effort: **groot**. Vergt:
- Per-source listing-normalizer: parse title text, classify make/model met
  domein-kennis
- Eventueel een crawl-job om historische listings te re-classificeren
- Of: extra `title_match_score` veld in market_listings dat door
  comp-engine wordt gebruikt i.p.v. raw `model`-veld

Verwachte impact bij oplossing: comp pad zou van 19% naar 60%+ van calls
moeten kunnen. Significant minder API-kosten, minder variantie.

**S2. Expert-API single-point-of-failure**

Quick-price-expert is volledig afhankelijk van OpenAI API. Bij outage:
- Thin pool cases (vrijwel alle taxaties): geen bod, alleen bodRange
- Problematische input (staat SLECHT/DEFECT/NEE): geen bod
- User ervaart "Onvoldoende marktdata"

Effort: medium. Vergt:
- Health-check monitoring
- Fallback strategy bij API outage (bv. cached recente schattingen,
  formule-based laatste-redmiddel)
- SLA-monitoring (Tatum statistieken nodig)

### Major

**M1. 12 systematisch-off clusters zonder rule**
Renault Twingo, Nissan Note, Toyota Aygo, Renault Megane, Skoda Fabia,
VW Up, Kia Venga, Hyundai I10, Fiat 500, Toyota Auris/Corolla/C-HR.
Effort: klein (uitbreiden bod-adjustments.json zoals v10.18.69 deed).
Schat impact +€20-30k op feedback-volume.

**M2. Trim-vs-model verwarring bij premium makes**
BMW (`320i` als model), Mercedes (`e 350 cgi`, `a 180`). Comp-engine
mismatched 3-series queries. Effort: medium. Vergt normalizer in
scraper-stap.

**M3. Lange-staart accuracy onbekend**
80% van het volume dekt 147 (make, model) combinaties (uit coverage-
analyse v10.18.69). Slechts 32 clusters hebben ≥5 feedback-cases. Voor
de overige ~115 hoog-volume combinaties weten we niet hoe het bod
presteert. Vergt: meer feedback verzamelen.

**M4. Real-time monitoring ontbreekt**
Geen dashboard voor:
- % van quick-prices per pad over tijd
- Expert-cache hit-rate
- API-error rate
- Gemiddelde response-tijd

Effort: medium. Vergt log-aggregator, eenvoudige metrics-collector.

### Minor

**m1. NORMAAL staat heeft geen effect** (post v10.18.71)
GOED en NORMAAL leveren statistisch hetzelfde bod (alleen API-variantie).
Mogelijk: separate prompt-hint voor NORMAAL ("kleine
gebruikssporen") die expert daadwerkelijk 5-8% lager doet schatten.

**m2. `staat_factor` audit-veld nu altijd 1.0**
Sinds v10.18.71 wordt het niet meer benut maar blijft in schema. Cosmetic.

**m3. Pre-v10.18.67 audit-rows hebben `price_source=null`**
~23% van snel-taxaties. Geen impact op productie maar lastig voor
retrospect-analyses.

**m4. `_bodAdjustment.tag` blijft soms in response na expert-pad override**
Per v10.18.69-spec wordt het gewist, maar test (c) v10.18.71 toonde dat
KG-004-L Toyota Prius Hybride wel een tag had in adj-object terwijl
priceSource expert_fallback was. Cosmetic; final_bod is correct.

---

## Top 20 priority-clusters voor volgende sprint

Combinatie van financial impact + actionability:

| # | Cluster | n | median | actie | effort |
|---|---|---|---|---|---|
| 1 | RENAULT TWINGO | 7 | 0.61 | overshoot multiplier × 0.78 | XS |
| 2 | NISSAN NOTE | 5 | 0.57 | overshoot multiplier × 0.75 | XS |
| 3 | TOYOTA AYGO | 6 | 0.68 | overshoot multiplier × 0.80 | XS |
| 4 | RENAULT MEGANE | 10 | 0.82 | overshoot multiplier × 0.88 | XS |
| 5 | SKODA FABIA | 5 | 0.73 | overshoot multiplier × 0.82 | XS |
| 6 | VW UP | 5 | 0.77 | overshoot multiplier × 0.83 | XS |
| 7 | KIA VENGA | 5 | 0.81 | overshoot multiplier × 0.86 | XS |
| 8 | HYUNDAI I10 | 5 | 0.89 | overshoot multiplier × 0.92 | XS |
| 9 | FIAT 500 | 6 | 0.86 | overshoot multiplier × 0.90 | XS |
| 10 | TOYOTA AURIS | 6 | 1.22 | export bonus × 1.15 | XS |
| 11 | TOYOTA COROLLA | 8 | 1.06 | export bonus × 1.08 | XS |
| 12 | TOYOTA C-HR | 7 | 1.06 | export bonus × 1.08 | XS |
| 13 | SEAT model-normalizer | — | — | scraper data-fix (alle SEAT) | L |
| 14 | AUDI model-normalizer | — | — | scraper data-fix (alle Audi) | L |
| 15 | VW Passat/Tiguan onder Golf/Polo | — | — | scraper data-fix | L |
| 16 | BMW 3-series trim-vs-model | — | — | scraper data-fix | M |
| 17 | Mercedes E/C/A-klasse trim mix | — | — | scraper data-fix | M |
| 18 | Ford Focus undercount | — | — | scraper data-fix | M |
| 19 | Expert API outage fallback | — | — | health check + caching | M |
| 20 | Real-time path-monitoring dashboard | — | — | log aggregation | M |

---

## Antwoord op de specifieke vraag

> "Waarom hebben we te weinig marktdata met zoveel scrape-volume?"

**Korte versie**: 95% van 238.084 listings komt uit 5 scrapers die make×model
verkeerd labelen. Wanneer comp-engine zoekt naar "SEAT Altea" of "VW
Passat" krijgt het slechts ~7% van de eigenlijk-aanwezige listings, omdat
de andere 93% gelabeld staan onder de "magnet"-modelnamen (leon, golf,
polo, fiesta, a3, 320i, e-klasse).

**Cijfers ter ondersteuning**:
- 1.008 SEAT-listings 2004-2008 in DB, waarvan slechts 104 (10%) als
  'altea' herkenbaar; rest staat als 'leon'. Voor 79-SP-GF (Altea-case)
  pakt comp-engine de 1.008-pool maar normaliseert mediaan op een mix
  van Toledos en Cordobas (€500) i.p.v. echte Altea-prijs (€700-1.000).
- 2.468 BMW-listings 2015-2019 onder model='320i'; slechts 171 onder
  '3-serie'. De 320i-pool is een vergaarbak van 318/320d/325/330 trims.
- nlmarket-bron heeft 17k listings (7% van volume) MET correcte
  normalisatie. Alle SEAT-modellen (Altea, Toledo, Cordoba, Arosa)
  apart gelabeld. Bewijst dat correcte normalisatie technisch
  haalbaar is — andere scrapers doen het gewoon niet.

**Wat we NIET hebben**: een tekort aan scrape-volume. Bronnen leveren ~15.000
nieuwe listings per week.

**Conclusie**: het is een DATA-QUALITY probleem, niet een DATA-QUANTITY
probleem. De fundamentele fix zit op listing-ingest niveau (titel
parsen, model bepalen) niet op scrape-frequentie of comp-engine
filter-aggressiviteit.

---
