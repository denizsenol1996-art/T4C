// server.js — T4C Platform v2 (clean modular architecture)
// All routes in routes/, all shared logic in lib/
try { require("dotenv").config() } catch(e) { /* dotenv optional */ }

const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const fs = require("fs")
const path = require("path")
const { initDB, stmts, getJwtSecret, verifyUser, getStats, backup, DATA_DIR, queryAll, queryOne, run, forceSave } = require("./db")

// ── Shared modules (EXISTING — do NOT duplicate) ──
const { VERSION, _serverStats, writeLog, LOG_DIR } = require("./lib/state")
const auth = require("./lib/auth")
const { hasApiKey } = require("./lib/ai")

const app = express()
// Cloudflared/nginx loopt voor ons — vertrouw X-Forwarded-For zodat req.ip de echte client-IP is.
// Cruciaal voor login rate-limit (anders is iedereen "127.0.0.1" en lockt 1 brute-forcer iedereen).
app.set("trust proxy", "loopback")
app.disable("x-powered-by") // 2026-06-03 cleanup — hide Express signature

// Security headers (helmet). CSP staat UIT tot we de inline-scripts/styles auditen
// — anders breken marketing-pages. HSTS + X-Frame + X-Content-Type-Options
// + Referrer-Policy zijn safe defaults. 2026-06-10 SEC-2.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}))

// CORS: alleen eigen domeinen + same-origin/server-to-server (geen Origin-header).
// Cross-origin van vreemde sites = geblokkeerd. 2026-06-10 SEC-2.
const ALLOWED_ORIGINS = new Set([
  "https://transfer4cars.com",
  "https://www.transfer4cars.com",
  "https://cardatax.com",
  "https://www.cardatax.com",
])
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true)
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true)
    // Vreemde origin: geen CORS-header zetten — browser blokkeert dan zelf.
    // Geen Error gooien, anders krijgen we 500's in de logs op elke probe.
    cb(null, false)
  },
  credentials: true,
}))

// CSRF-equivalent: Origin/Referer-check op state-changing methodes (2026-06-11 SEC-6).
// Browsers sturen Origin verplicht op cross-origin POST/PUT/DELETE/PATCH. Als de header
// er IS maar niet in ALLOWED_ORIGINS staat = third-party site → 403. Server-side calls
// (curl/mobile-app/health-check) hebben geen Origin én geen Referer = OK. Dit dekt het
// gat dat klassieke CSRF-tokens zouden dichten, maar past beter bij ons JWT-Bearer
// auth-model (geen auth-cookies = klassieke CSRF al grotendeels geneutraliseerd).
app.use((req, res, next) => {
  const m = req.method.toUpperCase()
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next()
  const origin = req.headers.origin
  const referer = req.headers.referer || req.headers.referrer
  if (!origin && !referer) return next() // server-side caller
  if (origin && ALLOWED_ORIGINS.has(origin)) return next()
  if (referer) {
    try {
      const u = new URL(referer)
      if (ALLOWED_ORIGINS.has(u.origin)) return next()
    } catch {}
  }
  return res.status(403).json({ ok: false, error: "Origin niet toegestaan" })
})
app.use((req, res, next) => {
  // Route-level parser handles /api/extended-taxatie with 50mb limit
  if (req.path === '/api/extended-taxatie') return next();
  return express.json({ limit: '10mb' })(req, res, next);
})
const PORT = process.env.PORT || 3000

// ══════════════════════════════════════════════
// PROCESS ERROR HANDLERS
// ══════════════════════════════════════════════
const CRASH_DIR = process.env.T4C_LOG_DIR || path.join(__dirname, "..", "logs")
if (!fs.existsSync(CRASH_DIR)) fs.mkdirSync(CRASH_DIR, { recursive: true })

