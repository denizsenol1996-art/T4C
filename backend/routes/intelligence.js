// T4C Intelligence Routes — Market intelligence API
const express = require("express")
const router = express.Router()
const { queryAll, queryOne } = require("../db")
const { authMiddleware, adminOnly, staffOnly } = require("../lib/auth")
const intel = require("../lib/intelligence")

// ── Markt intelligence voor een specifiek model ──
router.get("/api/intelligence/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const { make, model, year } = req.params
    const data = intel.enrichTaxatie(make, model, parseInt(year))
    res.json({ ok: true, ...data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Alle trends ──
router.get("/api/intelligence/trends", authMiddleware, (req, res) => {
  try {
    const trends = intel.detectAllTrends()
    res.json({ ok: true, trends, count: trends.length })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Source rankings ──
router.get("/api/intelligence/sources", authMiddleware, adminOnly, (req, res) => {
  try {
    const sources = intel.getSourceRankings()
    res.json({ ok: true, sources })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Dagelijkse digest ──
router.get("/api/intelligence/digest", authMiddleware, (req, res) => {
  try {
    const digest = intel.generateDailyDigest()
    res.json({ ok: true, digest })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Digest historie ──
router.get("/api/intelligence/digests", authMiddleware, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 14, 60)
    const digests = queryAll("SELECT * FROM market_digests ORDER BY date DESC LIMIT ?", [limit])
    res.json({ ok: true, digests })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Smart crawl queue ──
router.get("/api/intelligence/queue", authMiddleware, adminOnly, (req, res) => {
  try {
    const queue = intel.getSmartQueue(20)
    res.json({ ok: true, queue })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Market velocity voor model ──
router.get("/api/intelligence/velocity/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const { make, model, year } = req.params
    const velocity = intel.getMarketVelocity(make, model, parseInt(year))
    res.json({ ok: true, ...velocity })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})


// ── GPT Pricing Validator — AI second opinion ──
router.post("/api/taxatie/validate", authMiddleware, async (req, res) => {
  try {
    const { callGPT } = require("../lib/ai")
    const { queryAll, run } = require("../db")
    const intel = require("../lib/intelligence")
    const d = req.body

    // Build comprehensive context for GPT
    const trend = intel.detectTrend(d.make, d.model, d.year)
    const velocity = intel.getMarketVelocity(d.make, d.model, d.year)

    // Get recent sold prices for this model
    const soldPrices = queryAll(
      "SELECT price, sold_estimate FROM market_listings WHERE make=? AND model=? AND year=? AND status='sold' ORDER BY last_seen DESC LIMIT 10",
      [(d.make||"").toLowerCase(), (d.model||"").toLowerCase(), d.year || 0]
    )
    const soldAvg = soldPrices.length > 0 ? Math.round(soldPrices.reduce((s,r) => s + (r.sold_estimate || r.price || 0), 0) / soldPrices.length) : null

    // Get current market listings
    const currentListings = queryAll(
      "SELECT price, km, days_on_market FROM market_listings WHERE make=? AND model=? AND year=? AND status='active' ORDER BY last_seen DESC LIMIT 15",
      [(d.make||"").toLowerCase(), (d.model||"").toLowerCase(), d.year || 0]
    )

    const context = [
      "=== VOERTUIG ===",
      "Merk: " + (d.make || "?"),
      "Model: " + (d.model || "?") + (d.subModel ? " " + d.subModel : "") + (d.trimLevel ? " " + d.trimLevel : ""),
      "Bouwjaar: " + (d.year || "?"),
      "KM-stand: " + (d.km ? d.km.toLocaleString("nl-NL") : "onbekend"),
      "Brandstof: " + (d.fuel || "?"),
      "Vermogen: " + (d.powerHp ? d.powerHp + " pk" : "?"),
      "Motor: " + (d.engineLabel || "?"),
      "Transmissie: " + (d.transmission || "?"),
      d.engineRiskProfile ? "Risicoprofiel motor: " + d.engineRiskProfile : null,
      d.ownerCount ? "Eigenaren: " + d.ownerCount : null,
      d.importFlag ? "IMPORT AUTO" : null,
      d.catalogPrice ? "Nieuwprijs: EUR " + d.catalogPrice : null,
      "",
      "=== ONZE BEREKENING ===",
      "Ons voorgesteld bod: EUR " + (d.ourBod || "?"),
      "Verkoopadvies: EUR " + (d.verkoopadviees || "?"),
      "Handelswaarde: EUR " + (d.handelswaarde || "?"),
      "Inkoop range: EUR " + (d.inkoopLow || "?") + " - EUR " + (d.inkoopHigh || "?"),
      "",
      "=== MARKTDATA (live) ===",
      "Aantal vergelijkbare ads: " + (d.marketCount || 0),
      "Markt mediaan: EUR " + (d.marketMedian || "?"),
      "Markt P25: EUR " + (d.marketP25 || "?"),
      "Markt P75: EUR " + (d.marketP75 || "?"),
      soldAvg ? "Gemiddelde verkochte prijs (recent): EUR " + soldAvg : null,
      soldPrices.length > 0 ? "Aantal recent verkocht: " + soldPrices.length : null,
      "",
      "=== INTELLIGENCE ===",
      "Prijstrend: " + (trend.direction || "onbekend") + " (" + (trend.change_pct || 0) + "%)",
      "Verkoopsnelheid: " + (velocity.velocity || "onbekend") + (velocity.avg_days ? " (~" + velocity.avg_days + " dagen)" : ""),
      "Datapunten: " + (trend.datapoints || 0) + " snapshots",
      "",
      currentListings.length > 0 ? "=== HUIDIGE MARKT (top 15 listings) ===" : null,
      ...currentListings.map((l, i) => "  " + (i+1) + ". EUR " + (l.price||"?") + (l.km ? " | " + l.km + " km" : "") + (l.days_on_market ? " | " + l.days_on_market + " dagen online" : "")),
    ].filter(Boolean).join("\n")

    const systemPrompt = `Je bent een expert autotaxateur voor de Nederlandse occasionmarkt. Je werkt voor CarDatax, een AI-gedreven taxatieplatform.

Analyseer de voertuigdata, onze prijsberekening en de marktdata. Geef een EERLIJKE second opinion.

Antwoord ALLEEN in dit exacte JSON formaat (geen markdown, geen backticks):
{
  "gpt_price": <jouw geschatte handelswaarde in EUR als getal>,
  "confidence": <0.0-1.0 hoe zeker je bent>,
  "verdict": "<een van: GOED_BOD | TE_HOOG | TE_LAAG | NIET_KOPEN | TOP_DEAL>",
  "reasoning": "<1-2 zinnen waarom in het Nederlands>",
  "risk_factors": ["<risico 1>", "<risico 2>"],
  "opportunities": ["<kans 1>", "<kans 2>"],
  "sell_prediction": "<snel | normaal | traag>",
  "suggested_retail": <jouw geschatte verkoopprijs als getal>,
  "margin_estimate": <geschatte marge in EUR>
}

Regels:
- Baseer je op de ECHTE marktdata die je krijgt, niet op algemene kennis
- Wees eerlijk: als het een slechte deal is, zeg dat
- Houd rekening met risicomotoren (THP, DSG, PureTech, N47 etc.)
- Import auto's zijn minder waard
- Veel eigenaren = waardeverlies
- Kijk naar de trend: dalende markt = lager bieden`

    const raw = await callGPT(systemPrompt, context, { temperature: 0.2, model: "gpt-4o", max_tokens: 800 })

    // Parse JSON response
    let result
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim()
      result = JSON.parse(cleaned)
    } catch(pe) {
      result = { gpt_price: null, confidence: 0, verdict: "PARSE_ERROR", reasoning: raw.slice(0, 200), risk_factors: [], opportunities: [], sell_prediction: "onbekend", suggested_retail: null, margin_estimate: null }
    }

    // Store in taxatie if we have an ID
    if (d.taxatie_id) {
      try {
        run("UPDATE taxaties SET gpt_opinion=?, gpt_price=?, gpt_confidence=? WHERE id=?",
          [JSON.stringify(result), result.gpt_price, result.confidence, d.taxatie_id])
      } catch(ue) {}
    }

    res.json({ ok: true, ...result })
  } catch(e) {
    res.json({ ok: false, error: e.message, verdict: "ERROR" })
  }
})


// ── Seizoenseffect voor model ──
router.get("/api/intelligence/seasonal/:make/:model", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const { make, model } = req.params
    const body = req.query.body || ""
    const fuel = req.query.fuel || ""
    const effect = intel.getSeasonalEffect(make, model, body, fuel)
    res.json({ ok: true, ...effect })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Uitrusting impact ──
router.post("/api/intelligence/equipment-impact", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const impact = intel.getEquipmentImpact(req.body)
    res.json({ ok: true, ...impact })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})


// ── Regio-correctie ──
router.get("/api/intelligence/regio/:province", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.getRegioCorrectie(req.params.province)
    res.json({ ok: true, ...result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})


// ── Arbitrage deals ──
router.get("/api/intelligence/arbitrage", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const minPct = parseInt(req.query.min) || 10
    const result = intel.findArbitrageDeals(minPct)
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Saved arbitrage deals ──
router.get("/api/intelligence/arbitrage/saved", authMiddleware, (req, res) => {
  try {
    const { queryAll } = require("../db")
    const deals = queryAll("SELECT * FROM arbitrage_deals WHERE status='nieuw' ORDER BY discount_pct DESC LIMIT 30")
    res.json({ ok: true, deals, count: deals.length })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Dealer profiles ──
router.get("/api/intelligence/dealers", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.trackDealers()
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Single dealer profile ──
router.get("/api/intelligence/dealer/:name", authMiddleware, (req, res) => {
  try {
    const { queryOne, queryAll } = require("../db")
    const profile = queryOne("SELECT * FROM dealer_profiles WHERE dealer_name=?", [req.params.name])
    const listings = queryAll("SELECT * FROM market_listings WHERE dealer=? AND status='active' ORDER BY price ASC", [req.params.name])
    res.json({ ok: true, profile, listings, count: listings.length })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Prijselasticiteit ──
router.get("/api/intelligence/elasticity/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.getPriceElasticity(req.params.make, req.params.model, parseInt(req.params.year))
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})


// ── Globale accuracy stats ──
router.get("/api/intelligence/accuracy", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const stats = intel.getAccuracyStats()
    res.json({ ok: true, ...stats })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Model accuracy ──
router.get("/api/intelligence/accuracy/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.getModelAccuracy(req.params.make, req.params.model, parseInt(req.params.year))
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Taxatie confidence (for result screen) ──
router.get("/api/intelligence/confidence/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const hw = parseFloat(req.query.handelswaarde) || 0
    const result = intel.getTaxatieConfidence(req.params.make, req.params.model, parseInt(req.params.year), hw)
    res.json({ ok: true, ...result })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Price prediction ──
router.get("/api/intelligence/predict/:make/:model/:year", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.predictPrice(req.params.make, req.params.model, parseInt(req.params.year) || 0)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── AI briefing data ──
router.get("/api/intelligence/briefing", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.generateAIBriefingData()
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Smart alerts ──
router.get("/api/intelligence/alerts", authMiddleware, (req, res) => {
  try {
    const intel = require("../lib/intelligence")
    const result = intel.checkSmartAlerts(req.user?.userId || 0)
    res.json(result)
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

module.exports = router
