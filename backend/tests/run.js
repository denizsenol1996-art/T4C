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

// ── v1.1 motorCode-regels (gegrond op echte RDW-VIN-decode 2026-06-17) ──
// 11. PSA THP via motorCode (engineLabel mist 'thp'-tekst) → thp_ep6_motorcode
eq(m({ make: "PEUGEOT", motorCode: "EP6FDTX", engineLabel: "200pk" }),
   { id: "thp_ep6_motorcode", score: 1, aftrek_eur: 1800 }, "Peugeot EP6FDTX → thp_ep6_motorcode")
eq(m({ make: "CITROEN", motorCode: "EP6CDT", engineLabel: "156pk" }),
   { id: "thp_ep6_motorcode", score: 1, aftrek_eur: 1800 }, "Citroen EP6CDT → thp_ep6_motorcode")
// 12. KRITIEK: betrouwbare 1.6 VTi N/A (EP6/EP6C) mag NIET matchen
eq(m({ make: "CITROEN", motorCode: "EP6", engineLabel: "120pk" }), null,
   "Citroen EP6 N/A → null (geen 'dt', betrouwbare VTi)")
eq(m({ make: "PEUGEOT", motorCode: "EP6C", engineLabel: "120pk" }), null,
   "Peugeot EP6C N/A → null")
// 13. PureTech via motorCode: EB2 (N/A) + EB2DT/EB2ADTS (turbo) → puretech_eb2_motorcode
eq(m({ make: "CITROEN", motorCode: "EB2", engineLabel: "82pk" }),
   { id: "puretech_eb2_motorcode", score: 4, aftrek_eur: 800 }, "Citroen EB2 → puretech_eb2_motorcode")
eq(m({ make: "OPEL", motorCode: "EB2ADTS", engineLabel: "130pk" }),
   { id: "puretech_eb2_motorcode", score: 4, aftrek_eur: 800 }, "Opel EB2ADTS → puretech_eb2_motorcode")
// 14. Mini Prince-turbo N14/N18 (Mini gebruikt BMW-codes, geen EP6)
eq(m({ make: "MINI", motorCode: "N14B16A", engineLabel: "175pk" }),
   { id: "thp_n14_motorcode", score: 1, aftrek_eur: 1800 }, "Mini N14 → thp_n14_motorcode")
// 15. KRITIEK: betrouwbare Mini-broers N12 (N/A) en B38 (modern) mogen NIET matchen
eq(m({ make: "MINI", motorCode: "N12B14A", engineLabel: "95pk" }), null,
   "Mini N12 N/A → null")
eq(m({ make: "MINI", motorCode: "B38A15A", engineLabel: "136pk" }), null,
   "Mini B38 modern → null")
// 16. Ford 1.0 EcoBoost via motorCode → ecoboost_m1j_motorcode; lege Duratec-code → null
eq(m({ make: "FORD", fuel: "benzine", motorCode: "M1JE", engineLabel: "101pk" }),
   { id: "ecoboost_m1j_motorcode", score: 1, aftrek_eur: 1500 }, "Ford M1JE → ecoboost_m1j_motorcode")
eq(m({ make: "FORD", fuel: "benzine", motorCode: "", engineLabel: "65pk" }), null,
   "Ford lege code (Duratec) → null")

// 17. leeg/undefined → null, geen crash
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