// ══════════════════════════════════════════════
// SINGLE-INSTANCE LOCK FILE (15 mei 2026 — DB race prevention)
// ══════════════════════════════════════════════
// Voorkomt tweede t4c-server instance. Bij race tussen twee processen
// die dezelfde DATA_DIR delen flikkert /opt/t4c/data/t4c.db tussen
// in-memory states (zie incident 15 mei 2026 — t4c-test).
const LOCK_PATH = path.join(__dirname, "..", "data", ".t4c-server.lock")
function releaseLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return
    const pid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10)
    if (pid === process.pid) fs.unlinkSync(LOCK_PATH)
  } catch(e) {}
}
;(function acquireLockOrDie() {
  if (fs.existsSync(LOCK_PATH)) {
    let existingPid = 0
    try { existingPid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim(), 10) } catch {}
    if (existingPid && existingPid !== process.pid) {
      let alive = false
      try { process.kill(existingPid, 0); alive = true } catch {}
      // 2026-06-11: extra check tegen PID-recycling. Een levende PID die niet ONZE
      // server.js is = stale lock (bv. apt-daemon krijgt na crash recycled PID toegewezen).
      let isOurServer = false
      if (alive) {
        try {
          const cmdline = fs.readFileSync(`/proc/${existingPid}/cmdline`, 'utf8')
          // cmdline is null-separated; zoek naar server.js in het pad
          isOurServer = cmdline.includes("server.js") && cmdline.includes("node")
        } catch { isOurServer = false }
      }
      if (alive && isOurServer) {
        const msg = `[LOCK] FATAL: t4c-server al actief als PID ${existingPid} (lock: ${LOCK_PATH}). Refuse tweede instance — voorkomt DB race condition.`
        console.error(msg)
        try { writeLog("errors.log", msg) } catch {}
        try { fs.writeFileSync(path.join(CRASH_DIR, "CRASH.txt"), `${new Date().toISOString()}\n${msg}\n`) } catch {}
        process.exit(1)
      } else if (alive && !isOurServer) {
        console.warn(`[LOCK] Stale lock (PID ${existingPid} bestaat maar is geen t4c-server, vermoedelijk PID-recycling) — overschrijven`)
      } else {
        console.warn(`[LOCK] Stale lock (PID ${existingPid} bestaat niet) — overschrijven`)
      }
    }
  }
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid))
    console.log(`[LOCK] Acquired ${LOCK_PATH} for PID ${process.pid}`)
  } catch(e) {
    console.error(`[LOCK] Cannot write lock file: ${e.message} — refuse to start`)
    process.exit(1)
  }
})()
process.on("exit", releaseLock)

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

// Graceful shutdown: PM2/systemd sturen SIGTERM bij stop/restart. Default node-exit zou de DB
// niet opslaan en de sql.js in-memory state verliezen. We forceSave + release lock + exit clean.
// Voorkomt ook zombies bij `pm2 restart` (kill_timeout default 1.6s was te kort).
let _shuttingDown = false
function gracefulShutdown(signal) {
  if (_shuttingDown) return
  _shuttingDown = true
  console.log(`[SHUTDOWN] ${signal} ontvangen — saving DB + release lock`)
  try { forceSave() } catch(e) { console.error("[SHUTDOWN] forceSave error:", e.message) }
  try { releaseLock() } catch(e) { console.error("[SHUTDOWN] releaseLock error:", e.message) }
  console.log("[SHUTDOWN] klaar, exit(0)")
  process.exit(0)
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
process.on("SIGINT", () => gracefulShutdown("SIGINT"))

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

// ── Login rate-limit: voorkomt brute-force op accounts.
// 5 mislukte pogingen per IP in 15 min → 15 min lockout. Successful login = reset.
const _loginAttempts = new Map() // IP → { fails, firstFailAt, lockedUntil }
const RL_WINDOW_MS = 15 * 60 * 1000
const RL_MAX_FAILS = 5
function loginRateCheck(ip) {
  const now = Date.now()
  const rec = _loginAttempts.get(ip)
  if (rec?.lockedUntil && rec.lockedUntil > now) {
    return { ok: false, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) }
  }
  if (rec && now - rec.firstFailAt > RL_WINDOW_MS) _loginAttempts.delete(ip)
  return { ok: true }
}
function loginRecordFail(ip) {
  const now = Date.now()
  const rec = _loginAttempts.get(ip) || { fails: 0, firstFailAt: now, lockedUntil: 0 }
  rec.fails += 1
  if (rec.fails === 1) rec.firstFailAt = now
  if (rec.fails >= RL_MAX_FAILS) rec.lockedUntil = now + RL_WINDOW_MS
  _loginAttempts.set(ip, rec)
}
function loginRecordSuccess(ip) { _loginAttempts.delete(ip) }
// Cleanup stale entries elke 5 min
setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of _loginAttempts) {
    if (rec.lockedUntil < now && now - rec.firstFailAt > RL_WINDOW_MS) _loginAttempts.delete(ip)
  }
}, 5 * 60 * 1000).unref?.()

