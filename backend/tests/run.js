// backend/tests/run.js — RSPP unit-test harnas (Gate 3)
// Run: node /opt/t4c/backend/tests/run.js  → exit 0 = pass, exit 1 = fail
// Eerste cyclus: RSPP/engine-blacklist-v1.

const { matchEngineProfile, applyEngineAftrek } = require("../lib/engine-profile")

let pass = 0, fail = 0
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; }
  else { fail++; console.error(`  ✗ ${name}\n      verwacht: ${e}\n      kreeg:    ${a}`) }
}
function ok(cond, name) {
  if (cond) { pass++; } else { fail++; console.error(`  ✗ ${name}`) }
}

console.log("RSPP/engine-blacklist-v1 — unit-tests\n")

// ── matchEngineProfile ──────────────────────────────────────────────
const m = (v) => matchEngineProfile(v)

// 1. Ford 1.0 EcoBoost benzine → ecoboost_1_0, aftrek 1500
eq(m({ make: "FORD", fuel: "benzine", engineLabel: "1.0 EcoBoost 100pk" }),
   { id: "ecoboost_1_0", score: 1, aftrek_eur: 1500 }, "Ford 1.0 EcoBoost → ecoboost_1_0")

// 2. PSA 1.6 THP → thp_1_6 (1800), niet thp_1_2 (volgorde + AND op displacement)
eq(m({ make: "PEUGEOT", engineLabel: "1.6 THP 156" }),
   { id: "thp_1_6", score: 1, aftrek_eur: 1800 }, "Peugeot 1.6 THP → thp_1_6")

// 3. Citroen 1.2 THP → thp_1_2 (1200)
eq(m({ make: "CITROEN", engineLabel: "1.2 THP" }),
   { id: "thp_1_2", score: 2, aftrek_eur: 1200 }, "Citroen 1.2 THP → thp_1_2")

// 4. Nissan CVT high-km → match via haystack (transmissionType vult transmissionDetail-gat)
eq(m({ make: "NISSAN", transmissionType: "CVT Automaat", km: 160000 }),
   { id: "nissan_cvt_high_km", score: 3, aftrek_eur: 1000 }, "Nissan CVT 160k → nissan_cvt_high_km (haystack-fix)")

// 5. Nissan CVT maar te lage km → géén match
eq(m({ make: "NISSAN", transmissionType: "CVT Automaat", km: 100000 }), null,
   "Nissan CVT 100k → geen match (km_gte 150000)")

// 6. Renault TCe → renault_tce (500)
eq(m({ make: "RENAULT", engineLabel: "1.3 TCe 130" }),
   { id: "renault_tce", score: 4, aftrek_eur: 500 }, "Renault TCe → renault_tce")

// 7. BMW N47 diesel via motorCode → bmw_n47_diesel (1000)
eq(m({ make: "BMW", fuel: "diesel", motorCode: "N47D20" }),
   { id: "bmw_n47_diesel", score: 4, aftrek_eur: 1000 }, "BMW N47 diesel → bmw_n47_diesel")

// 8. Betrouwbare Toyota hybride → null (v1 negeert positives)
eq(m({ make: "TOYOTA", fuel: "hybride", engineLabel: "1.8 Hybrid" }), null,
   "Toyota hybride → null (positives niet in v1)")

// 9. make_in mismatch: 1.6 THP maar merk buiten lijst → geen match
eq(m({ make: "VOLVO", engineLabel: "1.6 THP" }), null,
   "Volvo 1.6 THP → null (make_in dekt VOLVO niet)")

// 10. leeg/undefined → null, geen crash
eq(m({}), null, "leeg object → null")
eq(m(null), null, "null → null")

// ── applyEngineAftrek (guardrails) ──────────────────────────────────
eq(applyEngineAftrek(8000, 1500), 6500, "8000 −1500 (onder cap) → 6500")
eq(applyEngineAftrek(1800, 1500), 1350, "1800 −1500 → cap 25% (450) → 1350")
eq(applyEngineAftrek(0, 1500), 0, "bod 0 → 0 (geen aftrek)")
eq(applyEngineAftrek(8000, 0), 8000, "aftrek 0 → ongewijzigd")
eq(applyEngineAftrek(8025, 500), 7550, "afronding op €50")
const tiny = applyEngineAftrek(100, 1500)
ok(tiny >= 0 && tiny % 50 === 0, "mini-bod → niet negatief, veelvoud van 50")

// ── samenvatting ────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? "✓ ALLE" : "✗"} tests: ${pass} pass, ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)
