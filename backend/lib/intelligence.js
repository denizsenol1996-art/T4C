// T4C Intelligence Engine — Auto-learning market scanner
// Maakt taxaties slimmer over tijd door:
// 1. Auto-queue: taxaties → crawl queue
// 2. Source scoring: welke bronnen leveren betrouwbare data
// 3. Trend detectie: stijgend/dalend per model
// 4. Verkocht-detectie: listing weg = sold
// 5. Dagelijkse samenvatting

const { queryAll, queryOne, run, stmts } = require("../db")

// ═══ DB MIGRATIONS ═══
function migrateIntelligence() {
  try {
    // Source reliability scores
    run(`CREATE TABLE IF NOT EXISTS source_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL UNIQUE,
      hit_count INTEGER DEFAULT 0,
      miss_count INTEGER DEFAULT 0,
      total_prices INTEGER DEFAULT 0,
      avg_deviation REAL DEFAULT 0,
      avg_response_ms INTEGER DEFAULT 0,
      reliability REAL DEFAULT 0.5,
      last_updated TEXT DEFAULT (datetime('now'))
    )`)

    // Daily market digests
    run(`CREATE TABLE IF NOT EXISTS market_digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      models_scanned INTEGER DEFAULT 0,
      total_prices INTEGER DEFAULT 0,
      new_listings INTEGER DEFAULT 0,
      sold_detected INTEGER DEFAULT 0,
      trending_up TEXT DEFAULT '[]',
      trending_down TEXT DEFAULT '[]',
      summary TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`)

    // Add priority + crawl_count to crawl_queue if missing
    try { run("ALTER TABLE crawl_queue ADD COLUMN priority INTEGER DEFAULT 5") } catch {}
    try { run("ALTER TABLE crawl_queue ADD COLUMN crawl_count INTEGER DEFAULT 0") } catch {}
    try { run("ALTER TABLE crawl_queue ADD COLUMN avg_prices INTEGER DEFAULT 0") } catch {}
    try { run("ALTER TABLE crawl_queue ADD COLUMN taxatie_count INTEGER DEFAULT 0") } catch {}

    console.log("[INTELLIGENCE] DB migrations OK")
  } catch (e) {
    console.error("[INTELLIGENCE] Migration error:", e.message)
  }
}

// ═══ AUTO-QUEUE ═══
// Bij elke taxatie: auto-add model to crawl queue met hogere prioriteit
function autoQueue(make, model, year, transmission) {
  if (!make || !model || !year) return
  const mk = make.toLowerCase(), ml = model.toLowerCase()
  const trans = transmission || ''

  try {
    const existing = queryOne(
      "SELECT id, priority, taxatie_count FROM crawl_queue WHERE make=? AND model=? AND year=?",
      [mk, ml, year]
    )

    if (existing) {
      // Verhoog prioriteit en taxatie count
      const newPrio = Math.min(10, (existing.priority || 5) + 1)
      run("UPDATE crawl_queue SET priority=?, taxatie_count=?, transmission=? WHERE id=?",
        [newPrio, (existing.taxatie_count || 0) + 1, trans, existing.id])
    } else {
      // Nieuw model — hoge prioriteit want iemand zoekt het
      try {
        stmts.addToCrawlQueue.run(mk, ml, year, trans)
      } catch {
        run("INSERT OR IGNORE INTO crawl_queue (make,model,year,transmission,priority,taxatie_count) VALUES (?,?,?,?,8,1)",
          [mk, ml, year, trans])
      }
    }
  } catch (e) {
    console.error("[INTELLIGENCE] autoQueue error:", e.message)
  }
}

// ═══ SOURCE SCORING ═══
// Track per bron: hits, misses, prijsafwijking
function scoreSource(sourceName, priceCount, prices, medianAll, responseMs) {
  if (!sourceName) return
  try {
    const existing = queryOne("SELECT * FROM source_scores WHERE source=?", [sourceName])

    if (existing) {
      const newHits = existing.hit_count + (priceCount > 0 ? 1 : 0)
      const newMisses = existing.miss_count + (priceCount === 0 ? 1 : 0)
      const newTotal = existing.total_prices + priceCount

      // Bereken gemiddelde afwijking van deze bron vs overall mediaan
      let deviation = existing.avg_deviation
      if (prices && prices.length > 0 && medianAll > 0) {
        const srcMedian = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
        const srcDev = Math.abs(srcMedian - medianAll) / medianAll
        // Weighted moving average
        deviation = (existing.avg_deviation * 0.7) + (srcDev * 0.3)
      }

      // Reliability score: 0-1 (hits ratio × inverse deviation)
      const hitRatio = newHits / Math.max(1, newHits + newMisses)
      const devPenalty = Math.max(0, 1 - deviation * 2) // >50% afwijking = 0
      const reliability = Math.round((hitRatio * 0.6 + devPenalty * 0.4) * 100) / 100

      const avgMs = Math.round((existing.avg_response_ms * 0.8) + ((responseMs || 0) * 0.2))

      run(`UPDATE source_scores SET hit_count=?, miss_count=?, total_prices=?,
           avg_deviation=?, avg_response_ms=?, reliability=?, last_updated=datetime('now')
           WHERE source=?`,
        [newHits, newMisses, newTotal, Math.round(deviation * 1000) / 1000, avgMs, reliability, sourceName])
    } else {
      const reliability = priceCount > 0 ? 0.6 : 0.2
      run(`INSERT INTO source_scores (source, hit_count, miss_count, total_prices,
           avg_deviation, avg_response_ms, reliability)
           VALUES (?,?,?,?,0,?,?)`,
        [sourceName, priceCount > 0 ? 1 : 0, priceCount === 0 ? 1 : 0,
         priceCount, responseMs || 0, reliability])
    }
  } catch (e) {
    console.error("[INTELLIGENCE] scoreSource error:", e.message)
  }
}

// Get source rankings
function getSourceRankings() {
  try {
    return queryAll("SELECT * FROM source_scores ORDER BY reliability DESC, total_prices DESC")
  } catch { return [] }
}

