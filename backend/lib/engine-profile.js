// lib/engine-profile.js — RSPP/engine-blacklist-v1
// Motor-betrouwbaarheid → absolute EUR-aftrek op het bod.
// Bron: backend/config/engine-blacklist.json. DNA: technische betrouwbaarheid = 35%
// (JURGEN-PRICING-DNA-2026-06-17.md r.24 + motor-categorie r.93-100).
// Spec: docs/specs/RSPP-2026-06-17-engine-blacklist-v1.md
//
// v1: ALLEEN 'engines' (aftrek). 'positives'/bonus_eur bewust NOG NIET (v2).
// Matching per *_contains-array = AND (alle tokens moeten in haystack zitten);
// dat is nodig om displacement-specifieke regels (thp_1_6 vs thp_1_2) te scheiden,
// gecombineerd met first-match-wins volgorde in de config.

let _blacklist = { engines: [], positives: [] }
try {
  _blacklist = require("../config/engine-blacklist.json")
} catch (e) {
  console.log("[ENGINE-BL] config niet geladen:", e.message)
}

// Combineer alle tekstvelden tot één haystack — lost het transmissionDetail-gat op
// (enrichment vult transmissionDetail niet, alleen transmissionType).
function buildHaystack(vehicle) {
  return [
    vehicle.engineLabel,
    vehicle.motorCode,
    vehicle.transmissionType,
    vehicle.transmissionDetail,
    vehicle.subModel,
  ].map((x) => (x == null ? "" : String(x)).toLowerCase()).join(" ")
}

function containsAll(haystack, need) {
  const arr = Array.isArray(need) ? need : [need]
  return arr.every((tok) => haystack.includes(String(tok).toLowerCase()))
}

// Retourneert { id, score, aftrek_eur } van de eerste matchende engine, of null.
function matchEngineProfile(vehicle, blacklist = _blacklist) {
  if (!vehicle) return null
  const hay = buildHaystack(vehicle)
  const makeUp = (vehicle.make || "").toUpperCase()
  const fuelLow = (vehicle.fuel || "").toLowerCase()
  const km = parseInt(vehicle.km) || 0

  for (const eng of (blacklist.engines || [])) {
    const m = eng.match || {}
    if (m.make && makeUp !== String(m.make).toUpperCase()) continue
    if (m.make_in && !m.make_in.map((s) => String(s).toUpperCase()).includes(makeUp)) continue
    if (m.fuel && !fuelLow.includes(String(m.fuel).toLowerCase())) continue
    if (m.km_gte != null && km < m.km_gte) continue
    if (m.engineLabel_contains && !containsAll(hay, m.engineLabel_contains)) continue
    if (m.motorCode_contains && !containsAll(hay, m.motorCode_contains)) continue
    if (m.transmissionDetail_contains && !containsAll(hay, m.transmissionDetail_contains)) continue
    return { id: eng.id, score: eng.score, aftrek_eur: eng.aftrek_eur }
  }
  return null
}

// Pas de aftrek toe met guardrails:
//  - cap op capPct van het bod (default 25%) → goedkope auto's niet halveren
//  - bod nooit < 0
//  - afronden op €50 (consistent met de rest van de pijplijn)
function applyEngineAftrek(bod, aftrek_eur, capPct = 0.25) {
  if (!(bod > 0) || !(aftrek_eur > 0)) return bod
  const cap = Math.round(bod * capPct)
  const aftrek = Math.min(aftrek_eur, cap)
  return Math.max(0, Math.round((bod - aftrek) / 50) * 50)
}

module.exports = { matchEngineProfile, applyEngineAftrek, buildHaystack, _blacklist }
