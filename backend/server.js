// server.js — T4C Platform v2 (clean modular architecture)
// All routes in routes/, all shared logic in lib/
try { require("dotenv").config() } catch(e) { /* dotenv optional */ }

const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const { initDB, stmts, getJwtSecret, verifyUser, getStats, backup, DATA_DIR, queryAll, queryOne, run, forceSave } = require("./db")

// ── Shared modules (EXISTING — do NOT duplicate) ──
const { VERSION, _serverStats, writeLog, LOG_DIR } = require("./lib/state")
const auth = require("./lib/auth")
const { hasApiKey } = require("./lib/ai")

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
const PORT = process.env.PORT || 3000

// ══════════════════════════════════════════════
// PROCESS ERROR HANDLERS
// ══════════════════════════════════════════════
const CRASH_DIR = process.env.T4C_LOG_DIR || path.join(__dirname, "..", "logs")
if (!fs.existsSync(CRASH_DIR)) fs.mkdirSync(CRASH_DIR, { recursive: true })

process.on("uncaughtException", (err) => {
  const msg = `[FATAL] Uncaught: ${err.message}\n${err.stack}`
  console.error(msg)
  try { writeLog("errors.log", msg) } catch(e){}
  try { fs.writeFileSync(path.join(CRASH_DIR, "CRASH.txt"), `${new Date().toISOString()}\n${msg}\n`) } catch(e){}
  _serverStats.errorCount = (_serverStats.errorCount || 0) + 1
  _serverStats.lastError = { time: Date.now(), msg: err.message, type: "uncaughtException" }
})
process.on("unhandledRejection", (err) => {
  const msg = `[WARN] Unhandled Rejection: ${err?.message || err}\n${err?.stack || ''}`
  console.error(msg)
  try { writeLog("errors.log", msg) } catch(e){}
  try { fs.writeFileSync(path.join(CRASH_DIR, "CRASH.txt"), `${new Date().toISOString()}\n${msg}\n`) } catch(e){}
  _serverStats.errorCount = (_serverStats.errorCount || 0) + 1
  _serverStats.lastError = { time: Date.now(), msg: err?.message || String(err), type: "unhandledRejection" }
})
process.on("exit", (code) => {
  if (code !== 0) {
    const msg = `[EXIT] Process exit with code ${code} at ${new Date().toISOString()}`
    console.error(msg)
    try { fs.appendFileSync(path.join(CRASH_DIR, "CRASH.txt"), msg + "\n") } catch(e){}
  }
})

// ── Request logging middleware ──
app.use((req, res, next) => {
  _serverStats.requestCount = (_serverStats.requestCount || 0) + 1
  if (req.path.startsWith("/api/")) {
    const route = req.method + " " + req.path.split("?")[0]
    _serverStats.apiCalls[route] = (_serverStats.apiCalls[route] || 0) + 1
    const start = Date.now()
    res.on("finish", () => {
      const ms = Date.now() - start
      if (res.statusCode >= 400) writeLog("errors.log", `${route} → ${res.statusCode} (${ms}ms)`)
      if (ms > 5000) writeLog("errors.log", `SLOW: ${route} took ${ms}ms`)
    })
  }
  next()
})

// ── Login & auth check ──
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {}
  const user = verifyUser(username, password)
  if (!user) return res.json({ ok: false, error: "Onjuiste inloggegevens" })
  try { run("UPDATE users SET last_login=datetime('now') WHERE username=?", [user.username]) } catch {}
  const fullUser = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [user.username])
  const secret = auth.getSecret()
  const jwt = require("jsonwebtoken")
  const token = jwt.sign({ sub: user.username, role: user.role, name: user.name, userId: fullUser?.id || user.id }, secret, { expiresIn: "7d" })
  res.json({ ok: true, token, user: { id: fullUser?.id, username: user.username, name: user.name, role: user.role, email: fullUser?.email || '' }, name: user.name, role: user.role, userId: fullUser?.id, email: fullUser?.email || '' })
})

app.get("/api/me", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "No token" })
  try {
    const jwt = require("jsonwebtoken")
    const decoded = jwt.verify(token, auth.getSecret())
    const user = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [decoded.sub])
    res.json({ ok: true, username: decoded.sub, name: decoded.name, role: decoded.role, userId: user?.id || decoded.userId, email: user?.email || '', phone: user?.phone || '' })
  } catch { res.status(401).json({ error: "Invalid token" }) }
})