// Get best sources (reliability > 0.4) for smart scraping
function getBestSources(minReliability) {
  const min = minReliability || 0.4
  try {
    return queryAll("SELECT source, reliability FROM source_scores WHERE reliability >= ? ORDER BY reliability DESC", [min])
  } catch { return [] }
}

// ═══ TREND DETECTION ═══
// Analyseer snapshots over tijd: stijgt of daalt de prijs?
function detectTrend(make, model, year) {
  try {
    // Laatste 10 snapshots
    const snaps = queryAll(
      "SELECT median, avg, count, created_at FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 10",
      [make.toLowerCase(), model.toLowerCase(), year]
    )

    if (snaps.length < 3) return { direction: 'unknown', confidence: 0, change_pct: 0, datapoints: snaps.length }

    // Recent vs older: vergelijk eerste helft met tweede helft
    const mid = Math.floor(snaps.length / 2)
    const recent = snaps.slice(0, mid)
    const older = snaps.slice(mid)

    const recentMedian = recent.reduce((s, r) => s + (r.median || 0), 0) / recent.length
    const olderMedian = older.reduce((s, r) => s + (r.median || 0), 0) / older.length

    if (olderMedian === 0) return { direction: 'unknown', confidence: 0, change_pct: 0, datapoints: snaps.length }

    const changePct = Math.round(((recentMedian - olderMedian) / olderMedian) * 1000) / 10 // 1 decimal

    // Richting + vertrouwen
    let direction = 'stabiel'
    let confidence = 0

    if (changePct > 3) { direction = 'stijgend'; confidence = Math.min(1, changePct / 15) }
    else if (changePct < -3) { direction = 'dalend'; confidence = Math.min(1, Math.abs(changePct) / 15) }
    else { direction = 'stabiel'; confidence = 0.5 }

    // Bonus confidence als veel datapunten
    if (snaps.length >= 8) confidence = Math.min(1, confidence + 0.15)

    return {
      direction,
      confidence: Math.round(confidence * 100) / 100,
      change_pct: changePct,
      recent_median: Math.round(recentMedian),
      older_median: Math.round(olderMedian),
      datapoints: snaps.length,
      period_days: snaps.length > 1 ?
        Math.round((new Date(snaps[0].created_at) - new Date(snaps[snaps.length - 1].created_at)) / 86400000) : 0
    }
  } catch (e) {
    return { direction: 'unknown', confidence: 0, change_pct: 0, error: e.message }
  }
}

// Detect trends for all tracked models
function detectAllTrends() {
  try {
    const models = queryAll(
      "SELECT DISTINCT make, model, year FROM market_snapshots GROUP BY make, model, year HAVING COUNT(*) >= 3"
    )
    const trends = []
    for (const m of models) {
      const trend = detectTrend(m.make, m.model, m.year)
      if (trend.direction !== 'unknown') {
        trends.push({ ...m, ...trend })
      }
    }
    return trends.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
  } catch { return [] }
}

// ═══ SOLD DETECTION ═══
// Markeer listings die niet meer gezien zijn als verkocht
function detectSoldListings(make, model, year, currentListings) {
  if (!currentListings || !currentListings.length) return 0
  try {
    const currentHashes = new Set(currentListings.map(l => {
      const crypto = require("crypto")
      return crypto.createHash("md5").update(`${l.price}-${(l.title || '').slice(0, 30)}-${l.source || ''}`).digest("hex").slice(0, 12)
    }))

    // Get active listings from DB
    const active = queryAll(
      "SELECT id, hash, price FROM market_listings WHERE make=? AND model=? AND year=? AND status='active'",
      [make.toLowerCase(), model.toLowerCase(), year]
    )

    let soldCount = 0
    for (const listing of active) {
      if (!currentHashes.has(listing.hash)) {
        // Listing niet meer gezien — waarschijnlijk verkocht
        // Alleen markeren als we genoeg nieuwe data hebben
        if (currentListings.length >= 3) {
          run("UPDATE market_listings SET status='sold', sold_estimate=? WHERE id=?",
            [listing.price, listing.id])
          soldCount++
        }
      } else {
        // Nog actief — update last_seen
        run("UPDATE market_listings SET last_seen=datetime('now') WHERE id=?", [listing.id])
      }
    }

    return soldCount
  } catch (e) {
    console.error("[INTELLIGENCE] detectSold error:", e.message)
    return 0
  }
}

// ═══ MARKET VELOCITY ═══
// Hoe snel worden auto's van dit type verkocht?
function getMarketVelocity(make, model, year) {
  try {
    const sold = queryAll(
      "SELECT first_seen, last_seen FROM market_listings WHERE make=? AND model=? AND year=? AND status='sold' ORDER BY last_seen DESC LIMIT 20",
      [make.toLowerCase(), model.toLowerCase(), year]
    )

    if (sold.length < 2) return { velocity: 'unknown', avg_days: null, sold_count: sold.length }

    const days = sold.map(s => {
      const first = new Date(s.first_seen)
      const last = new Date(s.last_seen)
      return Math.max(1, Math.round((last - first) / 86400000))
    })

    const avgDays = Math.round(days.reduce((a, b) => a + b, 0) / days.length)

    let velocity = 'normaal'
    if (avgDays <= 14) velocity = 'snel'
    else if (avgDays <= 30) velocity = 'normaal'
    else if (avgDays <= 60) velocity = 'traag'
    else velocity = 'zeer traag'

    return { velocity, avg_days: avgDays, sold_count: sold.length }
  } catch {
    return { velocity: 'unknown', avg_days: null, sold_count: 0 }
  }
}

