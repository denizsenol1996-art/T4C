// server.js — T4C Platform v2 (clean modular architecture)
// All routes in routes/, all shared logic in lib/
try { require("dotenv").config() } catch(e) { /* dotenv optional */ }

const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const { initDB, stmts, getJwtSecret, verifyUser, getStats, backup, DATA_DIR, queryAll, queryOne, run } = require("./db")

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

// Localhost fallbacks
app.use("/verkoop", express.static(T4C_SALES_DIR, { extensions: ["html"] }))
app.use(express.static(CARDATAX_DIR, { extensions: ["html"] }))
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
    try { const { setupDVWebhookRoutes } = require("./dv-webhook"); setupDVWebhookRoutes(app, { run, queryAll, queryOne, scheduleSave: () => {} }); console.log("[DV] Webhook mounted OK") } catch(e) { console.log("[DV] Not loaded:", e.message) }

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
      setInterval(() => { backgroundCrawl().catch(e => console.error('[CRAWLER] Timer error:', e.message)) }, 4 * 60 * 60 * 1000)
      setTimeout(() => { console.log('[CRAWLER] First run starting...'); backgroundCrawl().then(() => console.log('[CRAWLER] First run done')).catch(e => console.error('[CRAWLER] First run error:', e.message)) }, 60000)
    } else {
      console.log("[CRAWLER] backgroundCrawl not available from market module")
    }

    // Email queue processor
    try {
      const { processEmailQueue } = require("./lib/mailer")
      setInterval(() => { try { processEmailQueue() } catch(e) {} }, 60000)
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
