# T4C SESSION-STATE

*Laatst bijgewerkt: 2026-06-17 ~11:50 · update bij elke sessie-afsluiting*

## Wat draait er nu
- `t4c-server` (live, poort 3000) — online, **shadow-flag AAN** (`T4C_ENGINE_BLACKLIST_SHADOW=1` via ecosystem.config.js). Echte blacklist-flag UIT.
- `t4c-staging-base` (3008, flag UIT) + `t4c-staging-new` (3009, flag AAN) — eigen code-kopie in `/home/deniz/t4c-staging/backend` (zie memory). Draaien de v1.1-config voor eventuele her-run.
- DB: better-sqlite3 + WAL, `/opt/t4c/data/t4c.db`.

## Pricing-stack status
- Laatste commits (main): `a825b57` Gate5-shadow · `03cdce7` Gate4-correctie · `11e934b` v1.1-motorCode · `51986f7` v1-Gate4.
- Git tree clean (behalve CRASH-LOG.md = bewust lokaal).
- Bod-curve aan. Bench afgesloten.

## RSPP/engine-blacklist — huidige gate
**Gate 5 (shadow) LOPEND sinds 2026-06-17 ~11:47.**
- Shadow logt naar `/opt/t4c/data/bench/engine-shadow.jsonl` (dealer/price + quick-price), past het bod NIET aan.
- v1.1 toevoeging: motorCode-regels (EP6+dt=THP, EB2=PureTech, N14/N18=Prince, M1J=EcoBoost), gegrond op echte RDW-VIN-decode, nul false-positives (28/28 unit).
- Gate 4 (segment-niveau): GESLAAGD, geen segment >5pp slechter. Footprint klein (~3 nieuwe cases in 662; EcoBoost mist door lege Ford-VIN-decode).
- Rapporten: `docs/specs/RSPP-2026-06-17-engine-blacklist-v1.1-GATE4-REPORT.md`.

## Volgende stap (na 24u shadow, ~18-06 ~12:00)
> ⚙️ **GEAUTOMATISEERD (17-06):** one-shot cron `0 10 18 6 *` (= 12:00 CEST) draait `scripts/gate5-shadow-eval.sh` → read-only `scripts/analyze-engine-shadow.js` → rapport `docs/specs/RSPP-2026-06-18-engine-blacklist-GATE5-SHADOW-ANALYSIS.md`. Cron verwijdert zichzelf na afloop. Log: `logs/gate5-shadow-eval.log`. Crontab-backup: `backups/crontab-pre-gate5cron-20260617.txt`. Stap 1 hieronder is dus al gedaan zodra je morgen kijkt; pak op bij stap 2.
>
> ✅ **Cron-verificatie (17-06 ~14:55 UTC):**
> - Cron-user = `deniz`; `engine-shadow.jsonl` is `deniz:deniz rw`, hele dir-keten heeft traversal-`x`, feitelijke leestest geslaagd → script kan morgen lezen. Output-dir `docs/specs` schrijfbaar.
> - Self-remove sandbox-getest tegen crontab-kopie (live onaangeroerd): verwijdert exact 1 regel (8→7), alle 6 andere cron-jobs intact, live crontab nog = 1 match.
> - node + bash syntax-check OK. Smoke-run gaf correct "0 echte hits, 2 seeds"; test-rapport daarna verwijderd zodat morgen verse generatie volgt.
> - Server-tijdzone = UTC → 10:00 UTC bewust gekozen voor 12:00 Amsterdam (CEST).
1. Analyseer `engine-shadow.jsonl`: hoeveel echte taxaties geraakt, welke rules, spreiding aftrek.
2. **Gate 6**: Jurgen sign-off op 10 spread-cases + bevestig motorCode-mapping (vooral Ford-EcoBoost-codes + TCe-aftrek op budget-Dacia).
3. Bij akkoord: promote (`T4C_ENGINE_BLACKLIST=1`, shadow-flag eruit) + één commit.
4. Open Gate 6-vraag: betaalt Jurgen écht −€500 op budget-Dacia (TCe), of alleen op duurdere TCe? (Dacia-onderbod-staart, niet gate-blokkerend.)

## Laatste belangrijke besluit
Deniz koos: motorCode-mapping bouwen → door naar Gate 5 shadow (richting-bewuste aftrek NIET nodig; Gate 4 slaagt op segment-niveau).