// ═══ DAILY DIGEST ═══
// Genereer dagelijkse samenvatting van marktbewegingen
function generateDailyDigest() {
  try {
    const today = new Date().toISOString().split('T')[0]

    // Check of we vandaag al een digest hebben
    const existing = queryOne("SELECT id FROM market_digests WHERE date=?", [today])
    if (existing) return queryOne("SELECT * FROM market_digests WHERE date=?", [today])

    // Verzamel data van vandaag
    const todaySnaps = queryAll(
      "SELECT * FROM market_snapshots WHERE created_at >= date('now')"
    )
    const todayListings = queryAll(
      "SELECT * FROM market_listings WHERE first_seen >= date('now')"
    )
    const soldToday = queryAll(
      "SELECT * FROM market_listings WHERE status='sold' AND last_seen >= date('now')"
    )

    // Trends
    const trends = detectAllTrends()
    const trendingUp = trends.filter(t => t.direction === 'stijgend' && t.change_pct > 5).slice(0, 5)
    const trendingDown = trends.filter(t => t.direction === 'dalend' && t.change_pct < -5).slice(0, 5)

    // Summary tekst
    const parts = []
    parts.push(`${todaySnaps.length} modellen gescand, ${todaySnaps.reduce((s, r) => s + (r.count || 0), 0)} prijzen verzameld.`)
    if (todayListings.length) parts.push(`${todayListings.length} nieuwe listings gevonden.`)
    if (soldToday.length) parts.push(`${soldToday.length} auto's als verkocht gemarkeerd.`)
    if (trendingUp.length) parts.push(`Stijgend: ${trendingUp.map(t => `${t.make} ${t.model} ${t.year} (+${t.change_pct}%)`).join(', ')}.`)
    if (trendingDown.length) parts.push(`Dalend: ${trendingDown.map(t => `${t.make} ${t.model} ${t.year} (${t.change_pct}%)`).join(', ')}.`)

    run(`INSERT OR REPLACE INTO market_digests (date, models_scanned, total_prices, new_listings,
         sold_detected, trending_up, trending_down, summary)
         VALUES (?,?,?,?,?,?,?,?)`,
      [today, todaySnaps.length,
       todaySnaps.reduce((s, r) => s + (r.count || 0), 0),
       todayListings.length,
       soldToday.length,
       JSON.stringify(trendingUp.map(t => ({ make: t.make, model: t.model, year: t.year, pct: t.change_pct }))),
       JSON.stringify(trendingDown.map(t => ({ make: t.make, model: t.model, year: t.year, pct: t.change_pct }))),
       parts.join(' ')])

    return queryOne("SELECT * FROM market_digests WHERE date=?", [today])
  } catch (e) {
    console.error("[INTELLIGENCE] digest error:", e.message)
    return null
  }
}

// ═══ SMART CRAWL PRIORITY ═══
// Bepaal welke modellen het eerst gecrawled moeten worden
function getSmartQueue(limit) {
  const n = limit || 12
  try {
    // Prioriteit: taxatie_count (vraag) × priority - recent gecrawled straft af
    return queryAll(`
      SELECT *, 
        COALESCE(priority, 5) * (1 + COALESCE(taxatie_count, 0) * 0.3) 
        - CASE WHEN last_crawled_at > 0 THEN MIN(10, (strftime('%s','now') - last_crawled_at) / -3600) ELSE 10 END
        AS score
      FROM crawl_queue 
      ORDER BY score DESC, last_crawled_at ASC
      LIMIT ?
    `, [n])
  } catch {
    // Fallback naar oude methode
    try {
      return queryAll("SELECT * FROM crawl_queue ORDER BY last_crawled_at ASC LIMIT ?", [n])
    } catch { return [] }
  }
}

// ═══ ENRICH TAXATIE ═══
// Voeg intelligence data toe aan een taxatie resultaat
function enrichTaxatie(make, model, year) {
  const trend = detectTrend(make, model, year)
  const velocity = getMarketVelocity(make, model, year)
  const sources = getSourceRankings()

  // Bereken marktvertrouwen
  const snapsCount = queryOne(
    "SELECT COUNT(*) as c FROM market_snapshots WHERE make=? AND model=? AND year=?",
    [make.toLowerCase(), model.toLowerCase(), year]
  )?.c || 0

  let marketConfidence = 'laag'
  if (snapsCount >= 10 && trend.confidence > 0.5) marketConfidence = 'hoog'
  else if (snapsCount >= 5) marketConfidence = 'gemiddeld'

  return {
    trend,
    velocity,
    market_confidence: marketConfidence,
    data_points: snapsCount,
    top_sources: sources.slice(0, 5).map(s => ({ name: s.source, reliability: s.reliability })),
    recommendation: buildRecommendation(trend, velocity, marketConfidence)
  }
}

// Genereer advies op basis van intelligence
function buildRecommendation(trend, velocity, confidence) {
  const parts = []

  if (trend.direction === 'dalend' && trend.change_pct < -5) {
    parts.push('Prijs daalt — snel inkopen of lager bieden.')
  } else if (trend.direction === 'stijgend' && trend.change_pct > 5) {
    parts.push('Markt stijgt — hogere marge mogelijk.')
  } else {
    parts.push('Markt stabiel — standaard marge hanteren.')
  }

  if (velocity.velocity === 'snel') {
    parts.push('Snelle doorloop — populair model, snel verkoopbaar.')
  } else if (velocity.velocity === 'traag' || velocity.velocity === 'zeer traag') {
    parts.push('Trage doorloop — meer onderhandelruimte nodig.')
  }

  if (confidence === 'laag') {
    parts.push('⚠ Weinig data — prijs indicatief.')
  }

  return parts.join(' ')
}

// ═══ INIT ═══
function initIntelligence() {
  migrateIntelligence()
  console.log("[INTELLIGENCE] Engine initialized")
}


