// T4C Veiling Routes — Sessie 4: Compleet veilingsysteem
const express = require("express")
const router = express.Router()
const { stmts, queryAll, queryOne, run } = require("../db")
const { authMiddleware, adminOnly, staffOnly } = require("../lib/auth")
const { writeLog } = require("../lib/state")
const { logAudit } = require("../lib/audit")

/* ═══ SSE BROADCASTER — real-time bid push naar alle subscribers per veiling ═══ */
const _sseSubs = new Map() // veiling_id → Set<res>
function sseSubscribe(veilingId, res) {
  let set = _sseSubs.get(veilingId)
  if (!set) { set = new Set(); _sseSubs.set(veilingId, set) }
  set.add(res)
  return () => { set.delete(res); if (!set.size) _sseSubs.delete(veilingId) }
}
function sseBroadcast(veilingId, event, data) {
  const set = _sseSubs.get(veilingId)
  if (!set || !set.size) return
  const payload = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"
  for (const res of set) {
    try { res.write(payload) } catch {}
  }
}
// Heartbeat elke 25s om proxy-timeouts te voorkomen (cloudflared kapt idle SSE na ~30s).
setInterval(() => {
  for (const set of _sseSubs.values()) {
    for (const res of set) { try { res.write(": ping\n\n") } catch {} }
  }
}, 25000).unref?.()

/* ═══ PER-USER RATE-LIMIT (anti-flood op bid/transport/betaal) ═══
   In-memory Map (userId → window). Reset bij elke restart (acceptabel — beperkt
   alleen bursts). 2026-06-10 SEC-3. */
const _userRate = new Map()
function rateLimit(maxPerMin) {
  return (req, res, next) => {
    if (!req.userId) return next()
    const now = Date.now()
    const rec = _userRate.get(req.userId)
    if (!rec || now - rec.windowStart > 60000) {
      _userRate.set(req.userId, { count: 1, windowStart: now })
      return next()
    }
    rec.count++
    if (rec.count > maxPerMin) {
      const retryAfter = Math.max(1, Math.ceil((rec.windowStart + 60000 - now) / 1000))
      res.set("Retry-After", String(retryAfter))
      return res.status(429).json({ ok: false, error: "Te veel verzoeken — wacht " + retryAfter + "s" })
    }
    next()
  }
}
setInterval(() => {
  const now = Date.now()
  for (const [k, r] of _userRate) if (now - r.windowStart > 60000) _userRate.delete(k)
}, 300000).unref?.()

/* ═══════════════════════════════════════════════
   VEILING LIFECYCLE — Auto-check elke 60 seconden
   ═══════════════════════════════════════════════ */

function checkVeilingen() {
  try {
    const geplande = queryAll("SELECT * FROM veilingen WHERE status='gepland' AND start_datum <= datetime('now')")
    for (const v of geplande) {
      run("UPDATE veilingen SET status='actief', updated_at=datetime('now') WHERE id=?", [v.id])
      if (v.voorraad_id) run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?", [v.voorraad_id])
      writeLog("server.log", "VEILING #" + v.id + " GEACTIVEERD (was gepland)")
    }
    const verlopen = stmts.getVerlopenVeilingen.all()
    for (const v of verlopen) {
      const hoogste = stmts.getHoogsteBod.get(v.id)
      if (hoogste && hoogste.bedrag >= v.minimumprijs) {
        run("UPDATE veilingen SET status='gewonnen', winnaar_user_id=?, winnaar_bod=?, updated_at=datetime('now') WHERE id=?", [hoogste.user_id, hoogste.bedrag, v.id])
        if (v.voorraad_id) run("UPDATE voorraad SET status='verkocht', updated_at=datetime('now') WHERE id=?", [v.voorraad_id])
        try {
          const winnaar = queryOne("SELECT * FROM users WHERE id=?", [hoogste.user_id])
          const car = v.voorraad_id ? queryOne("SELECT * FROM voorraad WHERE id=?", [v.voorraad_id]) : null
          const portfolio = v.kenteken ? queryOne("SELECT * FROM portfolio WHERE kenteken=? ORDER BY id DESC LIMIT 1", [v.kenteken]) : null
          const inkoop = portfolio?.inkoop_prijs || 0, reconditie = portfolio?.reconditie_kosten || 0
          stmts.addVerkoop.run({ kenteken: v.kenteken, make: car?.make||v.merk||"", model: car?.model||v.model||"", year: car?.year||v.bouwjaar, type: "veiling", inkoop_prijs: inkoop, verkoop_prijs: hoogste.bedrag, reconditie, marge: hoogste.bedrag-inkoop-reconditie, koper_naam: winnaar?.username||hoogste.username||"", koper_email: winnaar?.email||"", koper_id: hoogste.user_id, veiling_id: v.id, portfolio_id: portfolio?.id||null, voorraad_id: v.voorraad_id, notities: "Veiling #"+v.id+" ronde "+(v.ronde||1) })
          try { generateFactuur(v, hoogste, winnaar, car) } catch(fe) { writeLog("errors.log", "FACTUUR ERROR #"+v.id+": "+fe.message) }
          if (winnaar?.email) stmts.addEmailQueue.run({ to_email: winnaar.email, subject: "Veiling #"+v.id+" gewonnen!", body: "Gefeliciteerd! Je hebt "+((v.merk||"")+" "+(v.model||"")).trim()+" gewonnen voor EUR "+hoogste.bedrag+". Log in om transport te kiezen en af te rekenen.", type: 'veiling_gewonnen' })
        } catch(e) { writeLog("errors.log", "VERKOOP ERROR #"+v.id+": "+e.message) }
        writeLog("server.log", "VEILING #"+v.id+" GEWONNEN user "+hoogste.user_id+" EUR "+hoogste.bedrag)
      } else {
        stmts.archiveBids.run(v.id, v.ronde||1)
        const nieuweEind = new Date(Date.now()+24*60*60*1000).toISOString()
        run("UPDATE veilingen SET status='actief', ronde=?, eind_datum=?, huidige_bod=0, aantal_biedingen=0, updated_at=datetime('now') WHERE id=?", [(v.ronde||1)+1, nieuweEind, v.id])
        run("DELETE FROM veiling_biedingen WHERE veiling_id=?", [v.id])
        writeLog("server.log", "VEILING #"+v.id+" HERSTART ronde "+((v.ronde||1)+1))
        try { const ws=stmts.getWatchers.all(v.id); for(const w of ws){ if(w.email) stmts.addEmailQueue.run({to_email:w.email,subject:"Veiling herstart: "+(v.merk||"")+" "+(v.model||""),body:"Minimumbedrag niet bereikt. Bied opnieuw!",type:'veiling_herstart'}) } } catch{}
      }
    }
  } catch(e) { writeLog("errors.log", "VEILING CHECK ERROR: "+e.message) }
}
setInterval(() => { try { checkVeilingen() } catch(e) { console.error("[VEILING]", e.message) } }, 60000)

