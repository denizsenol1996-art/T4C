# T4C Pricing — ROOT-CAUSE ANALYSE (diepe research, 2026-06-16)
*4 parallelle read-only onderzoekslijnen op de live server. Alle cijfers uit echte data (661 deals: our_bod vs sold_price). Niets gewijzigd.*

## De kern in 1 zin
De taxatie biedt structureel te hoog omdat **GPT vrijwel altijd alleen de prijs bepaalt (in 98% van de taxaties) en GPT is hoog-geankerd**, en de **vaste 0,70-omrekening naar bod nooit meebeweegt en reparatiekosten nooit aftrekt** — fataal op goedkope/oude auto's.

## Root cause #1 — GPT is de facto de énige prijsbron, en hij ankert hoog
- Comps bereiken de eindprijs in **<2% van de taxaties** (`market_median` gevuld bij 2,9%, `price_source=comp` bij 1,3%; juni: 1 van 121). De rest = **100% GPT**.
- De GPT-prompt duwt de prijs omhoog: *"geen geld laten liggen"*, *"BMW 535i 289k km verkoopt nog voor €8.000-10.000"*, *"lage km bij oude auto telt niet"*. GPT zoekt bovendien op Marktplaats/AS/Gaspedaal = **vraagprijzen** (niet verkoopprijzen).
- Gevolg: retail/sold = **1,59 gemiddeld**, **2,98 op auto's <€2k**. De retail is +59% tot +198% te hoog.

## Root cause #2 — De bod-omrekening is een platte 0,70 + trekt reparatie NOOIT af
- bod/retail = **constant ~0,70**, ongeacht waarde/leeftijd/staat.
- Die 0,70 is afgesteld op dúre auto's: bij ≥€10k valt 0,70 × (+37% retail) precies op **1,00 (perfect)**. Bij <€2k laat diezelfde 0,70 nog **+104%** staan (bod/sold = 2,04).
- GPT berékent een realistische opknap (€1.500-4.000 bij slechte motor) maar de trade-engine **gooit `reconEstimate` weg** (`trade-engine.js`: gelezen, nooit afgetrokken). Voor oude auto's ≈ de hele waarde → ramp.
- Bod-floor hard op 0,35 × retail → zelfs maximaal risico biedt nog 35% van een opgeblazen retail.

## Root cause #3 — De drift sinds april (waarom mei beter voelde)
- **2 april: blend UITGEZET** ("comps trokken prijzen omhoog") → goede april/mei-basis = bod ≈ GPT/expert + bevroren trade-engine.
- **17 mei (commit 2322be0 "Recovery"): blend WEER AAN** in dealer/price + comp-gewicht-cap van 0,4 → 0,70. De april-fix werd teruggedraaid.
- De 16 negatieve multipliers (mei 20-21) zijn er gekomen **omdat** de heraangezette blend overschoot — symptoombestrijding.
- ⚠️ Nuance: omdat comps tóch <2% de prijs raken, is het praktische effect van de blend-heractivering beperkt — de dominante oorzaak blijft #1+#2.
- De km-feeder (13 juni) is juist een **verbetering** (BMW: realistische mediaan €3.750, geen vervuiling). Niet de boosdoener.

## Data-fundament is zwak (waarom niemand het zag)
- `taxaties.sold_price` = **0 rijen** → geen echte uitkomst-meting (de leerlus die we net aansloten gaat dit vullen).
- De "sold"-prijzen in market_listings zijn **nep** (laatste vraagprijs ×0,92, niet echte verkoop).
- Asking→sold-correctie is een platte ×0,93 — veel te klein voor goedkoop/oud.

## GPT-5.5? — ja beschikbaar, maar NIET de oplossing
- Je key kan `gpt-5.5` + `gpt-5.5-pro` gebruiken (getest). Uitgebracht 23-04-2026. **2× duurder**, modest beter (reasoning + tool-use). Zelfde context.
- **Lost de systematische over-bidding NIET op** — dat is methodiek, geen model. Helpt alleen op **zeldzame auto's zonder comps** (de long tail waar 't 100% GPT is).
- Advies: alléén de hoofd-valuation-call (`valuation.js:883`) als **gated A/B** (env-var `T4C_VALUATION_MODEL`), getoetst tegen `sold_price` — niet blind upgraden.

## "Terug op level" + écht goed — het plan
**A. Snel terug naar april-gedrag** (1 wijziging): blend uit in dealer/price (`valuation.js:965` `_dataWeight=0.0`, evt. :960). LET OP: april over-bood óók op goedkoop (+103% was er altijd) → dit is een tussenstap, geen echte fix.

**B. De échte structurele fix** (gevalideerd tegen je 661 echte bods):
1. **Opknap aftrekken**: `bod = bod − reconEstimate` (GPT levert 'm al!) — grootste hefboom voor goedkoop/oud.
2. **Conditie-/waarde-afhankelijke bid-ratio** i.p.v. platte 0,70 — laat 'm steil dalen voor goedkoop/oud/hoog-risico.
3. **GPT-prompt de-ankeren**: weg met "geen geld laten liggen" + "289k BMW = €8-10k"; expliciet vraag- vs verkoopprijs + grotere asking→sold-marge op goedkoop/oud.
4. **Valideren via de leerlus**: meet bias per prijsklasse vóór/na; doel <€2k en €2-5k naar ~0%.

**C. (optioneel) gpt-5.5 A/B** op de long-tail, ná B.

## Bewijs-bestanden
4 agent-rapporten (deze sessie) · `dealer_feedback` (661, gekoppeld) · `/opt/t4c/data/groundtruth/cars-sample.csv` · valuation.js prompt 777-847 + blend 947-985 · trade-engine.js (recon nooit afgetrokken) · db.js:1052 (nep-sold).