// ═══ SEIZOENSEFFECTEN ═══
function getSeasonalEffect(make, model, body, fuel) {
  const month = new Date().getMonth() + 1 // 1-12
  const mk = (make || "").toLowerCase()
  const ml = (model || "").toLowerCase()
  const bd = (body || "").toLowerCase()
  const fl = (fuel || "").toLowerCase()

  // Cabrio / roadster: winter = -15%, zomer = +8%
  const isCabrio = bd.includes("cabrio") || bd.includes("roadster") || ml.includes("cabrio") || ml.includes("roadster") || ml.includes("spider") || ml.includes("boxster") || ml.includes("mx-5") || ml.includes("slk") || ml.includes("z4")
  if (isCabrio) {
    if (month >= 11 || month <= 2) return { pct: -15, label: "Cabrio in winter", season: "winter" }
    if (month >= 5 && month <= 8) return { pct: 8, label: "Cabrio in zomer", season: "zomer" }
    return { pct: 0, label: "Cabrio neutraal seizoen", season: "neutraal" }
  }

  // SUV / 4x4: winter = +5%, zomer = -3%
  const isSUV = bd.includes("suv") || bd.includes("terrein") || ml.includes("tiguan") || ml.includes("tucson") || ml.includes("qashqai") || ml.includes("kuga") || ml.includes("rav4") || ml.includes("x1") || ml.includes("x3") || ml.includes("x5") || ml.includes("glc") || ml.includes("gla") || ml.includes("q3") || ml.includes("q5") || ml.includes("sportage") || ml.includes("ateca") || ml.includes("kodiaq") || ml.includes("t-roc") || ml.includes("2008") || ml.includes("3008") || ml.includes("duster") || ml.includes("mokka") || ml.includes("kona") || ml.includes("c-hr") || ml.includes("cx-5") || ml.includes("karoq")
  if (isSUV) {
    if (month >= 10 || month <= 2) return { pct: 5, label: "SUV in herfst/winter", season: "winter" }
    if (month >= 5 && month <= 8) return { pct: -3, label: "SUV in zomer", season: "zomer" }
    return { pct: 0, label: "SUV neutraal seizoen", season: "neutraal" }
  }

  // EV: december/januari bonus (bijtelling), zomer lager
  const isEV = fl.includes("elektr") || ml.includes("model 3") || ml.includes("model y") || ml.includes("id.3") || ml.includes("id.4") || ml.includes("e-208") || ml.includes("zoe") || ml.includes("enyaq") || ml.includes("ioniq") || ml.includes("ev6") || ml.includes("e-niro")
  if (isEV) {
    if (month === 12 || month === 1) return { pct: 8, label: "EV bijtelling-rush", season: "winter" }
    if (month >= 6 && month <= 8) return { pct: -5, label: "EV zomerdip", season: "zomer" }
    return { pct: 0, label: "EV neutraal seizoen", season: "neutraal" }
  }

  // Busje / bedrijfswagen: vrij stabiel
  const isBus = bd.includes("bedrijf") || ml.includes("transporter") || ml.includes("caddy") || ml.includes("transit") || ml.includes("sprinter") || ml.includes("vito") || ml.includes("trafic") || ml.includes("master") || ml.includes("ducato") || ml.includes("berlingo")
  if (isBus) return { pct: 0, label: "Bedrijfswagen stabiel", season: "neutraal" }

  // Standaard: kleine seizoenseffecten
  if (month === 1 || month === 2) return { pct: -3, label: "Januari/februari dip", season: "winter" }
  if (month >= 3 && month <= 5) return { pct: 3, label: "Voorjaarspiek", season: "lente" }
  return { pct: 0, label: "Neutraal seizoen", season: "neutraal" }
}

// ═══ UITRUSTING IMPACT ═══
function getEquipmentImpact(vehicle) {
  let total = 0
  const items = []
  const v = vehicle || {}

  // Premium opties
  if (v.roofType && (v.roofType.toLowerCase().includes("panorama") || v.roofType.toLowerCase().includes("schuifdak"))) {
    total += 800; items.push({ name: "Panoramadak", value: 800 })
  }
  if (v.towbar) { total += 400; items.push({ name: "Trekhaak", value: 400 }) }
  if (v.naviType && v.naviType.toLowerCase().includes("pro")) {
    total += 500; items.push({ name: "Navigatie Pro", value: 500 })
  } else if (v.naviType) {
    total += 300; items.push({ name: "Navigatie", value: 300 })
  }
  if (v.camera && v.camera.toLowerCase().includes("360")) {
    total += 400; items.push({ name: "360° camera", value: 400 })
  } else if (v.camera) {
    total += 200; items.push({ name: "Achteruitrijcamera", value: 200 })
  }
  if (v.heatedSeats) { total += 200; items.push({ name: "Stoelverwarming", value: 200 }) }
  if (v.parkingSensors && v.parkingSensors.toLowerCase().includes("voor")) {
    total += 250; items.push({ name: "Parkeersensoren V+A", value: 250 })
  } else if (v.parkingSensors) {
    total += 150; items.push({ name: "Parkeersensoren", value: 150 })
  }
  if (v.headlightType && (v.headlightType.toLowerCase().includes("led") || v.headlightType.toLowerCase().includes("matrix"))) {
    total += 350; items.push({ name: "LED/Matrix koplampen", value: 350 })
  }
  if (v.interior && (v.interior.toLowerCase().includes("leder") || v.interior.toLowerCase().includes("leather") || v.interior.toLowerCase().includes("leer"))) {
    total += 600; items.push({ name: "Leder interieur", value: 600 })
  }
  if (v.audioSystem && (v.audioSystem.toLowerCase().includes("harman") || v.audioSystem.toLowerCase().includes("bose") || v.audioSystem.toLowerCase().includes("bang") || v.audioSystem.toLowerCase().includes("burmester"))) {
    total += 400; items.push({ name: "Premium audio", value: 400 })
  }
  
  // Transmissie impact
  if (v.transmissionAuto) { total += 500; items.push({ name: "Automaat", value: 500 }) }

  // Trim level bonus
  const trim = (v.trimLevel || "").toLowerCase()
  if (trim.includes("r-line") || trim.includes("amg") || trim.includes("m-sport") || trim.includes("s-line") || trim.includes("gt-line") || trim.includes("fr")) {
    total += 1000; items.push({ name: "Sportpakket (" + v.trimLevel + ")", value: 1000 })
  } else if (trim.includes("highline") || trim.includes("avantgarde") || trim.includes("luxury") || trim.includes("inscription")) {
    total += 600; items.push({ name: "Luxe uitvoering (" + v.trimLevel + ")", value: 600 })
  }

  return { total: total, items: items }
}



