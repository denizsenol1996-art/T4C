// Shadow-blend backfill voor de 22 historische comp+expert rijen.
//
// Reden: live shadow-mode (v10.20.1-dev, commit 6890458) vult shadow_bod
// alleen voor NIEUWE quick-price calls. Voor analyse willen we ook
// retroactief inzicht op de 22 bestaande eligible rijen.
//
// SCOPE (= filter): rijen waar comp_status='ok' AND comp_count>=3 AND
// expert_bod_low/high IS NOT NULL AND market_median IS NOT NULL AND
// shadow_bod IS NULL. Resultaat: precies de 22 historische "blend-zou-
// hebben-gevuurd" cases.
//
// MARKER: shadow_source='shadow_backfill' (vs 'shadow_blend' voor live).
// Hiermee kunnen we live vs backfill onderscheiden in analyse.
//
// FORMULE: identiek aan de live shadow-code in valuation.js, met één
// verschil — confidenceComparable is niet opgeslagen in taxaties, dus
// gebruiken we een proxy via comp_count buckets:
//
//   comp_count >= 30 → weight 0.55  (proxy: confidence ~37/100)
//   comp_count >= 15 → weight 0.50  (proxy: confidence ~33/100)
//   comp_count >=  8 → weight 0.35  (proxy: confidence ~23/100)
//   comp_count >=  3 → weight 0.20  (clamp-floor zoals in live formule)
//
// Live formule: weight = clamp(0.20..0.70, confidenceComparable/100 * 1.5)
// De buckets zijn een grove approximatie. Verwachte afwijking met echte
// live shadow: 0.05-0.10 in weight, wat zich vertaalt naar ~€50-100
// shadow_bod-delta per case. Voor backtest-doel acceptabel.
//
// COMP-BOD RECONSTRUCTIE: gebruikt market_median (= compResult.market-
// Median, nooit overschreven door expert-paths) i.p.v. handelswaarde
// (die WEL overschreven wordt door expert_override / expert_user_context
// paden, zie valuation.js:1284-1331). Rounding-cascade identiek aan live
// code (valuation.js:1213-1217+1225):
//
//   verkoopMid = ROUND(market_median * 0.93 / 50) * 50
//   handel     = ROUND(verkoopMid * 0.85 / 50) * 50
//   bod_raw    = ROUND(handel * 0.90 / 50) * 50
//   comp_bod   = ROUND(bod_raw * bod_adjustment_factor / 50) * 50
//
//   expert_bod_mid = ROUND((expert_bod_low + expert_bod_high) / 2 / 50) * 50
//   shadow_bod = ROUND((comp_bod * w + expert_bod_mid * (1-w)) / 50) * 50

const fs = require('fs')
const initSqlJs = require('/opt/t4c/backend/node_modules/sql.js')

