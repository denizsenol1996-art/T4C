#!/usr/bin/env node
// Retroactive normalize-sweep over alle market_listings rows.
// Vereist: t4c-server STOPPED tijdens uitvoer.
const path = require("path")
const Database = require("/opt/t4c/backend/node_modules/better-sqlite3")
const { normalizeListing } = require("/opt/t4c/backend/lib/listing-normalizer")

const DB_PATH = "/opt/t4c/data/t4c.db"

function main() {
  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")

  // Pre-sweep baseline per make
  console.log("=== Pre-sweep distribution per make (top 30 model buckets) ===")
  const baseline = db.prepare(`
    SELECT make, model, COUNT(*) as n FROM market_listings
    GROUP BY make, model HAVING n>=50 ORDER BY n DESC LIMIT 30
  `).all()
  for (const r of baseline) console.log(`  ${r.make.padEnd(18)} ${r.model.padEnd(30)} ${r.n}`)

  // Sweep
  console.log("\n=== Starting sweep ===")
  const rows = db.prepare(`SELECT id, make, model, title, source FROM market_listings`).all()
  console.log(`Total rows: ${rows.length}`)

  const stmt = db.prepare(`UPDATE market_listings SET model_normalized=?, normalize_source=? WHERE id=?`)
  const BATCH = 1000
  const counts = { native: 0, title_parse: 0, unmatched: 0 }
  const changes = []   // rows where model_normalized differs from model

  const txn = db.transaction((batch) => {
    for (const r of batch) {
      const result = normalizeListing(r)
      stmt.run(result.normalized_model || null, result.normalize_source, r.id)
      counts[result.normalize_source] = (counts[result.normalize_source] || 0) + 1
      if (result.normalized_model && result.normalized_model !== (r.model || "").toLowerCase()) {
        if (changes.length < 50) changes.push({ from: r.model, to: result.normalized_model, title: r.title })
      }
    }
  })

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    txn(batch)
    if ((i + BATCH) % 10000 === 0 || (i + BATCH) >= rows.length) {
      const pct = Math.min(100, Math.round(100 * (i + BATCH) / rows.length))
      console.log(`  progress ${Math.min(i+BATCH, rows.length)}/${rows.length} (${pct}%)`)
    }
  }

  console.log("\n=== Sweep done ===")
  console.log(`Counts: native=${counts.native}, title_parse=${counts.title_parse}, unmatched=${counts.unmatched}`)
  console.log(`First 20 model changes (from raw -> normalized):`)
  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.from.padEnd(20)} -> ${c.to.padEnd(20)}  | ${(c.title || "").slice(0, 60)}`)
  }

  // Post-sweep distribution
  console.log("\n=== Post-sweep — distribution per make (using normalized model) ===")
  const post = db.prepare(`
    SELECT make, COALESCE(model_normalized, model) as m, COUNT(*) as n
    FROM market_listings
    GROUP BY make, m HAVING n>=50 ORDER BY make, n DESC
  `).all()
  let lastMake = null
  for (const r of post) {
    if (r.make !== lastMake) {
      lastMake = r.make
      console.log(`\n  ${r.make}:`)
    }
    console.log(`    ${r.m.padEnd(30)} ${r.n}`)
  }

  db.close()
  console.log("\n[OK] sweep complete")
}

main()