// ══════════════════════════════════════════════
// STATIC FILE ROUTING
// ══════════════════════════════════════════════
const SITES_DIR = path.resolve(__dirname, "..", "sites")
const CARDATAX_DIR = path.join(SITES_DIR, "cardatax")
const T4C_SALES_DIR = path.join(SITES_DIR, "transfer4cars")

// Domain detection
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos")) return next()
  const host = (req.hostname || "").toLowerCase()
  if (host.includes("transfer4cars")) req.site = "transfer4cars"
  else if (host.includes("cardatax")) req.site = "cardatax"
  else req.site = "local"
  next()
})

app.use("/m", express.static(path.join(__dirname, "..", "sites", "cardatax", "m"), { extensions: ["html"], setHeaders: (res,p) => { if(p.endsWith('.html')){res.set('Cache-Control','no-store')} } }))
app.use("/admin", express.static(path.join(__dirname, "..", "sites", "cardatax", "admin"), { extensions: ["html"], setHeaders: (res,p) => { if(p.endsWith('.html')){res.set('Cache-Control','no-store')} } }))

// Transfer4Cars domain
app.use((req, res, next) => {
  if (req.site !== "transfer4cars") return next()
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos") || req.path.startsWith("/admin") || req.path.startsWith("/app")) return next()
  express.static(T4C_SALES_DIR, { extensions: ["html"] })(req, res, () => {
    if (!req.path.includes(".")) res.sendFile(path.join(T4C_SALES_DIR, "index.html"))
    else next()
  })
})

// CardDatax domain
app.use((req, res, next) => {
  if (req.site !== "cardatax") return next()
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos")) return next()
  express.static(CARDATAX_DIR, { extensions: ["html"] })(req, res, next)
})

// /app/ — altijd verse file, nooit cache
app.get('/app/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.set('Surrogate-Control', 'no-store')
  const p = require('path')
  res.sendFile(p.join(__dirname, '..', 'sites', 'cardatax', 'app', 'index.html'))
})
// Localhost fallbacks
app.use("/verkoop", express.static(T4C_SALES_DIR, { extensions: ["html"] }))
app.use(express.static(CARDATAX_DIR, { extensions: ["html"], setHeaders: (res,p) => { if(p.endsWith(".html")){res.set("Cache-Control","no-store, no-cache, must-revalidate")} } }))
app.use("/app", (req, res, next) => {
  if (req.path.match(/\.(js|css|svg|png|jpg|ico|woff|woff2|ttf)$/)) return next()
  next()
})

// ══════════════════════════════════════════════
// ROUTE MODULES
// ══════════════════════════════════════════════

// ── Route modules (gegroepeerd op domein) ──
// Auth & algemeen
app.use(require("./routes/misc"))

// Voertuig & taxatie
app.use(require("./routes/vehicle"))
app.use(require("./routes/valuation"))
app.use(require("./routes/taxatie"))
app.use(require("./routes/images"))
app.use(require("./routes/pdf"))
app.use(require("./routes/intelligence"))

// Voorraad & handel
app.use(require("./routes/voorraad"))
app.use(require("./routes/dealer"))
app.use(require("./routes/scanner"))
app.use(require("./routes/inspectie"))

// Veilingen
app.use(require("./routes/veilingen"))

// Markt
app.use(require("./routes/market"))

// AI chat
app.use(require("./routes/ai-chat"))

// Admin (last — catch-all admin routes)
app.use(require("./routes/admin"))

// Photos static
const PHOTOS_DIR = path.join(DATA_DIR, "photos")
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })
app.use("/photos", express.static(PHOTOS_DIR))

// ── /app/* SPA catch-all ──
app.get("/app/*", (req, res) => {
  const indexPath = path.join(CARDATAX_DIR, "app", "index.html")
  if (fs.existsSync(indexPath)) res.sendFile(indexPath)
  else res.status(404).send("App not built yet.")
})