// ── Login & auth check ──
const { logAudit } = require("./lib/audit")
app.post("/api/login", (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || "unknown"
    const gate = loginRateCheck(ip)
    if (!gate.ok) {
      res.set("Retry-After", String(gate.retryAfter))
      logAudit({ action: "login_blocked", details: { reason: "rate_limit", username: req.body?.username || null }, req })
      return res.status(429).json({ ok: false, error: `Te veel pogingen — probeer over ${Math.ceil(gate.retryAfter/60)} min opnieuw` })
    }
    const { username, password } = req.body || {}
    // 2026-06-11 LOGIN-500-FIX: voorkom 500 bij missende body/fields
    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Gebruikersnaam en wachtwoord vereist" })
    }
    const user = verifyUser(username, password)
    if (!user) {
      loginRecordFail(ip)
      logAudit({ action: "login_failed", details: { username }, req })
      return res.status(401).json({ ok: false, error: "Onjuiste inloggegevens" })
    }
    loginRecordSuccess(ip)
    try { run("UPDATE users SET last_login=datetime('now') WHERE username=?", [user.username]) } catch {}
    const fullUser = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [user.username])
    const secret = auth.getSecret()
    const jwt = require("jsonwebtoken")
    const token = jwt.sign({ sub: user.username, role: user.role, name: user.name, userId: fullUser?.id || user.id }, secret, { expiresIn: "7d" })
    logAudit({ userId: fullUser?.id || user.id, action: "login_success", details: { role: user.role }, req })
    res.json({ ok: true, token, user: { id: fullUser?.id, username: user.username, name: user.name, role: user.role, email: fullUser?.email || '' }, name: user.name, role: user.role, userId: fullUser?.id, email: fullUser?.email || '' })
  } catch(e) {
    // Defensive: nooit 500 lekken naar de buitenwereld
    try { writeLog("errors.log", "[LOGIN-500] " + e.message + " | body: " + JSON.stringify(req.body || {}).substring(0,200)) } catch {}
    res.status(500).json({ ok: false, error: "Interne fout — probeer opnieuw" })
  }
})

app.get("/api/me", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "No token" })
  if (auth.isRevoked(token)) return res.status(401).json({ error: "Token revoked" })
  try {
    const jwt = require("jsonwebtoken")
    const decoded = jwt.verify(token, auth.getSecret())
    const user = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [decoded.sub])
    res.json({ ok: true, username: decoded.sub, name: decoded.name, role: decoded.role, userId: user?.id || decoded.userId, email: user?.email || '', phone: user?.phone || '' })
  } catch { res.status(401).json({ error: "Invalid token" }) }
})

// Logout: revoke huidige JWT server-side + audit-log. Frontend clear localStorage parallel.
app.post("/api/logout", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ ok: false, error: "Niet ingelogd" })
  let userId = null
  try { userId = require("jsonwebtoken").verify(token, auth.getSecret()).userId || null } catch {}
  auth.revokeToken(token)
  if (userId) logAudit({ userId, action: "logout", req })
  res.json({ ok: true })
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

// /admin/atx/ route PERMANENT VERWIJDERD 2026-06-11


