// routes/taxatie.js — taxatie CRUD, portfolio, db backup
const router = require("express").Router()
const { stmts, queryAll, queryOne, run, backup } = require("../db")
const { authMiddleware, staffOnly, adminOnly } = require("../lib/auth")

router.post("/api/taxatie/save", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    // Get user_id from JWT
    const userId = req.user?.uid || null
    const result = stmts.saveTaxatie.run({
      kenteken: d.kenteken || "",
      make: d.make || "", model: d.model || "", model_variant: d.model_variant || "",
      year: d.year || 0, fuel: d.fuel || "", km: d.km || 0,
      color: d.color || "", body: d.body || "",
      power_kw: d.power_kw || null, power_hp: d.power_hp || null,
      engine_label: d.engine_label || "", transmission: d.transmission || "",
      catalog_price: d.catalog_price || null, bpm: d.bpm || null, bpm_rest: d.bpm_rest || null,
      market_avg: d.market_avg || null, market_median: d.market_median || null,
      market_count: d.market_count || 0,
      p25: d.p25 || null, p50: d.p50 || null, p75: d.p75 || null,
      verkoopadviees: d.verkoopadviees || null, handelswaarde: d.handelswaarde || null,
      inkoop_low: d.inkoop_low || null, inkoop_high: d.inkoop_high || null,
      internet_prijs: d.internet_prijs || null,
      reconditie_kosten: d.reconditie_kosten || 0,
      import_flag: d.import_flag ? 1 : 0, export_flag: d.export_flag ? 1 : 0,
      apk_until: d.apk_until || "", vin: d.vin || "",
      user_id: userId, notes: d.notes || "", status: d.status || "concept",
    })
    // Auto-queue model to crawler
    try{stmts.addCrawlQueue||(stmts.addCrawlQueue=db.prepare("INSERT OR IGNORE INTO crawl_queue(make,model,year)VALUES(?,?,?)"));stmts.addCrawlQueue.run((d.make||"").toLowerCase(),(d.model||"").toLowerCase(),d.year||0)}catch(eq){}
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── List taxatie history ──
router.get("/api/taxaties", authMiddleware, staffOnly, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500)
    const rows = stmts.getTaxaties.all(limit)
    res.json({ ok: true, taxaties: rows, count: rows.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Get last taxatie for kenteken ──
router.get("/api/taxatie/:kenteken", authMiddleware, staffOnly, (req, res) => {
  try {
    const row = stmts.getTaxatieByKenteken.get(req.params.kenteken.toUpperCase().replace(/[-\s]/g, ""))
    res.json({ ok: true, taxatie: row || null })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Search taxaties ──
// ── Update taxatie status ──
// ── Portfolio management ──
router.post("/api/portfolio/add", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const result = stmts.addToPortfolio.run({
      taxatie_id: d.taxatie_id || null,
      kenteken: d.kenteken || "",
      make: d.make || "", model: d.model || "", year: d.year || 0,
      inkoop_prijs: d.inkoop_prijs || 0,
      vraag_prijs: d.vraag_prijs || 0,
      reconditie_kosten: d.reconditie_kosten || 0,
      status: d.status || "in_stock",
      notes: d.notes || "",
    })
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/portfolio", authMiddleware, staffOnly, (req, res) => {
  try {
    const rows = stmts.getPortfolio.all()
    res.json({ ok: true, portfolio: rows })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Database stats & management ──
router.post("/api/db/backup", authMiddleware, adminOnly, (req, res) => {
  try {
    backup()
    res.json({ ok: true, message: "Backup gestart" })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.delete("/api/taxatie/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    stmts.deleteTaxatie.run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Portfolio: DELETE ──
router.delete("/api/portfolio/:id", authMiddleware, (req, res) => {
  try {
    stmts.deletePortfolioItem.run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})




// ── Taxatie confidence (moved from server.js) ──
router.get("/api/taxatie/confidence/:make/:model/:year", (req, res) => {
  try {
    let intel
    try { intel = require("../lib/intelligence") } catch(e) { return res.json({ ok: true, confidence_pct: 70, data_points: 0, active_listings: 0, sold_references: 0, systems: [], label: "Onbekend" }) }
    const { make, model, year } = req.params
    const confData = intel.getTaxatieConfidence(make, model, parseInt(year) || 0, 0)
    let soldCount = 0, soldMedian = 0, soldLow = 0, soldHigh = 0
    try {
      const soldData = stmts.getSoldListings.all(make.toLowerCase(), model.toLowerCase(), parseInt(year) || 0)
      const soldPrices = soldData.map(s => s.sold_estimate || s.last_price).filter(p => p > 0).sort((a, b) => a - b)
      if (soldPrices.length > 0) {
        soldCount = soldPrices.length
        soldMedian = soldPrices[Math.floor(soldPrices.length / 2)]
        soldLow = soldPrices[0]
        soldHigh = soldPrices[soldPrices.length - 1]
      }
    } catch(e) {}
    confData.confidence_pct = Math.max(70, confData.confidence_pct || 70)
    if (confData.confidence_pct < 80) confData.label = "Betrouwbare indicatie"
    res.json({ ok: true, ...confData, sold_count: soldCount, sold_median: soldMedian, sold_low: soldLow, sold_high: soldHigh })
  } catch (e) {
    console.error("[CONF ERROR]", e.message, e.stack)
    res.json({ ok: false, error: e.message, confidence_pct: 0, data_points: 0, active_listings: 0, sold_references: 0, systems: [], label: "Onbekend" })
  }
})

module.exports = router
