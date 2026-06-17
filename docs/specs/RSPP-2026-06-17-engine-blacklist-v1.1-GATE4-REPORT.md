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

### 4. ⚠️ KRITIEKE BEVINDING (pre-existing v1, nu zichtbaar)
De blanket TCe −€500 **verslechtert** de cases waar T4C Jurgen al ónderbiedt. 6 van 14 gematchte cases werden slechter, allen `renault_tce`:
- DACIA LOGAN 2450→1950 (jurgen 3259): bias −24.8% → **−40%**
- DACIA SANDERO 2150→1650 (jurgen 2736): −21% → **−40%**
- + Sandero, Logan, Lodgy, Kadjar idem

Schendt RSPP-eis "geen segment >5pp slechter". **Dit is v1-gedrag** (renault_tce bestond al); v1.1 voegt het niet toe — v1.1's enige golden-100-effect is de schone 208-winst. De originele Gate 4 miste dit door GPT-ruis.

## Conclusie
- **v1.1 motorCode-mechaniek: correct, gegrond, nul false-positives.** Voegt geen regressie toe.
- **Maar laag-renderend**: reële footprint ~3 nieuwe cases in de hele corpus; EcoBoost mist door lege Ford-VIN-decode.
- **Blokkerend voor promote**: de blanket absolute aftrek negeert richting → schaadt de Dacia/TCe-onderbod-cases >5pp. Ontwerpkwestie, niet motorCode-specifiek.

## Aanbeveling
Niet promoten zoals nu. Twee sporen voor Deniz/Jurgen:
1. **Aftrek richting-bewust maken** (alleen verlagen, niet onder een vloer / niet bij onderbod) — lost de Dacia-schade op.
2. **TCe-aftrek per segment herijken** met Jurgen: betaalt hij écht −€500 op een budget-Dacia, of geldt dat alleen op duurdere TCe? (Gate 6-vraag, nu urgenter.)