// /admin/klassiek/ — T4C Command Center (cardatax admin dashboard)
app.use("/admin/klassiek", express.static(path.join(__dirname, "..", "sites", "cardatax", "admin"), {
  extensions: ["html"],
  setHeaders: (res, p) => {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive")
    if (p.endsWith(".html")) res.set("Cache-Control", "no-store")
  }
}))

app.use("/admin", (req, res, next) => {
  // Cardatax-admin mount: skip voor transfer4cars-host (die heeft eigen /admin/).
  const host = (req.hostname || "").toLowerCase()
  if (host.includes("transfer4cars")) return next()
  return express.static(path.join(__dirname, "..", "sites", "cardatax", "admin"), {
    extensions: ["html"],
    setHeaders: (res, p) => {
      res.set("X-Robots-Tag", "noindex, nofollow, noarchive")
      if (p.endsWith(".html")) res.set("Cache-Control", "no-store")
    }
  })(req, res, next)
})

// SEO routes (sitemap + robots) — alleen voor T4C-domain. Moet vóór de catch-all
// fallback zodat de transfer4cars-mount /sitemap.xml en /robots.txt niet hapt.
app.use((req, res, next) => {
  if (req.site !== "transfer4cars") return next()
  if (req.path === "/sitemap.xml" || req.path === "/robots.txt") return require("./routes/seo")(req, res, next)
  next()
})