// ══════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════
;(async () => {
  try {
    await initDB()

    // Set JWT secret from database
    const JWT_SECRET = getJwtSecret()
    auth.setSecret(JWT_SECRET)

    // Mount DV webhook (MUST be BEFORE 404 catch-all)
    try { const { setupDVWebhookRoutes } = require("./dv-webhook"); setupDVWebhookRoutes(app, { run, queryAll, queryOne, scheduleSave: forceSave }); console.log("[DV] Webhook mounted OK") } catch(e) { console.log("[DV] Not loaded:", e.message) }

    // 404 catch-all for API (MUST be AFTER all route mounts)
    app.all("/api/*", (req, res) => { res.status(404).json({ ok: false, error: "Endpoint niet gevonden" }) })

    console.log("[DB] Database ready")

    // Auto-backup every 6 hours
    const safeBackup = () => { try { const r = backup(); if (r && r.catch) r.catch(e => console.error("[BACKUP] Async error:", e.message)) } catch(e) { console.error("[BACKUP] Error:", e.message) } }
    setInterval(safeBackup, 6 * 60 * 60 * 1000)
    setTimeout(safeBackup, 10000)

    // Background crawler — from market routes (every 4 hours)
    let backgroundCrawl = null
    try { backgroundCrawl = require("./routes/market").backgroundCrawl } catch(e) {}
    if (backgroundCrawl) {
      setInterval(() => { backgroundCrawl().catch(e => console.error('[CRAWLER] Timer error:', e.message)) }, 2 * 60 * 1000)  // 2 min interval — max speed — continu data opbouwen
      setTimeout(() => { console.log('[CRAWLER] First run starting...'); backgroundCrawl().then(() => console.log('[CRAWLER] First run done')).catch(e => console.error('[CRAWLER] First run error:', e.message)) }, 60000)
    } else {
      console.log("[CRAWLER] backgroundCrawl not available from market module")
    }

    // Email queue processor
    try {
      const { processEmailQueue } = require("./lib/mailer")
      setInterval(() => { try { processEmailQueue() } catch(e) {}

    // ── Daily scrapers: ILSA + Autohero (elke 24 uur, gespreid) ──
    const runDailyScrapers = async () => {
      try {
        console.log('[DAILY] Starting ILSA scraper...')
        const axios = require('axios')
        const crypto = require('crypto')
        const _srcMap = {'autoofy':'nlmarket','autohero':'nlretail'}
        
        // ILSA (Autoofy) — 7400+ listings
        try {
          const ILSA_URL = 'https://api-nl.ilsa.cloud/crRvy1uXUuuT/searchresults'
          const PAGE = 100
          let offset = 0, ilsaNew = 0, ilsaUpd = 0
          while (true) {
            const { data } = await axios.get(ILSA_URL + '?_fieldset=searchresults&_limit=' + PAGE + '&_offset=' + offset, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0' },
              timeout: 15000
            })
            if (!data.results || !data.results.length) break
            for (const r of data.results) {
              const g = r.general || {}
              const mk = (g.make?.name || '').toLowerCase().trim()
              const ml = (g.model?.name || '').toLowerCase().trim()
              const yr = g.year || 0
              const title = (g.type?.name || (mk + ' ' + ml)).slice(0, 80)
              const priceRaw = r.sales_conditions?.pricing?.asking?.general?.formatted || ''
              const price = parseInt(String(priceRaw).replace(/[^\d]/g, ''), 10) || 0
              const kmRaw = r.condition?.odometer?.formatted || ''
              const km = parseInt(String(kmRaw).replace(/[^\d]/g, ''), 10) || 0
              const trans = r.powertrain?.transmission?.type?.display_value || ''
              const dealer = (r.advertiser?.name || '').slice(0, 60)
              const options = (g.type?.supplement || '').slice(0, 500)
              const fuel = r.powertrain?.engine?.energy?.type?.category?.display_value || r.powertrain?.engine?.energy?.type?.code?.display_value || ''
              if (!mk || !ml || !yr || price < 500 || price > 500000) continue
              if (km < 1000 || km > 500000) continue
              const hash = crypto.createHash('md5').update('nlmarket|' + mk + '|' + ml + '|' + yr + '|' + price + '|' + km + '|' + title.slice(0,30)).digest('hex')
              const ex = queryOne('SELECT id FROM market_listings WHERE hash=?', [hash])
              if (ex) { run("UPDATE market_listings SET price=?, km=?, last_seen=datetime('now'), status='active', dealer=?, options=CASE WHEN ?!='' AND (options IS NULL OR options='') THEN ? ELSE options END, fuel=CASE WHEN ?!='' AND (fuel IS NULL OR fuel='') THEN ? ELSE fuel END WHERE hash=?", [price, km, dealer, options, options, fuel, fuel, hash]); ilsaUpd++ }
              else { run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer,options,fuel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [hash, mk, ml, yr, title, price, km, trans, 'nlmarket', '', dealer, options, fuel]); ilsaNew++ }
            }
            offset += PAGE
            if (offset >= (data.num_results || 0)) break
            await new Promise(r => setTimeout(r, Math.random() * 2000 + 500))
          }
          console.log('[DAILY] ILSA done: ' + ilsaNew + ' new, ' + ilsaUpd + ' updated')
        } catch(e) { console.log('[DAILY] ILSA error:', e.message) }

        // Autohero — 1100+ listings via JSON-LD
        try {
          const cheerio = require('cheerio')
          let ahNew = 0, ahUpd = 0, page = 1
          while (page <= 100) {
            const { data } = await axios.get('https://www.autohero.com/nl/search/?page=' + page, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' },
              timeout: 15000
            })
            const $ = cheerio.load(data)
            let found = 0
            $('script[type="application/ld+json"]').each((_, el) => {
              try {
                const j = JSON.parse($(el).html())
                if (j['@type'] !== 'Product') return
                const brand = (j.brand || '').toLowerCase()
                const name = j.name || ''
                const model = name.replace(new RegExp('^' + (j.brand||''), 'i'), '').trim().toLowerCase()
                const price = j.offers?.[0]?.price || 0
                if (!brand || !model || price < 500) return
                const hash = crypto.createHash('md5').update('nlretail|' + brand + '|' + model + '|' + price + '|' + name.slice(0,30)).digest('hex')
                const ex = queryOne('SELECT id FROM market_listings WHERE hash=?', [hash])
                if (ex) { run("UPDATE market_listings SET price=?, last_seen=datetime('now'), status='active' WHERE hash=?", [price, hash]); ahUpd++ }
                else { run("INSERT INTO market_listings (hash,make,model,year,title,price,km,transmission,source,url,dealer) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [hash, brand, model, 0, name.slice(0,80), price, 0, '', 'nlretail', '', 'Retail']); ahNew++ }
                found++
              } catch {}
            })
            if (found === 0) break
            page++
            await new Promise(r => setTimeout(r, Math.random() * 3000 + 1500))
          }
          console.log('[DAILY] Autohero done: ' + ahNew + ' new, ' + ahUpd + ' updated')
        } catch(e) { console.log('[DAILY] Autohero error:', e.message) }

        forceSave()
      } catch(e) { console.error('[DAILY] Fatal:', e.message) }
    }

    // Run dagelijks om ~3:00 's nachts (random offset 0-60 min)
    const msUntil3AM = () => {
      const now = new Date()
      const target = new Date(now)
      target.setHours(3, Math.floor(Math.random() * 60), 0, 0)
      if (target <= now) target.setDate(target.getDate() + 1)
      return target - now
    }
    setTimeout(() => {
      runDailyScrapers()
      setInterval(runDailyScrapers, 24 * 60 * 60 * 1000)
    }, msUntil3AM())
    console.log('[DAILY] Scrapers scheduled for ~3:00 AM')
 }, 60000)
    } catch(e) {}

    app.listen(PORT, () => {
      const hasAI = hasApiKey("OPENAI_API_KEY")
      console.log(`
  ╔════════════════════════════════════════════════════╗
  ║  T4C Platform v${VERSION}                              ║
  ║  http://localhost:${PORT}                               ║
  ║                                                    ║
  ║  CARDATAX (Taxatie Platform)                       ║
  ║    /app/        Desktop portal (login)             ║
  ║    /m/          Dealer Toolkit (PWA)               ║
  ║    /admin/      Admin Panel                        ║
  ║                                                    ║
  ║  TRANSFER4CARS (Verkoop Site)                      ║
  ║    /verkoop/    Publieke verkoop website            ║
  ║                                                    ║
  ║  AI: ${hasAI ? "GPT ACTIEF ✓" : "Niet geconfigureerd (.env)"}${hasAI ? "                            " : "          "}║
  ║  API: /api/*    Shared backend                     ║
  ║  DB:  ${DATA_DIR}
  ╚════════════════════════════════════════════════════╝
`)
      console.log("[STARTUP] Server fully started on port", PORT)
    })
  } catch(e) {
    console.error("[FATAL] Database init failed:", e)
    process.exit(1)
  }
})()
