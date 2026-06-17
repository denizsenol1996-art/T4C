# Jurgen Pricing-DNA — complete framework + vertaling naar T4C-stack

Datum: 2026-06-17 (ronde 2)
Bron: Jurgen tegenover Deniz, plus Jurgen's eigen ChatGPT-uitwerking.
Doel: dit doc is de canonieke vertaling van zijn brein naar code/configs.

---

## Kernfilosofie (waarom het werkt)
- AutoTelex/JP Cars: *"wat is auto waard?"* → boekwaarde-spel.
- Jurgen: *"hoe snel verander ik dit weer in geld met €600-750 marge?"* → liquiditeit-spel.
- T4C-positionering: **niet sneller op waarde-berekening, wel beter op liquiditeit + risico-detectie**.

## De score-architectuur

### Startpunt
Elke auto = **score 10** (perfecte auto). Score 10 = 1e eigenaar, NL origineel, geen schade, vol historie, 2 sleutels, courante kleur, courante uitvoering, lage km voor leeftijd, APK ruim, betrouwbare motor/bak, snel verkoopbaar.

Score 1-3 = oude schade-import met 5+ eigenaren, motorlampje + storingen, hoge km, kale uitvoering.

### 8 hoofdblokken (gewichten)
| # | Blok | Gewicht | Schaal |
|---|---|--:|---|
| 1 | Technische betrouwbaarheid (motor/bak-reputatie) | 35% | 1-10 |
| 2 | Marktcourantheid (vraag/aanbod) | 25% | 1-10 |
| 3 | Importanalyse | 15% | aftrek-cijfer |
| 4 | Eigenarenhistorie | 10% | aftrek-cijfer |
| 5 | Onderhoudshistorie | 10% | aftrek-cijfer |
| 6 | Ex-verleden (taxi/WOK/CD/les) | apart | aftrek-cijfer |
| 7 | Uitvoering + opties | apart | aftrek + bonus |
| 8 | Bedrijfspsychologie | apart | ±1-3% |

Plus aparte dimensies: kilometerstand-vs-leeftijd, prijsvolatiliteit, marktliquiditeit.

---

## Concrete cijfers per dimensie

### Eigenaren-aftrek
| eigenaren | aftrek (score-punten) |
|---|--:|
| 1e | 0 |
| 2e | −0,25 |
| 3e | −0,5 |
| 4e | −1 |
| 5+ | −1,5 |

### Historie-aftrek
| status | aftrek |
|---|--:|
| volledig boekje + stempels | 0 |
| dealer-onderhouden | +bonus (2%) |
| gedeeltelijk / facturen | −0,75 |
| geen historie | −1,5 |

### Sleutel-aftrek
| sleutels | aftrek |
|---|--:|
| 2 | 0 |
| 1 | −0,25 tot −0,5 |

### Technisch-mankement-aftrek
| Mankement | aftrek (score-punten) |
|---|--:|
| Motorlampje zonder klachten | −1 |
| Motorlampje + inhouden | −3 |
| Stotteren / overslag cilinders | −4 |
| Bak slipt / schakelt slecht | −4 |
| Airco defect | −0,75 |
| Voorruit barst | −0,5 tot −1 |
| Cosmetische schade | −0,5 tot −1 |
| Scheve bumpers | middel-zwaar |
| Dashboard-storingen | middel-zwaar |

### Import-aftrek
| situatie | aftrek |
|---|--:|
| origineel Nederlands | 0 |
| logische import (>1 jaar, kloppende BPM) | −0,5 |
| recente import (<3 maanden) | −1,5 |
| onlogische lage BPM | −2,5 |
| schade-import | −4 |

### Ex-verleden-aftrek
| verleden | aftrek | % effect |
|---|--:|--:|
| geen | 0 | 0 |
| taxi | −3 | −20% |
| WOK | −4 | −30% |
| CD-kenteken | −2 | −15% |
| rijschool | −2 | −15% |

### Motor-categorie (technische betrouwbaarheid 1-10)
| score | motoren |
|--:|---|
| 10 | Toyota hybride · Lexus hybride · Honda · Mazda Skyactiv · Suzuki · sommige Volvo's |
| 8 | Kia · Hyundai · Toyota benzine · Mazda benzine |
| 6 | VW TSI (goede gen) · Renault TCe (gen-afhankelijk) · Volvo benzine |
| 4 | Peugeot PureTech · BMW N47 · Opel 1.4 Turbo |
| 1 | THP · EcoBoost 1.0/1.5/1.6 · DSG-probleem-gen · CVT-probleem-gen · risicodiesels |

### Km-grenzen per brandstof
**Benzine**:
- 0-180k = neutraal
- 180-225k = licht negatief
- 225-250k = zwaar negatief
- 250k+ = niche

**Diesel**:
- 0-300k = neutraal
- 300-350k = licht negatief
- 350k+ = zwaar negatief
- <2,0 liter motor = exporteerbaar
- >2,0 liter = importheffing andere landen
- Stand-op-kenteken 2L maar werkelijk 1999cc = zonder invoerbeveiliging