// Transfer4Cars domain — whitelist-only static + fallback (2026-06-03 cleanup)
const T4C_PUBLIC_PATHS = new Set([
  "", "/", "/aanbod", "/aanbod/", "/auto", "/auto/", "/veilingen", "/veilingen/",
  "/over-ons", "/diensten", "/transport", "/contact",
  "/privacy", "/voorwaarden", "/dealer-worden",
  "/sitemap.xml", "/robots.txt", "/pand.jpg", "/logo-cardatax.png"
])
app.use((req, res, next) => {
  if (req.site !== "transfer4cars") return next()
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos") || req.path.startsWith("/app") || req.path.startsWith("/lyra-ai") || req.path.startsWith("/m/") || req.path.startsWith("/telex-inkoop") || req.path.startsWith("/admin/inbound") || req.path.startsWith("/admin/koppelingen") || req.path === "/health" || /^\/(inbound|inbound-detail|inbound-render)\.(js|css)$/.test(req.path) || req.path === "/admin.css" || req.path === "/admin.js" || req.path === "/admin/admin.css" || req.path === "/admin/admin.js") return next()
  // Try static serve first (handles /aanbod/, /auto/, /veilingen/, assets)
  express.static(T4C_SALES_DIR, { extensions: ["html"] })(req, res, () => {
    // Static miss → whitelist fallback to homepage, else 404
    const segments = req.path.split("/").filter(Boolean)
    const top = "/" + (segments[0] || "")
    if (T4C_PUBLIC_PATHS.has(top) || T4C_PUBLIC_PATHS.has(req.path)) {
      if (!req.path.includes(".")) return res.sendFile(path.join(T4C_SALES_DIR, "index.html"))
    }
    // 404 — geen wildcard 200 meer
    const fourOhFour = path.join(T4C_SALES_DIR, "404.html")
    if (fs.existsSync(fourOhFour)) return res.status(404).sendFile(fourOhFour)
    res.status(404).type("text/html").send("<!doctype html><html lang=\"nl\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex\"><title>404 — Niet gevonden | Transfer4Cars</title></head><body style=\"font-family:system-ui,sans-serif;background:#060a0f;color:#a8b8cc;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center\"><div><h1 style=\"font-size:64px;color:#4ade80;margin:0\">404</h1><p>Pagina niet gevonden</p><p><a href=\"/\" style=\"color:#4ade80\">← terug naar Transfer4Cars</a></p></div></body></html>")
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
// Localhost fallbacks (/verkoop schrapt — was duplicate mirror van T4C-domain, duplicate-content voor Google)
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
app.use(require("./routes/extended-taxatie"))

// Markt
app.use(require("./routes/market"))

// AI chat
app.use(require("./routes/ai-chat"))

// Leer-lus (grondwaarheid-koppeling + accuratesse-meting, additief, localhost-gated)
app.use(require("./routes/groundtruth"))

// Externe API (key-beveiligd) voor eigen koppelingen — /api/v1/taxatie
app.use(require("./routes/external-api"))

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

    // ═══ Lyra Server proxy — toegevoegd voor v1.1 ═══
    async function lyraProxy(req, res) {
      try {
        const url = `http://127.0.0.1:3100${req.originalUrl}`
        const headers = { ...req.headers }
        delete headers.host
        delete headers['content-length']

        const fetchOpts = { method: req.method, headers }
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
          fetchOpts.body = JSON.stringify(req.body)
          headers['content-type'] = 'application/json'
        }

        const lyraResp = await fetch(url, fetchOpts)

        res.status(lyraResp.status)
        lyraResp.headers.forEach((v, k) => {
          if (!['content-encoding','transfer-encoding','connection'].includes(k.toLowerCase())) {
            res.setHeader(k, v)
          }
        })

        const buf = Buffer.from(await lyraResp.arrayBuffer())
        res.send(buf)
      } catch (e) {
        console.error('[Lyra Proxy] Error:', e.message)
        res.status(502).json({ ok: false, error: 'Lyra niet bereikbaar' })
      }
    }

    app.use('/api/lyra', express.json({ limit: '500kb' }), lyraProxy)
    app.use('/lyra-ai', lyraProxy)
    // ═══ einde Lyra proxy ═══

    // ═══ ATX-pipeline proxy (telex-inkoop portaal) ═══
    async function atxProxy(req, res) {
      try {
        const url = `http://127.0.0.1:3110${req.originalUrl}`
        const headers = { ...req.headers }
        delete headers.host
        delete headers['content-length']

        const fetchOpts = { method: req.method, headers }
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
          fetchOpts.body = JSON.stringify(req.body)
          headers['content-type'] = 'application/json'
        }

        const atxResp = await fetch(url, fetchOpts)
        res.status(atxResp.status)
        atxResp.headers.forEach((v, k) => {
          if (!['content-encoding','transfer-encoding','connection'].includes(k.toLowerCase())) {
            res.setHeader(k, v)
          }
        })
        const buf = Buffer.from(await atxResp.arrayBuffer())
        res.send(buf)
      } catch (e) {
        console.error('[ATX Proxy] Error:', e.message)
        res.status(502).json({ ok: false, error: 'atx-pipeline niet bereikbaar' })
      }
    }

    // PATCH 10 (2026-05-25): authMiddleware op API-routes voor security.
    // HTML+CSS+JS routes blijven open — atx-pipeline JS doet client-side
    // localStorage.t4c_token check + redirect naar /login. API-routes vereisen
    // Bearer-token. /api/scraper/photos blijft open (foto-URLs zijn opaque +
    // <img> kan geen Authorization-header sturen — TODO pre-signed URLs).
    const { authMiddleware } = require('./lib/auth')

    // ATX API routes — proxy naar atx-admin (3110)
    // Geen authMiddleware op admin-panel routes (pagina is al achter /admin/ login)
    app.use('/api/accounts', express.json(), atxProxy)
    app.use('/api/watcher', atxProxy)
    app.use('/api/scraper/photos', atxProxy)  // foto's publiek (opaque URLs)
    app.use('/api/inbound', atxProxy)  // veiling-prep + inbound API
    app.use('/api/scraper', atxProxy)
    app.use('/api/taxatie', atxProxy)
    app.use('/api/ga4', atxProxy)
    app.get('/api/health', atxProxy)
    app.use('/api/markt', atxProxy)
    // Koppelingen-pagina (Autotelex credentials) — eigen route
    app.get('/admin/koppelingen', (req, res) => {
      req.url = '/admin/'
      req.originalUrl = '/admin/'
      atxProxy(req, res)
    })
    app.get('/admin/koppelingen/*', (req, res) => {
      req.url = req.url.replace('/admin/koppelingen', '/admin')
      req.originalUrl = req.originalUrl.replace('/admin/koppelingen', '/admin')
      atxProxy(req, res)
    })
    // /health voor koppelingen-pagina status indicator
    app.get('/health', atxProxy)

    // HTML routes — geen server-side auth (skeleton bevat geen data)
    app.get('/telex-inkoop', (req, res, next) => {
      req.url = '/admin/inbound'
      req.originalUrl = '/admin/inbound'
      atxProxy(req, res)
    })
    app.get('/telex-inkoop/:id', (req, res, next) => {
      req.url = '/admin/inbound/' + req.params.id
      req.originalUrl = '/admin/inbound/' + req.params.id
      atxProxy(req, res)
    })

    // API routes — authMiddleware vereist (data-exposure)
    app.use("/admin/inbound", atxProxy)
    app.use('/api/inbound', authMiddleware, express.json({ limit: '5mb' }), atxProxy)

    // Static CSS/JS — geen data, geen auth nodig
    app.use('/inbound.css', atxProxy)
    app.use('/inbound.js', atxProxy)
    app.use('/inbound-detail.css', atxProxy)
    app.use('/inbound-detail.js', atxProxy)
    app.use('/inbound-render.js', atxProxy)
    app.use('/admin.css', atxProxy)
    app.use('/admin.js', atxProxy)
    // Relatieve paden vanuit /admin/koppelingen resolven naar /admin/admin.css etc
    app.get('/admin/admin.css', (req, res) => { req.url = '/admin.css'; req.originalUrl = '/admin.css'; atxProxy(req, res) })
    app.get('/admin/admin.js', (req, res) => { req.url = '/admin.js'; req.originalUrl = '/admin.js'; atxProxy(req, res) })
    // ═══ einde ATX-pipeline proxy ═══

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

    // Email queue processor — elke 60s
    try {
      const { processEmailQueue } = require("./lib/mailer")
      setInterval(() => { try { processEmailQueue() } catch(e) {} }, 60000)
    } catch(e) {}

    // ── Daily scrapers: ILSA + Autohero (1× per 24u rond 03:00, random 0-60min spread) ──
    let _dailyRunning = false
    const runDailyScrapers = async () => {
      if (_dailyRunning) { console.log('[DAILY] Skipped — vorige run nog bezig'); return }
      _dailyRunning = true
      try {
        console.log('[DAILY] Starting ILSA scraper...')
        const axios = require('axios')
        const crypto = require('crypto')

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

        // Autohero scraper verwijderd v10.20.7 — search-tile JSON-LD bevatte
        // geen year/km, alle 776 rows hadden year=0/km=0 = 0% bruikbaar voor
        // pricing (valuation.js filtert `year BETWEEN` weg). Detail-page
        // scraping zou rijke data opleveren maar is een aparte sprint.

        // Marker: vandaag is gerund (voor skip-recovery bij PM2 restart)
        try {
          const today = new Date().toISOString().slice(0, 10)
          run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('last_daily_scraper_run', ?, datetime('now'))", [today])
        } catch(e) { console.error('[DAILY] Marker write failed:', e.message) }

        forceSave()
      } catch(e) { console.error('[DAILY] Fatal:', e.message) }
      finally { _dailyRunning = false }
    }

    // Schedule dagelijks om ~3:00 's nachts (random offset 0-60 min)
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

    // Skip-recovery: na 03:00 starten zonder run vandaag? Inhalen.
    try {
      const lastRun = queryOne("SELECT value FROM settings WHERE key='last_daily_scraper_run'")
      const today = new Date().toISOString().slice(0, 10)
      const nowHour = new Date().getHours()
      if (nowHour >= 3 && (!lastRun || lastRun.value !== today)) {
        console.log('[DAILY] Inhalen — run vandaag nog niet gehad (last:', lastRun?.value || 'nooit', ')')
        setTimeout(runDailyScrapers, 5000)
      }
    } catch(e) { console.error('[DAILY] Skip-recovery check failed:', e.message) }

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
