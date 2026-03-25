#!/usr/bin/env python3
# deploy-trade-engine-v3.py — ONLY wires trade engine, does NOT touch the prompt
# Run: cd /opt/t4c && python3 deploy-trade-engine-v3.py

content = open('backend/routes/valuation.js').read()

# 1. Add trade-engine import (if not already there)
if 'trade-engine' not in content:
    content = content.replace(
        "const { calculateQualityScore",
        "const { calculateTradeBid } = require('../lib/trade-engine')\nconst { calculateQualityScore"
    )
    print("1. Import added")
else:
    print("1. Import already present")

# 2. Wire trade engine into final pricing (replace ratio-based pricing)
old_final = (
    "          finalVerkoop = _blendedVerkoop\n"
    "          const _kmC = kmCorrection(km)\n"
    "          if (_kmC.export) { d.exportFlag = true }\n"
    "          console.log('[PRICING-FINAL]', d.make, d.model, km+'km:', 'VP', finalVerkoop, _kmC.export ? '\u26a0 EXPORT' : '')\n"
    "          finalHandel = Math.round(finalVerkoop * hwRatio / 50) * 50\n"
    "          finalBod = finalHandel\n"
    "          finalInkoopLow = Math.round(finalHandel * 0.85 / 50) * 50\n"
    "          finalInkoopHigh = Math.round(finalHandel * 0.95 / 50) * 50\n"
    "          finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50\n"
    "          if (_kmC.export) { d.exportFlag = true }\n"
    "          conf += 25"
)

new_final = (
    "          finalVerkoop = _blendedVerkoop\n"
    "          const _kmC = kmCorrection(km)\n"
    "          if (_kmC.export) { d.exportFlag = true }\n"
    "          // Trade Engine: deterministic bid calculation\n"
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
    print("2. Trade engine wired in")
elif 'calculateTradeBid(finalVerkoop' in content:
    print("2. Trade engine already wired in")
else:
    print("2. WARNING: pricing block not found - check manually")
    print("   Looking for: finalVerkoop = _blendedVerkoop")
    import sys
    sys.exit(1)

open('backend/routes/valuation.js', 'w').write(content)
print("Done - prompt NOT touched, only trade engine wired in")
