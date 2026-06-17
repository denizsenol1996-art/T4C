#!/usr/bin/env node
// RSPP Gate 4: golden-replay-engine.
//
// Voor elke case in golden-cases-100.json:
//   1. Haal enriched data (RDW + finnik) van /api/vehicle/enriched (poort 3000)
//   2. POST /api/dealer/price tegen target-poort (default 3009 staging)
//   3. POST tegen baseline-poort (default 3000 prod) voor vergelijking
//   4. Vergelijk bod-uitkomst met Jurgen-bod (sold_price uit fixture)
//
// Output:
//   - bench-results-RSPP-<timestamp>.csv in /opt/t4c/data/bench/
//   - 1-pagina samenvatting per stratum + per prijsklasse + per leeftijd
//
// Gebruik:
//   node /opt/t4c/scripts/replay.js [--target=3009] [--baseline=3000] [--cases=100]
//   node /opt/t4c/scripts/replay.js --target=3009 --parallel=8

const fs = require('fs')
const path = require('path')
const http = require('http')

const args = process.argv.slice(2).reduce((a, x) => {
  const m = x.match(/^--(\w+)=(.+)$/)
  if (m) a[m[1]] = m[2]
  return a
}, {})

const TARGET = parseInt(args.target || '3009')
const BASELINE = parseInt(args.baseline || '3000')
const PARALLEL = parseInt(args.parallel || '8')
const FIXTURE = args.fixture || '/opt/t4c/fixtures/golden-cases-100.json'
const LIMIT = parseInt(args.cases || '0') || Infinity

if (!fs.existsSync(FIXTURE)) {
  console.error(`❌ Fixture ontbreekt: ${FIXTURE}`)
  process.exit(1)
}

const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
const cases = fixture.cases.slice(0, LIMIT)

console.log(`RSPP Gate 4 replay`)
console.log(`  Target:   localhost:${TARGET}`)
console.log(`  Baseline: localhost:${BASELINE}`)
console.log(`  Cases:    ${cases.length}`)
console.log(`  Parallel: ${PARALLEL}`)
console.log('')

function httpRequest(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: data ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      } : {},
      timeout: 90000
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) }
        catch (e) { resolve({ _parseError: e.message, _raw: buf.slice(0, 200) }) }
      })
    })
    req.on('error', e => resolve({ _err: e.message }))
    req.on('timeout', () => { req.destroy(); resolve({ _err: 'timeout' }) })
    if (data) req.write(data)
    req.end()
  })
}

async function enrichPlate(plate, km) {
  const r = await httpRequest(BASELINE, 'GET', `/api/vehicle/enriched?plate=${encodeURIComponent(plate)}&km=${km}`)
  return r
}

function buildPriceBody(plate, km, enriched, fallback) {
  const e = enriched || {}
  const g = (k, d) => (e[k] !== undefined && e[k] !== null) ? e[k] : d
  return {
    plate, km,
    make: g('make', fallback.make),
    model: g('model', fallback.model),
    year: g('year', fallback.year),
    fuel: g('fuel', 'benzine'),
    weightKg: g('weightKg', null),
    catalogPrice: g('catalogPrice', null),
    bpm: g('bpm', null),
    power: g('powerKw', null),
    ownerCount: g('ownerCount', 0),
    isExDealer: g('isExDealer', false),
    bpmRest: g('bpmRest', 0),
    importFlag: g('importFlag', null),
    stolenFlag: g('stolenFlag', null),
    transmissionAuto: g('transmissionAuto', null),
    transmissionType: g('transmissionType', null),
    transmissionDetail: g('transmissionDetail', null),
    engineLabel: g('engineLabel', null),
    subModel: g('subModel', null),
    vin: g('vin', ''),
    motorCode: g('motorCode', null),
    generation: g('generation', null),
    trimLevel: g('trimLevel', null),
    drivetrain: g('drivetrain', null),
    engineRiskProfile: g('engineRiskProfile', null),
    courantScore: g('courantScore', null),
    optionPriceImpact: g('optionPriceImpact', null)
  }
}

async function runCase(c) {
  const enriched = await enrichPlate(c.kenteken, c.km)
  if (enriched._err || !enriched.make) {
    return { ...c, _err: 'enrich_failed' }
  }
  const body = buildPriceBody(c.kenteken, c.km, enriched, c)

  const [tgt, base] = await Promise.all([
    httpRequest(TARGET,   'POST', '/api/dealer/price', body),
    httpRequest(BASELINE, 'POST', '/api/dealer/price', body)
  ])

  return {
    kenteken: c.kenteken,
    make: c.make, model: c.model, year: c.year, km: c.km,
    segment: c.segment, stratum: c._stratum, bucket: c._bucket, ageBand: c._ageBand,
    jurgen_bod: c.jurgen_bod,
    target_verkoop: tgt.verkoopadviees || null,
    target_bod: tgt.t4cBod || null,
    target_src: tgt.priceSource || (tgt._err ? 'err' : 'unknown'),
    baseline_verkoop: base.verkoopadviees || null,
    baseline_bod: base.t4cBod || null,
    baseline_src: base.priceSource || (base._err ? 'err' : 'unknown'),
    target_bias_pct:   tgt.t4cBod  ? ((tgt.t4cBod  - c.jurgen_bod) / c.jurgen_bod * 100).toFixed(1) : null,
    baseline_bias_pct: base.t4cBod ? ((base.t4cBod - c.jurgen_bod) / c.jurgen_bod * 100).toFixed(1) : null
  }
}

