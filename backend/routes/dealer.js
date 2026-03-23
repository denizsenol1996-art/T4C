const express = require("express")
const router = express.Router()
const { queryAll, queryOne, run } = require("../db")
const { authMiddleware, staffOnly } = require("../lib/auth")

// ════════════════════════════════════════
// FINANCIEEL — Kosten & Winst per auto
// ════════════════════════════════════════

// Kosten toevoegen aan auto
router.post("/api/voorraad/:id/kosten", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const { categorie, omschrijving, bedrag, datum, leverancier } = req.body
    if (!bedrag) return res.status(400).json({ ok: false, error: "Bedrag verplicht" })
    run("INSERT INTO kosten_items (voorraad_id, categorie, omschrijving, bedrag, datum, leverancier) VALUES (?,?,?,?,?,?)",
      [req.params.id, categorie || "overig", omschrijving || "", bedrag, datum || "", leverancier || ""])
    // Update totale kostprijs
    recalcKostprijs(req.params.id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Kosten lijst per auto
router.get("/api/voorraad/:id/kosten", authMiddleware, staffOnly, (req, res) => {
  try {
    const items = queryAll("SELECT * FROM kosten_items WHERE voorraad_id=? ORDER BY datum DESC", [req.params.id])
    const totaal = queryOne("SELECT COALESCE(SUM(bedrag),0) as total FROM kosten_items WHERE voorraad_id=?", [req.params.id])
    res.json({ ok: true, items, totaal: totaal?.total || 0 })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Kosten verwijderen
router.delete("/api/kosten/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const item = queryOne("SELECT voorraad_id FROM kosten_items WHERE id=?", [req.params.id])
    run("DELETE FROM kosten_items WHERE id=?", [req.params.id])
    if (item) recalcKostprijs(item.voorraad_id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Inkoop prijs instellen
router.post("/api/voorraad/:id/inkoop", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const { inkoop_prijs, btw_type, bron, inkoper, inkoop_datum } = req.body
    run("UPDATE voorraad SET inkoop_prijs=?, btw_type=?, bron=?, inkoper=?, inkoop_datum=? WHERE id=?",
      [inkoop_prijs || 0, btw_type || "marge", bron || "", inkoper || "", inkoop_datum || "", req.params.id])
    recalcKostprijs(req.params.id)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Auto markeren als verkocht
router.post("/api/voorraad/:id/verkocht", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const { verkoop_prijs, verkoop_datum } = req.body
    const auto = queryOne("SELECT inkoop_prijs, totale_kostprijs, inkoop_datum FROM voorraad WHERE id=?", [req.params.id])
    const kostprijs = auto?.totale_kostprijs || auto?.inkoop_prijs || 0
    const winst = (verkoop_prijs || 0) - kostprijs
    const winstPct = kostprijs > 0 ? Math.round(winst / kostprijs * 100) : 0
    
    // Bereken stadagen
    let stadagen = null
    if (auto?.inkoop_datum && verkoop_datum) {
      stadagen = Math.max(0, Math.round((new Date(verkoop_datum) - new Date(auto.inkoop_datum)) / 86400000))
    }

    run("UPDATE voorraad SET status='verkocht', verkoop_prijs=?, verkoop_datum=?, winst=?, winst_pct=?, stadagen=? WHERE id=?",
      [verkoop_prijs, verkoop_datum || new Date().toISOString().split("T")[0], winst, winstPct, stadagen, req.params.id])
    res.json({ ok: true, winst, winstPct, stadagen })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Herbereken kostprijs
function recalcKostprijs(voorraadId) {
  const auto = queryOne("SELECT inkoop_prijs, reconditie_kosten, apk_kosten, transport_kosten, overige_kosten FROM voorraad WHERE id=?", [voorraadId])
  const extraKosten = queryOne("SELECT COALESCE(SUM(bedrag),0) as total FROM kosten_items WHERE voorraad_id=?", [voorraadId])
  if (auto) {
    const totaal = (auto.inkoop_prijs || 0) + (auto.reconditie_kosten || 0) + (auto.apk_kosten || 0) +
      (auto.transport_kosten || 0) + (auto.overige_kosten || 0) + (extraKosten?.total || 0)
    run("UPDATE voorraad SET totale_kostprijs=? WHERE id=?", [totaal, voorraadId])
  }
}

// ════════════════════════════════════════
// VOORRAAD DASHBOARD
// ════════════════════════════════════════

router.get("/api/dashboard/voorraad", authMiddleware, staffOnly, (req, res) => {
  try {
    const totaal = queryOne("SELECT COUNT(*) as c FROM voorraad WHERE status='te_koop'")
    const waarde = queryOne("SELECT COALESCE(SUM(vraag_prijs),0) as total FROM voorraad WHERE status='te_koop'")
    const kostprijs = queryOne("SELECT COALESCE(SUM(totale_kostprijs),0) as total FROM voorraad WHERE status='te_koop'")
    const gemStadagen = queryOne("SELECT COALESCE(AVG(CAST(julianday('now')-julianday(inkoop_datum) as INTEGER)),0) as avg FROM voorraad WHERE status='te_koop' AND inkoop_datum IS NOT NULL AND inkoop_datum != ''")
    
    // Verkocht deze maand
    const maand = new Date().toISOString().slice(0, 7)
    const verkochtMaand = queryOne("SELECT COUNT(*) as c, COALESCE(SUM(winst),0) as winst FROM voorraad WHERE status='verkocht' AND verkoop_datum LIKE ?", [maand + "%"])
    
    // Verkocht totaal
    const verkochtTotaal = queryOne("SELECT COUNT(*) as c, COALESCE(SUM(winst),0) as winst, COALESCE(AVG(winst_pct),0) as gem_pct, COALESCE(AVG(stadagen),0) as gem_stadagen FROM voorraad WHERE status='verkocht'")

    // Top 5 langste stadagen
    const oudste = queryAll("SELECT id, kenteken, make, model, vraag_prijs, inkoop_datum FROM voorraad WHERE status='te_koop' AND inkoop_datum IS NOT NULL AND inkoop_datum != '' ORDER BY inkoop_datum ASC LIMIT 5")

    res.json({
      ok: true,
      voorraad: {
        aantal: totaal?.c || 0,
        totale_vraagprijs: waarde?.total || 0,
        totale_kostprijs: kostprijs?.total || 0,
        potentiele_winst: (waarde?.total || 0) - (kostprijs?.total || 0),
        gem_stadagen: Math.round(gemStadagen?.avg || 0),
      },
      verkocht_maand: {
        aantal: verkochtMaand?.c || 0,
        winst: verkochtMaand?.winst || 0,
      },
      verkocht_totaal: {
        aantal: verkochtTotaal?.c || 0,
        totale_winst: verkochtTotaal?.winst || 0,
        gem_marge_pct: Math.round(verkochtTotaal?.gem_pct || 0),
        gem_stadagen: Math.round(verkochtTotaal?.gem_stadagen || 0),
      },
      oudste_voorraad: oudste,
    })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Auto-reprice suggesties
router.get("/api/dashboard/reprice", authMiddleware, staffOnly, (req, res) => {
  try {
    // Auto's die langer dan 21 dagen te koop staan
    const stale = queryAll(`SELECT v.id, v.kenteken, v.make, v.model, v.year, v.vraag_prijs, v.inkoop_datum,
      CAST(julianday('now')-julianday(v.inkoop_datum) as INTEGER) as dagen
      FROM voorraad v
      WHERE v.status='te_koop' AND v.inkoop_datum IS NOT NULL AND v.inkoop_datum != ''
      AND julianday('now')-julianday(v.inkoop_datum) > 21
      ORDER BY dagen DESC`)

    const suggestions = stale.map(auto => {
      const dagen = auto.dagen || 0
      let suggestie = 0
      if (dagen > 60) suggestie = -Math.round((auto.vraag_prijs || 0) * 0.08)
      else if (dagen > 45) suggestie = -Math.round((auto.vraag_prijs || 0) * 0.05)
      else if (dagen > 30) suggestie = -Math.round((auto.vraag_prijs || 0) * 0.03)
      else suggestie = -Math.round((auto.vraag_prijs || 0) * 0.02)
      return { ...auto, suggestie, nieuwe_prijs: (auto.vraag_prijs || 0) + suggestie }
    })

    res.json({ ok: true, suggestions, count: suggestions.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Maandoverzicht
router.get("/api/dashboard/maand/:maand?", authMiddleware, staffOnly, (req, res) => {
  try {
    const maand = req.params.maand || new Date().toISOString().slice(0, 7)
    
    const ingekocht = queryOne("SELECT COUNT(*) as c, COALESCE(SUM(inkoop_prijs),0) as totaal FROM voorraad WHERE inkoop_datum LIKE ?", [maand + "%"])
    const verkocht = queryOne("SELECT COUNT(*) as c, COALESCE(SUM(verkoop_prijs),0) as omzet, COALESCE(SUM(winst),0) as winst, COALESCE(AVG(winst_pct),0) as gem_marge, COALESCE(AVG(stadagen),0) as gem_stadagen FROM voorraad WHERE status='verkocht' AND verkoop_datum LIKE ?", [maand + "%"])
    const kosten = queryOne("SELECT COALESCE(SUM(bedrag),0) as totaal FROM kosten_items WHERE datum LIKE ?", [maand + "%"])

    res.json({
      ok: true, maand,
      ingekocht: { aantal: ingekocht?.c || 0, totaal: ingekocht?.totaal || 0 },
      verkocht: { aantal: verkocht?.c || 0, omzet: verkocht?.omzet || 0, winst: verkocht?.winst || 0, gem_marge: Math.round(verkocht?.gem_marge || 0), gem_stadagen: Math.round(verkocht?.gem_stadagen || 0) },
      kosten: kosten?.totaal || 0,
      netto: (verkocht?.winst || 0) - (kosten?.totaal || 0),
    })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ════════════════════════════════════════
// INKOOP PIPELINE
// ════════════════════════════════════════

// Lijst
router.get("/api/inkoop", authMiddleware, staffOnly, (req, res) => {
  try {
    const status = req.query.status || ""
    const items = status
      ? queryAll("SELECT * FROM inkoop_pipeline WHERE status=? ORDER BY created_at DESC", [status])
      : queryAll("SELECT * FROM inkoop_pipeline ORDER BY created_at DESC LIMIT 100")
    res.json({ ok: true, items, count: items.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Toevoegen
router.post("/api/inkoop", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    run(`INSERT INTO inkoop_pipeline (kenteken, make, model, year, km, fuel, color, bron, contact_naam, contact_tel, contact_email, geschatte_waarde, ons_bod, status, notities, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.kenteken||"", d.make||"", d.model||"", d.year||0, d.km||0, d.fuel||"", d.color||"",
       d.bron||"", d.contact_naam||"", d.contact_tel||"", d.contact_email||"",
       d.geschatte_waarde||null, d.ons_bod||null, d.status||"nieuw", d.notities||"", req.user?.userId||null])
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Status updaten
router.patch("/api/inkoop/:id", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    const sets = [], vals = []
    for (const key of ["status", "ons_bod", "notities", "contact_naam", "contact_tel"]) {
      if (d[key] !== undefined) { sets.push(key + "=?"); vals.push(d[key]) }
    }
    if (sets.length === 0) return res.json({ ok: true })
    vals.push(req.params.id)
    run("UPDATE inkoop_pipeline SET " + sets.join(",") + " WHERE id=?", vals)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Inkoop → Voorraad (auto ingekocht, verplaats naar voorraad)
router.post("/api/inkoop/:id/koop", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const item = queryOne("SELECT * FROM inkoop_pipeline WHERE id=?", [req.params.id])
    if (!item) return res.status(404).json({ ok: false, error: "Niet gevonden" })
    const d = req.body
    run(`INSERT INTO voorraad (kenteken, make, model, year, fuel, km, color, inkoop_prijs, btw_type, bron, inkoper, inkoop_datum, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [item.kenteken, item.make, item.model, item.year, item.fuel, item.km, item.color,
       d.inkoop_prijs || item.ons_bod || 0, d.btw_type || "marge", item.bron || "",
       d.inkoper || "", d.inkoop_datum || new Date().toISOString().split("T")[0], "te_koop"])
    run("UPDATE inkoop_pipeline SET status='ingekocht' WHERE id=?", [req.params.id])
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ════════════════════════════════════════
// LEADS / MINI CRM
// ════════════════════════════════════════

router.get("/api/leads", authMiddleware, staffOnly, (req, res) => {
  try {
    const items = queryAll("SELECT * FROM leads ORDER BY created_at DESC LIMIT 100")
    res.json({ ok: true, items, count: items.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post("/api/leads", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    run(`INSERT INTO leads (voorraad_id, kenteken, klant_naam, klant_tel, klant_email, bron, interesse, status, notities, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [d.voorraad_id||null, d.kenteken||"", d.klant_naam||"", d.klant_tel||"", d.klant_email||"",
       d.bron||"", d.interesse||"", d.status||"nieuw", d.notities||"", req.user?.userId||null])
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.patch("/api/leads/:id", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    const sets = [], vals = []
    for (const key of ["status", "notities", "klant_naam", "klant_tel", "interesse"]) {
      if (d[key] !== undefined) { sets.push(key + "=?"); vals.push(d[key]) }
    }
    if (sets.length === 0) return res.json({ ok: true })
    vals.push(req.params.id)
    run("UPDATE leads SET " + sets.join(",") + " WHERE id=?", vals)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


// ════════════════════════════════════════
// NOTIFICATIE SYSTEEM
// ════════════════════════════════════════

// Alle notificaties voor gebruiker
router.get("/api/notificaties", authMiddleware, (req, res) => {
  try {
    const userId = req.user?.userId || 0
    const unread = queryAll("SELECT * FROM notificaties WHERE (user_id=? OR user_id IS NULL) AND read=0 ORDER BY created_at DESC LIMIT 50", [userId])
    const recent = queryAll("SELECT * FROM notificaties WHERE (user_id=? OR user_id IS NULL) ORDER BY created_at DESC LIMIT 20", [userId])
    res.json({ ok: true, unread: unread.length, notificaties: recent })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Markeer als gelezen
router.post("/api/notificaties/read", authMiddleware, express.json(), (req, res) => {
  try {
    const { ids } = req.body
    if (ids && ids.length) {
      ids.forEach(id => run("UPDATE notificaties SET read=1 WHERE id=?", [id]))
    } else {
      run("UPDATE notificaties SET read=1 WHERE user_id=? OR user_id IS NULL", [req.user?.userId || 0])
    }
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ════════════════════════════════════════
// VEILING ALERTS MET INTELLIGENCE
// ════════════════════════════════════════

// Veiling analyseren met intelligence data
router.get("/api/veiling/:id/intelligence", authMiddleware, staffOnly, (req, res) => {
  try {
    const veiling = queryOne("SELECT * FROM veilingen WHERE id=?", [req.params.id])
    if (!veiling) return res.status(404).json({ ok: false, error: "Veiling niet gevonden" })
    
    const intel = require("../lib/intelligence")
    const trend = intel.detectTrend(veiling.make || "", veiling.model || "", veiling.year || 0)
    const velocity = intel.getMarketVelocity(veiling.make || "", veiling.model || "", veiling.year || 0)
    const seasonal = intel.getSeasonalEffect(veiling.make || "", veiling.model || "", veiling.body || "", veiling.fuel || "")
    const equipment = intel.getEquipmentImpact(veiling)
    
    // Geschatte marktwaarde
    const snaps = queryAll("SELECT median, avg FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 3",
      [(veiling.make||"").toLowerCase(), (veiling.model||"").toLowerCase(), veiling.year || 0])
    const marktwaarde = snaps.length > 0 ? Math.round(snaps.reduce((s,r) => s + (r.median || r.avg || 0), 0) / snaps.length) : null
    
    // Advies
    let advies = "Onvoldoende data"
    let score = 5
    if (marktwaarde && veiling.start_prijs) {
      const verschil = marktwaarde - veiling.start_prijs
      const pct = Math.round(verschil / marktwaarde * 100)
      if (pct > 20) { advies = "Sterk onder marktwaarde — bieden!"; score = 9 }
      else if (pct > 10) { advies = "Onder marktwaarde — interessant"; score = 7 }
      else if (pct > 0) { advies = "Net onder marktwaarde — scherp bieden"; score = 6 }
      else if (pct > -10) { advies = "Rond marktwaarde — pas op"; score = 4 }
      else { advies = "Boven marktwaarde — niet doen"; score = 2 }
      
      // Trend correctie
      if (trend.direction === "dalend") { score = Math.max(1, score - 1); advies += ". Let op: dalende markt." }
      if (trend.direction === "stijgend") { score = Math.min(10, score + 1); advies += ". Plus: stijgende markt." }
    }
    
    res.json({
      ok: true,
      veiling: { id: veiling.id, make: veiling.make, model: veiling.model, year: veiling.year, start_prijs: veiling.start_prijs },
      intelligence: { marktwaarde, trend, velocity, seasonal, equipment_bonus: equipment.total, score, advies }
    })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ════════════════════════════════════════
// AUTO-REPRICE CHECK (cron-style)
// ════════════════════════════════════════

// Handmatig triggeren of via cron
router.post("/api/reprice/check", authMiddleware, staffOnly, (req, res) => {
  try {
    const stale = queryAll(
      "SELECT id, kenteken, make, model, year, vraag_prijs, inkoop_datum FROM voorraad WHERE status=\'te_koop\' AND inkoop_datum IS NOT NULL AND inkoop_datum != \'\'",
      [])

    let alerts = 0
    const now = new Date()
    
    for (const auto of stale) {
      if (!auto.inkoop_datum) continue
      const dagen = Math.round((now - new Date(auto.inkoop_datum)) / 86400000)
      
      if (dagen < 21) continue // Nog niet oud genoeg
      
      // Check of we al een recente notificatie hebben
      const recent = queryOne(
        "SELECT id FROM notificaties WHERE type=\'reprice\' AND data LIKE ? AND created_at > datetime(\'now\', \'-7 days\')",
        ["%" + auto.id + "%"])
      if (recent) continue // Al recent gemeld
      
      // Bereken suggestie
      let pct = 0
      if (dagen > 60) pct = 8
      else if (dagen > 45) pct = 5
      else if (dagen > 30) pct = 3
      else pct = 2
      
      const verlaging = Math.round((auto.vraag_prijs || 0) * pct / 100)
      const nieuwePrijs = (auto.vraag_prijs || 0) - verlaging
      
      run("INSERT INTO notificaties (type, title, message, data) VALUES (?,?,?,?)", [
        "reprice",
        (auto.make || "") + " " + (auto.model || "") + " — " + dagen + " dagen",
        "Staat al " + dagen + " dagen te koop. Advies: verlaag van \u20ac" + (auto.vraag_prijs||0) + " naar \u20ac" + nieuwePrijs + " (-" + pct + "%)",
        JSON.stringify({ voorraad_id: auto.id, kenteken: auto.kenteken, dagen: dagen, huidig: auto.vraag_prijs, suggestie: nieuwePrijs, verlaging: verlaging })
      ])
      alerts++
    }
    
    res.json({ ok: true, alerts_created: alerts })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ════════════════════════════════════════
// PRIJSALERT — dealer zoekprofiel
// ════════════════════════════════════════

// Prijsalert aanmaken
router.post("/api/prijsalert", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    run("INSERT INTO price_alerts (user_id, make, model, year_min, year_max, price_max, km_max, fuel, transmission) VALUES (?,?,?,?,?,?,?,?,?)",
      [req.user?.userId || 0, d.make || "", d.model || "", d.year_min || null, d.year_max || null,
       d.price_max || null, d.km_max || null, d.fuel || "", d.transmission || ""])
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Mijn prijsalerts
router.get("/api/prijsalerts", authMiddleware, staffOnly, (req, res) => {
  try {
    const items = queryAll("SELECT * FROM price_alerts WHERE user_id=? AND active=1", [req.user?.userId || 0])
    res.json({ ok: true, items })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Prijsalert verwijderen
router.delete("/api/prijsalert/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    run("UPDATE price_alerts SET active=0 WHERE id=? AND user_id=?", [req.params.id, req.user?.userId || 0])
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Check prijsalerts tegen nieuwe listings (called by crawler)
router.post("/api/prijsalerts/check", authMiddleware, staffOnly, (req, res) => {
  try {
    const alerts = queryAll("SELECT * FROM price_alerts WHERE active=1")
    let matches = 0
    
    for (const alert of alerts) {
      let where = "status=\'active\'"
      const params = []
      
      if (alert.make) { where += " AND make LIKE ?"; params.push("%" + alert.make + "%") }
      if (alert.model) { where += " AND model LIKE ?"; params.push("%" + alert.model + "%") }
      if (alert.year_min) { where += " AND year >= ?"; params.push(alert.year_min) }
      if (alert.year_max) { where += " AND year <= ?"; params.push(alert.year_max) }
      if (alert.price_max) { where += " AND price <= ?"; params.push(alert.price_max) }
      if (alert.km_max) { where += " AND km <= ?"; params.push(alert.km_max) }
      
      // Alleen nieuwe listings (afgelopen 24u)
      where += " AND first_seen > datetime(\'now\', \'-1 day\')"
      
      const found = queryAll("SELECT * FROM market_listings WHERE " + where + " LIMIT 5", params)
      
      for (const listing of found) {
        run("INSERT INTO notificaties (user_id, type, title, message, data) VALUES (?,?,?,?,?)", [
          alert.user_id,
          "prijsalert",
          "Match: " + (listing.make||"") + " " + (listing.model||"") + " " + (listing.year||""),
          "\u20ac" + (listing.price||0) + " | " + (listing.km||"?") + " km | " + (listing.source||""),
          JSON.stringify({ listing_id: listing.id, alert_id: alert.id, price: listing.price, url: listing.url })
        ])
        matches++
      }
    }
    
    res.json({ ok: true, matches })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


module.exports = router
