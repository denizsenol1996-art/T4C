# RSPP-spec — engine-blacklist-v1

*Gate 1 SPEC · 2026-06-17 · Cyclus `RSPP/engine-blacklist-v1` · Status: WACHT OP AKKOORD*

---

## Probleem (één zin)
T4C's bod houdt geen rekening met motor-betrouwbaarheid: een Ford 1.0 EcoBoost of PSA 1.6 THP krijgt hetzelfde bod als een betrouwbare motor, terwijl Jurgen daar structureel een reparatie-reserve aftrekt (DNA: technische betrouwbaarheid = 35% van zijn oordeel).

## Voorgestelde wijziging
Sluit de klaargezette `backend/config/engine-blacklist.json` aan op de bod-pijplijn via een **nieuwe matcher** in `backend/routes/valuation.js`.

- **Nieuw**: `matchEngineProfile(vehicle)` (naast bestaande `matchBodAdjustment`, ~regel 24). Bouwt één haystack `${engineLabel} ${motorCode} ${transmissionType} ${transmissionDetail} ${subModel}` (lowercase) en matcht de `*_contains`-arrays + `make`/`make_in`/`fuel`/`km_gte` uit de config. Retourneert `{id, score, aftrek_eur}` of `null`.
- **Toepassing**: als absolute EUR-aftrek op `finalBod`, **ná de bod-curve** (valuation.js:1042) en symmetrisch in het quick-price-pad (rond regel 1356). Formule: `finalBod = Math.round((finalBod - aftrek) / 50) * 50`, met guardrails (zie onder).
- **Config blijft de bron**: geen magic constants in code; alle bedragen/condities in `engine-blacklist.json`.

### Waarom een aparte functie (afwijking van SESSION-STATE "matchBodAdjustment-uitbreiding")
`matchBodAdjustment` werkt met een **factor (×)** en een smaller match-schema. De blacklist gebruikt **absolute `aftrek_eur`** + arrays/`make_in`/`motorCode`/`transmissionDetail`. Die in één functie persen levert een B1-achtige overlading op (twee betekenissen in één pad). Een aparte `matchEngineProfile` is schoner en los testbaar. Functioneel blijft het "de bod-adjustment-stap uitbreiden" — alleen netjes gescheiden. **Beslissing 1 voor Deniz.**

## Verwacht effect op bias (richting + grootteorde)
- **Alleen op matchende auto's** (Ford EcoBoost, PSA THP/PureTech, Renault/Nissan TCe, BMW N47, Opel 1.4T, Nissan CVT high-km). Macro-mediaan beweegt nauwelijks; segment-bias op die motoren daalt.
- **Richting**: bod omlaag → minder overshoot op risico-motoren. Kan de bekende **<€2k overshoot (+38%)** deels helpen voor zover dat goedkope risico-motoren zijn.
- **Grootteorde**: −€500 tot −€1.800 op een auto rond €5-10k (config = richtgetal op die klasse).

## Relatie tot Jurgen-DNA
- DNA §"Motor-categorie (technische betrouwbaarheid 1-10)" r.93-100: score 1 = THP · EcoBoost 1.0/1.5/1.6 · CVT-probleem-gen · risicodiesels; score 4 = PureTech · BMW N47 · Opel 1.4T.
- DNA §score-architectuur r.24: technische betrouwbaarheid weegt **35%** — zwaarste enkele dimensie.
- Config-`evidence`-velden citeren de DNA per regel.

## Open beslissingen (vraag akkoord)
1. **Aparte `matchEngineProfile` vs. inbouwen in `matchBodAdjustment`.** Aanbeveling: apart.
2. **Scope v1 = alléén aftrek (blacklist), géén `positives`/`bonus_eur`.** Aanbeveling: ja — conservatief, past bij de naam "blacklist", lager overshoot-risico, makkelijker Jurgen-sign-off. Positives → v2.
3. **Guardrails tegen te grote aftrek op goedkope auto's.** Aanbeveling: `aftrek = min(aftrek_eur, 0.25 × finalBod)` én `finalBod` mag nooit < €0 (sloop-floor volgt in aparte cyclus). Zonder dit kan −€1.500 een €1.800-bod halveren.
4. **Stapeling met bestaande `bod-adjustments.json` overshoot-factor** (bv. Ford Fiesta 0.85 × én EcoBoost −€1.500). Aanbeveling: voor v1 beide toepassen + beide loggen; Gate 4-replay en Gate 6 oordelen of het dubbeltelt. Niet vooraf onderdrukken zonder bewijs.

## Risico-segmenten (waar wordt het mogelijk slechter?)
- **Goedkope risico-motor-auto's** (€1-3k): absolute aftrek te zwaar → guardrail 3 dekt dit, replay moet bevestigen.
- **Dubbeltelling** met (a) `bod-adjustments` overshoot-factoren en (b) `engineRiskProfile`/`trade-engine.js RISKY_ENGINES`. NB: trade-engine's bod-bijdrage is door **B1 (`finalBod=finalHandel`)** al dood, dus die route telt niet dubbel — **maar Gate 2 moet verifiëren dat `engineRiskProfile` het bod niet al aanpast.**
- **`transmissionDetail` gat**: enrichment vult dit niet (alleen `transmissionType`). De gecombineerde haystack lost dit op zodat de Nissan-CVT-regel toch kan matchen.

## Rollback-pad
- Code-pad achter env-flag `T4C_ENGINE_BLACKLIST` (default UIT tot promote). Uitzetten = `T4C_ENGINE_BLACKLIST=0` + reload → exact oude gedrag.
- Eén commit terug (config-aansluiting is geïsoleerd in valuation.js).

## Gate-plan
1. ✅ SPEC (dit doc) — wacht op akkoord.
2. REVIEW tegen DNA + STABILITEIT-PROTOCOL §A (backup vóór edit valuation.js).
3. UNIT: `matchEngineProfile` 100% branches (elke config-regel + guardrails + geen-match) in `backend/tests/`.
4. REPLAY: `scripts/replay.js` op `golden-cases-100.json`, beide stacks, criteria uit RSPP Gate 4.
5. SHADOW 24u op live via `T4C_ENGINE_BLACKLIST_SHADOW` → `shadow_log`.
6. SIGNOFF: Jurgen op 10 grootste-verschil-cases (≥7/10).
PROMOTE: `T4C_ENGINE_BLACKLIST=1` live, één commit.
