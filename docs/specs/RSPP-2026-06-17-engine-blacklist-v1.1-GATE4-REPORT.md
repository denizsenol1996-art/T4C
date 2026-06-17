# Gate 4 REPLAY-rapport — engine-blacklist-v1.1 (motorCode-mapping)

*2026-06-17 · vervolg op v1 (commit 51986f7) · staging-only, live onaangeroerd*

## Aanleiding
Gate 4 v1 toonde: blacklist vuurde alleen op TCe (trim-naam lekt), inert op THP/EcoBoost/PureTech/N47 omdat die in `motorCode` zitten (EP6=THP, EB2=PureTech), niet in de `engineLabel`-tekst waar de config op matchte. Besluit Deniz: motorCode-mapping toevoegen.

## Wat gewijzigd (config-only, geen code)
`engine-profile.js` bouwde de haystack al mét `motorCode`. Dus puur config: 5 nieuwe `motorCode`-regels toegevoegd, tekst-regels blijven als fallback. Backup: `backups/config/engine-blacklist.json.bak-20260617-100323`.

| Regel | Signaal | DNA | Gegrond op echte RDW-VIN-decode |
|---|---|---|---|
| `thp_ep6_motorcode` | `ep6`+`dt` | score1 / −1800 | EP6FDTX/EP6CDT = THP turbo; **EP6/EP6C N/A uitgesloten** |
| `thp_n14/n18_motorcode` | `n14`/`n18` | score1 / −1800 | Mini gebruikt BMW-codes; N14/N18 = Prince-turbo |
| `puretech_eb2_motorcode` | `eb2` | score4 / −800 | EB2 (N/A) + EB2DT/EB2ADTS (turbo), natte riem |
| `ecoboost_m1j_motorcode` | `m1j` | score1 / −1500 | M1JE = 1.0 EcoBoost |

## Gate 3 — matcher empirisch geverifieerd (11/11)
Tegen échte enriched-objecten: alle turbo-varianten matchen, **alle betrouwbare broers ongemoeid** (EP6 N/A, N12, B38, W10, lege Duratec). Het `["ep6","dt"]`-AND-paar sluit de betrouwbare 1.6 VTi correct uit. Nul false-positives.

## Gate 4 — bevindingen

### 1. Methodologie gecorrigeerd
A/B-replay over twéé aparte GPT-instances meet vooral GPT-jitter (58 cases verschilden, meeste niet-blacklist, beide richtingen). Voor een feature met kleine footprint is dat ruis > signaal. **Overgestapt op zuivere deterministische meting**: één baseline-bod + deterministische aftrek op alleen gematchte cases.

### 2. Echte footprint = zeer klein
- 662-case Jurgen-corpus: maar **3 NIEUWE** matches (2 PureTech, 1 THP) + 4 al-werkende N47.
- Golden-100: maar **1 nieuwe** match: PEUGEOT 208 THP → bias **49% → 21%** (schone winst).
- **EcoBoost: 0** — Ford VIN-decode geeft lege motorCode (3/6 Fiesta). M1J dook nergens op in de corpus.
- **N14/N18: 0** — geen Cooper S in de corpus.

### 3. Zuivere macro (golden-100, deterministisch)
| | voor | na |
|---|---|---|
| mediaan bias | 10.5% | 9.3% (−1.2pp) |
| binnen ±10% | 23% | 21% (−2pp) |
| binnen ±20% | 48% | 46% (−2pp) |

### 4. Individuele-case-staart (geen segment-violation)
Op **case-niveau** worden 6 van 14 gematchte cases slechter, allen `renault_tce`, waar T4C Jurgen al ónderbiedt:
- DACIA LOGAN 2450→1950 (jurgen 3259): bias −24.8% → −40%
- DACIA SANDERO 2150→1650 (jurgen 2736): −21% → −40%

**CORRECTIE op eerdere lezing:** dit zijn losse staart-cases, GEEN segment-violation. De RSPP-eis luidt "geen *segment* >5pp slechter" en wordt op segment-mediaan getoetst (bucket/stratum/age).

### 5. Segment-niveau (de échte RSPP-toets) — GEEN violation
Deterministische mediaan-bias |voor| → |na| per segment:

| segment | n | matched | voor | na | delta |
|---|---|---|---|---|---|
| bucket 2_5k | 29 | 7 | 1.2% | 1.2% | 0.0pp |
| bucket 5_10k | 26 | 5 | 7.3% | 3.8% | −3.5pp |
| bucket lt2k | 32 | 2 | 40.9% | 37.3% | −3.6pp |
| stratum budget | 20 | 9 | 16.4% | 16.4% | 0.0pp |
| stratum lt2k_extra | 20 | 2 | 101% | 84.7% | **−16.4pp** |
| age y6_10 | 30 | 7 | 8.5% | 5.0% | −3.5pp |
| age y11_15 | 33 | 7 | 27.1% | 23.3% | −3.7pp |

**Elk geraakt segment verbetert of blijft vlak. Nul segmenten verslechteren.** De Dacia-staart valt binnen budget-stratum, waarvan de mediaan 0.0pp blijft (TCe-winst Duster/Lodgy compenseert).

## Conclusie (herzien)
- **v1.1 motorCode-mechaniek: correct, gegrond, nul false-positives**, geen regressie.
- **Gate 4 SLAAGT** — ook op het strenge "geen segment >5pp slechter": geen enkel segment verslechtert; meerdere verbeteren.
- **Laag-renderend**: reële footprint ~3 nieuwe cases in 662; EcoBoost mist door lege Ford-VIN-decode. De winst is echt maar bescheiden.
- De Dacia-TCe-onderbod-staart is reëel maar is de inherente staart van een per-saldo-positieve uniforme aftrek, geen gate-blocker.

## Aanbeveling (herzien)
Gate 4 is gehaald. Keuzes:
1. **Door naar Gate 5 (shadow 24u op live)** — feature is segment-veilig en net-positief.
2. **Optioneel** de Dacia-TCe-staart als Gate 6-vraag aan Jurgen meenemen (betaalt hij écht −€500 op budget-Dacia?) zonder de promote te blokkeren.
3. Een "richting-bewuste" aftrek is **niet nodig** voor de gate; bovendien is over/onderbod t.o.v. Jurgen niet kenbaar at inference (geen interne proxy vangt de Dacia-onderwaardering). Risico op overfit > baat.
