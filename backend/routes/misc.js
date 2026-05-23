// T4C Misc Routes
const express = require("express")
const router = express.Router()
const jwt = require("jsonwebtoken")
const { stmts, queryAll, queryOne, run } = require("../db")
const { authMiddleware, adminOnly, staffOnly, getSecret } = require("../lib/auth")
const { getApiKey, callGPT } = require("../lib/ai")
const { writeLog } = require("../lib/state")

// Register
router.post("/api/register", express.json(), (req, res) => {
  try {
    const d = req.body
    if (!d.email) return res.status(400).json({ ok: false, error: "E-mail is vereist" })
    if (!d.bedrijf) return res.status(400).json({ ok: false, error: "Bedrijfsnaam is vereist" })
    if (!d.telefoon) return res.status(400).json({ ok: false, error: "Telefoonnummer is vereist" })
    if (!d.kvk || d.kvk.replace(/\D/g,"").length !== 8) return res.status(400).json({ ok: false, error: "Geldig KvK-nummer (8 cijfers) is vereist" })
    // Check of email al bestaat
    const existingUser = queryOne("SELECT id FROM users WHERE email=?", [d.email])
    if (existingUser) return res.status(400).json({ ok: false, error: "Dit e-mailadres is al geregistreerd. Probeer in te loggen." })
    const existingReq = queryOne("SELECT id,status FROM contact_requests WHERE email=? AND type='b2b_aanmelding'", [d.email])
    if (existingReq) {
      if (existingReq.status === 'nieuw' || existingReq.status === 'in_behandeling') return res.status(400).json({ ok: false, error: "Uw aanmelding is al ontvangen en wordt beoordeeld." })
    }
    run("INSERT INTO contact_requests (naam,bedrijf,email,telefoon,kvk,type,status,bericht) VALUES (?,?,?,?,?,?,?,?)",
      [d.naam||'', d.bedrijf, d.email, d.telefoon, d.kvk||'', 'b2b_aanmelding', 'nieuw',
       `Aanmelding via website\nNaam: ${d.naam||'-'}\nBedrijf: ${d.bedrijf}\nKvK: ${d.kvk||'-'}\nTelefoon: ${d.telefoon}\nEmail: ${d.email}`])
    writeLog("server.log", `B2B AANMELDING: ${d.bedrijf} (${d.email}) — wacht op goedkeuring`)
    // Email notificatie naar admin
    try {
      stmts.addEmailQueue.run({ to_email: 'info@transfer4cars.com', subject: 'Nieuwe B2B aanmelding: ' + d.bedrijf, body: 'Nieuwe dealer aanmelding!\nBedrijf: ' + d.bedrijf + '\nNaam: ' + (d.naam||'-') + '\nKvK: ' + (d.kvk||'-') + '\nTelefoon: ' + d.telefoon + '\nEmail: ' + d.email, type: 'admin_alert' })
    } catch(e) { console.error('Email queue error:', e.message) }
    res.json({ ok: true, message: "Aanmelding ontvangen! Wij beoordelen uw aanvraag en nemen binnen 24 uur contact op." })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Koper self-registration (Transfer4Cars buyers)
router.post("/api/register/koper", express.json(), (req, res) => {
  try {
    const d = req.body
    if (!d.username || !d.password || !d.email) return res.status(400).json({ ok: false, error: "Gebruikersnaam, wachtwoord en e-mail vereist" })
    if (d.password.length < 6) return res.status(400).json({ ok: false, error: "Wachtwoord minimaal 6 tekens" })
    const existing = queryOne("SELECT id FROM users WHERE username=? OR email=?", [d.username, d.email])
    if (existing) return res.status(400).json({ ok: false, error: "Gebruikersnaam of e-mail al in gebruik" })
    const bcrypt = require("bcryptjs")
    const hash = bcrypt.hashSync(d.password, 10)
    run("INSERT INTO users (username,password,name,role,email,phone,active) VALUES (?,?,?,?,?,?,?)",
      [d.username, hash, d.naam || d.username, 'koper', d.email, d.telefoon || '', 1])
    const user = queryOne("SELECT id,username,name,role,email FROM users WHERE username=?", [d.username])
    const token = jwt.sign({ sub: user.username, name: user.name, role: user.role, userId: user.id }, getSecret(), { expiresIn: "7d" })
    writeLog("server.log", `KOPER GEREGISTREERD: ${user.username} (${user.email})`)
    // Queue welkomstmail
    stmts.addEmailQueue.run({ to_email: d.email, subject: "Welkom bij Transfer4Cars!", body: `Hallo ${d.naam || d.username},\n\nJe account is aangemaakt! Je kunt nu bieden op veilingen.\n\nLog in op: ${req.headers.origin || 'https://transfer4cars.com'}/verkoop/veilingen/\n\nTeam Transfer4Cars`, type: 'welkom' })
    res.json({ ok: true, token, user: { id: user.id, username: user.username, name: user.name, role: user.role, email: user.email } })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Update user profile (self)

// Profiel
router.put("/api/profiel", authMiddleware, express.json(), (req, res) => {
  try {
    const d = req.body
    const sets = [], vals = []
    if (d.naam) { sets.push("name=?"); vals.push(d.naam) }
    if (d.email) { sets.push("email=?"); vals.push(d.email) }
    if (d.telefoon !== undefined) { sets.push("phone=?"); vals.push(d.telefoon) }
    if (d.bedrijf !== undefined) { sets.push("company=?"); vals.push(d.bedrijf) }
    if (!sets.length) return res.status(400).json({ ok: false, error: "Niets om bij te werken" })
    vals.push(req.userId)
    run("UPDATE users SET " + sets.join(",") + " WHERE id=?", vals)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Get full user profile
router.get("/api/profiel", authMiddleware, (req, res) => {
  try {
    const user = queryOne("SELECT id,username,name,role,email,phone,created_at FROM users WHERE id=?", [req.userId])
    if (!user) return res.status(404).json({ ok: false, error: "Gebruiker niet gevonden" })
    res.json({ ok: true, user })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Admin: preview as role (returns token for preview)
/* ═══════════════════════════════════════════════
   MISSING ENDPOINTS (v9.6 additions)
   ═══════════════════════════════════════════════ */

// ── Voorraad: authenticated full list (all statuses) ──

// Settings
router.get("/api/settings", authMiddleware, (req, res) => {
  try {
    const rows = queryAll("SELECT key, value FROM settings")
    const settings = {}
    for (const r of rows) settings[r.key] = r.value
    res.json({ ok: true, settings })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.put("/api/settings", authMiddleware, (req, res) => {
  try {
    const entries = req.body
    for (const [key, value] of Object.entries(entries)) {
      if (key === "jwt_secret") continue // Don't allow changing JWT secret via API
      stmts.setSetting.run(key, String(value))
    }
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Change own password ──
router.post("/api/me/password", authMiddleware, (req, res) => {
  try {
    const { current_password, new_password } = req.body
    if (!new_password || new_password.length < 6) return res.status(400).json({ ok: false, error: "Wachtwoord moet minimaal 6 tekens zijn" })
    // Verify current password
    const user = verifyUser(req.user.sub, current_password)
    if (!user) return res.status(400).json({ ok: false, error: "Huidig wachtwoord onjuist" })
    const bcrypt = require("bcryptjs")
    const hash = bcrypt.hashSync(new_password, 10)
    stmts.changePassword.run(req.user.sub, hash)
    res.json({ ok: true, message: "Wachtwoord gewijzigd" })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── All inspecties (for desktop overview) ──

// ── All inspecties (for desktop overview) ──

// Export
router.get("/api/export/csv", authMiddleware, staffOnly, (req, res) => {
  try {
    const cars = stmts.getVoorraad.all()
    const header = "Kenteken;Merk;Model;Variant;Bouwjaar;Brandstof;KM;Kleur;PK;Vraagprijs;APK_tot\n"
    const rows = cars.map(c => `${c.kenteken};${c.make};${c.model};${c.model_variant||""};${c.year};${c.fuel};${c.km};${c.color||""};${c.power_hp||""};${c.vraag_prijs};${c.apk_until||""}`).join("\n")
    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", "attachment; filename=t4c-voorraad.csv")
    res.send(header + rows)
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/export/marktplaats", authMiddleware, staffOnly, (req, res) => {
  try {
    const cars = stmts.getVoorraad.all()
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<vehicles>\n'
    for (const c of cars) {
      const photos = stmts.getVoorraadPhotos.all(c.id)
      xml += `  <vehicle><kenteken>${c.kenteken}</kenteken><make>${c.make}</make><model>${c.model}</model><year>${c.year}</year><fuel>${c.fuel}</fuel><mileage>${c.km}</mileage><price>${c.vraag_prijs}</price><transmission>${c.transmission||""}</transmission><description><![CDATA[${c.beschrijving||""}]]></description><photos>${photos.map(p=>`<photo>/photos/${p.filename}</photo>`).join("")}</photos></vehicle>\n`
    }
    xml += '</vehicles>'
    res.setHeader("Content-Type", "application/xml")
    res.setHeader("Content-Disposition", "attachment; filename=t4c-marktplaats.xml")
    res.send(xml)
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


/* ═══════════════════════════════════════════════
   VERKOOPTEKST GENERATOR
   ═══════════════════════════════════════════════ */
router.post("/api/verkooptekst", authMiddleware, staffOnly, express.json(), async (req, res) => {
  try {
    const d = req.body
    const { make, model, year, km, fuel, power, transmission, color, body: bodyType, apk, catalogPrice, vraagprijs, extra, style,
      engineLabel, subModel, trimLevel, interior, ownerCount, drivetrain,
      heatedSeats, towbar, camera, naviType, roofType, parkingSensors, audioSystem
    } = d
    const prijsTxt = vraagprijs ? "\u20ac" + Number(vraagprijs).toLocaleString("nl-NL") : "Prijs op aanvraag"
    const kmTxt = km ? Number(km).toLocaleString("nl-NL") + " km" : ""
    const pwTxt = power ? power + " pk" : ""
    const title = (make + " " + model).trim()
    const s = (style || "professioneel").toLowerCase()

    // KORT: template
    if (s === "kort") {
      const specLine = [year, kmTxt, fuel, pwTxt, transmission, color].filter(Boolean).join(" \u2022 ")
      return res.json({ ok: true, text: title + " | " + specLine + " | " + prijsTxt + (extra ? " | " + extra : "") + " \u2014 Transfer4Cars" })
    }
    
    // MARKTPLAATS: template met meer data
    if (s === "marktplaats") {
      const equipList = [
        heatedSeats ? "\u2713 Stoelverwarming" : null, towbar ? "\u2713 Trekhaak" : null,
        camera ? "\u2713 Camera" : null, naviType ? "\u2713 Navigatie (" + naviType + ")" : null,
        roofType ? "\u2713 " + roofType : null, parkingSensors ? "\u2713 Parkeersensoren" : null,
        audioSystem ? "\u2713 " + audioSystem : null
      ].filter(Boolean).join("\n")
      const text = title + "\n\n--- SPECIFICATIES ---\nBouwjaar: " + (year||"\u2014") +
        "\nKilometerstand: " + (kmTxt||"\u2014") + "\nBrandstof: " + (fuel||"\u2014") +
        "\nVermogen: " + (pwTxt||"\u2014") + "\nTransmissie: " + (transmission||"\u2014") +
        "\nKleur: " + (color||"\u2014") +
        (engineLabel ? "\nMotor: " + engineLabel : "") +
        (trimLevel ? "\nUitvoering: " + trimLevel : "") +
        (apk ? "\nAPK tot: " + apk : "") +
        (equipList ? "\n\n--- UITRUSTING ---\n" + equipList : "") +
        "\n\n--- PRIJS ---\n" + prijsTxt +
        (extra ? "\n\n--- EXTRA ---\n" + extra : "") +
        "\n\n--- CONTACT ---\nTransfer4Cars\nLocatie: Ter Aar\nTelefoon: 06 87 99 71 68"
      return res.json({ ok: true, text })
    }

    // PROFESSIONEEL & WERVEND: AI-generated
    const { callGPT } = require("../lib/ai")
    const context = [
      "Auto: " + title + (subModel ? " " + subModel : "") + (trimLevel ? " " + trimLevel : ""),
      year ? "Bouwjaar: " + year : null, kmTxt ? "KM: " + kmTxt : null,
      fuel ? "Brandstof: " + fuel : null, pwTxt ? "Vermogen: " + pwTxt : null,
      engineLabel ? "Motor: " + engineLabel : null, transmission ? "Transmissie: " + transmission : null,
      drivetrain ? "Aandrijving: " + drivetrain : null, color ? "Kleur: " + color : null,
      bodyType ? "Carrosserie: " + bodyType : null, apk ? "APK tot: " + apk : null,
      catalogPrice ? "Nieuwprijs: \u20ac" + Number(catalogPrice).toLocaleString("nl-NL") : null,
      ownerCount ? "Eigenaren: " + ownerCount : null, interior ? "Interieur: " + interior : null,
      heatedSeats ? "Stoelverwarming: ja" : null, towbar ? "Trekhaak: ja" : null,
      camera ? "Camera: " + camera : null, naviType ? "Navigatie: " + naviType : null,
      roofType ? "Dak: " + roofType : null, parkingSensors ? "Parkeersensoren: " + parkingSensors : null,
      audioSystem ? "Audio: " + audioSystem : null,
      extra ? "Extra van dealer: " + extra : null, vraagprijs ? "Vraagprijs: " + prijsTxt : null
    ].filter(Boolean).join("\n")

    const sysPrompt = s === "professioneel"
      ? "Je bent een professionele autoadvertentie schrijver voor Transfer4Cars in Ter Aar, Nederland. Schrijf een professionele verkooptekst in het Nederlands. Begin met de autonaam als titel. Schrijf 2-3 alinea\'s. Benoem specifieke opties als die er zijn. Eindig met: Transfer4Cars \u2014 Ter Aar \u2014 06 87 99 71 68. Max 300 woorden. Geen emoji\'s."
      : "Je bent een enthousiaste advertentieschrijver voor Transfer4Cars in Ter Aar. Schrijf een wervende verkooptekst met emoji\'s. Maak het enthousiast maar geloofwaardig. Benoem USP\'s en specifieke opties als highlights. Eindig met: \ud83d\udcde Transfer4Cars \u2014 Ter Aar \u2014 06 87 99 71 68. Max 250 woorden."

    const text = await callGPT(sysPrompt, context, { temperature: 0.7, model: "gpt-4o-mini" })
    res.json({ ok: true, text, ai: true })
  } catch(e) {
    // Fallback
    const d = req.body
    const title = ((d.make||"") + " " + (d.model||"")).trim()
    const text = title + "\n\n" + [d.year, d.km ? d.km + " km" : "", d.fuel].filter(Boolean).join(" \u2022 ") +
      "\n\nPrijs: " + (d.vraagprijs ? "\u20ac" + d.vraagprijs : "n.o.t.k.") +
      "\n\nTransfer4Cars \u2014 Ter Aar \u2014 06 87 99 71 68"
    res.json({ ok: true, text, ai: false })
  }
})

/* ═══════════════════════════════════════════════
   VEILING SYSTEEM — Transfer4Cars Auctions
   ═══════════════════════════════════════════════ */

// Veiling checker — activeer geplande veilingen + sluit verlopen af

// Contact requests
router.get("/api/contact-requests", authMiddleware, adminOnly, (req, res) => {
  try {
    const rows = stmts.getContactRequests.all()
    res.json({ ok: true, rows, count: rows.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.put("/api/contact-requests/:id", authMiddleware, adminOnly, (req, res) => {
  try {
    stmts.updateContactStatus.run(parseInt(req.params.id), req.body.status || "gelezen")
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// B2B aanmelding goedkeuren → maakt account aan
router.post("/api/contact-requests/:id/approve", authMiddleware, adminOnly, express.json(), (req, res) => {
  try {
    const cr = queryOne("SELECT * FROM contact_requests WHERE id=?", [parseInt(req.params.id)])
    if (!cr) return res.status(404).json({ ok: false, error: "Aanmelding niet gevonden" })
    if (!cr.email) return res.status(400).json({ ok: false, error: "Geen e-mail in aanmelding" })
    // Check of account al bestaat
    const existing = queryOne("SELECT id FROM users WHERE email=?", [cr.email])
    if (existing) return res.status(400).json({ ok: false, error: "Account bestaat al voor dit e-mailadres" })
    // Genereer username en wachtwoord
    const username = cr.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "dealer" + Date.now()
    const password = req.body.password || Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 4).toUpperCase()
    const role = req.body.role || "dealer"
    const bcrypt = require("bcryptjs")
    const hash = bcrypt.hashSync(password, 10)
    run("INSERT INTO users (username,password,name,role,email,phone,company,active) VALUES (?,?,?,?,?,?,?,?)",
      [username, hash, cr.naam || cr.bedrijf || username, role, cr.email, cr.telefoon || '', cr.bedrijf || '', 1])
    // Update contact request
    stmts.updateContactStatus.run(parseInt(req.params.id), "goedgekeurd")
    writeLog("server.log", `B2B GOEDGEKEURD: ${cr.bedrijf || cr.naam} (${cr.email}) → account: ${username} / rol: ${role} door ${req.user.sub}`)
    res.json({ ok: true, account: { username, password, email: cr.email, role, bedrijf: cr.bedrijf } })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.delete("/api/contact-requests/:id", authMiddleware, adminOnly, (req, res) => {
  try {
    stmts.deleteContactRequest.run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Settings ──

// Search history
router.post("/api/search-history", authMiddleware, async (req, res) => {
  try {
    const { plate, make, model, year } = req.body
    if (!plate) return res.status(400).json({ error: "No plate" })
    const clean = plate.toUpperCase().replace(/[-\s]/g, "")
    run("INSERT OR IGNORE INTO search_history (kenteken, make, model, year, searched_at, user_id) VALUES (?,?,?,?,?,?) ON CONFLICT(kenteken) DO UPDATE SET searched_at=excluded.searched_at, search_count=search_count+1",
      clean, make||"", model||"", year||0, Date.now(), req.user?.uid||null
    )
    res.json({ ok: true })
  } catch(e) { res.json({ ok: true }) }
})



// ── Dealer feedback: verkocht/niet verkocht ──
router.post("/api/taxatie/feedback", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const { queryOne, run } = require("../db")

    // Update taxatie
    if (d.taxatie_id) {
      run("UPDATE taxaties SET sold_price=?, sold_date=?, days_to_sell=?, dealer_feedback=?, updated_at=datetime(\'now\') WHERE id=?",
        [d.sold_price || null, d.sold_date || null, d.days_to_sell || null, d.feedback || null, d.taxatie_id])
    }

    // Save to dealer_feedback table
    run(`INSERT INTO dealer_feedback (taxatie_id, kenteken, make, model, year, our_bod, gpt_price, sold_price, days_on_lot, accuracy_pct, feedback_type, notes, user_id, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [d.taxatie_id || null, d.kenteken || "", d.make || "", d.model || "", d.year || 0,
       d.our_bod || null, d.gpt_price || null, d.sold_price || null, d.days_on_lot || null,
       d.sold_price && d.our_bod ? Math.round((1 - Math.abs(d.sold_price - d.our_bod) / d.our_bod) * 100) : null,
       d.feedback_type || "sold", d.notes || "", req.user?.userId || null])

    // Log to accuracy_log if we have prices to compare
    if (d.sold_price && d.our_bod) {
      const ourErr = Math.round(Math.abs(d.sold_price - d.our_bod) / d.sold_price * 100)
      const gptErr = d.gpt_price ? Math.round(Math.abs(d.sold_price - d.gpt_price) / d.sold_price * 100) : null
      const winner = gptErr !== null ? (ourErr <= gptErr ? "ons" : "gpt") : "ons"
      run("INSERT INTO accuracy_log (taxatie_id, our_price, gpt_price, actual_price, our_error_pct, gpt_error_pct, winner, created_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))",
        [d.taxatie_id, d.our_bod, d.gpt_price || null, d.sold_price, ourErr, gptErr, winner])
    }

    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Accuracy dashboard ──
router.get("/api/accuracy", authMiddleware, adminOnly, (req, res) => {
  try {
    const { queryAll, queryOne } = require("../db")
    const logs = queryAll("SELECT * FROM accuracy_log ORDER BY created_at DESC LIMIT 100")
    const stats = queryOne("SELECT COUNT(*) as total, AVG(our_error_pct) as avg_our_error, AVG(gpt_error_pct) as avg_gpt_error, SUM(CASE WHEN winner=\'ons\' THEN 1 ELSE 0 END) as ons_wins, SUM(CASE WHEN winner=\'gpt\' THEN 1 ELSE 0 END) as gpt_wins FROM accuracy_log")
    res.json({ ok: true, logs, stats })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


module.exports = router
