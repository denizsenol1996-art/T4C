# Rock-Solid Pricing Pipeline (RSPP) — T4C

*Versie 1.0 · 2026-06-17 · Eigenaar: Deniz · Verplicht voor elke pricing-wijziging*

---

## Doel

Elke wijziging aan T4C-pricing-logica (prompt, formule, multiplier, curve, trade-engine, scoring) passeert dezelfde 6 gates. Pas bij **alle gates groen** gaat het live. Bij regressie automatisch rollback. Alles gedocumenteerd. Geen patches, geen ad-hoc fixes, geen "even snel".

## Waarom dit bestaat

De maanden vóór RSPP toonden:
- Pricing-wijzigingen die de bias verschoven zonder dat iemand het zag
- Multipliers gestapeld op multipliers om symptomen te bestrijden van eerdere fouten (16 negatieve overshoot-multipliers in mei 2026)
- Geen ground-truth-vergelijking → niemand kon zeggen of een fix het beter of slechter maakte
- Aannames ("our_bod = Jurgen-bod") die wekenlang fout waren

RSPP forceert kennis vóór actie en bewijs vóór live.

## Ground truth

`backend/data/t4c.db` → tabel `dealer_feedback` → kolom `sold_price` IS Jurgen's eigen bod (verwarrend genaamd; via UI `/app/` → POST `/api/feedback` met veld `eigen_bod` → opgeslagen als `sold_price`). Per 2026-06-17: 662 rijen, 662 met geldig kenteken.

Geheel Jurgen's mentale model staat in `JURGEN-PRICING-DNA-2026-06-17.md` — dat is de canonieke regelset.

---

## De 6 gates

### Gate 1: SPEC (voor codering begint)

**Wat**: 1-pagina-doc in `/opt/t4c/docs/specs/RSPP-<jjjj-mm-dd>-<korte-titel>.md`

**Inhoud verplicht**:
- Probleem (één zin)
- Voorgestelde wijziging (bestand + regel-aanduiding waar van toepassing)
- Verwachte effect op bias (richting + grootteorde per prijsklasse)
- Relatie tot Jurgen-DNA (welke regel/principe ondersteunt dit)
- Rollback-pad (één commit terug? config-flag uit?)
- Risico-segmenten (waar zou dit *slechter* kunnen worden?)

**Pass-criterium**: spec gecommit + user (Deniz) heeft 'm gelezen en ja gezegd.

### Gate 2: CODE-REVIEW TEGEN DNA

**Wat**: zelfreview van de wijziging tegen `JURGEN-PRICING-DNA-2026-06-17.md` + `STABILITEIT-PROTOCOL.md` + `SESSION-START-PROTOCOL.md`.

**Checklist**:
- [ ] Wijziging schendt geen hard-rule uit STABILITEIT-PROTOCOL §A
- [ ] Wijziging is consistent met Jurgen's regel (citeer welke)
- [ ] Backup gemaakt vóór edit voor critical files (server.js, db.js, lib/, routes/, configs)
- [ ] Geen aanname zonder verificatie (geen "we draaien sql.js", geen "our_bod = Jurgen-bod", etc.)
- [ ] Magic constants vermeden waar mogelijk (gebruik config)
- [ ] Geen B1-stijl `finalBod = finalHandel` patroon dat een complete engine dead-code maakt

**Pass-criterium**: alle items aangevinkt in commit-message body.

### Gate 3: UNIT-TESTS

**Wat**: pure-functie-tests in `/opt/t4c/backend/tests/`.

**Wat moet getest**: elke logic-tak die je raakt. Voor configs: parse-test + sanity-check (geen NaN, geen negatieve ratios, etc.).

**Minimal coverage**:
- Nieuwe functies: 100% branches
- Aangepaste functies: voorheen bestaande branches + nieuwe

**Pass-criterium**: `node /opt/t4c/backend/tests/run.js` geeft exit 0.

(Test-harnas wordt apart opgezet bij eerste RSPP-cyclus die het nodig heeft. Tot dan: ad-hoc test-script in spec opnemen.)

### Gate 4: GOLDEN-REPLAY

**Wat**: 100 hand-verkozen cases uit `dealer_feedback` (gestratificeerd) door **beide stacks** halen (huidige prod + voorgesteld), bias vergelijken tegen `sold_price` (= Jurgen-bod).

**Tooling**: `/opt/t4c/scripts/replay.js` + `/opt/t4c/fixtures/golden-cases-100.json` (klaargezet 2026-06-17).

**Pass-criteria**:
- Macro mediaan bias mag niet verslechteren (max +1pp)
- Geen segment (segment/prijsklasse/leeftijd) mag >5pp verslechteren
- Std-dev mag niet >2pp omhoog
- Aantal cases binnen ±10% van Jurgen: niet >2pp lager
- Voor elk segment met expliciete verbeter-doelstelling (zoals <€2k): vooruitgang aantoonbaar

**Output**: `bench-results-RSPP-<datum>.csv` + 1-pagina-rapport in spec-folder.