// ═══ REGIO-CORRECTIE ═══
function getRegioCorrectie(province) {
  const p = (province || "").toLowerCase()
  // Randstad = hogere prijzen (meer vraag, hogere kosten)
  // Platteland = lagere prijzen
  const corrections = {
    "noord-holland": 3, "zuid-holland": 3, "utrecht": 2,
    "noord-brabant": 1, "gelderland": 0, "overijssel": -1,
    "limburg": -2, "flevoland": 0, "zeeland": -2,
    "friesland": -3, "groningen": -3, "drenthe": -3
  }
  const pct = corrections[p] !== undefined ? corrections[p] : 0
  let label = "Neutraal"
  if (pct > 0) label = "Randstad premium"
  else if (pct < 0) label = "Regio korting"
  return { pct, label, province: p || "onbekend" }
}


// ═══ ARBITRAGE DETECTOR ═══
function findArbitrageDeals(minDiscountPct = 10) {
  // Compare every active listing against market median for its make/model/year
  const deals = []
  const listings = queryAll("SELECT * FROM market_listings WHERE price > 500 AND status='active' AND last_seen > datetime('now', '-3 days')")
  
  for (const l of listings) {
    const snap = queryOne(
      "SELECT median, avg, count FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 1",
      [(l.make||"").toLowerCase(), (l.model||"").toLowerCase(), l.year || 0]
    )
    if (!snap || !snap.median || snap.count < 5) continue
    
    const discount = snap.median - l.price
    const discountPct = Math.round(discount / snap.median * 100)
    
    if (discountPct >= minDiscountPct) {
      deals.push({
        listing_id: l.id,
        make: l.make, model: l.model, year: l.year, km: l.km,
        listing_price: l.price,
        market_median: snap.median,
        discount_pct: discountPct,
        discount_eur: Math.round(discount),
        source: l.source || "",
        url: l.url || "",
        dealer: l.dealer || "",
        market_count: snap.count
      })
    }
  }
  
  // Filter out suspicious deals (too good to be true)
  const realDeals = deals.filter(d => d.listing_price >= 1500 && d.year >= 2010 && (!d.km || d.km <= 250000))
  const goodDeals = realDeals.filter(d => d.discount_pct >= 8 && d.discount_pct <= 35)
  const suspectDeals = realDeals.filter(d => d.discount_pct > 35)
  
  // Sort good deals by discount
  goodDeals.sort((a, b) => b.discount_pct - a.discount_pct)
  
  // Save top deals
  for (const d of goodDeals.slice(0, 50)) {
    try {
      const exists = queryOne("SELECT id FROM arbitrage_deals WHERE listing_id=? AND status='nieuw'", [d.listing_id])
      if (!exists) {
        run("INSERT INTO arbitrage_deals (listing_id,make,model,year,km,listing_price,market_median,discount_pct,discount_eur,source,url,dealer) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          [d.listing_id, d.make, d.model, d.year, d.km, d.listing_price, d.market_median, d.discount_pct, d.discount_eur, d.source, d.url, d.dealer])
      }
    } catch(e) {}
  }
  
  return { count: goodDeals.length, suspect: suspectDeals.length, total: deals.length, top: goodDeals.slice(0, 20) }
}

// ═══ DEALER TRACKER ═══
function trackDealers() {
  const dealers = {}
  const listings = queryAll("SELECT * FROM market_listings WHERE dealer IS NOT NULL AND dealer != '' AND price > 500")
  
  for (const l of listings) {
    const name = (l.dealer || "").trim()
    if (!name || name.length < 3) continue
    if (!dealers[name]) dealers[name] = { listings: [], total: 0, prices: [], sources: new Set() }
    dealers[name].listings.push(l)
    dealers[name].total++
    dealers[name].prices.push(l.price)
    dealers[name].sources.add(l.source || "onbekend")
  }
  
  const profiles = []
  for (const [name, data] of Object.entries(dealers)) {
    if (data.total < 2) continue // Min 2 listings to track
    
    const avgPrice = Math.round(data.prices.reduce((s,p) => s+p, 0) / data.prices.length)
    
    // Compare dealer avg to market median
    let priceVsMarket = 0
    let comparisons = 0
    for (const l of data.listings) {
      const snap = queryOne(
        "SELECT median FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 1",
        [(l.make||"").toLowerCase(), (l.model||"").toLowerCase(), l.year || 0]
      )
      if (snap && snap.median > 0) {
        priceVsMarket += ((l.price - snap.median) / snap.median) * 100
        comparisons++
      }
    }
    priceVsMarket = comparisons > 0 ? Math.round(priceVsMarket / comparisons) : 0
    
    // Get unique models
    const models = [...new Set(data.listings.map(l => (l.make||"") + " " + (l.model||"")))].slice(0, 10)
    
    const sellSpeed = priceVsMarket < -5 ? "snel" : priceVsMarket > 5 ? "traag" : "normaal"
    
    // Upsert
    try {
      const existing = queryOne("SELECT id FROM dealer_profiles WHERE dealer_name=?", [name])
      if (existing) {
        run("UPDATE dealer_profiles SET total_listings=?, avg_price=?, price_vs_market_pct=?, sell_speed=?, models=?, source=?, updated_at=datetime('now') WHERE id=?",
          [data.total, avgPrice, priceVsMarket, sellSpeed, JSON.stringify(models), [...data.sources].join(","), existing.id])
      } else {
        run("INSERT INTO dealer_profiles (dealer_name, total_listings, avg_price, price_vs_market_pct, sell_speed, models, source) VALUES (?,?,?,?,?,?,?)",
          [name, data.total, avgPrice, priceVsMarket, sellSpeed, JSON.stringify(models), [...data.sources].join(",")])
      }
    } catch(e) {}
    
    profiles.push({ name, total: data.total, avgPrice, priceVsMarket, sellSpeed, models })
  }
  
  profiles.sort((a, b) => b.total - a.total)
  return { count: profiles.length, top: profiles.slice(0, 20) }
}

// ═══ PRIJSELASTICITEIT ═══
function getPriceElasticity(make, model, year) {
  // Analyze: at what price points do cars sell faster?
  const sold = queryAll(
    "SELECT price, days_on_market FROM market_listings WHERE make LIKE ? AND model LIKE ? AND year=? AND status='sold' AND price > 500 AND days_on_market IS NOT NULL",
    ["%" + make + "%", "%" + model + "%", year]
  )
  
  if (sold.length < 3) return { ok: false, reason: "Te weinig verkoopdata" }
  
  const snap = queryOne(
    "SELECT median FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 1",
    [make.toLowerCase(), model.toLowerCase(), year]
  )
  const median = snap ? snap.median : sold.reduce((s,r) => s+r.price, 0) / sold.length
  
  // Split into below/at/above median
  const below = sold.filter(s => s.price < median * 0.95)
  const atMedian = sold.filter(s => s.price >= median * 0.95 && s.price <= median * 1.05)
  const above = sold.filter(s => s.price > median * 1.05)
  
  const avgDays = arr => arr.length > 0 ? Math.round(arr.reduce((s,r) => s + (r.days_on_market||30), 0) / arr.length) : null
  
  return {
    ok: true,
    median: Math.round(median),
    below_median: { count: below.length, avg_days: avgDays(below), label: "Snel verkocht" },
    at_median: { count: atMedian.length, avg_days: avgDays(atMedian), label: "Gemiddeld" },
    above_median: { count: above.length, avg_days: avgDays(above), label: "Langzaam" },
    advice: below.length > 0 && above.length > 0
      ? "Verlaag met \u20ac" + Math.round(median * 0.05) + " (-5%) voor " + Math.max(0, (avgDays(atMedian)||30) - (avgDays(below)||15)) + " dagen sneller verkocht"
      : "Onvoldoende data voor elasticiteitsadvies"
  }
}



// ═══ ACCURACY & CONFIDENCE SYSTEEM ═══

// Globale accuracy stats
function getAccuracyStats() {
  // Based on feedback: our bid vs actual sold price
  const feedback = queryAll("SELECT our_bod, sold_price FROM dealer_feedback WHERE sold_price > 0 AND our_bod > 0")
  
  let totalDiff = 0, count = 0, within5 = 0, within10 = 0
  for (const f of feedback) {
    const diff = Math.abs(f.our_bod - f.sold_price) / f.sold_price * 100
    totalDiff += diff
    count++
    if (diff <= 5) within5++
    if (diff <= 10) within10++
  }
  
  // Also compare taxaties vs market median
  const taxaties = queryAll("SELECT t.make, t.model, t.year, t.handelswaarde FROM taxaties t WHERE t.handelswaarde > 0 LIMIT 200")
  let marketDiffs = [], marketCount = 0
  for (const t of taxaties) {
    const snap = queryOne("SELECT median FROM market_snapshots WHERE make=? AND model=? AND year=? AND median > 0 ORDER BY created_at DESC LIMIT 1",
      [(t.make||"").toLowerCase(), (t.model||"").toLowerCase(), t.year])
    if (snap && snap.median > 0) {
      const diff = Math.abs(t.handelswaarde - snap.median) / snap.median * 100
      marketDiffs.push(diff)
      marketCount++
    }
  }
  
  const avgMarketDiff = marketDiffs.length > 0 ? Math.round(marketDiffs.reduce((s,d)=>s+d,0) / marketDiffs.length * 10) / 10 : null
  const marketWithin5 = marketDiffs.filter(d => d <= 5).length
  const marketWithin10 = marketDiffs.filter(d => d <= 10).length
  
  return {
    feedback: {
      count,
      avg_diff_pct: count > 0 ? Math.round(totalDiff / count * 10) / 10 : null,
      within_5pct: within5,
      within_10pct: within10,
      accuracy_pct: count > 0 ? Math.round((within10 / count) * 100) : null
    },
    market_validation: {
      count: marketCount,
      avg_diff_pct: avgMarketDiff,
      within_5pct: marketWithin5,
      within_10pct: marketWithin10,
      accuracy_pct: marketCount > 0 ? Math.round((marketWithin10 / marketCount) * 100) : null
    },
    overall_accuracy: count >= 10
      ? Math.round((within10 / count) * 100)
      : (marketCount >= 5 ? Math.round((marketWithin10 / marketCount) * 100) : null),
    data_points: {
      total_taxaties: queryOne("SELECT COUNT(*) as c FROM taxaties")?.c || 0,
      total_snapshots: queryOne("SELECT COUNT(*) as c FROM market_snapshots")?.c || 0,
      total_listings: queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status=\'active\'")?.c || 0,
      total_feedback: count,
      models_tracked: queryOne("SELECT COUNT(DISTINCT make||model||year) as c FROM market_snapshots")?.c || 0,
    }
  }
}

// Accuracy per model
function getModelAccuracy(make, model, year) {
  const feedback = queryAll("SELECT our_bod, sold_price FROM dealer_feedback WHERE make=? AND model=? AND year=? AND sold_price > 0 AND our_bod > 0",
    [make, model, year])
  
  // Market data quality
  const snapCount = queryOne("SELECT COUNT(*) as c FROM market_snapshots WHERE make=? AND model=? AND year=?",
    [make.toLowerCase(), model.toLowerCase(), year])?.c || 0
  const listingCount = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE make LIKE ? AND model LIKE ? AND year=? AND status=\'active\'",
    ["%" + make + "%", "%" + model + "%", year])?.c || 0
  
  // Confidence level
  let confidence = "laag"
  let confidencePct = 30
  if (snapCount >= 20 && listingCount >= 5) { confidence = "hoog"; confidencePct = 90 }
  else if (snapCount >= 10 || listingCount >= 3) { confidence = "gemiddeld"; confidencePct = 65 }
  else if (snapCount >= 3) { confidence = "basis"; confidencePct = 45 }
  
  // Feedback accuracy
  let feedbackAccuracy = null
  if (feedback.length >= 3) {
    const within10 = feedback.filter(f => Math.abs(f.our_bod - f.sold_price) / f.sold_price <= 0.1).length
    feedbackAccuracy = Math.round((within10 / feedback.length) * 100)
    // Feedback overrules market confidence
    if (feedbackAccuracy >= 80) { confidence = "bewezen"; confidencePct = 95 }
  }
  
  return {
    make, model, year,
    data_points: snapCount,
    active_listings: listingCount,
    feedback_count: feedback.length,
    feedback_accuracy: feedbackAccuracy,
    confidence,
    confidence_pct: confidencePct,
    label: confidence === "bewezen" ? "Bewezen nauwkeurig"
         : confidence === "hoog" ? "Sterke marktdata"
         : confidence === "gemiddeld" ? "Voldoende data"
         : confidence === "basis" ? "Beperkte data"
         : "Weinig data — indicatief"
  }
}

