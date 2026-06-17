#!/usr/bin/env node
// AI-research voor 6 open Jurgen-vragen (zie ROCK-SOLID-PIPELINE-2026-06-17.md
// + JURGEN-PRICING-DNA-2026-06-17.md).
//
// Doel: laat GPT (web_search + reasoning) cijfers ophalen die Jurgen niet
// expliciet kan formuleren maar wel verwacht dat de tool weet.
//
// Output: /opt/t4c/backend/config/model-profiles.json (1 entry per top-100 model)
//
// Gebruik:
//   node /opt/t4c/scripts/jurgen-research.js --models=100 [--dry-run]
//   node /opt/t4c/scripts/jurgen-research.js --model="VOLKSWAGEN GOLF"
//
// LET OP: kost OpenAI-credits. Top-100 = ~€5-10 met gpt-5.4. Run bewust.

const fs = require('fs')
const path = require('path')
const Database = require('/opt/t4c/backend/node_modules/better-sqlite3')
const axios = require('/opt/t4c/backend/node_modules/axios')

const args = process.argv.slice(2).reduce((a, x) => {
  const m = x.match(/^--([\w-]+)(?:=(.+))?$/)
  if (m) a[m[1]] = m[2] === undefined ? true : m[2]
  return a
}, {})

const TOP_N = parseInt(args.models || '100')
const DRY_RUN = !!(args['dry-run'] || args.dry)
const SINGLE_MODEL = args.model || null
const OUT = '/opt/t4c/backend/config/model-profiles.json'

const db = new Database('/opt/t4c/data/t4c.db', { readonly: true })

// API-key via DB-settings (zie memory feedback_t4c_jwt_secret_location voor patroon)
function getApiKey() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'api_key_OPENAI_API_KEY'").get()
    if (row && row.value && row.value.length > 10) return row.value
  } catch (e) {}
  return process.env.OPENAI_API_KEY || ''
}

// API-key alleen vereist voor echte run (niet voor dry-run)
const API_KEY = getApiKey()
if (!DRY_RUN && !API_KEY) {
  console.error('❌ Geen OPENAI_API_KEY (DB-setting of env)')
  process.exit(1)
}

// Top-N modellen uit market_listings (waar wij echt mee werken)
function getTopModels(n) {
  if (SINGLE_MODEL) {
    const [make, ...modelParts] = SINGLE_MODEL.split(' ')
    return [{ make, model: modelParts.join(' '), count: 0 }]
  }
  return db.prepare(`
    SELECT UPPER(make) AS make, UPPER(model) AS model, COUNT(*) AS count
    FROM market_listings
    WHERE make IS NOT NULL AND model IS NOT NULL
      AND last_seen > datetime('now', '-90 days')
    GROUP BY UPPER(make), UPPER(model)
    HAVING count > 30
    ORDER BY count DESC
    LIMIT ?
  `).all(n)
}

function buildPrompt(make, model) {
  return {
    system: `Je bent een Nederlandse automotive markt-analist. Je geeft cijfers over de Nederlandse occasionmarkt op basis van publieke bronnen (Marktplaats, Gaspedaal, AutoScout24.nl, ANWB, BOVAG, RDW, Nederlandse autopers). Antwoord ALLEEN met geldige JSON, geen prose.`,
    user: `Geef voor ${make} ${model} de volgende profielinformatie voor de Nederlandse markt 2026:

{
  "recon_costs_eur": {
    "apk_typical": <gemiddelde APK-reparatie>,
    "service_typical": <onderhoudsbeurt>,
    "common_repairs_at_150k_km": <typische slijtage>,
    "common_repairs_at_250k_km": <hoge km>
  },
  "typical_standtijd_days_at_dealer": <mediaan dagen op terrein bij NL-dealer>,
  "marketability_score": <1-10 hoe snel verkoopt dit model in NL>,
  "high_relevance_options": [<2-5 opties die voor dit model echt prijsverschil maken>],
  "low_relevance_options": [<2-3 opties die NIET prijsverschil maken>],
  "engine_variants_high_risk": [<motoren die bekend probleem zijn, bv "1.6 THP">],
  "engine_variants_safe": [<motoren die als betrouwbaar bekend staan>],
  "scrap_value_eur": {
    "200k_km": <onderdelen/sloop-restwaarde>,
    "300k_km": <idem>
  },
  "export_demand": "<laag|midden|hoog>",
  "export_target_markets": [<landen waar dit model gevraagd is>],
  "seasonal_pattern": "<beste maanden om dit model te verkopen>",
  "notable_facts": [<2-4 markant feiten voor dealer-prijsbepaling>]
}

Wees realistisch en specifiek. Gebruik web_search om actuele Nederlandse marktdata te checken.`
  }
}

