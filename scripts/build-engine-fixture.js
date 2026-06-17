#!/usr/bin/env node
// RSPP/engine-blacklist-v1.1 — bouw engine-gerichte fixture.
// Enrich PSA/Ford/Mini-kandidaten uit dealer_feedback (met echte Jurgen-bod=sold_price),
// filter op cases die een blacklist-rule daadwerkelijk raken, schrijf fixture.
// Gebruik: node scripts/build-engine-fixture.js   (leest plates van stdin: "kenteken|make|model|year|sold_price")

const fs = require('fs')
const http = require('http')
const { matchEngineProfile } = require('../backend/lib/engine-profile.js')

const BASELINE = 3000
function enrich(plate, km) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port: BASELINE, method: 'GET',
      path: `/api/vehicle/enriched?plate=${encodeURIComponent(plate)}&km=${km}`, timeout: 60000 },
      res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)) } catch { resolve({}) } }) })
    req.on('error', () => resolve({})); req.on('timeout', () => { req.destroy(); resolve({}) }); req.end()
  })
}

const lines = fs.readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)
const cands = lines.map(l => { const [kenteken, make, model, year, sold] = l.split('|'); return { kenteken, make, model, year: +year, sold_price: +sold } })

;(async () => {
  const matched = []
  let i = 0, done = 0
  async function worker() {
    while (i < cands.length) {
      const c = cands[i++]
      const km = 120000
      const e = await enrich(c.kenteken, km)
      done++
      if (e && e.make) {
        const v = { make: e.make, model: e.model, fuel: e.fuel, km, year: e.year, engineLabel: e.engineLabel, motorCode: e.motorCode, transmissionType: e.transmissionType, transmissionDetail: e.transmissionDetail, subModel: e.subModel }
        const m = matchEngineProfile(v)
        if (m) matched.push({ kenteken: c.kenteken, make: e.make, model: e.model, year: e.year, km, jurgen_bod: c.sold_price, fuel: e.fuel, motorCode: e.motorCode || null, engineLabel: e.engineLabel || null, _rule: m.id, _aftrek: m.aftrek_eur })
      }
      if (done % 20 === 0) process.stderr.write(`  ${done}/${cands.length} (matches: ${matched.length})\n`)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  matched.sort((a, b) => a._rule.localeCompare(b._rule))
  const out = { _meta: { created: '2026-06-17', purpose: 'RSPP engine-blacklist v1.1 — alleen cases die een motorCode/engineLabel-rule raken', n: matched.length }, cases: matched }
  fs.writeFileSync('/opt/t4c/fixtures/engine-targeted.json', JSON.stringify(out, null, 1))
  process.stderr.write(`\nKLAAR: ${matched.length} matchende cases -> fixtures/engine-targeted.json\n`)
  const byRule = {}
  for (const m of matched) byRule[m._rule] = (byRule[m._rule] || 0) + 1
  process.stderr.write('Per rule: ' + JSON.stringify(byRule) + '\n')
})()