/* ═══ FACTUUR GENERATIE ═══ */
function generateFactuur(veiling, bod, winnaar, car) {
  const nr = stmts.nextFactuurNr.get()
  const veilingkosten = Math.round(bod.bedrag * 0.025)
  const subtotaal = bod.bedrag + veilingkosten
  stmts.addFactuur.run({ factuur_nr:nr, veiling_id:veiling.id, verkoop_id:null, koper_id:bod.user_id, koper_naam:winnaar?.name||winnaar?.username||bod.username||"", koper_email:winnaar?.email||"", koper_telefoon:winnaar?.phone||"", koper_adres:"",koper_postcode:"",koper_plaats:"",koper_bedrijf:"",koper_kvk:"",koper_btw_nr:"", kenteken:veiling.kenteken, auto_merk:car?.make||veiling.merk||"", auto_model:car?.model||veiling.model||"", auto_bouwjaar:car?.year||veiling.bouwjaar, auto_km:car?.km||veiling.km, auto_brandstof:car?.fuel||veiling.brandstof||"", auto_vin:car?.vin||"", bod_bedrag:bod.bedrag, transport_keuze:null, transport_kosten:0, veilingkosten, subtotaal, btw_percentage:0, btw_bedrag:0, totaal:subtotaal, marge_regeling:true, notities:"Auto-gegenereerd" })
  writeLog("server.log", "FACTUUR "+nr+" aangemaakt veiling #"+veiling.id+" EUR "+subtotaal)
}

/* ═══ MULTI-FOTO UPLOAD (admin) — base64 JSON, geen multer-dep ═══ */
const path = require("path")
const fs = require("fs")
const DATA_DIR = process.env.T4C_DATA_DIR || path.join(__dirname, "..", "..", "data")
const VEILING_PHOTOS_DIR = path.join(DATA_DIR, "photos")
if (!fs.existsSync(VEILING_PHOTOS_DIR)) fs.mkdirSync(VEILING_PHOTOS_DIR, { recursive: true })

function vphotoMatch(id, fname) {
  return new RegExp("^veiling-" + id + "-\\d+\\.(jpe?g|png|webp)$", "i").test(fname)
}
function listVeilingPhotos(id) {
  try {
    return fs.readdirSync(VEILING_PHOTOS_DIR)
      .filter(f => vphotoMatch(id, f))
      .sort()
      .map(filename => ({ filename }))
  } catch { return [] }
}

router.get("/api/veiling/:id/photos", (req, res) => {
  res.json({ ok: true, photos: listVeilingPhotos(req.params.id) })
})