async function askGPT(make, model) {
  const p = buildPrompt(make, model)
  const resp = await axios.post('https://api.openai.com/v1/responses', {
    model: process.env.T4C_VALUATION_MODEL || 'gpt-5.4',
    temperature: 0,
    max_output_tokens: 1500,
    tools: [{ type: 'web_search_preview' }],
    input: p.system + '\n\n' + p.user
  }, {
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    timeout: 60000
  })
  const outBlocks = resp.data.output || []
  const textBlock = outBlocks.find(b => b.type === 'message')
  let raw = (textBlock?.content?.find(c => c.type === 'output_text') || textBlock?.content?.[0] || {}).text || ''
  raw = raw.replace(/```json/g, '').replace(/```/g, '').trim()
  const m = raw.match(/\{[\s\S]*\}/)
  if (m) raw = m[0]
  return JSON.parse(raw)
}

;(async () => {
  const models = getTopModels(TOP_N)
  console.log(`Top ${models.length} modellen om te onderzoeken (uit market_listings <90d)`)
  if (DRY_RUN) {
    console.log('\n--dry-run: alleen lijst tonen, geen GPT-calls.\n')
    for (const m of models.slice(0, 20)) {
      console.log(`  ${m.make.padEnd(15)} ${m.model.padEnd(25)} count=${m.count}`)
    }
    if (models.length > 20) console.log(`  ... +${models.length - 20} meer`)
    db.close()
    return
  }

  // Laad bestaande profiles indien aanwezig (incrementeel)
  let profiles = {}
  if (fs.existsSync(OUT)) {
    try { profiles = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch (e) {}
  }
  if (!profiles._meta) {
    profiles._meta = {
      generated: new Date().toISOString(),
      source: 'jurgen-research.js (GPT + web_search)',
      model_used: process.env.T4C_VALUATION_MODEL || 'gpt-5.4',
      version: 1
    }
    profiles.models = {}
  }

  let done = 0, failed = 0
  for (const m of models) {
    const key = `${m.make}|${m.model}`
    if (profiles.models?.[key]) {
      console.log(`  ⏭️  ${key} (bestaat al)`)
      continue
    }
    try {
      const t0 = Date.now()
      const data = await askGPT(m.make, m.model)
      const ms = Date.now() - t0
      profiles.models = profiles.models || {}
      profiles.models[key] = {
        make: m.make, model: m.model,
        market_count_90d: m.count,
        researched_at: new Date().toISOString(),
        latency_ms: ms,
        data
      }
      done++
      console.log(`  ✅ ${key} (${ms}ms)`)
      // Persist na elke 5 (incremental save)
      if (done % 5 === 0) {
        fs.writeFileSync(OUT, JSON.stringify(profiles, null, 2))
      }
    } catch (e) {
      failed++
      console.log(`  ❌ ${key}: ${e.message}`)
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(profiles, null, 2))
  console.log(`\n✅ Klaar: ${done} nieuw, ${failed} mislukt → ${OUT}`)
  db.close()
})()