async function runParallel(items, parallel) {
  const results = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await runCase(items[idx])
      if ((idx + 1) % 10 === 0) console.log(`  ${idx + 1}/${items.length}`)
    }
  }
  await Promise.all(Array.from({ length: parallel }, worker))
  return results
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function summarize(results, key) {
  const groups = {}
  for (const r of results) {
    const g = r[key] || '?'
    if (!groups[g]) groups[g] = { tgt: [], base: [] }
    if (r.target_bias_pct !== null)   groups[g].tgt.push(parseFloat(r.target_bias_pct))
    if (r.baseline_bias_pct !== null) groups[g].base.push(parseFloat(r.baseline_bias_pct))
  }
  const out = []
  for (const g of Object.keys(groups).sort()) {
    const t = groups[g].tgt, b = groups[g].base
    out.push({
      [key]: g,
      n: t.length,
      tgt_med:   t.length ? median(t).toFixed(1) : '-',
      base_med:  b.length ? median(b).toFixed(1) : '-',
      tgt_p10:   t.length ? `${(t.filter(x => Math.abs(x) <= 10).length / t.length * 100).toFixed(0)}%` : '-',
      base_p10:  b.length ? `${(b.filter(x => Math.abs(x) <= 10).length / b.length * 100).toFixed(0)}%` : '-'
    })
  }
  return out
}

;(async () => {
  const t0 = Date.now()
  console.log('Running...')
  const results = await runParallel(cases, PARALLEL)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
  console.log(`\n✅ ${results.length} cases in ${elapsed}s\n`)

  // CSV-output
  const outDir = '/opt/t4c/data/bench'
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const csvPath = `${outDir}/replay-${stamp}.csv`
  const headers = Object.keys(results[0] || {})
  fs.writeFileSync(csvPath,
    [headers.join(','), ...results.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n')
  )
  console.log(`CSV: ${csvPath}`)

  // Macro summary
  const valid = results.filter(r => r.target_bias_pct !== null && r.baseline_bias_pct !== null)
  const tgtB  = valid.map(r => parseFloat(r.target_bias_pct))
  const baseB = valid.map(r => parseFloat(r.baseline_bias_pct))
  console.log(`\n${'='.repeat(60)}`)
  console.log('MACRO (vs Jurgen-bod)')
  console.log('='.repeat(60))
  console.log(`  Valide:           ${valid.length} / ${results.length}`)
  console.log(`  Mediaan bias:     target ${median(tgtB).toFixed(1)}%   baseline ${median(baseB).toFixed(1)}%`)
  console.log(`  Binnen ±10%:      target ${(tgtB.filter(x => Math.abs(x) <= 10).length / tgtB.length * 100).toFixed(1)}%   baseline ${(baseB.filter(x => Math.abs(x) <= 10).length / baseB.length * 100).toFixed(1)}%`)
  console.log(`  Binnen ±20%:      target ${(tgtB.filter(x => Math.abs(x) <= 20).length / tgtB.length * 100).toFixed(1)}%   baseline ${(baseB.filter(x => Math.abs(x) <= 20).length / baseB.length * 100).toFixed(1)}%`)

  console.log(`\n${'='.repeat(60)}\nPer prijsklasse\n${'='.repeat(60)}`)
  console.table(summarize(valid, 'bucket'))
  console.log(`\nPer stratum`)
  console.table(summarize(valid, 'stratum'))
  console.log(`\nPer leeftijd`)
  console.table(summarize(valid, 'ageBand'))

  // Gate 4 pass/fail
  console.log(`\n${'='.repeat(60)}\nGATE 4 — passcriteria-check\n${'='.repeat(60)}`)
  const tgtMed = median(tgtB), baseMed = median(baseB)
  const delta = tgtMed - baseMed
  const p10T = tgtB.filter(x => Math.abs(x) <= 10).length / tgtB.length * 100
  const p10B = baseB.filter(x => Math.abs(x) <= 10).length / baseB.length * 100
  const checks = [
    { name: 'Mediaan bias mag niet >1pp verslechteren', pass: delta <= 1.0, detail: `${delta.toFixed(1)}pp` },
    { name: 'Binnen-10% mag niet >2pp lager',           pass: (p10B - p10T) <= 2.0, detail: `${(p10T - p10B).toFixed(1)}pp` },
  ]
  for (const c of checks) {
    console.log(`  ${c.pass ? '✅' : '❌'} ${c.name} (${c.detail})`)
  }
  const allPass = checks.every(c => c.pass)
  console.log(`\n${allPass ? '✅ GATE 4 PASS' : '❌ GATE 4 FAIL'}`)
  process.exit(allPass ? 0 : 1)
})()