**Bus V-kenteken**: 400k km nog acceptabel

### Km-vs-leeftijd-norm (algemene auto)
- Normaal particulier: 8.000-12.000 km/jaar
- Onder gemiddeld: positief
- 25% boven gemiddeld: licht negatief
- 50% boven: fors negatief
- 100% boven: zwaar negatief

### Markt-liquiditeit (T4C-score 1-10)
| % verkocht binnen X dagen | score |
|---|--:|
| 70% binnen 30 dagen | 9-10 |
| 50% binnen 45 dagen | 7-8 |
| 30% binnen 60 dagen | 5-6 |
| <30% binnen 90 dagen | 3-4 |
| blijft massaal staan | 1-2 |

### Prijsvolatiliteit (apart)
Verschil tussen laagste-km en hoogste-km versie van zelfde model = volatiliteit-indicator.
- **Hoge volatiliteit** (zoals Kadjar: €12k vs €5,5k) → voorzichtiger bieden + grotere risicomarge
- **Lage volatiliteit** (Toyota Verso: klein verschil 80k vs 180k) → bod kan dichter bij retail

### Uitvoering-aftrek/bonus (VW Golf als voorbeeld)
- Trendline (kaal, raamslingers, geen navi/cruise) = −5%
- Comfortline = +2%
- Highline (navi/camera/cruise/half-leder) = +5%

### Bedrijfspsychologie (mag tot ±3%)
- Veel verkocht recent: +1-3%
- Weinig verkocht: −1-3%
- Voorraad te laag: +2%
- Voorraad te hoog: −2%
- Seizoen gunstig: +2%
- Seizoen ongunstig: −2%

### T4C-Liquiditeitsscore (eindcijfer 0-100, Jurgen's gewenste merknaam)
| score | actie |
|---|---|
| 90-100 | direct kopen |
| 80-89 | agressief bieden |
| 70-79 | normaal bieden |
| 60-69 | alleen scherp kopen |
| 50-59 | niche |
| 0-49 | niet kopen |

---

## Gewenste output per taxatie (Jurgen's wens)
```json
{
  "kenteken": "XX-999-X",
  "vehicle": "Toyota Yaris Hybrid 2018",
  "mileage": 92000,
  "condition_score": 8.9,
  "technical_risk_score": 9.3,
  "market_liquidity_score": 9.1,
  "price_volatility_score": 4.2,
  "import_history_risk": 1.0,
  "t4c_liquidity_score": 91,
  "expected_retail_price": 13950,
  "expected_days_to_sell": 8,
  "risk_margin": 1150,
  "b2b_purchase_advice": 12175,
  "explanation": "Zeer courante Toyota hybride met lage technische risico's, goede km en sterke liquiditeit. Agressief bieden."
}
```

---

## Vertaling naar T4C-stack — concrete fixes/uitbreidingen

### Stap 1: Configs (laag risico, deze sessie of volgende)

**`backend/config/engine-blacklist.json`** (NIEUW)
Motor-categorieën met aftrek-bedragen + match-condities (engineLabel/motorCode):
```json
{
  "engines": [
    {"category": "ecoboost_1_0", "score": 1, "aftrek_eur": 1500,
     "match": {"engineLabel_contains": ["ecoboost", "1.0t"], "fuel": "benzine"}},
    {"category": "thp_1_6", "score": 1, "aftrek_eur": 1800,
     "match": {"engineLabel_contains": ["thp", "1.6"], "make_in": ["PEUGEOT","CITROEN","BMW","MINI"]}},
    {"category": "thp_1_2", "score": 2, "aftrek_eur": 1200,
     "match": {"engineLabel_contains": ["thp", "1.2"]}},
    {"category": "tce_renault_nissan", "score": 4, "aftrek_eur": 500,
     "match": {"engineLabel_contains": ["tce"], "make_in": ["RENAULT","NISSAN","DACIA"]}},
    {"category": "nissan_cvt_old", "score": 3, "aftrek_eur": 1000,
     "match": {"make": "NISSAN", "transmissionDetail_contains": "cvt", "km_gte": 150000}}
  ]
}
```

**`backend/config/pricing-rules.json`** (NIEUW)
```json
{
  "margin_floor_eur": 700,
  "margin_quick_sale_eur": 750,
  "standtijd_buckets": {
    "snel": {"max_days": 60, "margin_pct": 8},
    "normaal": {"max_days": 120, "margin_pct": 12},
    "langzaam": {"max_days": 180, "margin_pct": 18},
    "verlies_zone": {"max_days": null, "margin_pct": 25}
  },
  "km_thresholds": {
    "benzine": {"neutral_until": 180000, "light_until": 225000, "heavy_until": 250000, "niche": 999999},
    "diesel":  {"neutral_until": 300000, "light_until": 350000, "heavy_until": 999999, "niche": 999999},
    "bus_v":   {"neutral_until": 400000, "light_until": 999999, "heavy_until": 999999, "niche": 999999}
  },
  "km_per_year_normal": {"min": 8000, "max": 12000}
}
```

