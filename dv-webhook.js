/**
 * DV.nl / Hexon Eigen Website Webhook Handler
 * =============================================
 * Receives incremental XML POST mutations from DV.nl/UCC
 * Actions: add, change, delete
 * 
 * Security:
 * - Basic Auth verification
 * - Rate limiting (max 100 requests/minute)
 * - Request logging with IP tracking
 * - XML size limit (10MB)
 * - Input sanitization
 * 
 * Schema: Hexon Voorraad v2.25
 */

const { XMLParser } = require("fast-xml-parser")
const crypto = require("crypto")

// ═══════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════
const DV_USERNAME = process.env.DV_WEBHOOK_USER || "transfer4"
const DV_PASSWORD = process.env.DV_WEBHOOK_PASS || "c5eLtlGy!"
const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB
const RATE_LIMIT_WINDOW = 60 * 1000     // 1 minute
const RATE_LIMIT_MAX = 100              // max requests per window

// Rate limiter store
const rateLimiter = new Map()

// XML Parser config
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => {
    // These elements can appear multiple times
    return [
      "voertuig", "afbeelding", "accessoire", "panorama", "video",
      "document", "contactpersoon", "beschadiging", "defect_onderdeel",
      "onderhoud", "leasevoorstel", "garantie", "pakket", "as",
      "overlay", "call-to-action", "prijs", "prijzen", "element",
      "afleverpakket", "garantielabel", "bandensoort",
      "toepassingsmateriaal", "toepassingsgebied", "toepassingsschaal"
    ].includes(name)
  }
})

// ═══════════════════════════════════════════════════
// SECURITY MIDDLEWARE
// ═══════════════════════════════════════════════════

function verifyBasicAuth(req) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith("Basic ")) return false
  
  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8")
  const [user, pass] = decoded.split(":")
  
  // Timing-safe comparison to prevent timing attacks
  const userMatch = crypto.timingSafeEqual(
    Buffer.from(user || ""),
    Buffer.from(DV_USERNAME)
  )
  const passMatch = crypto.timingSafeEqual(
    Buffer.from(pass || ""),
    Buffer.from(DV_PASSWORD)
  )
  
  return userMatch && passMatch
}

