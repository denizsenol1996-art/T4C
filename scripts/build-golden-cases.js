#!/usr/bin/env node
// Genereert /opt/t4c/fixtures/golden-cases-100.json uit dealer_feedback.
//
// Gestratificeerd:
// - 4 segment (budget/midden/premium/sport)
// - 4 prijsklasse (<€2k / €2-5k / €5-10k / ≥€10k)
// - leeftijd-spreiding binnen elke bucket
// + 20 random uit <€2k (de blinde-vlek-zone)
//
// Output: JSON array van cases met kenteken + bekende velden + Jurgen-bod (sold_price).

const Database = require('/opt/t4c/backend/node_modules/better-sqlite3')
const fs = require('fs')
const path = require('path')

const DB_PATH = '/opt/t4c/data/t4c.db'
const OUT = '/opt/t4c/fixtures/golden-cases-100.json'

const db = new Database(DB_PATH, { readonly: true })

// Pak alle valide rijen (sold_price > 0 = Jurgen-bod)
const rows = db.prepare(`
  SELECT kenteken, make, model, year, our_bod, sold_price, feedback
  FROM dealer_feedback
  WHERE kenteken IS NOT NULL AND kenteken <> ''
    AND sold_price > 0
    AND CAST(json_extract(feedback,'$.km') AS INTEGER) > 0
    AND created_at > '2026-03-01'
`).all()

function parseFeedback(r) {
  try {
    const f = JSON.parse(r.feedback || '{}')
    return {
      km: Number(f.km) || 0,
      segment: f.segment || '?',
      onze_verkoop: Number(f.onze_verkoop) || 0,
      status: f.status || 'gekocht',
      notitie: (f.notitie || '').slice(0, 100)
    }
  } catch (e) { return { km: 0, segment: '?', onze_verkoop: 0, status: '?', notitie: '' } }
}

const enriched = rows.map(r => ({
  kenteken: r.kenteken,
  make: r.make,
  model: r.model,
  year: r.year,
  our_bod: r.our_bod,
  jurgen_bod: r.sold_price,
  ...parseFeedback(r),
  age: 2026 - (r.year || 2015)
})).filter(c => c.km > 0)

function pickBucket(c) {
  const j = c.jurgen_bod
  if (j < 2000) return 'lt2k'
  if (j < 5000) return '2_5k'
  if (j < 10000) return '5_10k'
  return 'gte10k'
}
function pickAgeBand(c) {
  const a = c.age
  if (a <= 5) return 'y0_5'
  if (a <= 10) return 'y6_10'
  if (a <= 15) return 'y11_15'
  return 'y16plus'
}

const bySegment = { budget: [], midden: [], premium: [], sport: [], other: [] }
for (const c of enriched) {
  const s = c.segment in bySegment ? c.segment : 'other'
  bySegment[s].push(c)
}

// Shuffle deterministisch (seed via simple hash)
function seededShuffle(arr, seed = 42) {
  const a = [...arr]
  let s = seed
  function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Gestratificeerd kiezen:
// - 20 per segment × 4 segmenten = 80 (verdelen over 4 prijsklasse + 4 leeftijd buckets)
// - 20 extra uit lt2k
const targetPerSegment = 20
const targets = ['budget', 'midden', 'premium', 'sport']
const selected = []
const seenKentekens = new Set()

for (const seg of targets) {
  const pool = seededShuffle(bySegment[seg] || [], 42 + seg.charCodeAt(0))
  let picked = 0
  for (const c of pool) {
    if (picked >= targetPerSegment) break
    if (seenKentekens.has(c.kenteken)) continue
    selected.push({ ...c, _bucket: pickBucket(c), _ageBand: pickAgeBand(c), _stratum: seg })
    seenKentekens.add(c.kenteken)
    picked++
  }
}

// 20 extra uit lt2k (over alle segmenten, gericht op blinde vlek)
const lt2kPool = seededShuffle(
  enriched.filter(c => c.jurgen_bod < 2000 && !seenKentekens.has(c.kenteken)),
  101
)
for (const c of lt2kPool) {
  if (selected.filter(x => x._stratum === 'lt2k_extra').length >= 20) break
  selected.push({ ...c, _bucket: 'lt2k', _ageBand: pickAgeBand(c), _stratum: 'lt2k_extra' })
  seenKentekens.add(c.kenteken)
}

// Output
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({
  _meta: {
    generated: new Date().toISOString(),
    source: 'dealer_feedback waar sold_price > 0',
    sold_price_is: 'Jurgen-bod (eigen_bod via UI)',
    our_bod_is: 'toenmalige T4C-systeem-output (onze_inkoop_high)',
    stratification: '20 per segment (budget/midden/premium/sport) + 20 uit lt2k',
    total: selected.length
  },
  cases: selected
}, null, 2))

console.log(`✅ ${selected.length} cases → ${OUT}`)

// Distributie-overzicht
const dist = {}
for (const c of selected) {
  const key = `${c._stratum}/${c._bucket}/${c._ageBand}`
  dist[key] = (dist[key] || 0) + 1
}
console.log('\nDistributie (stratum/prijs/leeftijd):')
for (const k of Object.keys(dist).sort()) {
  console.log(`  ${k.padEnd(40)} ${dist[k]}`)
}

db.close()