**`backend/config/sloop-detection.json`** (NIEUW — <€2k auto's)
Criteria die samen sloop-categorie forceren:
- absentie airco
- absentie stuurbekrachtiging
- 3-deurs waar 5-deurs gangbaar
- APK verlopen/binnen 30 dagen
- zichtbare schade
- score-drempel: ≥3 van deze 5 = sloop-route, bod-curve ratio 0,15-0,20

### Stap 2: matchBodAdjustment helper uitbreiden
Huidige `matchBodAdjustment` (valuation.js:24) doet alleen make/model/fuel/km/year. Uitbreiden met:
- `engineLabel_contains` (array van substrings)
- `motorCode_contains`
- `transmissionDetail_contains`
- `make_in` (array)
- `body` match (voor "bus V-kenteken")
- `aftrek_eur` als alternatief voor `factor` (vaste euro-aftrek)

### Stap 3: GPT-prompt-uitbreidingen (op bench)
- **Score-architectuur instructie**: "Begin elke auto op score 10. Trek af per dimensie. Geef per dimensie aparte sub-score."
- **R/M-Line lagen-detectie**: prompt vragen "Welke laag? 1× (alleen exterieur), 2× (+ interieur), 3× (+ motor)?"
- **Cilinder-detectie**: "3 of 4 cilinders? Belangrijk voor courantheid."
- **Incourant-flag**: bij <40 vergelijkbare listings → "terug naar basis", agressievere risicomarge
- **Verwijderen**: oude BMW 535i 289k-anker, REGIONAAL-clausule

### Stap 4: Trade-engine uitbreiden
- **Marge-floor €700** hard inbouwen (geen bod < €700 marge mogelijk)
- **sellSpeed-buckets** afstemmen op Jurgen's 60/120/180-grens (niet huidige 30/60/120/120+)
- **Recon-aftrek** inschakelen (was dead-code) — bedrag nog open bij volgende ronde

### Stap 5: Output-uitbreiding
Response per taxatie krijgt 5 nieuwe scores (1-10) + T4C-Liquiditeitsscore (0-100):
- `condition_score`
- `technical_risk_score`
- `market_liquidity_score`
- `price_volatility_score`
- `import_history_risk`
- `t4c_liquidity_score`

Display via channel-engine of nieuw `_jurgen_scores`-veld.

### Stap 6: Feedback-flow uitbreiden in `/app/`
Per Jurgen's voorstel — feedback-knop na elke deal slaat op:
- gevoel_factor (-3 tot +3)
- technische_betrouwbaarheid (1-10)
- courantheid (1-10)
- import_risico (0-10)
- onderhoud (0-10)
- uitvoering (1-10)
- historie (0-10)
- ex_verleden (0-4)
- eigenaren (1-5+)
- kleur (1-10)

Na 1000 rijen = ML-trainingsset.

### Stap 7: Prijsvolatiliteit-meter (nieuw)
Voor elk model: bereken delta tussen p25-km en p75-km versie. Hoge delta = grotere risicomarge.

### Stap 8: Marktliquiditeit-meter
Uit `market_listings` + `days_on_market`: bereken per model "% verkocht binnen 30/45/60/90 dagen". Geeft liquiditeitsscore 1-10.

---

## Prioriteit (mijn voorstel)

**Veilig + snel resultaat** (kan deze sessie):
1. Maak `engine-blacklist.json` + `pricing-rules.json` als CONFIG (geen code-edit)
2. Documenteer alle Jurgen-cijfers in een centraal config-bestand
3. Update memory

**Op bench eerst, daarna live** (volgende sessie):
4. `matchBodAdjustment` uitbreiden voor engine-matching
5. GPT-prompt-uitbreidingen (score-architectuur, R/M-Line lagen, incourant-flag)
6. Trade-engine marge-floor €700

**Groter werk** (volgende sessies):
7. T4C-Liquiditeitsscore als eind-output
8. Volatiliteit-meter
9. Markt-liquiditeit-meter (uit days_on_market)
10. Feedback-flow uitbreiding in /app/

## Open vragen voor Jurgen (ronde 3)
1. **Reconditie-bedrag**: gemiddeld + per prijsklasse?
2. **Marge: vast bedrag of percentage?** (sommige aanwijzingen €700 vast, andere "Highline +5%")
3. **Volledige incourante-lijst**: meer dan Subaru XV / Audi S3 2005 / Yaris GR / Lotus Elise / Mustang?
4. **Seizoensgebondenheid**: welke maanden/segmenten?
5. **Voorraad-gevoeligheid**: bij hoeveel auto's "te veel" = bod-discount?
6. **Sloop-route concreet**: onderdelen-handel, export-koper, schroothandel?

## Belangrijkste niet-getroffen rules uit ronde 1 (blijven valid)
- 2 maanden standtijd-target / 6 maanden verlies-zone
- €600-700 marge-floor / €750 bij snelle verkoop
- R-/M-Line in lagen (1×/2×/3×)
- Cilinders 3 vs 4 doet ertoe
- Leder = geen prijs-criterium
- Qashqai basis-uitvoering = onverkoopbaar