// Taxatie confidence voor het resultaat
function getTaxatieConfidence(make, model, year, handelswaarde) {
  const ma = getModelAccuracy(make, model, year)
  
  // Vergelijk onze handelswaarde met marktdata
  const snap = queryOne("SELECT median, p25, p75, count FROM market_snapshots WHERE make=? AND model=? AND year=? AND median > 0 ORDER BY created_at DESC LIMIT 1",
    [make.toLowerCase(), model.toLowerCase(), year])
  
  let validation = null
  if (snap && snap.median > 0 && handelswaarde > 0) {
    const diff = Math.round(Math.abs(handelswaarde - snap.median) / snap.median * 100)
    const inRange = snap.p25 && snap.p75 ? (handelswaarde >= snap.p25 * 0.9 && handelswaarde <= snap.p75 * 1.1) : null
    validation = {
      market_median: snap.median,
      diff_pct: diff,
      in_market_range: inRange,
      market_count: snap.count,
      verdict: diff <= 5 ? "Sterk" : diff <= 10 ? "Goed" : diff <= 20 ? "Acceptabel" : "Afwijkend"
    }
  }
  
  // Verkochte referenties
  const soldCount = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE make LIKE ? AND model LIKE ? AND year=? AND status=\'sold\'",
    ["%" + make + "%", "%" + model + "%", year])?.c || 0
  
  return {
    confidence: ma.confidence,
    confidence_pct: ma.confidence_pct,
    label: ma.label,
    data_points: ma.data_points,
    active_listings: ma.active_listings,
    sold_references: soldCount,
    feedback_count: ma.feedback_count,
    validation,
    systems: [
      { name: "Marktdata analyse", status: ma.data_points >= 3 ? "actief" : "beperkt", points: ma.data_points },
      { name: "CarDatax AI validatie", status: "actief", points: null },
      { name: "Verkochte prijzen", status: soldCount >= 3 ? "actief" : soldCount > 0 ? "beperkt" : "onvoldoende", points: soldCount },
    ]
  }
}