router.post("/api/admin/veiling/:id/photos", authMiddleware, staffOnly, express.json({ limit: "60mb" }), (req, res) => {
  try {
    const id = parseInt(req.params.id)
    if (!id) return res.status(400).json({ ok: false, error: "Geen veiling-id" })
    const photos = Array.isArray(req.body && req.body.photos) ? req.body.photos : []
    if (!photos.length) return res.status(400).json({ ok: false, error: "Geen foto's ontvangen" })
    const existing = listVeilingPhotos(id)
    const startIdx = existing.length
    const saved = []
    photos.forEach((p, i) => {
      if (!p || !p.data_base64) return
      const ext = (p.filename || "jpg").match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase() || "jpg"
      const fname = "veiling-" + id + "-" + String(startIdx + i + 1).padStart(3, "0") + "." + ext
      const buf = Buffer.from(p.data_base64.replace(/^data:[^;]+;base64,/, ""), "base64")
      if (buf.length > 12 * 1024 * 1024) return // 12MB hard cap per foto
      fs.writeFileSync(path.join(VEILING_PHOTOS_DIR, fname), buf)
      saved.push(fname)
    })
    writeLog("server.log", "VEILING #" + id + " " + saved.length + " foto's toegevoegd door user " + req.userId)
    res.json({ ok: true, saved, photos: listVeilingPhotos(id) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.delete("/api/admin/veiling/:id/photos/:filename", authMiddleware, staffOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const fn = req.params.filename
    if (!vphotoMatch(id, fn)) return res.status(400).json({ ok: false, error: "Ongeldige filename" })
    fs.unlinkSync(path.join(VEILING_PHOTOS_DIR, fn))
    res.json({ ok: true, photos: listVeilingPhotos(id) })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══ PUBLIEKE FEED voor klant-browsing — geen auth, beperkte velden ═══ */
router.get("/api/veilingen/public", (req, res) => {
  try {
    const status = req.query.status || "actief"
    const channel = req.query.channel || ""
    const merk = (req.query.merk || "").trim()
    const q = (req.query.q || "").trim().toLowerCase()
    const prijsMin = parseFloat(req.query.prijs_min) || 0
    const prijsMax = parseFloat(req.query.prijs_max) || 0
    const jaarMin = parseInt(req.query.jaar_min) || 0
    const jaarMax = parseInt(req.query.jaar_max) || 0
    const limit = Math.min(parseInt(req.query.limit) || 60, 200)

    const where = []
    const vals = []
    if (status && status !== "all") { where.push("status = ?"); vals.push(status) }
    if (channel) { where.push("channel_type = ?"); vals.push(channel) }
    if (merk) { where.push("LOWER(merk) = ?"); vals.push(merk.toLowerCase()) }
    if (jaarMin) { where.push("bouwjaar >= ?"); vals.push(jaarMin) }
    if (jaarMax) { where.push("bouwjaar <= ?"); vals.push(jaarMax) }
    if (prijsMin) { where.push("COALESCE(huidige_bod, startprijs) >= ?"); vals.push(prijsMin) }
    if (prijsMax) { where.push("COALESCE(huidige_bod, startprijs) <= ?"); vals.push(prijsMax) }
    if (q) { where.push("(LOWER(merk) LIKE ? OR LOWER(model) LIKE ? OR LOWER(kenteken) LIKE ?)"); vals.push("%"+q+"%","%"+q+"%","%"+q+"%") }

    const sql = "SELECT id, kenteken, titel, merk, model, bouwjaar, km, brandstof, kleur, "
      + "channel_type, startprijs, verwachte_prijs, huidige_bod, aantal_biedingen, "
      + "start_datum, eind_datum, status, ronde, voorraad_id "
      + "FROM veilingen "
      + (where.length ? "WHERE " + where.join(" AND ") + " " : "")
      + "ORDER BY CASE WHEN status='actief' THEN 0 ELSE 1 END, eind_datum ASC "
      + "LIMIT " + limit
    const veilingen = queryAll(sql, vals)

    // Eerste foto: probeer voorraad-foto, fallback naar veiling-eigen upload
    for (const v of veilingen) {
      let f = null
      if (v.voorraad_id) {
        const r = queryOne("SELECT filename FROM car_photos WHERE voorraad_id=? ORDER BY sort_order, id LIMIT 1", [v.voorraad_id])
        if (r) f = r.filename
      }
      if (!f) { const vp = listVeilingPhotos(v.id); if (vp.length) f = vp[0].filename }
      v.foto = f
    }

    // Filter-aggregaties voor sidebar (alleen op actieve set)
    const facets = queryAll(
      "SELECT merk, COUNT(*) as n FROM veilingen WHERE status=? AND merk IS NOT NULL AND merk != '' GROUP BY merk ORDER BY n DESC LIMIT 30",
      ["actief"]
    )

    res.json({ ok: true, veilingen, facets: { merken: facets }, total: veilingen.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══ PUBLIEKE ROUTES ═══ */
router.get("/api/veilingen", authMiddleware, (req, res) => {
  try {
    const status = req.query.status || 'actief'
    let veilingen
    if (status === 'all') veilingen = stmts.getVeilingen.all()
    else if (status === 'actief') veilingen = stmts.getActieveVeilingen.all()
    else veilingen = stmts.getVeilingen.all(status)
    for (const v of veilingen) { if (v.voorraad_id) v.fotos = queryAll("SELECT id, filename FROM car_photos WHERE voorraad_id=? LIMIT 5", [v.voorraad_id]); v.biedingen_count = v.aantal_biedingen||0 }
    res.json({ ok: true, veilingen })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/veiling/:id", (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok: false, error: "Veiling niet gevonden" })
    v.biedingen = stmts.getVeilingBiedingen.all(v.id)
    let voorraadFotos = []
    if (v.voorraad_id) {
      try { const car = stmts.getVoorraadById.get(v.voorraad_id); if(car) v.auto = { id:car.id, kenteken:car.kenteken, make:car.make, model:car.model, model_variant:car.model_variant, year:car.year, fuel:car.fuel, km:car.km, color:car.color, body:car.body, power_kw:car.power_kw, power_hp:car.power_hp, engine_label:car.engine_label, transmission:car.transmission, doors:car.doors, seats:car.seats, vraag_prijs:car.vraag_prijs, beschrijving:car.beschrijving, highlights:car.highlights, apk_until:car.apk_until, vin:car.vin } } catch{}
      voorraadFotos = queryAll("SELECT id, filename FROM car_photos WHERE voorraad_id=? ORDER BY sort_order, id", [v.voorraad_id]) || []
    }
    // Combineer voorraad-foto's met direct geuploade veiling-foto's
    v.fotos = voorraadFotos.concat(listVeilingPhotos(v.id))
    if (v.status === 'gewonnen') { const f = stmts.getFactuurByVeiling.get(v.id); if(f) v.factuur = { id:f.id, factuur_nr:f.factuur_nr, totaal:f.totaal, betaal_status:f.betaal_status, transport_kosten:f.transport_kosten, veilingkosten:f.veilingkosten, bod_bedrag:f.bod_bedrag } }
    res.json({ ok: true, veiling: v })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/veilingen/stats", (req, res) => { try { res.json({ ok:true, stats: stmts.countVeilingen.get() }) } catch(e) { res.status(500).json({ ok:false, error:e.message }) } })

/* ═══ BIED ═══ */
router.post("/api/veiling/:id/bied", authMiddleware, rateLimit(30), express.json(), (req, res) => {
  try {
    const veiling = stmts.getVeiling.get(req.params.id)
    if (!veiling) return res.status(404).json({ ok:false, error:"Veiling niet gevonden" })
    if (veiling.status !== 'actief') return res.status(400).json({ ok:false, error:"Veiling is niet actief" })
    if (new Date(veiling.eind_datum) <= new Date()) return res.status(400).json({ ok:false, error:"Veiling is verlopen" })
    const bedrag = parseFloat(req.body.bedrag)
    if (!bedrag || bedrag <= 0) return res.status(400).json({ ok:false, error:"Ongeldig bedrag" })
    const huidig = veiling.huidige_bod||0, MIN=50
    if (bedrag <= huidig) return res.status(400).json({ ok:false, error:"Bod moet hoger dan EUR "+huidig })
    if (huidig > 0 && (bedrag-huidig) < MIN) return res.status(400).json({ ok:false, error:"Minimum verhoging EUR "+MIN+". Minimaal EUR "+(huidig+MIN) })
    if (bedrag < veiling.minimumprijs) return res.status(400).json({ ok:false, error:"Bod minimaal EUR "+veiling.minimumprijs })
    const laatste = queryOne("SELECT user_id FROM veiling_biedingen WHERE veiling_id=? ORDER BY bedrag DESC LIMIT 1", [veiling.id])
    if (laatste && laatste.user_id === req.userId) return res.status(400).json({ ok:false, error:"Je bent al hoogste bieder" })
    const user = queryOne("SELECT * FROM users WHERE id=?", [req.userId])
    stmts.addVeilingBod.run({ veiling_id:veiling.id, user_id:req.userId, username:user?.username||req.body.naam||"Anoniem", bedrag })
    run("UPDATE veilingen SET huidige_bod=?, aantal_biedingen=?, updated_at=datetime('now') WHERE id=?", [bedrag, (veiling.aantal_biedingen||0)+1, veiling.id])
    // Anti-snipe: verleng 2 min als <2 min resteert
    const rem = new Date(veiling.eind_datum).getTime()-Date.now()
    if (rem < 120000 && rem > 0) { run("UPDATE veilingen SET eind_datum=? WHERE id=?", [new Date(Date.now()+120000).toISOString(), veiling.id]); writeLog("server.log","ANTI-SNIPE #"+veiling.id) }
    writeLog("server.log", "BOD EUR "+bedrag+" veiling #"+veiling.id+" door "+(user?.username||"user-"+req.userId))
    logAudit({
      userId: req.userId,
      action: "bid_placed",
      targetType: "veiling", targetId: veiling.id,
      details: { bedrag, previous_bid: huidig, aantal_biedingen: (veiling.aantal_biedingen||0)+1, anti_snipe: rem < 120000 && rem > 0 },
      req
    })
    // SSE-broadcast naar alle subscribers — verstuurd direct na DB-commit
    sseBroadcast(veiling.id, "bid", {
      veiling_id: veiling.id,
      bedrag,
      username: user?.username || "Anoniem",
      aantal_biedingen: (veiling.aantal_biedingen||0)+1,
      eind_datum: (rem < 120000 && rem > 0) ? new Date(Date.now()+120000).toISOString() : veiling.eind_datum,
      anti_snipe: rem < 120000 && rem > 0,
      timestamp: new Date().toISOString()
    })
    res.json({ ok:true, message:"Bod geplaatst", bedrag, min_volgend:bedrag+MIN })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/watch", authMiddleware, rateLimit(60), express.json(), (req, res) => { try { const u=queryOne("SELECT * FROM users WHERE id=?",[req.userId]); stmts.addWatcher.run({veiling_id:req.body.veiling_id||0,user_id:req.userId,email:u?.email||req.body.email||""}); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })

/* ═══ TRANSPORT & AFREKENING ═══ */
router.post("/api/veiling/:id/transport", authMiddleware, rateLimit(10), express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId) return res.status(403).json({ ok:false, error:"Niet de winnaar" })
    const { keuze } = req.body
    let kosten=0, leverdagen=0
    if (keuze==='ophalen') { kosten=0; leverdagen=0 }
    else if (keuze==='transport_standaard') { kosten=249; leverdagen=5 }
    else if (keuze==='transport_express') { kosten=449; leverdagen=2 }
    const leverdatum = leverdagen>0 ? new Date(Date.now()+leverdagen*86400000).toISOString() : null
    run("UPDATE veilingen SET transport_status='gekozen', transport_keuze=?, transport_kosten=?, leverdatum=?, updated_at=datetime('now') WHERE id=?", [keuze, kosten, leverdatum, v.id])
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (f) { const sub=f.bod_bedrag+f.veilingkosten+kosten; stmts.updateFactuur.run(f.id, { transport_keuze:keuze, transport_kosten:kosten, subtotaal:sub, totaal:sub+f.btw_bedrag }); writeLog("server.log","FACTUUR "+f.factuur_nr+" transport "+keuze+" EUR "+kosten) }
    res.json({ ok:true, transport:{ keuze, kosten, leverdagen, leverdatum } })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/:id/afrekening", authMiddleware, rateLimit(10), express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId) return res.status(403).json({ ok:false, error:"Niet de winnaar" })
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (!f) return res.status(400).json({ ok:false, error:"Factuur niet gevonden" })
    const d = req.body, updates = {}
    if(d.naam) updates.koper_naam=d.naam; if(d.email) updates.koper_email=d.email; if(d.telefoon) updates.koper_telefoon=d.telefoon
    if(d.adres) updates.koper_adres=d.adres; if(d.postcode) updates.koper_postcode=d.postcode; if(d.plaats) updates.koper_plaats=d.plaats
    if(d.bedrijf) updates.koper_bedrijf=d.bedrijf; if(d.kvk) updates.koper_kvk=d.kvk; if(d.btw_nr) updates.koper_btw_nr=d.btw_nr
    if(d.betaal_methode) updates.betaal_methode=d.betaal_methode
    if (d.btw_nr && !d.marge_regeling) { const btw=Math.round(f.subtotaal*0.21); updates.marge_regeling=0; updates.btw_percentage=21; updates.btw_bedrag=btw; updates.totaal=f.subtotaal+btw }
    if (Object.keys(updates).length) stmts.updateFactuur.run(f.id, updates)
    res.json({ ok:true, factuur: stmts.getFactuur.get(f.id) })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.post("/api/veiling/:id/betaal", authMiddleware, rateLimit(10), express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (v.winnaar_user_id !== req.userId && req.userRole !== 'admin') return res.status(403).json({ ok:false, error:"Geen toegang" })
    const f = stmts.getFactuurByVeiling.get(v.id)
    if (!f) return res.status(400).json({ ok:false, error:"Factuur niet gevonden" })
    stmts.updateFactuur.run(f.id, { betaal_status:'betaald', betaal_methode:req.body.methode||'bank_overschrijving', betaal_referentie:req.body.referentie||"T4C-"+Date.now(), betaald_op:new Date().toISOString() })
    if (v.transport_keuze) run("UPDATE veilingen SET transport_status='betaald', updated_at=datetime('now') WHERE id=?", [v.id])
    writeLog("server.log", "BETALING factuur "+f.factuur_nr+" EUR "+f.totaal)
    res.json({ ok:true, message:"Betaling ontvangen", factuur_nr:f.factuur_nr })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

/* ═══ FACTUUR ROUTES ═══ */
router.get("/api/factuur/:id", authMiddleware, (req, res) => {
  try {
    const f = stmts.getFactuur.get(req.params.id)
    if (!f) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (f.koper_id !== req.userId && req.userRole !== 'admin' && req.userRole !== 't4c') return res.status(403).json({ ok:false, error:"Geen toegang" })
    if (f.veiling_id) { const v=stmts.getVeiling.get(f.veiling_id); if(v) f.veiling={id:v.id,titel:v.titel,status:v.status,transport_keuze:v.transport_keuze,transport_status:v.transport_status} }
    res.json({ ok:true, factuur:f })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})
router.get("/api/factuur/nr/:nr", authMiddleware, (req, res) => { try { const f=stmts.getFactuurByNr.get(req.params.nr); if(!f) return res.status(404).json({ok:false,error:"Niet gevonden"}); if(f.koper_id!==req.userId&&req.userRole!=='admin'&&req.userRole!=='t4c') return res.status(403).json({ok:false,error:"Geen toegang"}); res.json({ok:true,factuur:f}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })

/* ═══ FACTUUR-PDF (branded, 1 pagina) — 2026-06-11 ═══ */
router.get("/api/factuur/:id/pdf", authMiddleware, (req, res) => {
  try {
    const f = stmts.getFactuur.get(req.params.id)
    if (!f) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (f.koper_id !== req.userId && req.user?.role !== 'admin' && req.user?.role !== 't4c') {
      return res.status(403).json({ ok:false, error:"Geen toegang" })
    }
    const PDFDocument = require("pdfkit")
    const doc = new PDFDocument({ size: "A4", margin: 50 })
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="factuur-${f.factuur_nr || f.id}.pdf"`,
    })
    doc.pipe(res)

    // ── Brand-balk (groen accent links) ──
    doc.rect(50, 50, 4, 60).fill("#00cc7d")
    doc.fillColor("#0b1216").fontSize(22).font("Helvetica-Bold").text("Transfer4Cars", 70, 55)
    doc.fontSize(9).font("Helvetica").fillColor("#5a6e84").text("B2B Autoveilingen · Occasions · EU-import", 70, 82)
    doc.fontSize(8).text("Woudsedijk 11B · 2461 CR Langeraar · KvK 88503925 · BTW NL864657079B01", 70, 96)

    // ── Factuur-meta rechtsboven ──
    doc.fillColor("#0b1216").fontSize(20).font("Helvetica-Bold").text("FACTUUR", 380, 55, { width: 165, align: "right" })
    doc.fontSize(10).font("Helvetica").fillColor("#5a6e84")
    doc.text(`Nr: ${f.factuur_nr || ("F-"+String(f.id).padStart(5,"0"))}`, 380, 82, { width: 165, align: "right" })
    doc.text(`Datum: ${(f.created_at || "").substring(0,10)}`, 380, 96, { width: 165, align: "right" })
    const statusColor = f.betaal_status === "betaald" ? "#00cc7d" : (f.betaal_status === "open" ? "#ffb300" : "#ef4444")
    doc.fillColor(statusColor).font("Helvetica-Bold").text(`Status: ${(f.betaal_status||"open").toUpperCase()}`, 380, 110, { width: 165, align: "right" })

    // ── Scheider ──
    doc.moveTo(50, 135).lineTo(545, 135).strokeColor("#e5e7eb").lineWidth(1).stroke()

    // ── Koper-block ──
    doc.fillColor("#5a6e84").fontSize(9).text("AAN", 50, 150)
    doc.fillColor("#0b1216").fontSize(11).font("Helvetica-Bold").text(f.koper_naam || "—", 50, 165)
    doc.font("Helvetica").fontSize(10)
    let y = 180
    if (f.koper_bedrijf) { doc.text(f.koper_bedrijf, 50, y); y += 14 }
    if (f.koper_adres) { doc.text(f.koper_adres, 50, y); y += 14 }
    if (f.koper_postcode || f.koper_plaats) { doc.text(`${f.koper_postcode||""} ${f.koper_plaats||""}`.trim(), 50, y); y += 14 }
    if (f.koper_email) { doc.text(f.koper_email, 50, y); y += 14 }
    if (f.koper_telefoon) { doc.text(f.koper_telefoon, 50, y); y += 14 }
    if (f.koper_kvk) { doc.fontSize(9).fillColor("#5a6e84").text(`KvK ${f.koper_kvk}`, 50, y); y += 12 }
    if (f.koper_btw_nr) { doc.text(`BTW ${f.koper_btw_nr}`, 50, y); y += 12 }

    // ── Auto-block (rechts) ──
    doc.fillColor("#5a6e84").fontSize(9).text("VOERTUIG", 320, 150)
    doc.fillColor("#0b1216").fontSize(11).font("Helvetica-Bold").text(
      `${f.auto_merk||""} ${f.auto_model||""}`.trim() || f.kenteken || "—",
      320, 165
    )
    doc.font("Helvetica").fontSize(10)
    let yr = 180
    if (f.kenteken) { doc.font("Courier-Bold").fillColor("#0b1216").text(`Kenteken: ${f.kenteken}`, 320, yr); yr += 14; doc.font("Helvetica") }
    if (f.auto_bouwjaar) { doc.text(`Bouwjaar: ${f.auto_bouwjaar}`, 320, yr); yr += 14 }
    if (f.auto_km) { doc.text(`Kilometerstand: ${Number(f.auto_km).toLocaleString("nl-NL")} km`, 320, yr); yr += 14 }
    if (f.auto_brandstof) { doc.text(`Brandstof: ${f.auto_brandstof}`, 320, yr); yr += 14 }
    if (f.auto_vin) { doc.fontSize(9).fillColor("#5a6e84").text(`VIN: ${f.auto_vin}`, 320, yr); yr += 12 }

    // ── Specificatie-tabel ──
    const tableY = Math.max(y, yr) + 30
    doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor("#0b1216").lineWidth(1).stroke()
    doc.fillColor("#0b1216").fontSize(10).font("Helvetica-Bold")
    doc.text("Omschrijving", 60, tableY + 8)
    doc.text("Bedrag", 480, tableY + 8, { width: 60, align: "right" })
    doc.moveTo(50, tableY + 26).lineTo(545, tableY + 26).strokeColor("#e5e7eb").stroke()

    const eur = (n) => "€ " + Number(n || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const rows = []
    if (f.bod_bedrag) rows.push(["Winnende bod (veiling)", f.bod_bedrag])
    if (f.veilingkosten) rows.push(["Veilingkosten", f.veilingkosten])
    if (f.transport_kosten) rows.push([`Transport${f.transport_keuze?" ("+f.transport_keuze+")":""}`, f.transport_kosten])

    doc.font("Helvetica").fontSize(10)
    let ty = tableY + 35
    for (const [omschr, bedr] of rows) {
      doc.fillColor("#0b1216").text(omschr, 60, ty)
      doc.text(eur(bedr), 480, ty, { width: 60, align: "right" })
      ty += 20
    }
    // Subtotaal + BTW + Totaal
    doc.moveTo(50, ty + 4).lineTo(545, ty + 4).strokeColor("#e5e7eb").stroke()
    ty += 14
    doc.text("Subtotaal", 60, ty)
    doc.text(eur(f.subtotaal || (rows.reduce((s,r)=>s+r[1],0))), 480, ty, { width: 60, align: "right" })
    ty += 18
    if (f.marge_regeling) {
      doc.fillColor("#5a6e84").fontSize(9).text("Marge-regeling van toepassing — geen BTW belast", 60, ty)
      ty += 16
    } else {
      doc.text(`BTW (${f.btw_percentage || 21}%)`, 60, ty)
      doc.text(eur(f.btw_bedrag || 0), 480, ty, { width: 60, align: "right" })
      ty += 18
    }
    doc.moveTo(50, ty + 4).lineTo(545, ty + 4).strokeColor("#0b1216").lineWidth(1).stroke()
    ty += 14
    doc.fillColor("#0b1216").fontSize(13).font("Helvetica-Bold")
    doc.text("TOTAAL", 60, ty)
    doc.text(eur(f.totaal || (f.subtotaal || 0) + (f.btw_bedrag || 0)), 460, ty, { width: 80, align: "right" })

    // ── Betaal-info / notitie ──
    ty += 50
    if (f.betaal_status === "open") {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0b1216").text("Betaalinstructie", 50, ty)
      doc.font("Helvetica").fontSize(9).fillColor("#5a6e84")
      doc.text(`Gelieve € ${Number(f.totaal||0).toLocaleString("nl-NL",{minimumFractionDigits:2,maximumFractionDigits:2})} over te maken onder vermelding van factuurnummer ${f.factuur_nr || f.id}.`, 50, ty + 16, { width: 495 })
      doc.text("Betaal-instructies volgen per e-mail of via uw account-dashboard.", 50, ty + 32, { width: 495 })
    } else if (f.betaal_status === "betaald") {
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#00cc7d").text(`✓ Voldaan op ${(f.betaald_op||"").substring(0,10)}`, 50, ty)
    }
    if (f.notities) {
      doc.fontSize(9).fillColor("#5a6e84").font("Helvetica-Oblique").text(`Notities: ${f.notities}`, 50, ty + 60, { width: 495 })
    }

    // ── Footer ──
    doc.fontSize(8).fillColor("#5a6e84").font("Helvetica")
    doc.text("Transfer4Cars · JHVT Holding B.V. · transfer4cars.com · info@transfer4cars.com", 50, 770, { width: 495, align: "center" })
    doc.text("KvK 88503925 · BTW NL864657079B01 · Woudsedijk 11B, 2461 CR Langeraar", 50, 782, { width: 495, align: "center" })

    doc.end()
  } catch(e) {
    if (!res.headersSent) res.status(500).json({ ok:false, error:e.message })
  }
})
router.get("/api/mijn-facturen", authMiddleware, (req, res) => { try { res.json({ok:true, facturen: stmts.getUserFacturen.all(req.userId)}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })

router.get("/api/mijn-veilingen", authMiddleware, (req, res) => {
  try {
    const gewonnen = stmts.getUserGewonnenVeilingen.all(req.userId)
    const biedingen = stmts.getUserVeilingBiedingen.all(req.userId)
    const map = {}
    for (const b of biedingen) { if(!map[b.veiling_id]) map[b.veiling_id]={...b,mijn_hoogste_bod:b.bedrag}; if(b.bedrag>map[b.veiling_id].mijn_hoogste_bod) map[b.veiling_id].mijn_hoogste_bod=b.bedrag }
    const actief=[], verloren=[]
    for (const v of Object.values(map)) { if(v.veiling_status==='actief') actief.push(v); else if(v.veiling_status==='gewonnen'&&v.winnaar_user_id!==req.userId) verloren.push(v) }
    for (const v of gewonnen) {
      if(v.voorraad_id) v.fotos = queryAll("SELECT id, filename FROM car_photos WHERE voorraad_id=? LIMIT 3", [v.voorraad_id])
      const f = stmts.getFactuurByVeiling.get(v.id)
      if(f) v.factuur = { id:f.id, factuur_nr:f.factuur_nr, totaal:f.totaal, betaal_status:f.betaal_status, transport_kosten:f.transport_kosten, veilingkosten:f.veilingkosten, bod_bedrag:f.bod_bedrag }
    }
    // Watchlist — veilingen die user actief volgt (zonder bod)
    const watchlist = queryAll(
      "SELECT w.id AS watch_id, w.created_at AS watched_at, v.id AS veiling_id, v.titel, v.merk, v.model, v.kenteken, v.bouwjaar, v.km, v.huidige_bod, v.minimumprijs, v.eind_datum, v.status, v.aantal_biedingen FROM veiling_watchers w JOIN veilingen v ON v.id=w.veiling_id WHERE w.user_id=? ORDER BY w.created_at DESC",
      [req.userId]
    )
    // Historie — alle biedingen ooit geplaatst (ongeacht actief/gewonnen/verloren)
    const historie = biedingen.map(b => ({
      veiling_id: b.veiling_id,
      bedrag: b.bedrag,
      created_at: b.created_at,
      titel: b.titel,
      kenteken: b.kenteken,
      merk: b.merk,
      model: b.model,
      veiling_status: b.veiling_status,
      uitslag: b.veiling_status === 'gewonnen' ? (b.winnaar_user_id === req.userId ? 'gewonnen' : 'verloren') : b.veiling_status,
    }))
    res.json({ ok:true, gewonnen, verloren, actief, watchlist, historie })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

// Unwatch — verwijder een eigen watchlist-entry
router.delete("/api/veiling/watch/:id", authMiddleware, (req, res) => {
  try {
    const watchId = parseInt(req.params.id)
    if (!watchId) return res.status(400).json({ ok:false, error:"watch-id ongeldig" })
    const w = queryOne("SELECT * FROM veiling_watchers WHERE id=?", [watchId])
    if (!w) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    if (w.user_id !== req.userId) return res.status(403).json({ ok:false, error:"Geen toegang" })
    run("DELETE FROM veiling_watchers WHERE id=?", [watchId])
    res.json({ ok:true })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

/* ═══ ADMIN/STAFF ═══ */
router.post("/api/veiling", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const d = req.body
    if (!d.minimumprijs) return res.status(400).json({ ok:false, error:"Minimumprijs vereist" })
    let vid = d.voorraad_id?parseInt(d.voorraad_id):null, car=null
    if (vid) { car=stmts.getVoorraadById.get(vid); if(!car) return res.status(400).json({ok:false,error:"Auto niet gevonden"}); d.kenteken=car.kenteken }
    else if (d.kenteken) { car=queryOne("SELECT * FROM voorraad WHERE kenteken=? AND status!='verkocht'",[d.kenteken.toUpperCase()]); if(car) vid=car.id }
    else return res.status(400).json({ ok:false, error:"Kenteken of voorraad_id vereist" })
    const dupF=vid?"voorraad_id":"kenteken", dupV=vid||(d.kenteken||"").toUpperCase()
    const ex = queryOne("SELECT id FROM veilingen WHERE "+dupF+"=? AND status IN ('actief','gepland')", [dupV])
    if (ex) return res.status(400).json({ ok:false, error:"Al in actieve veiling (#"+ex.id+")" })
    const now=new Date(), start=d.start_datum?new Date(d.start_datum):now, eind=d.eind_datum?new Date(d.eind_datum):new Date(start.getTime()+(parseInt(d.duur_uren)||24)*3600000), status=start>now?"gepland":"actief"
    if(car){d.merk=d.merk||car.make||"";d.model=d.model||car.model||"";d.bouwjaar=d.bouwjaar||car.year||null;d.km=d.km||car.km||null;d.brandstof=d.brandstof||car.fuel||"";d.kleur=d.kleur||car.color||""}
    d.titel=d.titel||((d.merk||"")+" "+(d.model||"")+" "+(d.bouwjaar||"")).trim(); d.kenteken=(d.kenteken||"").toUpperCase(); d.start_datum=start.toISOString(); d.eind_datum=eind.toISOString(); d.created_by=req.userId
    d.beschrijving=d.beschrijving||""; d.merk=d.merk||""; d.model=d.model||""; d.kleur=d.kleur||""; d.brandstof=d.brandstof||""; d.bouwjaar=d.bouwjaar??null; d.km=d.km??null;
    stmts.addVeiling.run({...d, voorraad_id:vid, status})
    const id = queryOne("SELECT last_insert_rowid() as id")?.id
    if(vid&&status==="actief") run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?", [vid])
    try{const es=stmts.getAllWatcherEmails.all();for(const e of es)stmts.addEmailQueue.run({to_email:e.email,subject:"Nieuwe veiling: "+d.titel,body:"Nieuwe veiling: "+d.titel+" ("+d.kenteken+"). Min EUR "+d.minimumprijs,type:"nieuwe_veiling"})}catch{}
    writeLog("server.log", "VEILING #"+id+" AANGEMAAKT: "+d.titel+" min EUR "+d.minimumprijs)
    res.json({ ok:true, id, status, message:"Veiling aangemaakt" })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

// Anti-fraude (memory: cardatax_integrity_guardrail) — disclosure-velden waar
// wijzigingen MOETEN worden gelogd voor latere betwisting. Tooling mag NOOIT
// km-misleiding of schade-verzwijging faciliteren — zichtbaar audit-spoor wel.
const DISCLOSURE_FIELDS = ["km","bouwjaar","beschrijving","highlights","titel","merk","model","minimumprijs"]
router.put("/api/veiling/:id", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const v = stmts.getVeiling.get(req.params.id)
    if (!v) return res.status(404).json({ ok:false, error:"Niet gevonden" })
    const oldS=v.status, newS=req.body.status||oldS
    // Capture disclosure-velden vóór update
    const disclosureChanges = {}
    for (const f of DISCLOSURE_FIELDS) {
      if (f in req.body && String(v[f] ?? "") !== String(req.body[f] ?? "")) {
        disclosureChanges[f] = { from: v[f], to: req.body[f] }
      }
    }
    run("UPDATE veilingen SET "+Object.keys(req.body).map(k=>k+"=?").join(",")+",updated_at=datetime('now') WHERE id=?", [...Object.values(req.body), req.params.id])
    if(v.voorraad_id&&oldS!==newS){if(newS==="geannuleerd"||newS==="verlopen")run("UPDATE voorraad SET status='te_koop', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]);else if(newS==="gewonnen")run("UPDATE voorraad SET status='verkocht', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]);else if(newS==="actief"&&oldS==="gepland")run("UPDATE voorraad SET status='in_veiling', updated_at=datetime('now') WHERE id=?",[v.voorraad_id])}
    // Log disclosure-changes — onveranderbaar audit-spoor (art. 15+20 AVG + anti-fraude)
    if (Object.keys(disclosureChanges).length > 0) {
      logAudit({
        userId: req.userId,
        action: "veiling_disclosure_change",
        targetType: "veiling", targetId: parseInt(req.params.id),
        details: { changes: disclosureChanges, status_change: oldS !== newS ? { from: oldS, to: newS } : null },
        req
      })
      writeLog("server.log", "DISCLOSURE veiling #"+req.params.id+" velden: "+Object.keys(disclosureChanges).join(","))
    }
    res.json({ ok:true })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.delete("/api/veiling/:id", authMiddleware, adminOnly, (req, res) => {
  try { const v=stmts.getVeiling.get(req.params.id); if(v&&v.voorraad_id&&v.status!=="gewonnen") run("UPDATE voorraad SET status='te_koop', updated_at=datetime('now') WHERE id=?",[v.voorraad_id]); stmts.deleteVeiling.run(req.params.id); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) }
})

router.get("/api/admin/veilingen", authMiddleware, adminOnly, (req, res) => {
  try {
    const veilingen = queryAll("SELECT v.*, COALESCE(w.make,v.merk) as auto_merk, COALESCE(w.model,v.model) as auto_model, COALESCE(w.year,v.bouwjaar) as auto_bouwjaar, COALESCE(w.km,v.km) as auto_km, w.vraag_prijs as auto_vraagprijs, (SELECT COUNT(*) FROM car_photos WHERE voorraad_id=v.voorraad_id) as foto_count FROM veilingen v LEFT JOIN voorraad w ON w.id=v.voorraad_id ORDER BY v.created_at DESC")
    res.json({ ok:true, veilingen, stats: stmts.countVeilingen.get() })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.get("/api/admin/biedingen", authMiddleware, adminOnly, (req, res) => {
  try {
    const direct = queryAll("SELECT *, 'direct' as type FROM biedingen ORDER BY created_at DESC")
    const veiling = queryAll("SELECT vb.*, v.titel as veiling_titel, v.kenteken, v.status as veiling_status, 'veiling' as type FROM veiling_biedingen vb JOIN veilingen v ON v.id=vb.veiling_id ORDER BY vb.created_at DESC")
    res.json({ ok:true, direct, veiling, total:direct.length+veiling.length })
  } catch(e) { res.status(500).json({ ok:false, error:e.message }) }
})

router.get("/api/admin/verkopen", authMiddleware, adminOnly, (req, res) => { try { res.json({ok:true, verkopen:stmts.getVerkopen.all(200), stats:stmts.countVerkopen.get()}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })
router.get("/api/admin/facturen", authMiddleware, adminOnly, (req, res) => { try { res.json({ok:true, facturen:stmts.getAllFacturen.all(200), stats:stmts.countFacturen.get()}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })
router.put("/api/admin/factuur/:id", authMiddleware, adminOnly, express.json(), (req, res) => { try { const f=stmts.getFactuur.get(req.params.id); if(!f) return res.status(404).json({ok:false,error:"Niet gevonden"}); stmts.updateFactuur.run(f.id, req.body); writeLog("server.log","FACTUUR "+f.factuur_nr+" admin update"); res.json({ok:true}) } catch(e) { res.status(500).json({ok:false,error:e.message}) } })


/* ═══ SSE STREAM voor real-time veiling-detail ═══ */
router.get("/api/veiling/:id/stream", (req, res) => {
  const id = parseInt(req.params.id)
  if (!id) return res.status(400).end()
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  })
  res.flushHeaders?.()
  res.write(": connected\n\n")
  const unsub = sseSubscribe(id, res)
  req.on("close", () => unsub())
})

/* ═══ AI SERVICE ═══ */
module.exports = router