function checkRateLimit(ip) {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW
  
  // Clean old entries
  for (const [key, data] of rateLimiter) {
    if (data.windowStart < windowStart) rateLimiter.delete(key)
  }
  
  const entry = rateLimiter.get(ip)
  if (!entry) {
    rateLimiter.set(ip, { count: 1, windowStart: now })
    return true
  }
  
  if (entry.windowStart < windowStart) {
    entry.count = 1
    entry.windowStart = now
    return true
  }
  
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

function getClientIP(req) {
  return req.headers["cf-connecting-ip"] 
    || req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket?.remoteAddress 
    || "unknown"
}

// ═══════════════════════════════════════════════════
// XML PARSING & DATA EXTRACTION
// ═══════════════════════════════════════════════════

function parseVehicleXML(xmlBody) {
  const parsed = xmlParser.parse(xmlBody)
  
  // Handle both single vehicle and batch (voorraad > voertuig[])
  let vehicles = []
  
  if (parsed.voertuig) {
    // Single vehicle (incremental)
    vehicles = Array.isArray(parsed.voertuig) ? parsed.voertuig : [parsed.voertuig]
  } else if (parsed.voorraad?.voertuig) {
    // Batch (voorraad wrapper)
    vehicles = Array.isArray(parsed.voorraad.voertuig) ? parsed.voorraad.voertuig : [parsed.voorraad.voertuig]
  }
  
  return vehicles
}

function extractVehicleData(v) {
  // Extract action from attribute
  const actie = v["@_actie"] || "add"
  
  // Extract price (NL market, incl BTW preferred)
  let prijs = null
  let prijs_type = ""
  try {
    const pp = v.verkoopprijs_particulier
    if (pp?.prijzen) {
      const nlPrijzen = Array.isArray(pp.prijzen) 
        ? pp.prijzen.find(p => p["@_land"] === "nl") || pp.prijzen[0]
        : pp.prijzen
      if (nlPrijzen?.prijs) {
        const prijsList = Array.isArray(nlPrijzen.prijs) ? nlPrijzen.prijs : [nlPrijzen.prijs]
        const inclBtw = prijsList.find(p => p.btw === "in") || prijsList[0]
        if (inclBtw) {
          prijs = parseFloat(inclBtw.bedrag) || null
          prijs_type = inclBtw.btw || ""
        }
      }
    }
  } catch (e) { /* price parsing failed, continue */ }
  
  // Extract action price
  let actieprijs = null
  try {
    const ap = v.actieprijs
    if (ap?.prijzen) {
      const nlPrijzen = Array.isArray(ap.prijzen)
        ? ap.prijzen.find(p => p["@_land"] === "nl") || ap.prijzen[0]
        : ap.prijzen
      if (nlPrijzen?.prijs) {
        const prijsList = Array.isArray(nlPrijzen.prijs) ? nlPrijzen.prijs : [nlPrijzen.prijs]
        const inclBtw = prijsList.find(p => p.btw === "in") || prijsList[0]
        if (inclBtw) actieprijs = parseFloat(inclBtw.bedrag) || null
      }
    }
  } catch (e) { /* action price parsing failed */ }
  
  // Extract tellerstand (km)
  let km = null
  let km_eenheid = "K"
  try {
    if (v.tellerstand) {
      km = parseInt(v.tellerstand["#text"] || v.tellerstand) || null
      km_eenheid = v.tellerstand["@_eenheid"] || "K"
    }
  } catch (e) { /* km parsing failed */ }
  
  // Extract vermogen
  let vermogen_pk = parseInt(v.vermogen_motor_pk) || null
  let vermogen_kw = parseInt(v.vermogen_motor_kw) || null
  
  // Extract images
  let afbeeldingen = []
  try {
    if (v.afbeeldingen?.afbeelding) {
      const imgs = Array.isArray(v.afbeeldingen.afbeelding) 
        ? v.afbeeldingen.afbeelding 
        : [v.afbeeldingen.afbeelding]
      afbeeldingen = imgs.map(img => ({
        nr: parseInt(img["@_nr"]) || 0,
        url: img.url || "",
        bestandsnaam: img.bestandsnaam || "",
        omschrijving: img.omschrijving || "",
        overlay: img.overlay || ""
      })).filter(img => img.url)
    }
  } catch (e) { /* image parsing failed */ }
  
  // Extract accessories (Dutch)
  let accessoires_list = []
  try {
    if (v.accessoires?.accessoire) {
      const accs = Array.isArray(v.accessoires.accessoire) 
        ? v.accessoires.accessoire 
        : [v.accessoires.accessoire]
      accessoires_list = accs.map(a => a.naam || a).filter(Boolean)
    }
  } catch (e) { /* accessoire parsing failed */ }
  
  // Extract search accessories
  let zoekaccessoires_list = []
  try {
    if (v.zoekaccessoires?.accessoire) {
      const za = Array.isArray(v.zoekaccessoires.accessoire)
        ? v.zoekaccessoires.accessoire
        : [v.zoekaccessoires.accessoire]
      zoekaccessoires_list = za.filter(Boolean)
    }
  } catch (e) { /* zoekaccessoire parsing failed */ }
  
  // Extract APK
  let apk_tot = ""
  let apk_bij_aflevering = "n"
  try {
    if (v.apk) {
      apk_tot = v.apk["@_tot"] || ""
      apk_bij_aflevering = v.apk["@_bij_aflevering"] || "n"
    }
  } catch (e) { /* apk parsing failed */ }
  
  // Extract contact persons
  let contactpersonen = []
  try {
    if (v.contactpersonen?.contactpersoon) {
      const cp = Array.isArray(v.contactpersonen.contactpersoon)
        ? v.contactpersonen.contactpersoon
        : [v.contactpersonen.contactpersoon]
      contactpersonen = cp.map(c => ({
        id: c.id || 0,
        voornaam: c.voornaam || "",
        achternaam: c.achternaam || "",
        email: c.email || "",
        telefoon: c.telefoonnummer || "",
        mobiel: c.mobielenummer || ""
      }))
    }
  } catch (e) { /* contact parsing failed */ }
  
  // Extract damage info
  let schade_status = ""
  let schade_opmerkingen = ""
  try {
    if (v.schade) {
      schade_status = v.schade.status || ""
      schade_opmerkingen = v.schade.opmerkingen_nederlands || ""
    }
  } catch (e) { /* schade parsing failed */ }

  // Extract nieuwprijs
  let nieuwprijs = null
  try {
    if (v.nieuwprijs?.prijs) {
      const np = Array.isArray(v.nieuwprijs.prijs) ? v.nieuwprijs.prijs[0] : v.nieuwprijs.prijs
      nieuwprijs = parseFloat(np.bedrag) || null
    }
  } catch (e) { /* nieuwprijs parsing failed */ }

  // Extract BPM
  let bpm = null
  let rest_bpm = null
  try {
    if (v.bpm_bedrag?.prijs) {
      const bp = Array.isArray(v.bpm_bedrag.prijs) ? v.bpm_bedrag.prijs[0] : v.bpm_bedrag.prijs
      bpm = parseFloat(bp.bedrag) || null
    }
    if (v.rest_bpm_bedrag?.prijs) {
      const rbp = Array.isArray(v.rest_bpm_bedrag.prijs) ? v.rest_bpm_bedrag.prijs[0] : v.rest_bpm_bedrag.prijs
      rest_bpm = parseFloat(rbp.bedrag) || null
    }
  } catch (e) { /* bpm parsing failed */ }

  return {
    actie,
    hexon_id: String(v.voertuignr_hexon || v.hexon_id || ""),
    voertuignr: String(v.voertuignr || ""),
    klantnummer: String(v.klantnummer || ""),
    kenteken: String(v.kenteken || "").toUpperCase().replace(/[-\s]/g, ""),
    merk: String(v.merk || ""),
    model: String(v.model || ""),
    type: String(v.type || ""),
    uitrustingsniveau: String(v.uitrustingsniveau || ""),
    voertuigsoort: String(v.voertuigsoort || "AUTO"),
    carrosserie: String(v.carrosserie || ""),
    bouwjaar: parseInt(v.bouwjaar) || null,
    modeljaar: parseInt(v.modeljaar) || null,
    km,
    km_eenheid,
    brandstof: String(v.brandstof || ""),
    transmissie: String(v.transmissie || ""),
    aantal_versnellingen: parseInt(v.aantal_versnellingen) || null,
    btw_marge: String(v.btw_marge || ""),
    basiskleur: String(v.basiskleur || ""),
    kleur: String(v.kleur_nederlands || ""),
    laksoort: String(v.laksoort || ""),
    laktint: String(v.laktint || ""),
    bekleding: String(v.bekleding || ""),
    basisinterieurkleur: String(v.basisinterieurkleur || ""),
    aantal_deuren: parseInt(v.aantal_deuren) || null,
    aantal_zitplaatsen: parseInt(v.aantal_zitplaatsen) || null,
    vermogen_pk,
    vermogen_kw,
    cilinder_inhoud: parseInt(v.cilinder_inhoud) || null,
    cilinder_aantal: parseInt(v.cilinder_aantal) || null,
    massa: parseInt(v.massa) || null,
    max_trekgewicht: parseInt(v.max_trekgewicht) || null,
    topsnelheid: parseInt(v.topsnelheid) || null,
    acceleratie: parseFloat(v.acceleratie) || null,
    verbruik: parseFloat(v.gemiddeld_verbruik || v.wltp_brandstofverbruik_combined) || null,
    co2_uitstoot: parseFloat(v.co2_uitstoot || v.wltp_co2_uitstoot_combined) || null,
    emissieklasse: String(v.emissieklasse || ""),
    energielabel: String(v.energielabel || ""),
    vin: String(v.vin || ""),
    prijs,
    prijs_type,
    actieprijs,
    nieuwprijs,
    bpm,
    rest_bpm,
    prijstype: String(v.prijstype || ""),
    apk_tot,
    apk_bij_aflevering,
    schadevoertuig: String(v.schadevoertuig || "n"),
    schade_status,
    schade_opmerkingen,
    nieuw_voertuig: String(v.nieuw_voertuig || "n"),
    verkocht: String(v.verkocht || "n"),
    verwacht: String(v.verwacht || "n"),
    gereserveerd: String(v.gereserveerd || "n"),
    nap_weblabel: String(v.nap_weblabel || "n"),
    onderhoudsboekjes: String(v.onderhoudsboekjes || ""),
    aantal_eigenaren: parseInt(v.aantal_eigenaren) || null,
    aantal_sleutels: parseInt(v.aantal_sleutels) || null,
    opmerkingen: String(v.opmerkingen || ""),
    titel: String(v.titel || ""),
    highlights: String(v.highlights || ""),
    locatie: String(v.locatie_voertuig || ""),
    // EV specific
    type_hybride: String(v.type_hybride || ""),
    plugin_hybride: String(v.plugin_hybride || "n"),
    actieradius_elektrisch: parseInt(v.actieradius_elektrisch || v.wltp_actieradius_elektrisch_combined) || null,
    accu_laadvermogen: String(v.accu_laadvermogen?.["#text"] || v.accu_laadvermogen || ""),
    stekkeraansluiting: String(v.stekkeraansluiting || ""),
    stekkeraansluiting_snellader: String(v.stekkeraansluiting_snellader || ""),
    // Dates
    constructiedatum: String(v.constructiedatum || ""),
    datum_deel_1: String(v.datum_deel_1 || ""),
    datum_binnenkomst: String(v.datum_binnenkomst || ""),
    // Arrays (stored as JSON)
    afbeeldingen: JSON.stringify(afbeeldingen),
    accessoires: JSON.stringify(accessoires_list),
    zoekaccessoires: JSON.stringify(zoekaccessoires_list),
    contactpersonen: JSON.stringify(contactpersonen),
    // Raw XML backup (for debugging/future use)
    raw_xml: "" // Don't store raw XML to save space, set to xmlBody if needed
  }
}

// ═══════════════════════════════════════════════════
// DATABASE OPERATIONS
// ═══════════════════════════════════════════════════

function setupDVTables(runFn) {
  runFn(`CREATE TABLE IF NOT EXISTS dv_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hexon_id TEXT NOT NULL UNIQUE,
    voertuignr TEXT,
    klantnummer TEXT,
    kenteken TEXT,
    merk TEXT,
    model TEXT,
    type TEXT,
    uitrustingsniveau TEXT,
    voertuigsoort TEXT DEFAULT 'AUTO',
    carrosserie TEXT,
    bouwjaar INTEGER,
    modeljaar INTEGER,
    km INTEGER,
    km_eenheid TEXT DEFAULT 'K',
    brandstof TEXT,
    transmissie TEXT,
    aantal_versnellingen INTEGER,
    btw_marge TEXT,
    basiskleur TEXT,
    kleur TEXT,
    laksoort TEXT,
    laktint TEXT,
    bekleding TEXT,
    basisinterieurkleur TEXT,
    aantal_deuren INTEGER,
    aantal_zitplaatsen INTEGER,
    vermogen_pk INTEGER,
    vermogen_kw INTEGER,
    cilinder_inhoud INTEGER,
    cilinder_aantal INTEGER,
    massa INTEGER,
    max_trekgewicht INTEGER,
    topsnelheid INTEGER,
    acceleratie REAL,
    verbruik REAL,
    co2_uitstoot REAL,
    emissieklasse TEXT,
    energielabel TEXT,
    vin TEXT,
    prijs REAL,
    prijs_type TEXT,
    actieprijs REAL,
    nieuwprijs REAL,
    bpm REAL,
    rest_bpm REAL,
    prijstype TEXT,
    apk_tot TEXT,
    apk_bij_aflevering TEXT DEFAULT 'n',
    schadevoertuig TEXT DEFAULT 'n',
    schade_status TEXT,
    schade_opmerkingen TEXT,
    nieuw_voertuig TEXT DEFAULT 'n',
    verkocht TEXT DEFAULT 'n',
    verwacht TEXT DEFAULT 'n',
    gereserveerd TEXT DEFAULT 'n',
    nap_weblabel TEXT DEFAULT 'n',
    onderhoudsboekjes TEXT,
    aantal_eigenaren INTEGER,
    aantal_sleutels INTEGER,
    opmerkingen TEXT,
    titel TEXT,
    highlights TEXT,
    locatie TEXT,
    type_hybride TEXT,
    plugin_hybride TEXT DEFAULT 'n',
    actieradius_elektrisch INTEGER,
    accu_laadvermogen TEXT,
    stekkeraansluiting TEXT,
    stekkeraansluiting_snellader TEXT,
    constructiedatum TEXT,
    datum_deel_1 TEXT,
    datum_binnenkomst TEXT,
    afbeeldingen TEXT,
    accessoires TEXT,
    zoekaccessoires TEXT,
    contactpersonen TEXT,
    raw_xml TEXT,
    status TEXT DEFAULT 'active',
    dv_actie TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  runFn(`CREATE TABLE IF NOT EXISTS dv_webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    method TEXT,
    action TEXT,
    hexon_id TEXT,
    status_code INTEGER,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  // Indexes for fast lookups
  runFn("CREATE INDEX IF NOT EXISTS idx_dv_hexon ON dv_vehicles(hexon_id)")
  runFn("CREATE INDEX IF NOT EXISTS idx_dv_kenteken ON dv_vehicles(kenteken)")
  runFn("CREATE INDEX IF NOT EXISTS idx_dv_status ON dv_vehicles(status)")
  runFn("CREATE INDEX IF NOT EXISTS idx_dv_merk_model ON dv_vehicles(merk, model)")
  runFn("CREATE INDEX IF NOT EXISTS idx_dv_log_created ON dv_webhook_log(created_at)")
}

function upsertVehicle(runFn, queryOneFn, data) {
  const existing = queryOneFn(
    "SELECT id FROM dv_vehicles WHERE hexon_id = ?", [data.hexon_id]
  )
  
  if (existing) {
    // UPDATE
    const fields = Object.keys(data).filter(k => k !== "actie" && k !== "hexon_id" && k !== "raw_xml")
    const sets = fields.map(f => `${f} = ?`).join(", ")
    const vals = fields.map(f => data[f])
    runFn(
      `UPDATE dv_vehicles SET ${sets}, status = 'active', dv_actie = ?, updated_at = datetime('now') WHERE hexon_id = ?`,
      [...vals, data.actie, data.hexon_id]
    )
    return "updated"
  } else {
    // INSERT
    const fields = Object.keys(data).filter(k => k !== "actie")
    const placeholders = fields.map(() => "?").join(",")
    const vals = fields.map(f => data[f])
    runFn(
      `INSERT INTO dv_vehicles (${fields.join(",")}, status, dv_actie) VALUES (${placeholders}, 'active', ?)`,
      [...vals, data.actie]
    )
    return "inserted"
  }
}

function deleteVehicle(runFn, hexonId) {
  // Soft delete - mark as deleted, don't remove
  runFn(
    "UPDATE dv_vehicles SET status = 'deleted', dv_actie = 'delete', updated_at = datetime('now') WHERE hexon_id = ?",
    [hexonId]
  )
}

function logWebhook(runFn, ip, method, action, hexonId, statusCode, message) {
  try {
    runFn(
      "INSERT INTO dv_webhook_log (ip, method, action, hexon_id, status_code, message) VALUES (?,?,?,?,?,?)",
      [ip, method, action, hexonId, statusCode, message]
    )
  } catch (e) {
    console.error("[DV-WEBHOOK] Log error:", e.message)
  }
}

// ═══════════════════════════════════════════════════
// EXPRESS ROUTE SETUP
// ═══════════════════════════════════════════════════

function setupDVWebhookRoutes(app, { run: runFn, queryAll: queryAllFn, queryOne: queryOneFn, scheduleSave }) {
  // Create tables on startup
  setupDVTables(runFn)
  console.log("[DV-WEBHOOK] Tables initialized")

  // ─── Raw body parser for XML ───
  const express = require("express")

  // ─── WEBHOOK ENDPOINT ───
  app.post("/api/dv/webhook", 
    express.raw({ type: ["text/xml", "application/xml", "text/plain", "*/*"], limit: "10mb" }),
    (req, res) => {
      const ip = getClientIP(req)
      const startTime = Date.now()
      
      // Rate limit check
      if (!checkRateLimit(ip)) {
        logWebhook(runFn, ip, "POST", "rate_limited", "", 429, "Rate limit exceeded")
        return res.status(429).json({ error: "Too many requests" })
      }
      
      // Auth check
      if (!verifyBasicAuth(req)) {
        logWebhook(runFn, ip, "POST", "auth_failed", "", 401, "Invalid credentials")
        console.warn(`[DV-WEBHOOK] Auth failed from ${ip}`)
        return res.status(401).json({ error: "Unauthorized" })
      }
      
      try {
        // Parse XML body
        const xmlBody = req.body instanceof Buffer ? req.body.toString("utf8") : String(req.body || "")
        
        if (!xmlBody || xmlBody.length < 10) {
          logWebhook(runFn, ip, "POST", "empty_body", "", 400, "Empty or invalid body")
          return res.status(400).json({ error: "Empty body" })
        }
        
        // Parse vehicles from XML
        const vehicles = parseVehicleXML(xmlBody)
        
        if (vehicles.length === 0) {
          logWebhook(runFn, ip, "POST", "no_vehicles", "", 400, "No vehicles found in XML")
          return res.status(400).json({ error: "No vehicles found" })
        }
        
        const results = []
        
        for (const vehicle of vehicles) {
          try {
            const data = extractVehicleData(vehicle)
            const actie = data.actie
            
            if (actie === "delete") {
              deleteVehicle(runFn, data.hexon_id)
              results.push({ hexon_id: data.hexon_id, action: "deleted" })
              logWebhook(runFn, ip, "POST", "delete", data.hexon_id, 200, "Vehicle deleted")
              console.log(`[DV-WEBHOOK] DELETE ${data.hexon_id} (${data.merk} ${data.model})`)
            } else {
              // add or change
              const result = upsertVehicle(runFn, queryOneFn, data)
              results.push({ hexon_id: data.hexon_id, action: result, kenteken: data.kenteken })
              logWebhook(runFn, ip, "POST", actie, data.hexon_id, 200, `Vehicle ${result}`)
              const imgCount = JSON.parse(data.afbeeldingen || "[]").length
              console.log(`[DV-WEBHOOK] ${actie.toUpperCase()} ${data.hexon_id}: ${data.merk} ${data.model} ${data.type} (${data.kenteken}) — €${data.prijs || "?"} — ${imgCount} foto's`)
            }
          } catch (vErr) {
            const hexId = vehicle.voertuignr_hexon || vehicle.hexon_id || "unknown"
            results.push({ hexon_id: hexId, action: "error", message: vErr.message })
            logWebhook(runFn, ip, "POST", "error", hexId, 500, vErr.message)
            console.error(`[DV-WEBHOOK] Error processing vehicle ${hexId}:`, vErr.message)
          }
        }
        
        // Save database after mutations
        if (scheduleSave) scheduleSave()
        
        const elapsed = Date.now() - startTime
        console.log(`[DV-WEBHOOK] Processed ${results.length} vehicle(s) in ${elapsed}ms from ${ip}`)
        
        return res.status(200).json({ 
          success: true, 
          processed: results.length,
          results,
          elapsed_ms: elapsed
        })
        
      } catch (parseErr) {
        logWebhook(runFn, ip, "POST", "parse_error", "", 500, parseErr.message)
        console.error(`[DV-WEBHOOK] Parse error from ${ip}:`, parseErr.message)
        return res.status(500).json({ error: "XML parse error", message: parseErr.message })
      }
    }
  )

  // ─── STATUS ENDPOINT (for DV.nl health check) ───
  app.get("/api/dv/webhook", (req, res) => {
    res.status(200).json({ 
      status: "ok", 
      service: "Transfer4Cars DV.nl Webhook",
      version: "2.25",
      timestamp: new Date().toISOString()
    })
  })

  // ─── ADMIN: Get all active vehicles ───
  app.get("/api/dv/vehicles", (req, res) => {
    // Check JWT auth from existing middleware (or basic auth)
    if (!verifyBasicAuth(req) && !req.user) {
      return res.status(401).json({ error: "Unauthorized" })
    }
    
    const status = req.query.status || "active"
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0
    
    const vehicles = queryAllFn(
      "SELECT * FROM dv_vehicles WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?",
      [status, limit, offset]
    )
    const total = queryOneFn("SELECT COUNT(*) as count FROM dv_vehicles WHERE status = ?", [status])
    
    res.json({ vehicles, total: total?.count || 0, limit, offset })
  })

  // ─── ADMIN: Get single vehicle by hexon_id ───
  app.get("/api/dv/vehicles/:hexonId", (req, res) => {
    if (!verifyBasicAuth(req) && !req.user) {
      return res.status(401).json({ error: "Unauthorized" })
    }
    
    const vehicle = queryOneFn(
      "SELECT * FROM dv_vehicles WHERE hexon_id = ?", [req.params.hexonId]
    )
    if (!vehicle) return res.status(404).json({ error: "Vehicle not found" })
    res.json(vehicle)
  })

  // ─── ADMIN: Get webhook logs ───
  app.get("/api/dv/logs", (req, res) => {
    if (!verifyBasicAuth(req) && !req.user) {
      return res.status(401).json({ error: "Unauthorized" })
    }
    
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const logs = queryAllFn(
      "SELECT * FROM dv_webhook_log ORDER BY created_at DESC LIMIT ?", [limit]
    )
    res.json({ logs })
  })

  // ─── PUBLIC: Active vehicles for website (no auth needed) ───
  app.get("/api/voorraad", (req, res) => {
    const { merk, model, brandstof, transmissie, min_prijs, max_prijs, min_jaar, max_jaar, sort, limit: lim, offset: off } = req.query
    
    let where = ["status = 'active'", "verkocht = 'n'"]
    let params = []
    
    if (merk) { where.push("merk = ?"); params.push(merk) }
    if (model) { where.push("model = ?"); params.push(model) }
    if (brandstof) { where.push("brandstof = ?"); params.push(brandstof) }
    if (transmissie) { where.push("transmissie = ?"); params.push(transmissie) }
    if (min_prijs) { where.push("prijs >= ?"); params.push(parseFloat(min_prijs)) }
    if (max_prijs) { where.push("prijs <= ?"); params.push(parseFloat(max_prijs)) }
    if (min_jaar) { where.push("bouwjaar >= ?"); params.push(parseInt(min_jaar)) }
    if (max_jaar) { where.push("bouwjaar <= ?"); params.push(parseInt(max_jaar)) }
    
    const orderBy = {
      "prijs_asc": "prijs ASC",
      "prijs_desc": "prijs DESC",
      "km_asc": "km ASC",
      "bouwjaar_desc": "bouwjaar DESC",
      "nieuwste": "updated_at DESC"
    }[sort] || "updated_at DESC"
    
    const limit = Math.min(parseInt(lim) || 50, 100)
    const offset = parseInt(off) || 0
    
    const sql = `SELECT hexon_id, kenteken, merk, model, type, uitrustingsniveau, voertuigsoort, carrosserie,
      bouwjaar, km, brandstof, transmissie, basiskleur, kleur, vermogen_pk, 
      prijs, actieprijs, prijstype, btw_marge, afbeeldingen, titel, highlights,
      verkocht, verwacht, gereserveerd, nieuw_voertuig, energielabel, apk_tot
      FROM dv_vehicles WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    
    const vehicles = queryAllFn(sql, [...params, limit, offset])
    const total = queryOneFn(
      `SELECT COUNT(*) as count FROM dv_vehicles WHERE ${where.join(" AND ")}`, params
    )
    
    // Parse afbeeldingen JSON for each vehicle
    const parsed = vehicles.map(v => ({
      ...v,
      afbeeldingen: JSON.parse(v.afbeeldingen || "[]"),
      foto: JSON.parse(v.afbeeldingen || "[]")[0]?.url || null
    }))
    
    res.json({ voorraad: parsed, total: total?.count || 0, limit, offset })
  })

  // ─── PUBLIC: Single vehicle detail ───
  app.get("/api/voorraad/:hexonId", (req, res) => {
    const vehicle = queryOneFn(
      "SELECT * FROM dv_vehicles WHERE hexon_id = ? AND status = 'active'", 
      [req.params.hexonId]
    )
    if (!vehicle) return res.status(404).json({ error: "Voertuig niet gevonden" })
    
    // Parse JSON fields
    vehicle.afbeeldingen = JSON.parse(vehicle.afbeeldingen || "[]")
    vehicle.accessoires = JSON.parse(vehicle.accessoires || "[]")
    vehicle.zoekaccessoires = JSON.parse(vehicle.zoekaccessoires || "[]")
    vehicle.contactpersonen = JSON.parse(vehicle.contactpersonen || "[]")
    
    res.json(vehicle)
  })

  // ─── PUBLIC: Available filter values ───
  app.get("/api/voorraad-filters", (req, res) => {
    const merken = queryAllFn(
      "SELECT DISTINCT merk FROM dv_vehicles WHERE status = 'active' AND verkocht = 'n' AND merk != '' ORDER BY merk"
    )
    const brandstoffen = queryAllFn(
      "SELECT DISTINCT brandstof FROM dv_vehicles WHERE status = 'active' AND verkocht = 'n' AND brandstof != '' ORDER BY brandstof"
    )
    const kleuren = queryAllFn(
      "SELECT DISTINCT basiskleur FROM dv_vehicles WHERE status = 'active' AND verkocht = 'n' AND basiskleur != '' ORDER BY basiskleur"
    )
    const carrosserien = queryAllFn(
      "SELECT DISTINCT carrosserie FROM dv_vehicles WHERE status = 'active' AND verkocht = 'n' AND carrosserie != '' ORDER BY carrosserie"
    )
    const prijsRange = queryOneFn(
      "SELECT MIN(prijs) as min_prijs, MAX(prijs) as max_prijs, MIN(bouwjaar) as min_jaar, MAX(bouwjaar) as max_jaar FROM dv_vehicles WHERE status = 'active' AND verkocht = 'n' AND prijs > 0"
    )
    
    res.json({
      merken: merken.map(m => m.merk),
      brandstoffen: brandstoffen.map(b => b.brandstof),
      kleuren: kleuren.map(k => k.basiskleur),
      carrosserien: carrosserien.map(c => c.carrosserie),
      prijs_range: { min: prijsRange?.min_prijs || 0, max: prijsRange?.max_prijs || 0 },
      jaar_range: { min: prijsRange?.min_jaar || 2000, max: prijsRange?.max_jaar || 2026 }
    })
  })

  console.log("[DV-WEBHOOK] Routes registered:")
  console.log("  POST /api/dv/webhook      — DV.nl XML mutations (Basic Auth)")
  console.log("  GET  /api/dv/webhook       — Health check")
  console.log("  GET  /api/dv/vehicles      — Admin: all vehicles")
  console.log("  GET  /api/dv/vehicles/:id   — Admin: single vehicle")
  console.log("  GET  /api/dv/logs          — Admin: webhook logs")
  console.log("  GET  /api/voorraad         — Public: vehicle listing")
  console.log("  GET  /api/voorraad/:id     — Public: vehicle detail")
  console.log("  GET  /api/voorraad-filters — Public: filter options")
}

module.exports = { setupDVWebhookRoutes, setupDVTables }