### Gate 5: SHADOW-MODE 24u

**Wat**: live productie doet **beide** berekeningen (huidig + voorgesteld) en logt verschil naar `shadow_log` tabel. Beslist met OUD voor klant — alleen meten.

**Implementatie**: feature-flag `RSPP_SHADOW_<naam>` env-variabele. Code-pad checkt flag, draait beide, logt delta.

**Pass-criteria**:
- 24u live verkeer (≥100 echte taxaties)
- Bias-verschuiving consistent met golden-replay (geen verrassing)
- Geen errors in `shadow_log.error` kolom
- Geen latency >10% boven baseline
- Geen geheugen-leak (RSS-groei)

**Output**: shadow-summary in spec-folder.

### Gate 6: JURGEN SIGN-OFF

**Wat**: 10 cases waarbij oud en nieuw het **meest verschillen** worden aan Jurgen voorgelegd. Hij zegt per case "oud beter" / "nieuw beter" / "geen voorkeur".

**Pass-criterium**: Jurgen vindt nieuw beter of gelijkwaardig op minimaal 7 van de 10.

**Output**: korte note in spec-folder met Jurgen's antwoorden.

### Promote naar live

Alle 6 gates groen → één commit `RSPP/<naam>: promote naar live`. Pas hier raakt productie de wijziging.

---

## Auto-rollback bij regressie

Na promote draait een **48u-monitoring**:
- Vergelijk live bias-meting met golden-replay-baseline
- Bij afwijking >5pp op macro mediaan → automatische config-flag terug + alert
- Watchdog uitbreiding nodig om dit te enforcen (Fase 5-item)

## Doc-standards per RSPP-cyclus

Elke voltooide cyclus produceert:
1. **Spec-doc** in `/opt/t4c/docs/specs/`
2. **Commit-keten** met messages in format `RSPP/<naam>: <gate-naam>`
3. **Memory-entry** als rule veranderd is, als reference, of als learning
4. **Decision-log entry** in `/opt/t4c/docs/OPERATIONS-BOOK.md` (eenmalig aan te maken)
5. **System-map update** in `00-SYSTEEMKAART-T4C.md` overlay-sectie

## Commit-message format

```
RSPP/<naam>: <gate-naam>

Spec: docs/specs/RSPP-<jjjj-mm-dd>-<naam>.md
Gate: 1-SPEC | 2-REVIEW | 3-UNIT | 4-REPLAY | 5-SHADOW | 6-SIGNOFF | PROMOTE

Body:
- DNA-regel(s) die ondersteunt: [citaat]
- Bestand(en) geraakt: [paden + regelnrs]
- Verwacht effect: [richting + grootte]
- Rollback: [hoe terug]
```

## Wie mag RSPP gates skippen

Niemand. Geen patches om "snel iets te fixen". Als productie acuut kapot is: rollback naar laatste werkende commit (Gate 6-output), dan RSPP-cyclus voor de echte fix.

## Wat NIET onder RSPP valt

- Infra-fixes (backup-cron, monitoring, restart-bescherming) — eigen lichter pad
- Doc-updates
- Configs die geen pricing raken (logging, env-vars zonder pricing-effect)
- Frontend-werk dat geen pricing-API raakt

## Quick-reference per gate

| Gate | Bestand-output | Door wie | Hoe lang |
|---|---|---|---|
| 1 SPEC | spec-doc | Claude + Deniz akkoord | 15-30 min |
| 2 REVIEW | commit-message body | Claude | 5 min |
| 3 UNIT | test-output | Claude | 10-30 min |
| 4 REPLAY | bias-CSV + rapport | Claude (autom.) | 20-40 min (incl. GPT-calls) |
| 5 SHADOW | shadow-summary | Claude (24u wait) | 24 uur + 30 min analyse |
| 6 SIGNOFF | Jurgen-note | Deniz + Jurgen | per case ~2 min |
| PROMOTE | live-commit | Claude + Deniz akkoord | 5 min |

**Totale doorlooptijd per cyclus**: ~3 uur engineering + 24u shadow + Jurgen-tijd.

## Eerste geplande RSPP-cyclus

**RSPP/engine-blacklist-v1**: pas Jurgen's motor-categorieën toe via `engine-blacklist.json` (klaargezet 2026-06-17) en uitbreiding van `matchBodAdjustment` in `valuation.js`.

Te starten zodra:
- Staging-instance draait (Cluster 2)
- Golden-cases set klaar (klaargezet 2026-06-17)
- Replay-engine getest (klaargezet 2026-06-17)

## Verboden anti-patterns

- ❌ "Even snel een multiplier toevoegen"
- ❌ "Het werkt op deze ene auto, dus we kunnen live"
- ❌ "Jurgen vindt het mooi op het oog, geen replay nodig"
- ❌ "Het is maar een config, geen spec nodig"
- ❌ "Shadow-mode komt later wel"
- ❌ "Auto-rollback regelen we als het misgaat"

---

*Wijziging aan dit doc alleen op expliciet user-akkoord. RSPP is bindend.*