// ═══ PRICE PREDICTION — forecast based on trend + seasonal + velocity ═══
function predictPrice(make, model, year) {
  try {
    const trend = detectTrend(make, model, year)
    const seasonal = getSeasonalEffect(make, model, '', '')
    const velocity = getMarketVelocity(make, model, year)
    const snapshots = queryAll("SELECT avg_price, median_price, listing_count, month FROM price_trends WHERE make=? AND model=? AND year=? ORDER BY month DESC LIMIT 12", [make.toLowerCase(), model.toLowerCase(), year])
    
    if (!snapshots || snapshots.length < 2) {
      return { ok: false, reason: "Onvoldoende historische data (min 2 maanden nodig)" }
    }

    const currentMedian = snapshots[0]?.median_price || snapshots[0]?.avg_price || 0
    if (currentMedian <= 0) return { ok: false, reason: "Geen huidige prijsdata" }

    // Monthly change rate from trend
    const monthlyChangePct = (trend?.changePct || 0) / Math.max(1, (trend?.periodDays || 30) / 30)
    
    // Seasonal factors for next 3 months
    const now = new Date()
    const predictions = []
    for (let i = 1; i <= 3; i++) {
      const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const month = futureDate.getMonth() + 1
      // Simple seasonal adjustment per month
      const seasonalMap = { 1: 0.97, 2: 0.98, 3: 1.02, 4: 1.03, 5: 1.02, 6: 1.01, 7: 0.99, 8: 0.98, 9: 1.01, 10: 1.00, 11: 0.98, 12: 0.97 }
      const sFactor = seasonalMap[month] || 1.0
      const trendFactor = 1 + (monthlyChangePct / 100 * i)
      const predicted = Math.round(currentMedian * trendFactor * sFactor)
      const changePct = Math.round((predicted / currentMedian - 1) * 100 * 10) / 10
      predictions.push({
        month: futureDate.toISOString().slice(0, 7),
        month_name: futureDate.toLocaleString('nl-NL', { month: 'long', year: 'numeric' }),
        predicted_price: predicted,
        change_pct: changePct,
        direction: changePct > 1 ? "up" : changePct < -1 ? "down" : "stabiel",
        seasonal_factor: sFactor
      })
    }

    // Buy/sell advice
    const threeMonthChange = predictions[2]?.change_pct || 0
    let advice = "Stabiele markt — standaard strategie"
    if (threeMonthChange > 3) advice = "Prijs stijgt — nu kopen, later verkopen voor meer marge"
    else if (threeMonthChange > 1) advice = "Lichte stijging verwacht — goed moment om in te kopen"
    else if (threeMonthChange < -3) advice = "Dalende trend — wacht met inkoop of verkoop snel door"
    else if (threeMonthChange < -1) advice = "Lichte daling verwacht — snelle doorverkoop aanbevolen"

    return {
      ok: true,
      current_price: currentMedian,
      predictions,
      trend_direction: trend?.direction || "stabiel",
      trend_pct: trend?.changePct || 0,
      velocity: velocity?.speed || "onbekend",
      advice,
      data_months: snapshots.length,
      confidence: Math.min(95, 50 + snapshots.length * 5 + (trend ? 10 : 0))
    }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// ═══ AI DAILY BRIEFING — GPT-powered market summary ═══
function generateAIBriefingData() {
  try {
    // Gather data for briefing
    const trends = detectAllTrends()
    const deals = findArbitrageDeals(10)
    const digest = generateDailyDigest()
    const stats = queryOne("SELECT COUNT(*) as listings FROM market_listings WHERE status='active'") || {}
    const recentTaxaties = queryAll("SELECT make, model, year FROM taxaties ORDER BY created_at DESC LIMIT 10") || []
    
    const rising = (trends || []).filter(t => t.direction === 'up').slice(0, 5)
    const falling = (trends || []).filter(t => t.direction === 'down').slice(0, 5)
    
    return {
      ok: true,
      date: new Date().toISOString().slice(0, 10),
      summary: {
        active_listings: stats.listings || 0,
        rising_models: rising.map(t => `${t.make} ${t.model} (+${t.changePct}%)`),
        falling_models: falling.map(t => `${t.make} ${t.model} (${t.changePct}%)`),
        arbitrage_count: deals?.count || 0,
        top_deals: (deals?.top || []).slice(0, 3).map(d => ({
          car: `${d.make} ${d.model} ${d.year}`,
          price: d.listing_price,
          discount: d.discount_pct
        })),
        recent_taxaties: recentTaxaties.length,
        digest_highlights: (digest?.highlights || []).slice(0, 5)
      },
      // Pre-built prompt for GPT (frontend can call /api/ai/chat with this)
      gpt_prompt: `Maak een korte, actiegerichte dagelijkse marktbriefing voor een autohandelaar. Data:\n` +
        `- ${stats.listings || 0} actieve listings in de markt\n` +
        `- Stijgers: ${rising.map(t => `${t.make} ${t.model} (+${t.changePct}%)`).join(', ') || 'geen'}\n` +
        `- Dalers: ${falling.map(t => `${t.make} ${t.model} (${t.changePct}%)`).join(', ') || 'geen'}\n` +
        `- ${deals?.count || 0} arbitrage kansen gevonden\n` +
        `- ${recentTaxaties.length} recente taxaties\n` +
        `Schrijf max 5 zinnen. Begin met "Goedemorgen." Eindig met 1 actietip. Geen opsommingen.`
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ═══ SMART ALERTS — proactive notifications for dealers ═══
function checkSmartAlerts(userId) {
  try {
    const alerts = []
    
    // 1. Voorraad boven markt
    const voorraad = queryAll("SELECT id, make, model, year, vraag_prijs, kenteken FROM voorraad WHERE status='te_koop' OR status IS NULL") || []
    for (const car of voorraad) {
      if (!car.vraag_prijs || car.vraag_prijs <= 0) continue
      const snap = queryOne("SELECT median FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 1", 
        [car.make?.toLowerCase(), car.model?.toLowerCase(), car.year])
      if (snap?.median_price > 0) {
        const diff = Math.round((car.vraag_prijs / snap.median - 1) * 100)
        if (diff > 12) {
          alerts.push({ type: 'overpriced', severity: 'warning', 
            title: `${car.make} ${car.model} staat ${diff}% boven markt`,
            message: `Vraagprijs €${car.vraag_prijs.toLocaleString('nl-NL')} vs markt mediaan €${Math.round(snap.median).toLocaleString('nl-NL')}. Overweeg prijsverlaging.`,
            kenteken: car.kenteken, car_id: car.id })
        }
      }
      // 2. Auto staat te lang
      const stadagen = queryOne("SELECT CAST(julianday('now') - julianday(COALESCE(inkoop_datum, created_at)) AS INTEGER) as dagen FROM voorraad WHERE id=?", [car.id])
      if (stadagen?.dagen > 45) {
        alerts.push({ type: 'stale', severity: 'info',
          title: `${car.make} ${car.model} staat ${stadagen.dagen} dagen`,
          message: `Gemiddelde stadagen in de markt is ~30. Overweeg prijsverlaging of actieve promotie.`,
          kenteken: car.kenteken, car_id: car.id })
      }
    }

    // 3. Lead matches (klant zoekt iets dat net is binnengekomen)
    const leads = queryAll("SELECT id, klant_naam, interesse FROM leads WHERE status IN ('nieuw','contact') AND interesse IS NOT NULL AND interesse != ''") || []
    for (const lead of leads) {
      const interest = (lead.interesse || '').toLowerCase()
      const match = voorraad.find(c => interest.includes((c.make||'').toLowerCase()) || interest.includes((c.model||'').toLowerCase()))
      if (match) {
        alerts.push({ type: 'lead_match', severity: 'success',
          title: `Lead ${lead.klant_naam} matcht met ${match.make} ${match.model}`,
          message: `${lead.klant_naam} zoekt "${lead.interesse}" — ${match.kenteken} past.`,
          kenteken: match.kenteken, car_id: match.id, lead_id: lead.id })
      }
    }

    // 4. Markt trend alerts
    const trends = detectAllTrends() || []
    const bigMoves = trends.filter(t => Math.abs(t.changePct) > 5).slice(0, 3)
    for (const t of bigMoves) {
      alerts.push({ type: 'trend', severity: t.direction === 'down' ? 'warning' : 'success',
        title: `${t.make} ${t.model}: ${t.direction === 'up' ? '+' : ''}${t.changePct}% prijsbeweging`,
        message: t.direction === 'up' ? 'Stijgende trend — goed moment om te verkopen' : 'Dalende trend — snelle doorverkoop aanbevolen' })
    }

    return { ok: true, alerts, count: alerts.length }
  } catch (e) {
    return { ok: true, alerts: [], count: 0, error: e.message }
  }
}

module.exports = {
  initIntelligence,
  autoQueue,
  scoreSource,
  getSourceRankings,
  getBestSources,
  detectTrend,
  detectAllTrends,
  detectSoldListings,
  getMarketVelocity,
  generateDailyDigest,
  getSmartQueue,
  enrichTaxatie,
  getSeasonalEffect,
  getEquipmentImpact,
  getRegioCorrectie,
  findArbitrageDeals,
  trackDealers,
  getPriceElasticity,
  getAccuracyStats,
  getModelAccuracy,
  getTaxatieConfidence,
  predictPrice,
  generateAIBriefingData,
  checkSmartAlerts
}
