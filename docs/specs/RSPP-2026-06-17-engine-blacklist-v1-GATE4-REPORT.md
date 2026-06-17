# Gate 4 REPLAY-rapport — engine-blacklist-v1

*2026-06-17 · 100 golden-cases · target :3009 (flag aan) vs baseline :3008 (flag uit), staging-only, live onaangeroerd*

## Tool-uitslag: ✅ PASS (maar incompleet)
- Mediaan bias: **target 3.5%** vs baseline 6.8% (−3.3pp, dichter bij 0)
- Binnen ±10%: 29% vs 28% · binnen ±20%: 49% vs 43%
- Tool checkt alleen macro-mediaan + binnen-10%. De RSPP-criteria "geen segment >5pp slechter" en "std-dev" checkt de tool NIET — handmatig nagelopen (zie onder).

## Wiring geverifieerd
- 14 cases raakten de blacklist, **allemaal `renault_tce`** (−€500, na cap). Baseline matchte 0 (flag uit) → correct.
- CSV: `data/bench/replay-2026-06-17T01-45-31.csv` · log: `data/bench/gate4-run-20260617.log`

## ⚠️ Bevinding 1 (blokkerend) — blacklist inert op hoofd-targets
RDW-enrichment levert **geen marketingnaam** in `engineLabel` (bv. Peugeot 208 GTi → `engineLabel=" 200pk"`, `motorCode="EP6FDTX"` = de 1.6 THP). De config matcht op `engineLabel_contains:["thp"/"ecoboost"/"puretech"]` → die termen staan niet in de RDW-data → **THP / EcoBoost / PureTech / N47 vuren vrijwel nooit in productie**. Alleen TCe lekt door via trim-namen.
- **De motor-waarheid zit in `motorCode`** (EP6 = THP, EB2 = PureTech, Ford EcoBoost = M1*/SF* codes). v1 matcht daar niet op.
- Dit maakt v1 effectief een TCe-(+Nissan-CVT-)feature i.p.v. de bedoelde brede motor-blacklist.

## ⚠️ Bevinding 2 (methodologie) — segment-ruis
`lt2k_extra` "verslechterde" 72.8% → 86.3%, maar dat is **GPT-ruis, niet de change**: de cases die omhoog gingen (Ford Fiesta base 2500→tgt 3500, Opel Astra, Mercedes B170, Hyundai i20) staan NIET in de match-log — geen engine-aftrek gekregen. Target en baseline doen elk een eigen non-deterministische GPT-call; op <€2k-auto's exploderen % door de kleine noemer. De échte engine-matches gingen wél correct omlaag (Renault Mégane 2300→1800, Clio 2150→1700).
- Schoonste meting zou **single-pass** zijn (pre/post-aftrek op dezelfde GPT-output) — elimineert deze ruis volledig.

## Verdict
- **Geen schade**: engine-aftrek verlaagt alleen bod, conservatief (cap 25%), en uitsluitend op matchende motoren. De enige "regressie" is bewezen ruis.
- **Maar niet promote-waardig**: de feature is inert op Jurgens belangrijkste motoren (THP/EcoBoost/PureTech). Promoten zou een feature live zetten die ~niets doet op zijn doel.

## Aanbeveling
Terug naar config (RSPP-loop): voeg **`motorCode_contains`-matching** toe (EP6→thp_1_6, EB2→puretech, Ford EcoBoost-codes; N47 doet dit al) + herijk golden-set zodat THP/EcoBoost-cases erin zitten. Daarna Gate 2/3/4 opnieuw. Alternatief: v1 accepteren als TCe-only en de motorCode-uitbreiding als v1.1.