;(async () => {
  const SQL = await initSqlJs({ locateFile: f => '/opt/t4c/backend/node_modules/sql.js/dist/' + f })
  const dbPath = '/opt/t4c/data/t4c.db'
  const buf = fs.readFileSync(dbPath)
  const db = new SQL.Database(buf)

  // Pre-check: hoeveel rijen voldoen aan filter?
  const pre = db.exec(`
    SELECT COUNT(*) FROM taxaties
    WHERE shadow_bod IS NULL
      AND comp_status = 'ok' AND comp_count >= 3
      AND expert_bod_low IS NOT NULL AND expert_bod_high IS NOT NULL
      AND market_median IS NOT NULL
  `)
  const eligible = pre[0].values[0][0]
  console.log('Eligible rows for backfill: ' + eligible)
  if (eligible === 0) { console.log('Niets te doen.'); return }

  // Snapshot: log de berekende waarden voor de eligible rows VÓÓR update
  // (dry-run preview, blijft in stdout voor audit-trail)
  const preview = db.exec(`
    SELECT
      id, kenteken, make, model, year, km, comp_count,
      market_median, expert_bod_low, expert_bod_high,
      bod_adjustment_factor, final_bod,
      -- weight proxy
      CASE
        WHEN comp_count >= 30 THEN 0.55
        WHEN comp_count >= 15 THEN 0.50
        WHEN comp_count >=  8 THEN 0.35
        ELSE 0.20
      END AS w,
      -- comp_bod rounding cascade
      ROUND(
        (ROUND((ROUND((ROUND(market_median * 0.93 / 50.0) * 50) * 0.85 / 50.0) * 50) * 0.90 / 50.0) * 50)
        * COALESCE(bod_adjustment_factor, 1.0) / 50.0
      ) * 50 AS comp_bod_calc,
      -- expert_bod_mid snap-to-50
      ROUND((expert_bod_low + expert_bod_high) / 100.0) * 50 AS expert_bod_mid_calc
    FROM taxaties
    WHERE shadow_bod IS NULL
      AND comp_status = 'ok' AND comp_count >= 3
      AND expert_bod_low IS NOT NULL AND expert_bod_high IS NOT NULL
      AND market_median IS NOT NULL
    ORDER BY created_at DESC
  `)
  if (preview.length) {
    console.log('\n=== Preview ' + preview[0].values.length + ' rows ===')
    console.log(preview[0].columns.join(' | '))
    preview[0].values.forEach(row => console.log(row.map(v => v === null ? 'NULL' : String(v)).join(' | ')))
  }

  // UPDATE — identieke math als preview, plus eindblend
  db.run(`
    UPDATE taxaties
    SET
      shadow_bod =
        ROUND(
          (
            -- comp_bod term:
            (
              ROUND(
                (ROUND((ROUND((ROUND(market_median * 0.93 / 50.0) * 50) * 0.85 / 50.0) * 50) * 0.90 / 50.0) * 50)
                * COALESCE(bod_adjustment_factor, 1.0) / 50.0
              ) * 50
            ) *
            CASE
              WHEN comp_count >= 30 THEN 0.55
              WHEN comp_count >= 15 THEN 0.50
              WHEN comp_count >=  8 THEN 0.35
              ELSE 0.20
            END
            +
            -- expert_bod_mid term:
            (ROUND((expert_bod_low + expert_bod_high) / 100.0) * 50) *
            (1 - CASE
              WHEN comp_count >= 30 THEN 0.55
              WHEN comp_count >= 15 THEN 0.50
              WHEN comp_count >=  8 THEN 0.35
              ELSE 0.20
            END)
          ) / 50.0
        ) * 50,
      shadow_source = 'shadow_backfill'
    WHERE
      shadow_bod IS NULL
      AND comp_status = 'ok'
      AND comp_count >= 3
      AND expert_bod_low IS NOT NULL
      AND expert_bod_high IS NOT NULL
      AND market_median IS NOT NULL
  `)

  // Post-check: rows nu gevuld?
  const post = db.exec(`SELECT COUNT(*) FROM taxaties WHERE shadow_source='shadow_backfill'`)
  console.log('\nRows updated (shadow_source=shadow_backfill): ' + post[0].values[0][0])

  // Sample na update: laat de eerste 5 zien met shadow_bod gevuld
  const sample = db.exec(`
    SELECT kenteken, make, model, comp_count, market_median, expert_bod_low, expert_bod_high,
           bod_adjustment_factor, final_bod, shadow_bod, shadow_source
    FROM taxaties
    WHERE shadow_source = 'shadow_backfill'
    ORDER BY created_at DESC LIMIT 5
  `)
  if (sample.length) {
    console.log('\n=== Post-update sample (5 rows) ===')
    console.log(sample[0].columns.join(' | '))
    sample[0].values.forEach(row => console.log(row.map(v => v === null ? 'NULL' : String(v)).join(' | ')))
  }

  // Persist
  const out = Buffer.from(db.export())
  fs.writeFileSync(dbPath, out)
  console.log('\nDB persisted (' + out.length + ' bytes)')
})()
