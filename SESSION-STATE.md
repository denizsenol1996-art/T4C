# T4C SESSION STATE — 31 maart 2026 — v10.17.4

## CRITICAL: DO NOT CHANGE THESE FILES WITHOUT TESTING
- /opt/t4c/backend/routes/valuation.js — pricing engine
- /opt/t4c/backend/lib/trade-engine.js — inkoop berekening
- /opt/t4c/backend/lib/comparable-engine/pricing-protocol.js — blend regels
- /opt/t4c/backend/routes/market.js — live scrape 42 bronnen + cache
- /opt/t4c/backend/routes/vehicle.js — RDW + VIN decode + transmissie

## PRICING ARCHITECTURE (WORKING — DO NOT BREAK)
1. Frontend calls: enriched (3s) then parallel: market (15s scrape) + dealer/price (10s GPT)
2. dealer/price: enriched -> comp-engine (DB listings) -> GPT-5.4+websearch -> blend -> trade-engine
3. Blend: comp-engine confidence determines weight (40% comp / 60% GPT typical)
4. Trade-engine: retail x segment ratio = inkoop
5. Market: live scrape 42 sites, cached 2 uur per merk/model/jaar
6. VIN decode: GPT-5.4 met RDW Type/Variant/Uitvoering codes
7. Transmissie: altijd verplicht in VIN prompt + fallback call als null

## CALIBRATION REFERENCE
Qashqai 2011 200k: inkoop 3519 | A180 2016 195k: inkoop 7219
Prius 2010 136k: inkoop 5119 | Ibiza 2025 25k: inkoop 16019

## SEGMENT RATIOS (trade-engine.js)
Premium: 0.78/0.75/0.70 | Midden: 0.75/0.72/0.65 | Budget: 0.76/0.72/0.66

## TODO
1) laadtijd 20s->7s (live scrape bottleneck)
2) prijs kalibratie per model
3) facelift/generatie herkenning
4) looptijd model tonen
5) dubbele entries opschonen
6) sidebar localStorage->DB
7) import detectie
8) PR codes herkenning

## DB STATUS 31 maart
56773 listings, 34788 actief, 841 taxaties, 28 feedback, 114 autos met fotos
