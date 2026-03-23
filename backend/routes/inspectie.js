// routes/inspectie.js — inspecties, gebreken, biedingen
const router = require("express").Router()
const { stmts, queryAll, queryOne, run } = require("../db")
const { authMiddleware, staffOnly } = require("../lib/auth")

router.post("/api/inspectie", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const totaalScore = Math.round(((d.exterieur_score||3) + (d.interieur_score||3) + (d.technisch_score||3)) / 3 * 10) / 10
    const result = stmts.addInspectie.run({ ...d, totaal_score: totaalScore })
    res.json({ ok: true, id: result.lastInsertRowid, totaal_score: totaalScore })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/inspectie/:id", (req, res) => {
  try {
    const insp = stmts.getInspectie.get(parseInt(req.params.id))
    if (!insp) return res.status(404).json({ ok: false, error: "Niet gevonden" })
    const gebreken = stmts.getGebreken.all(insp.id)
    res.json({ ok: true, inspectie: insp, gebreken })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/inspecties/:kenteken", (req, res) => {
  try { res.json({ ok: true, inspecties: stmts.getInspecties.all(req.params.kenteken) }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.put("/api/inspectie/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const totaalScore = Math.round(((d.exterieur_score||3) + (d.interieur_score||3) + (d.technisch_score||3)) / 3 * 10) / 10
    stmts.updateInspectie.run(parseInt(req.params.id), { ...d, totaal_score: totaalScore })
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post("/api/inspectie/:id/gebrek", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const result = stmts.addGebrek.run({ inspectie_id: parseInt(req.params.id), ...d })
    const gebreken = stmts.getGebreken.all(parseInt(req.params.id))
    const totKosten = gebreken.reduce((s, g) => s + (g.geschatte_kosten || 0), 0)
    const insp = stmts.getInspectie.get(parseInt(req.params.id))
    if (insp) stmts.updateInspectie.run(insp.id, { ...insp, totaal_kosten: totKosten })
    res.json({ ok: true, id: result.lastInsertRowid, totaal_kosten: totKosten })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.delete("/api/gebrek/:id", authMiddleware, staffOnly, (req, res) => {
  try { stmts.deleteGebrek.run(parseInt(req.params.id)); res.json({ ok: true }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   BIEDINGEN SYSTEEM
   ═══════════════════════════════════════════════ */

router.post("/api/bod", authMiddleware, (req, res) => {
  try {
    const d = req.body
    if (!d.bedrag || !d.bieder) return res.status(400).json({ ok: false, error: "Bieder en bedrag vereist" })
    const result = stmts.addBod.run(d)
    const stats = stmts.getBiedingStats.get(d.kenteken || "")
    res.json({ ok: true, id: result.lastInsertRowid, stats })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/biedingen/:kenteken", (req, res) => {
  try {
    const biedingen = stmts.getBiedingen.all(req.params.kenteken)
    const stats = stmts.getBiedingStats.get(req.params.kenteken)
    res.json({ ok: true, biedingen, stats })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/biedingen", authMiddleware, (req, res) => {
  try {
    // Klant ziet al hun eigen biedingen (alle statussen)
    if (req.user?.role === "klant") {
      const me = req.user.name || req.user.sub || ""
      const biedingen = queryAll("SELECT * FROM biedingen WHERE bieder=? ORDER BY created_at DESC", [me])
      return res.json({ ok: true, biedingen })
    }
    // Staff/admin ziet actieve biedingen
    res.json({ ok: true, biedingen: stmts.getAllBiedingen.all() })
  }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.put("/api/bod/:id/status", authMiddleware, staffOnly, (req, res) => {
  try { stmts.updateBod.run(parseInt(req.params.id), req.body.status || "afgewezen"); res.json({ ok: true }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── All inspecties (for desktop overview) ──
router.get("/api/inspecties", authMiddleware, (req, res) => {
  try {
    const inspecties = stmts.getAllInspecties.all()
    res.json({ ok: true, inspecties })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})



module.exports = router
