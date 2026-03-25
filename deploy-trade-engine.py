#!/usr/bin/env python3
# deploy-trade-engine.py — run on server: python3 deploy-trade-engine.py

content = open('backend/routes/valuation.js').read()

# 1. Add trade-engine import
if 'trade-engine' not in content:
    content = content.replace(
        "const { calculateQualityScore",
        "const { calculateTradeBid } = require('../lib/trade-engine')\nconst { calculateQualityScore"
    )
    print("1. Import added")
else:
    print("1. Import already present")

# 2. Replace prompt
old_start = "Je bent de hoofd-taxateur van een Nederlandse dealerapp."
old_end = '"riskFlags":[]}'
i = content.index(old_start)
j = content.index(old_end, i) + len(old_end) + 1

new_prompt = (
    'Je bent de hoofd-taxateur van een Nederlandse dealerapp.\n\n'
    'ZOEK OP INTERNET naar actuele prijzen voor dit EXACTE model+motorvariant op Marktplaats.nl, AutoScout24.nl en Gaspedaal.nl.\n\n'
    'JOUW TAAK: Geef een realistische RETAIL VRAAGPRIJS en een RISICO-ANALYSE. JIJ bepaalt NIET de inkoopprijs \u2014 dat doet de backend.\n\n'
    'VERPLICHTE WERKWIJZE:\n'
    '1. Identificeer exact: merk, model, generatie, motor, transmissie, uitvoering\n'
    '2. Classificeer als type A, B of C\n'
    '3. Zoek online naar vergelijkbare exemplaren van de EXACTE variant\n'
    '4. Bepaal de realistische retail vraagprijs (B2C)\n'
    '5. Geef risicofactoren en verkoopbaarheid\n\n'
    'CLASSIFICATIE:\n'
    '- Type A = standaard volume-auto, veel aanbod\n'
    '- Type B = sterkere uitvoering, variant is prijsrelevant\n'
    '- Type C = zeldzaam, niche, dunne markt\n'
    'Bij twijfel B/C: kies C alleen bij aantoonbaar dunne markt.\n\n'
    'KERNREGELS:\n'
    '- Exacte variant boven modelgemiddelde\n'
    '- Meng NIET: sedan/coup\u00e9, benzine/diesel, 4-cil/V6, basis/AMG-GTI\n'
    '- RETAIL VRAAGPRIJS = wat een dealer deze auto TE KOOP ZET (niet de transactieprijs)\n'
    '- Baseer op MEDIAAN van gevonden vergelijkingen, niet op uitschieters\n'
    '- Wees conservatief: liever de onderkant van de range\n\n'
    'RISICOFACTOREN:\n'
    'Geef riskFlags als array: "hoge_km", "zeer_hoge_km", "import", "geen_nap", "risicomotor", "oud", '
    '"niche_markt", "ex_taxi", "apk_verlopen", "apk_gebreken", "recalls_open", "niet_verzekerd", '
    '"veel_eigenaren", "premium_benzine_hoge_km", "structurele_apk_problemen"\n\n'
    'ANTWOORD UITSLUITEND IN JSON (geen markdown, geen backticks):\n'
    '{"retailAskPrice":12345,"vehicleType":"B","sellSpeed":"normaal","reconEstimate":800,'
    '"facelift":"onbekend","confidence":75,"riskFlags":["hoge_km","import"],'
    '"riskLevel":"gemiddeld","reasoning":"max 3 zinnen NL"}`'
)

content = content[:i] + new_prompt + content[j:]
print("2. Prompt replaced")

# 3. Update AI price extraction
old_extract = '        const aiVerkoop = Math.round((aiResult.verkoopadviees || 0) / 50) * 50\n        const aiHandel = Math.round((aiResult.handelswaarde || 0) / 50) * 50\n        const aiInkLow = Math.round((aiResult.inkoopLow || 0) / 50) * 50\n        const aiInkHigh = Math.round((aiResult.inkoopHigh || 0) / 50) * 50'
new_extract = '        const aiRetail = Math.round((aiResult.retailAskPrice || aiResult.verkoopadviees || 0) / 50) * 50\n        const aiVerkoop = aiRetail\n        const aiHandel = 0\n        const aiInkLow = 0\n        const aiInkHigh = 0'
if old_extract in content:
    content = content.replace(old_extract, new_extract)
    print("3. Extraction updated")
else:
    print("3. SKIP: extraction already updated or not found")

# 4. Wire trade engine
old_final = "          finalVerkoop = _blendedVerkoop\n          const _kmC = kmCorrection(km)\n          if (_kmC.export) { d.exportFlag = true }\n          console.log('[PRICING-FINAL]', d.make, d.model, km+'km:', 'VP', finalVerkoop, _kmC.export ? '\u26a0 EXPORT' : '')\n          finalHandel = Math.round(finalVerkoop * hwRatio / 50) * 50\n          finalBod = finalHandel\n          finalInkoopLow = Math.round(finalHandel * 0.85 / 50) * 50\n          finalInkoopHigh = Math.round(finalHandel * 0.95 / 50) * 50\n          finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50\n          if (_kmC.export) { d.exportFlag = true }\n          conf += 25"

new_final = (
    "          finalVerkoop = _blendedVerkoop\n"
    "          const _kmC = kmCorrection(km)\n"
    "          if (_kmC.export) { d.exportFlag = true }\n"
    "          const _tradeResult = calculateTradeBid(finalVerkoop, aiResult, {...d, km, year, segment}, {count: mCount})\n"
    "          if (_tradeResult) {\n"
    "            finalHandel = _tradeResult.handelswaarde\n"
    "            finalBod = _tradeResult.maxBid\n"
    "            finalInkoopLow = _tradeResult.inkoopLow\n"
    "            finalInkoopHigh = _tradeResult.inkoopHigh\n"
    "            finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50\n"
    "          } else {\n"
    "            finalHandel = Math.round(finalVerkoop * hwRatio / 50) * 50\n"
    "            finalBod = finalHandel\n"
    "            finalInkoopLow = Math.round(finalHandel * 0.85 / 50) * 50\n"
    "            finalInkoopHigh = Math.round(finalHandel * 0.95 / 50) * 50\n"
    "            finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50\n"
    "          }\n"
    "          conf += 25"
)

if old_final in content:
    content = content.replace(old_final, new_final)
    print("4. Trade engine wired in")
else:
    print("4. WARNING: final block not found - may need manual check")

open('backend/routes/valuation.js', 'w').write(content)
print("Done - saved")
