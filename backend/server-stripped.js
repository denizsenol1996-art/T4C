// Load environment variables from .env
try { require("dotenv").config() } catch(e) { /* dotenv optional */ }

const express = require("express")
const cors = require("cors")
const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs")
const path = require("path")
const jwt = require("jsonwebtoken")
const { initDB, stmts, getJwtSecret, verifyUser, getStats, backup, DATA_DIR, queryAll, queryOne, run } = require("./db")

const app = express()
app.use(cors({
  origin: function(origin, callback) {
    const allowed = ['https://transfer4cars.com', 'https://cardatax.com', 'http://localhost:3000']
    if (!origin || allowed.some(a => origin.startsWith(a))) callback(null, true)
    else callback(null, true) // Allow all for now, log suspicious
  },
  credentials: true
}))

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')
  next()
})

// Rate limiting — simple in-memory
const _rateLimits = {}
const RATE_WINDOW = 60000 // 1 minute
const RATE_MAX = 120 // requests per minute
app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()
  if (!_rateLimits[ip]) _rateLimits[ip] = { count: 0, start: now }
  if (now - _rateLimits[ip].start > RATE_WINDOW) { _rateLimits[ip] = { count: 0, start: now } }
  _rateLimits[ip].count++
  if (_rateLimits[ip].count > RATE_MAX) return res.status(429).json({ ok: false, error: 'Te veel verzoeken. Probeer het over een minuut opnieuw.' })
  next()
})
// Clean rate limits every 5 min
setInterval(() => { const now = Date.now(); for (const ip in _rateLimits) { if (now - _rateLimits[ip].start > RATE_WINDOW * 2) delete _rateLimits[ip] } }, 300000)
app.use(express.json({ limit: '10mb' }))
const PORT = process.env.PORT || 3000
const VERSION = "10.13.0"
const MIN_PRICE = 500
const TIMEOUT = 6000

// ══════════════════════════════════════════════
// FILE LOGGER — writes errors and requests to logs/
// ══════════════════════════════════════════════
const LOG_DIR = process.env.T4C_LOG_DIR || path.join(__dirname, "..", "logs")
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const _logBuffers = {}
function writeLog(file, msg) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  // Buffer writes (flush every 2s)
  if (!_logBuffers[file]) _logBuffers[file] = []
  _logBuffers[file].push(line)
}
setInterval(() => {
  for (const [file, lines] of Object.entries(_logBuffers)) {
    if (lines.length === 0) continue
    try {
      fs.appendFileSync(path.join(LOG_DIR, file), lines.join(""))
    } catch {}
    _logBuffers[file] = []
  }
}, 2000)

// Server-internal error counters
const _serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  errorCount: 0,
  lastError: null,
  last5errors: [],
  apiCalls: {}
}

process.on("uncaughtException", (err) => {
  const msg = `[FATAL] Uncaught: ${err.message}\n${err.stack}`
  console.error(msg)
  try { writeLog("errors.log", msg) } catch(e){}
  // Write crash file immediately (sync) so Guardian can't hide it
  try { fs.writeFileSync(path.join(LOG_DIR, "CRASH.txt"), `${new Date().toISOString()}\n${msg}\n`) } catch(e){}
  _serverStats.errorCount++
  _serverStats.lastError = { time: Date.now(), msg: err.message, type: "uncaughtException" }
  _serverStats.last5errors.push(_serverStats.lastError)
  if (_serverStats.last5errors.length > 20) _serverStats.last5errors.shift()
  // Do NOT exit - keep server running
})
process.on("unhandledRejection", (err) => {
  const msg = `[WARN] Unhandled Rejection: ${err?.message || err}\n${err?.stack || ''}`
  console.error(msg)
  try { writeLog("errors.log", msg) } catch(e){}
  try { fs.writeFileSync(path.join(LOG_DIR, "CRASH.txt"), `${new Date().toISOString()}\n${msg}\n`) } catch(e){}
  _serverStats.errorCount++
  _serverStats.lastError = { time: Date.now(), msg: err?.message || String(err), type: "unhandledRejection" }
  _serverStats.last5errors.push(_serverStats.lastError)
  if (_serverStats.last5errors.length > 20) _serverStats.last5errors.shift()
  // Do NOT exit - keep server running
})

// Capture ANY exit with reason
process.on("exit", (code) => {
  if (code !== 0) {
    const msg = `[EXIT] Process exit with code ${code} at ${new Date().toISOString()}`
    console.error(msg)
    try { fs.appendFileSync(path.join(LOG_DIR, "CRASH.txt"), msg + "\n") } catch(e){}
  }
})

// Request logging middleware (only API calls, not static files)
app.use((req, res, next) => {
  _serverStats.requestCount++
  if (req.path.startsWith("/api/")) {
    const route = req.method + " " + req.path.split("?")[0]
    _serverStats.apiCalls[route] = (_serverStats.apiCalls[route] || 0) + 1
    const start = Date.now()
    res.on("finish", () => {
      const ms = Date.now() - start
      if (res.statusCode >= 400) {
        writeLog("errors.log", `${route} → ${res.statusCode} (${ms}ms)`)
      }
      if (ms > 5000) {
        writeLog("errors.log", `SLOW: ${route} took ${ms}ms`)
      }
    })
  }
  next()
})

// JWT_SECRET set after DB init
let JWT_SECRET = "t4c-secret-2025"

// Login endpoint
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {}
  const user = verifyUser(username, password)
  if (!user) return res.json({ ok: false, error: "Onjuiste inloggegevens" })
  // Update last_login
  try { run("UPDATE users SET last_login=datetime('now') WHERE username=?", [user.username]) } catch {}
  const fullUser = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [user.username])
  const token = jwt.sign({ sub: user.username, role: user.role, name: user.name, userId: fullUser?.id || user.id }, JWT_SECRET, { expiresIn: "7d" })
  res.json({ ok: true, token, user: { id: fullUser?.id, username: user.username, name: user.name, role: user.role, email: fullUser?.email || '' }, name: user.name, role: user.role, userId: fullUser?.id, email: fullUser?.email || '' })
})

// Auth check endpoint
app.get("/api/me", (req, res) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ error: "No token" })
  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    const user = queryOne("SELECT id,username,name,role,email,phone FROM users WHERE username=?", [decoded.sub])
    res.json({ ok: true, username: decoded.sub, name: decoded.name, role: decoded.role, userId: user?.id || decoded.userId, email: user?.email || '', phone: user?.phone || '' })
  } catch { res.status(401).json({ error: "Invalid token" }) }
})

// ── Domain-based static file routing ──
const SITES_DIR = path.resolve(__dirname, "..", "sites")
const CARDATAX_DIR = path.join(SITES_DIR, "cardatax")
const T4C_SALES_DIR = path.join(SITES_DIR, "transfer4cars")

// Domain detection middleware — sets req.site (skip for API)
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos") || req.path.startsWith("/app")) return next()
  const host = (req.hostname || "").toLowerCase()
  if (host.includes("transfer4cars")) req.site = "transfer4cars"
  else if (host.includes("cardatax")) req.site = "cardatax"
  else req.site = "local"
  next()
})

// Transfer4Cars domain — serve verkoop site as root
app.use((req, res, next) => {
  if (req.site !== "transfer4cars") return next()
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos") || req.path.startsWith("/app") || req.path.startsWith("/m") || req.path.startsWith("/admin")) return next()
  express.static(T4C_SALES_DIR, { extensions: ["html"] })(req, res, () => {
    if (!req.path.includes(".") && !req.path.startsWith("/admin") && !req.path.startsWith("/app")) res.sendFile(path.join(T4C_SALES_DIR, "index.html"))
    else next()
  })
})

// CardDatax domain — serve taxatie platform as root
app.use((req, res, next) => {
  if (req.site !== "cardatax") return next()
  if (req.path.startsWith("/api/") || req.path.startsWith("/photos")) return next()
  express.static(CARDATAX_DIR, { extensions: ["html"] })(req, res, next)
})

// Localhost: /verkoop/ → transfer4cars site
app.use("/app", (req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");next()})
app.use("/app", express.static(path.join(CARDATAX_DIR, "app"), { extensions: ["html"] }))
app.use("/app", (req,res) => res.sendFile(path.join(CARDATAX_DIR, "app", "index.html")))
app.use("/admin", (req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");next()})
app.use("/admin", express.static(path.join(CARDATAX_DIR, "admin"), { extensions: ["html"] }))
app.use("/admin", (req,res) => res.sendFile(path.join(CARDATAX_DIR, "admin", "index.html")))
app.use("/m", (req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");next()})
app.use("/m", express.static(path.join(CARDATAX_DIR, "m"), { extensions: ["html"] }))
app.use("/m", (req,res) => res.sendFile(path.join(CARDATAX_DIR, "m", "index.html")))

// /cardatax/ → alias for /m/ (mobile dealer app)
app.use("/cardatax/app", (req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");next()})
app.use("/cardatax/app", express.static(path.join(CARDATAX_DIR, "app"), { extensions: ["html"] }))
app.use("/cardatax/app", (req,res) => res.sendFile(path.join(CARDATAX_DIR, "app", "index.html")))
app.use("/cardatax", (req,res,next)=>{res.setHeader("Cache-Control","no-store, no-cache, must-revalidate");next()})
app.use("/cardatax", express.static(path.join(CARDATAX_DIR, "m"), { extensions: ["html"] }))
app.use("/cardatax", (req,res) => res.sendFile(path.join(CARDATAX_DIR, "m", "index.html")))

app.use("/verkoop", express.static(T4C_SALES_DIR, { extensions: ["html"] }))

// cardatax.com domain → redirect to transfer4cars.com/cardatax/
app.use((req, res, next) => {
  if (req.site === "cardatax" && req.path === "/") return res.redirect(301, "https://transfer4cars.com/cardatax/")
  next()
})

// Localhost/fallback: everything else → transfer4cars (main site)
app.use(express.static(T4C_SALES_DIR, { extensions: ["html"] }))
app.use(express.static(CARDATAX_DIR, { extensions: ["html"] }))

// Protect /app/ — check token via cookie or query
app.use("/app", (req, res, next) => {
  // Allow static assets through (js, css, images)
  if (req.path.match(/\.(js|css|svg|png|jpg|ico|woff|woff2|ttf)$/)) return next()
  // For HTML pages, we check auth client-side (SPA handles it)
  next()
})

// ── Split Routes ──
app.use(require("./routes/veilingen"))
app.use(require("./routes/scanner"))
app.use(require("./routes/misc"))
app.use(require("./routes/admin"))
app.use(require("./routes/market"))
const UAs = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
]
function ua() { return UAs[Math.floor(Math.random() * UAs.length)] }

/* ── CACHE ───────────────────────────────── */
const cache = new Map()
function getCached(k, ttl = 1200000) { const e = cache.get(k); if (!e) return null; if (Date.now()-e.ts > ttl) { cache.delete(k); return null }; return e.d }
function setCache(k, d) { cache.set(k, { d, ts: Date.now() }); if (cache.size > 500) { const o=[...cache.entries()].sort((a,b)=>a[1].ts-b[1].ts); for (let i=0;i<100;i++) cache.delete(o[i][0]) } }

/* ── INTELLIGENCE ENGINE (SQLite-backed) ──── */

// Store every taxatie with full context
function recordTaxatie(mk,ml,yr,km,prices,median,count,quality) {
  if(!prices.length) return
  try {
    stmts.saveLearnedPrice.run(
      mk.toLowerCase(), ml.toLowerCase(), yr, km || 0,
      median, Math.round(prices.reduce((a,b)=>a+b,0)/prices.length),
      prices[0], prices[prices.length-1],
      count, quality || "", new Date().getMonth()+1
    )
  } catch(e) { console.error("[DB] recordTaxatie error:", e.message) }
}

// Old learning system (still used for price augmentation)
function learn(mk,ml,yr,p) {
  if(!p.length) return
  try {
    const median = p[Math.floor(p.length/2)]
    const avg = Math.round(p.reduce((a,b)=>a+b,0)/p.length)
    stmts.saveLearnedPrice.run(
      mk.toLowerCase(), ml.toLowerCase(), yr, 0,
      median, avg, p[0], p[p.length-1],
      p.length, "learn", new Date().getMonth()+1
    )
  } catch(e) { console.error("[DB] learn error:", e.message) }
}

function getLearned(mk,ml,yr) {
  try {
    const rows = stmts.getLearnedPrice.all(mk.toLowerCase(), ml.toLowerCase())
    // Get recent entries (last 30 days) for this year
    const cutoff = Date.now() - 30*86400000
    const recent = rows.filter(r => {
      const ts = new Date(r.created_at).getTime()
      return ts > cutoff && r.year === yr
    })
    if (!recent.length) return []
    // Collect all unique prices
    const prices = []
    for (const r of recent) {
      if (r.low) prices.push(r.low)
      if (r.high) prices.push(r.high)
      if (r.median) prices.push(r.median)
    }
    return [...new Set(prices)].sort((a,b) => a-b).slice(-80)
  } catch { return [] }
}

// ═══ SEASON CORRECTION ═══
function getSeasonFactor(mk, ml, bodyType, fuel) {
  const month = new Date().getMonth() + 1 // 1-12
  const model = `${mk} ${ml}`.toLowerCase()
  let factor = 1.0
  let reason = null

  // Cabriolet / Roadster detection
  const isCabrio = /cabrio|roadster|spider|spyder|convertible|targa|boxster|slk|sl\b|z4|mx-5|miata|tt\s?roadster/i.test(model) ||
                   (bodyType && /cabrio|convert|road/i.test(bodyType))
  if(isCabrio) {
    // Mar-Jun: +6-10% premium, Oct-Feb: -8-12% discount
    if(month >= 3 && month <= 6) { factor = 1.08; reason = "Cabrio-seizoen (lente/zomer) — hogere vraag, +8%" }
    else if(month >= 10 || month <= 2) { factor = 0.91; reason = "Buiten cabrio-seizoen — lagere vraag, nu goedkoper inkopen" }
  }

  // 4x4 / SUV detection
  const is4x4 = /4x4|4wd|awd|allgrip|4motion|xdrive|quattro|4matic|alltrack/i.test(model)
  if(is4x4) {
    if(month >= 9 && month <= 12) { factor = Math.max(factor, 1.05); reason = "Winterseizoen — hogere vraag naar 4x4, +5%" }
    else if(month >= 4 && month <= 7) { factor = Math.min(factor, 0.97); reason = "Zomer — minder vraag naar 4x4, gunstiger inkoop" }
  }

  // EV detection
  const isEV = fuel && /elektr|electric|ev\b|bev/i.test(fuel)
  if(isEV) {
    // Q1: subsidie-aanvragen, hogere vraag
    if(month >= 1 && month <= 3) { factor = Math.max(factor, 1.06); reason = "Q1 subsidie-rush voor EV's — hogere marktprijs, +6%" }
    else if(month >= 7 && month <= 9) { factor = Math.min(factor, 0.96); reason = "Zomer-dip voor EV's — minder vraag, gunstiger inkopen" }
  }

  // Januari-effect: veel inruilaanbod na feestdagen
  if(month === 1 && !reason) { factor = 0.97; reason = "Januari-effect — veel inruilaanbod na feestdagen, prijzen iets lager" }

  // September: nieuwe modeljaar-aankondigingen drukken occasion
  if(month === 9 && !reason) { factor = 0.98; reason = "September — nieuw modeljaar drukt occasionprijzen licht" }

  return { factor, reason, month }
}

// ═══ DEPRECIATION ANALYSIS ═══
function loadHist() {
  try {
    const rows = queryAll("SELECT make, model, year, median as median_price, created_at FROM market_snapshots WHERE median > 0 ORDER BY created_at DESC LIMIT 500")
    const hist = {}
    for (const r of rows) {
      const k = `${r.make}|${r.model}`.toLowerCase()
      if (!hist[k]) hist[k] = []
      hist[k].push({ yr: r.year, median: r.median_price, ts: new Date(r.created_at).getTime() })
    }
    return hist
  } catch { return {} }
}

function getDepreciation(mk, ml, yr) {
  const hist = loadHist()
  const k = `${mk}|${ml}`.toLowerCase()
  const entries = (hist[k] || []).filter(e => e.yr === yr && e.median > 0)

  if(entries.length < 2) return null

  // Sort by timestamp
  entries.sort((a,b) => a.ts - b.ts)
  const first = entries[0]
  const last = entries[entries.length - 1]
  const daysDiff = (last.ts - first.ts) / 86400000

  if(daysDiff < 7) return null // Need at least a week of data

  const priceDiff = last.median - first.median
  const pctChange = (priceDiff / first.median) * 100
  const monthlyRate = daysDiff > 0 ? (pctChange / daysDiff) * 30 : 0

  return {
    firstPrice: first.median,
    lastPrice: last.median,
    change: Math.round(priceDiff),
    changePct: Math.round(pctChange * 10) / 10,
    monthlyRate: Math.round(monthlyRate * 10) / 10,
    dataPoints: entries.length,
    periodDays: Math.round(daysDiff),
    trend: priceDiff > 0 ? "stijgend" : priceDiff < 0 ? "dalend" : "stabiel"
  }
}

// ═══ MARKET PRESSURE ═══
function getMarketPressure(count, quality, cv) {
  let pressure = "normaal"
  let score = 50
  let advice = null

  if(count >= 30 && quality === "excellent") {
    pressure = "hoog aanbod"; score = 75
    advice = "Veel vergelijkbare auto's in de markt — koper heeft keuze, onderhandel stevig bij inkoop"
  } else if(count >= 20 && cv < 0.25) {
    pressure = "veel aanbod"; score = 65
    advice = "Ruim aanbod met stabiele prijzen — markt is voorspelbaar, houd je aan de mediaan"
  } else if(count >= 10) {
    pressure = "normaal"; score = 50
    advice = "Gezond marktaanbod — standaard inkoopstrategie"
  } else if(count >= 5) {
    pressure = "beperkt aanbod"; score = 35
    advice = "Weinig vergelijkbaar aanbod — meer ruimte in je verkoopprijs"
  } else if(count >= 1) {
    pressure = "schaars"; score = 20
    advice = "Zeer weinig aanbod — prijzen zijn onzeker maar schaarste = kans op hogere marge"
  } else {
    pressure = "geen data"; score = 0
    advice = "Geen vergelijkbaar aanbod gevonden — wees voorzichtig met prijsstelling"
  }

  // CV factor: high price spread = more negotiation room
  if(cv > 0.35 && count >= 5) {
    advice += ". Grote prijsspreiding — er is ruimte om scherp in te kopen"
  }

  return { pressure, score, advice }
}

// ═══ KM NORMALIZATION ═══
function normalizeKm(median, actualKm, yr) {
  const age = new Date().getFullYear() - yr
  const avgKmPerYear = 15000 // NL gemiddelde
  const expectedKm = age * avgKmPerYear
  const kmDiff = actualKm - expectedKm

  if(!actualKm || actualKm <= 0 || !median) return null

  // Price adjustment: ~€0.02-0.05 per km deviation for average car
  const pricePerKm = median * 0.000025 // ~2.5 cent per km per €1000 waarde
  const adjustment = Math.round(-kmDiff * pricePerKm)
  const normalizedPrice = median + adjustment

  let kmVerdict = "gemiddeld"
  if(kmDiff < -avgKmPerYear) kmVerdict = "weinig km"
  else if(kmDiff > avgKmPerYear) kmVerdict = "veel km"

  return {
    expectedKm: Math.round(expectedKm),
    actualKm,
    diff: Math.round(kmDiff),
    adjustment,
    normalizedPrice: Math.round(normalizedPrice),
    verdict: kmVerdict,
    avgPerYear: actualKm > 0 && age > 0 ? Math.round(actualKm / age) : null
  }
}

// ═══ SMART INSIGHTS GENERATOR ═══
function generateInsights(data) {
  const { mk, ml, yr, km, median, avg, count, quality, cv, p10, p90, season, depreciation, marketPressure, kmNorm, bodyType, fuel } = data
  const insights = []
  const age = new Date().getFullYear() - yr

  // 1. Market quality
  if(quality === "excellent" && count >= 15) {
    insights.push({ type: "positive", icon: "check", text: `Uitstekende marktdata: ${count} vergelijkbare listings met lage spreiding — prijs is betrouwbaar` })
  } else if(quality === "low" || count < 5) {
    insights.push({ type: "warning", icon: "warn", text: `Beperkte marktdata (${count} listings) — prijs is indicatief, verifieer handmatig` })
  }

  // 2. KM analysis
  if(kmNorm) {
    if(kmNorm.verdict === "weinig km") {
      const bonus = Math.abs(kmNorm.adjustment)
      insights.push({ type: "positive", icon: "check", text: `${Math.abs(Math.round(kmNorm.diff/1000))}k km onder gemiddeld — waarde-plus van ~${fmtE(bonus)}` })
    } else if(kmNorm.verdict === "veel km") {
      insights.push({ type: "warning", icon: "warn", text: `${Math.round(kmNorm.diff/1000)}k km boven gemiddeld — houd rekening met ~${fmtE(Math.abs(kmNorm.adjustment))} waardedaling` })
    }
    if(kmNorm.avgPerYear && kmNorm.avgPerYear > 25000) {
      insights.push({ type: "warning", icon: "warn", text: `Hoog jaargemiddelde: ${new Intl.NumberFormat("nl-NL").format(kmNorm.avgPerYear)} km/jaar — check slijtageonderdelen` })
    }
  }

  // 3. Season
  if(season.reason) {
    const type = season.factor >= 1 ? "info" : "positive"
    insights.push({ type, icon: season.factor >= 1 ? "info" : "check", text: season.reason })
  }

  // 4. Depreciation
  if(depreciation) {
    if(depreciation.trend === "dalend" && depreciation.monthlyRate < -2) {
      insights.push({ type: "warning", icon: "warn", text: `Prijsdaling: ${depreciation.changePct}% over ${depreciation.periodDays} dagen — snelle doorverkoop aanbevolen` })
    } else if(depreciation.trend === "stijgend" && depreciation.monthlyRate > 2) {
      insights.push({ type: "positive", icon: "check", text: `Prijsstijging: +${depreciation.changePct}% recent — sterke markt voor dit model` })
    } else if(depreciation.trend === "stabiel") {
      insights.push({ type: "info", icon: "info", text: "Stabiele prijsontwikkeling — voorspelbare markt" })
    }
  }

  // 5. Market pressure
  if(marketPressure.advice) {
    insights.push({ type: "info", icon: "info", text: marketPressure.advice })
  }

  // 6. Price spread opportunity
  if(p10 && p90 && median) {
    const spread = p90 - p10
    const spreadPct = Math.round((spread / median) * 100)
    if(spreadPct > 40) {
      insights.push({ type: "positive", icon: "check", text: `Grote prijsspreiding (${spreadPct}%) — er zijn koopjes onder P10 (${fmtE(p10)})` })
    }
  }

  // 7. Age-specific advice
  if(age <= 2) {
    insights.push({ type: "info", icon: "info", text: "Jong occasion — check of fabrieksgarantie nog geldig is, verhoogt verkoopwaarde" })
  } else if(age >= 10 && age < 15) {
    insights.push({ type: "info", icon: "info", text: "10+ jaar oud — BPM restwaarde is minimaal, check technische staat extra" })
  }

  // 8. EV-specific
  if(fuel && /elektr|electric|ev\b|bev/i.test(fuel)) {
    if(age >= 3) {
      insights.push({ type: "warning", icon: "warn", text: "EV ouder dan 3 jaar — batterijdegradatie kan waarde beinvloeden, check SOH indien mogelijk" })
    }
    insights.push({ type: "info", icon: "info", text: "Check of de koper in aanmerking komt voor SEPP-subsidie (tweedehands EV)" })
  }

  return insights.slice(0, 8) // Max 8 insights
}

function fmtE(n) { return "\u20AC " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n) }

/* ── GENEROUS PRICE CAP ──────────────────── */
const LUX=new Set(["porsche","ferrari","lamborghini","bentley","rolls-royce","aston martin","maserati","mclaren","tesla"])
const PREM=new Set(["bmw","mercedes","mercedes-benz","audi","lexus","jaguar","land rover","volvo","alfa romeo","mini","ds"])
function maxPrice(yr,mk){const age=new Date().getFullYear()-yr;const m=String(mk).toLowerCase()
  if(age<=0)return 350000;if(age>=35)return 120000
  // Supercars hold value extremely well - Urus 2019 still 180-250k
  if(LUX.has(m))return[500000,450000,400000,350000,300000,260000,230000,200000,175000,150000,130000,110000,95000,80000,70000,60000,55000,50000,45000,40000,35000][Math.min(age,20)]
  if(PREM.has(m))return[150000,120000,95000,75000,60000,50000,42000,35000,30000,25000,22000,18000,15000,13000,11000,10000,9000,8000,7000,6500,6000][Math.min(age,20)]
  return[65000,55000,45000,38000,32000,28000,24000,20000,17000,14000,12000,10000,8500,7500,6500,5500,5000,4500,4000,3500,3000][Math.min(age,20)]
}

/* ── HELPERS ──────────────────────────────── */
function parsePrice(t){if(!t)return 0;const c=t.replace(/[^\d.,]/g,"");let n;if(c.includes(".")&&c.includes(","))n=Number(c.replace(/\./g,"").replace(",","."));else if(c.includes(".")&&c.split(".").pop().length===3)n=Number(c.replace(/\./g,""));else n=Number(c.replace(",","."));return Number.isFinite(n)&&n>=MIN_PRICE?n:0}

async function safeFetch(url){
  try{const{data}=await axios.get(url,{headers:{"User-Agent":ua(),"Accept-Language":"nl-NL,nl;q=0.9,en;q=0.3","Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Encoding":"gzip, deflate","Connection":"keep-alive","Cache-Control":"no-cache","Pragma":"no-cache"},timeout:TIMEOUT,maxRedirects:5,validateStatus:s=>s<400});return data}
  catch(e){return null}
}

function extractPrices(html,cap){
  if(!html)return[];const $=cheerio.load(html);const pr=new Set()
  $('script[type="application/ld+json"]').each((_,el)=>{try{const j=JSON.parse($(el).html());for(const i of[].concat(Array.isArray(j)?j:j?.["@graph"]||[j])){for(const o of[].concat(i?.offers||[])){const p=parseInt(o?.price||o?.lowPrice,10);if(p>=MIN_PRICE&&p<=cap)pr.add(p)}}}catch{}})
  $("[data-price]").each((_,el)=>{const p=parsePrice($(el).attr("data-price"));if(p>=MIN_PRICE&&p<=cap)pr.add(p)})
  $('[class*="price"],[class*="Price"],[data-testid*="price"]').each((_,el)=>{const p=parsePrice($(el).text());if(p>=MIN_PRICE&&p<=cap)pr.add(p)})
  if(pr.size<3)$("span,p,div").each((_,el)=>{const t=$(el).text();const m=t.match(/€\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?)/);if(m){const p=parsePrice(m[0]);if(p>=MIN_PRICE&&p<=cap)pr.add(p)}})
  return[...pr]
}

/* ── LISTING EXTRACTOR — haalt echte auto-advertenties uit HTML ── */
function extractListings(html, cap, sourceUrl, sourceName) {
  if (!html) return []
  const $ = cheerio.load(html)
  const listings = []
  const seen = new Set()
  const baseUrl = sourceUrl ? new URL(sourceUrl).origin : ""

  // Method 1: JSON-LD structured data (most reliable)
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).html())
      const items = [].concat(Array.isArray(j) ? j : j?.["@graph"] || [j])
      for (const item of items) {
        if (item?.["@type"] !== "Car" && item?.["@type"] !== "Vehicle" && item?.["@type"] !== "Product") continue
        const offers = [].concat(item?.offers || [])
        for (const o of offers) {
          const price = parseInt(o?.price || o?.lowPrice, 10)
          if (!price || price < MIN_PRICE || price > cap) continue
          const title = item.name || item.description || ""
          const url = o.url || item.url || ""
          const km = parseInt(item.mileageFromOdometer?.value || item.mileage || 0, 10)
          const year = parseInt(item.vehicleModelDate || item.productionDate || 0, 10)
          const key = `${price}-${title.slice(0,20)}`
          if (!seen.has(key)) { seen.add(key); listings.push({ title: title.slice(0, 80), price, km: km || null, year: year || null, url: url.startsWith("http") ? url : (url ? baseUrl + url : ""), source: sourceName }) }
        }
      }
    } catch {}
  })

  // Method 2: Common HTML listing card patterns
  const cardSelectors = [
    'article[class*="listing"]', 'article[class*="result"]', 'article[class*="car"]',
    'div[class*="listing-item"]', 'div[class*="search-result"]', 'div[class*="vehicle-card"]',
    'li[class*="listing"]', 'li[class*="result"]',
    'a[class*="listing"]', 'a[class*="result-item"]',
    '[data-testid*="listing"]', '[data-testid*="result"]',
  ]
  for (const sel of cardSelectors) {
    $(sel).each((_, card) => {
      if (listings.length >= 25) return false
      const $c = $(card)
      // Find price
      let price = 0
      const priceEl = $c.find('[class*="price"],[class*="Price"],[data-price]').first()
      if (priceEl.length) {
        price = parsePrice(priceEl.attr("data-price") || priceEl.text())
      }
      if (!price) {
        const txt = $c.text()
        const pm = txt.match(/€\s?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?)/)
        if (pm) price = parsePrice(pm[0])
      }
      if (!price || price < MIN_PRICE || price > cap) return

      // Find title
      let title = ""
      const titleEl = $c.find('h2,h3,[class*="title"],[class*="Title"],[class*="name"]').first()
      if (titleEl.length) title = titleEl.text().trim()
      if (!title) title = $c.find("a").first().attr("title") || $c.find("a").first().text().trim() || ""
      title = title.replace(/\s+/g, " ").trim().slice(0, 80)

      // Find URL
      let url = $c.find("a[href]").first().attr("href") || $c.attr("href") || ""
      if (url && !url.startsWith("http")) url = baseUrl + (url.startsWith("/") ? url : "/" + url)

      // Find KM
      let km = null
      const kmMatch = $c.text().match(/(\d{1,3}(?:[.\s]\d{3})*)\s*km/i)
      if (kmMatch) { const k = parseInt(kmMatch[1].replace(/[.\s]/g, ""), 10); if (k > 1000 && k < 900000) km = k }

      // Find year
      let year = null
      const yrMatch = $c.text().match(/\b(19[89]\d|20[0-2]\d)\b/)
      if (yrMatch) year = parseInt(yrMatch[1], 10)

      const key = `${price}-${title.slice(0,20)}`
      if (title && !seen.has(key)) { seen.add(key); listings.push({ title, price, km, year, url, source: sourceName }) }
    })
    if (listings.length >= 10) break
  }

  return listings.slice(0, 15)
}

/* ── SCRAPERS ─────────────────────────────
   Tier 1: NL Primary (highest quality)
   Tier 2: NL Secondary
   Tier 3: International (DE/BE/FR)
   Tier 4: Auction / Wholesale
   ─────────────────────────────────────── */

// ═══ TIER 1: NL PRIMARY ═══
async function scrapeMarktplaats(mk,ml,yr,c,km,trans){
  const kmQ=km>0?`+${Math.round(km/1000)}km`:""
  const transQ=trans==='automaat'?'+automaat':trans==='handgeschakeld'?'+handgeschakeld':""
  return[...new Set(extractPrices(await safeFetch(`https://www.marktplaats.nl/q/${mk}+${ml}+${yr}${kmQ}${transQ}/`),c))]
}
async function scrapeAutoScout24NL(mk,ml,yr,c,km,trans){
  let url=`https://www.autoscout24.nl/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&cy=NL&sort=price&desc=0&priceto=${c}`
  if(km>0){url+=`&kmfrom=${Math.max(0,Math.round(km*0.6/1000)*1000)}&kmto=${Math.round(km*1.4/1000)*1000}`}
  if(trans==='automaat')url+='&gear=A'
  else if(trans==='handgeschakeld')url+='&gear=M'
  return extractPrices(await safeFetch(url),c)
}
async function scrapeAutoTrack(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autotrack.nl/aanbod?merk=${mk}&model=${ml}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeGaspedaal(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.gaspedaal.nl/${m}-${d}/jaar-${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.gaspedaal.nl/${m}/${d}?year=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.gaspedaal.nl/zoeken?q=${m}+${d}+${yr}`),c)
  return p
}
async function scrapeAutowereld(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autowereld.nl/${m}/${m}-${d}/b_${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autowereld.nl/${m}/${d}/b_${yr}`),c)
  return p
}
async function scrapeViaBovag(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.viabovag.nl/auto/merk-${m}/model-${d}?bouwjaarVan=${yr}&bouwjaarTot=${yr+1}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.viabovag.nl/auto?merk=${m}&model=${d}&bouwjaarVan=${yr}&bouwjaarTot=${yr+1}`),c)
  return p
}

// ═══ TIER 2: NL SECONDARY ═══
async function scrapeAutoWeek(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autoweek.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartm=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autoweek.nl/occasions/?q=${m}+${d}+${yr}`),c)
  return p
}
async function scrapeAutosNL(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autos.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autos.nl/zoeken/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartm=${yr}`),c)
  return p
}
async function scrapeAutoGids(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autogids.nl/tweedehands/${m}/${d}?year_min=${yr}&year_max=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autogids.nl/zoeken?q=${m}+${d}+${yr}`),c)
  return p
}
async function scrapeDealerOccasions(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.dealeroccasions.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.dealeroccasions.nl/zoeken/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  return p
}
async function scrapeAutoBedrijven(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autobedrijven.nl/occasions/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeAutoBedrijf24(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autobedrijf24.nl/aanbod/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeAutoKopen(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autokopen.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autokopen.nl/zoeken?merk=${m}&model=${d}&jaar=${yr}`),c)
  return p
}
async function scrapeAutoDealers(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autodealers.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAutoWerk(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.autowerk.nl/occasions/${m}/${d}/?bouwjaar=${yr}`),c)
}
async function scrapeVakgarage(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.vakgarage.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeAutoBedrijfNL(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autobedrijf.nl/occasions?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}

// ═══ TIER 3: INTERNATIONAL ═══
async function scrapeMobileDE(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://suchen.mobile.de/fahrzeuge/search.html?dam=0&isSearchRequest=true&ms=${m};${d}&fr=${yr}:${yr+1}&ml=:150000&s=Automobile&sb=p&vc=Car`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.mobile.de/nl/auto/${m}/${d}/vhc:car,pgn:1,pgs:50,frn:${yr},frx:${yr+1},srt:price,sro:asc`),c)
  return p
}
async function scrapeAutoScout24DE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.de/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeAutoScout24BE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.be/nl/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&cy=B&sort=price&desc=0&priceto=${c}`),c)
}
async function scrape2eHandsBE(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  return extractPrices(await safeFetch(`https://www.2dehands.be/l/auto-s/${m}-${d}/q/${m}+${d}+${yr}/`),c)
}
async function scrapeAutoScout24COM(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.com/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeLeBonCoin(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.leboncoin.fr/recherche?category=2&text=${mk.toLowerCase()}+${ml.toLowerCase()}&regdate=${yr}-${yr+1}`),c)
}

// ═══ TIER 4: AUCTION / WHOLESALE ═══
async function scrapeAutoVeiling(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoveiling.nl/zoeken?q=${mk.toLowerCase()}+${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeBCA(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.bca.com/nl-NL/search?make=${mk.toLowerCase()}&model=${ml.toLowerCase()}&yearFrom=${yr}&yearTo=${yr}`),c)
}
async function scrapeOpenLane(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.openlane.eu/nl/zoeken?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAdesaEU(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.adesa.eu/nl/vehicles?make=${mk.toLowerCase()}&model=${ml.toLowerCase()}&year=${yr}`),c)
}
async function scrapeCopart(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.copart.nl/lotSearchResults/?free=true&query=${mk.toLowerCase()}+${ml.toLowerCase()}+${yr}`),c)
}
async function scrapeAutoBidDE(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autobid.de/nl/zoeken?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}

// ═══ TIER 5: SEARCH ENGINES — DE CHATGPT METHODE ═══
// Zoek via Google/Bing en vind prijzen over ALLE websites tegelijk
async function scrapeGoogleSearch(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop prijs €`)
  const urls=[
    `https://www.google.nl/search?q=${q}&num=40&hl=nl`,
    `https://www.google.com/search?q=${encodeURIComponent(`${mk} ${ml} ${yr} occasion kopen`)}&num=30&hl=nl`,
  ]
  let all=[]
  for(const u of urls){
    const html=await safeFetch(u)
    if(html) all.push(...extractPrices(html,c))
  }
  return all
}
async function scrapeBingSearch(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop occasion prijs`)
  const html=await safeFetch(`https://www.bing.com/search?q=${q}&count=50&cc=NL&setlang=nl`)
  return html?extractPrices(html,c):[]
}
async function scrapeDuckDuckGo(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} te koop prijs euro`)
  const html=await safeFetch(`https://html.duckduckgo.com/html/?q=${q}`)
  return html?extractPrices(html,c):[]
}
async function scrapeEcosia(mk,ml,yr,c){
  const q=encodeURIComponent(`${mk} ${ml} ${yr} occasion prijs`)
  const html=await safeFetch(`https://www.ecosia.org/search?q=${q}`)
  return html?extractPrices(html,c):[]
}

// ═══ TIER 6: DEALER GROUPS ═══
async function scrapeVanMossel(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autobedrijfvanmossel.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autobedrijfvanmossel.nl/occasions/${m}/${d}/`),c)
  return p
}
async function scrapeLouwman(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.louwman.nl/occasions/?merk=${m}&model=${d}&bouwjaarvan=${yr}&bouwjaartot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.louwman.nl/occasions/${m}/${d}/`),c)
  return p
}
async function scrapeWensink(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.wensink.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeBroekhuis(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.broekhuis.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeHerwers(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.herwers.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapePonCenter(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.poncenter.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeZeeuwZeeuw(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.zeeuwenzeeuw.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeTerwolde(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.terwolde.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeStam(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.stam.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeMulder(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.mulder.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeHartgerink(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.hartgerink.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}

// ═══ TIER 7: LEASE OCCASIONS ═══
async function scrapeLeasePlan(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.leaseplanauto.nl/occasions/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.leaseplan.com/nl-nl/occasion-auto/?make=${m}&model=${d}`),c)
  return p
}
async function scrapeAthlon(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.athlon.com/nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeArval(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.arval.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeAlphabet(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.alphabet.com/nl-nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}

// ═══ TIER 8: EXTRA PLATFORMS ═══
async function scrapeAutoTraderNL(mk,ml,yr,c){
  const m=mk.toLowerCase(),d=ml.toLowerCase()
  let p=extractPrices(await safeFetch(`https://www.autotrader.nl/${m}/${d}/?bouwjaar=${yr}`),c)
  if(!p.length)p=extractPrices(await safeFetch(`https://www.autotrader.nl/zoeken/?merk=${m}&model=${d}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
  return p
}
async function scrapeAutoFirstNL(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autofirst.nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`),c)
}
async function scrapeBoschCarService(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.boschcarservice.com/nl/nl/occasions/?merk=${mk.toLowerCase()}&model=${ml.toLowerCase()}&bouwjaar=${yr}`),c)
}
async function scrapeAutoScout24FR(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autoscout24.fr/lst/${mk.toLowerCase()}/${ml.toLowerCase()}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0&priceto=${c}`),c)
}
async function scrapeAutoTraderUK(mk,ml,yr,c){
  return extractPrices(await safeFetch(`https://www.autotrader.co.uk/car-search?make=${mk.toUpperCase()}&model=${ml.toUpperCase()}&year-from=${yr}&year-to=${yr}&sort=price-asc`),c)
}

/* ── SEARCH URLS for listings display ────── */
function buildSearchUrls(mk, ml, yr) {
  const m = mk.toLowerCase(), d = ml.toLowerCase()
  const me = encodeURIComponent(m), de = encodeURIComponent(d)
  return [
    { name: "Marktplaats", icon: "MP", url: `https://www.marktplaats.nl/l/auto-s/#q:${me}+${de}&PriceCentsFrom=0&yearFrom=${yr}&yearTo=${yr+1}` },
    { name: "AutoScout24", icon: "AS", url: `https://www.autoscout24.nl/lst/${m}/${d}?fregfrom=${yr}&fregto=${yr}&cy=NL&sort=standard&desc=0` },
    { name: "AutoTrack", icon: "AT", url: `https://www.autotrack.nl/aanbod?merk=${me}&model=${de}&bouwjaarVan=${yr}&bouwjaarTot=${yr}` },
    { name: "Gaspedaal", icon: "GP", url: `https://www.gaspedaal.nl/${m}/${d}/${yr}` },
    { name: "AutoWereld", icon: "AW", url: `https://www.autowereld.nl/${m}/${d}/?bouwjaar=${yr}` },
    { name: "ViaBovag", icon: "VB", url: `https://www.viabovag.nl/auto/${m}/${d}?bouwjaar=${yr}-${yr}` },
    { name: "AutoWeek", icon: "AK", url: `https://www.autoweek.nl/occasions/?merk=${me}&model=${de}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}` },
    { name: "DealerOccasions", icon: "DO", url: `https://www.dealeroccasions.nl/${m}/${d}/?bouwjaar=${yr}` },
    { name: "Mobile.de", icon: "DE", url: `https://suchen.mobile.de/fahrzeuge/search.html?dam=0&isSearchRequest=true&ms=${me};${de}&fr=${yr}:${yr+1}&ml=:150000&s=Automobile&sb=p&vc=Car` },
    { name: "AutoScout24.de", icon: "DE", url: `https://www.autoscout24.de/lst/${m}/${d}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0` },
    { name: "2dehands.be", icon: "BE", url: `https://www.2dehands.be/l/auto-s/${m}-${d}/q/${m}+${d}+${yr}/` },
  ]
}

/* ── VALIDATION ──────────────────────────── */
function med(a){if(!a.length)return 0;const s=[...a].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function validate(prices,yr,mk){
  const cap=maxPrice(yr,mk);let p=prices.filter(x=>x>=MIN_PRICE&&x<=cap)
  if(p.length<2)return{v:p,rm:prices.length-p.length,q:p.length?"low":"none",cv:0}
  const m1=med(p);p=p.filter(x=>x>=m1*.25&&x<=m1*2.5)
  if(p.length>=6){const s=[...p].sort((a,b)=>a-b);const q1=s[Math.floor(s.length*.25)],q3=s[Math.floor(s.length*.75)],iq=q3-q1;p=p.filter(x=>x>=q1-1.5*iq&&x<=q3+1.5*iq)}
  const md=med(p);const sd=p.length>1?Math.sqrt(p.reduce((s,v)=>s+(v-md)**2,0)/p.length):0;const cv=md>0?Math.round(sd/md*100)/100:1
  let q="low";if(p.length>=15&&cv<.25)q="excellent";else if(p.length>=8&&cv<.35)q="good";else if(p.length>=4&&cv<.50)q="fair"
  return{v:p,rm:prices.length-p.length,q,cv}
}

/* ── MARKET ──────────────────────────────── */
/* ═══════════════════════════════════════════════
   PLATE OCR VALIDATION
   Quick RDW check for OCR scanner — tests plate variants
   ═══════════════════════════════════════════════ */
app.post("/api/plate/validate", async (req, res) => {
  try {
    const candidates = (req.body.candidates || []).map(p => p.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(p => p.length >= 5 && p.length <= 6)
    if (!candidates.length) return res.json({ ok: false, error: "Geen kandidaten" })
    // Test candidates in batches of 10, stop on first hit
    const toTest = candidates.slice(0, 60)
    for (let batch = 0; batch < toTest.length; batch += 20) {
      const chunk = toTest.slice(batch, batch + 20)
      const results = await Promise.allSettled(
        chunk.map(plate =>
          axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${plate}`, { timeout: 4000 })
            .then(r => ({ plate, found: Array.isArray(r.data) && r.data.length > 0, data: r.data[0] || null }))
            .catch(() => ({ plate, found: false, data: null }))
        )
      )
      const hits = results.filter(r => r.status === "fulfilled" && r.value.found).map(r => r.value)
      if (hits.length > 0) {
        const best = hits[0]
        return res.json({ ok: true, plate: best.plate, make: best.data?.merk || "", model: best.data?.handelsbenaming || "" })
      }
    }
    res.json({ ok: false, error: "Geen geldig kenteken gevonden" })
  } catch (e) { res.json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   SERVER-SIDE PLATE OCR
   Client sends cropped plate image → server does OCR + RDW
   Requires: apt install tesseract-ocr
   Fallback: tesseract.js npm package
   ═══════════════════════════════════════════════ */
const { execFile } = require("child_process")
const os = require("os")

const PLATE_SIDECODES = [
  { p: 'LLDDDL', w: 0 }, { p: 'LDDDLL', w: 0 },
  { p: 'LLDDLL', w: 1 }, { p: 'DDLLLD', w: 1 }, { p: 'DLLLDD', w: 1 },
  { p: 'LLLDDL', w: 2 }, { p: 'LDDLLL', w: 2 },
  { p: 'LLLLDD', w: 3 }, { p: 'DDLLDD', w: 3 }, { p: 'DLLDDD', w: 3 }, { p: 'DDDLLD', w: 3 },
  { p: 'LLDDDD', w: 4 }, { p: 'DDDDLL', w: 4 }, { p: 'DDLLLL', w: 4 },
]
function toLOpts(c) {
  if (/[A-Z]/.test(c)) return [c]
  return {'0':['O','D','Q'],'1':['I','T','L'],'2':['Z'],'3':['B','E'],'4':['A','H'],'5':['S'],'6':['G','C'],'7':['T','Z','J'],'8':['B','S'],'9':['G','P']}[c] || []
}
function toDOpts(c) {
  if (/[0-9]/.test(c)) return [c]
  return {'O':['0'],'D':['0'],'Q':['0'],'I':['1'],'T':['7','1'],'L':['1'],'Z':['2'],'B':['8','6'],'E':['3'],'A':['4'],'H':['4'],'S':['5'],'G':['6'],'C':['6'],'J':['7'],'P':['9'],'Y':['7','4'],'V':['7'],'U':['0'],'R':['8']}[c] || []
}
function serverSidecodeCandidates(raw) {
  if (!raw || raw.length < 5) return []
  const scored = []
  for (let offset = 0; offset <= Math.min(raw.length - 6, 3); offset++) {
    const chunk = raw.substring(offset, offset + 6)
    for (const { p: sc, w: weight } of PLATE_SIDECODES) {
      const posOpts = []
      let valid = true
      for (let i = 0; i < 6; i++) {
        const opts = sc[i] === 'L' ? toLOpts(chunk[i]) : toDOpts(chunk[i])
        if (!opts.length) { valid = false; break }
        posOpts.push(opts.map(o => ({ ch: o, changed: o !== chunk[i] ? 1 : 0 })))
      }
      if (!valid) continue
      let combos = [{ chars: [], changes: 0 }]
      for (const arr of posOpts) {
        const next = []
        for (const prev of combos) {
          for (const { ch, changed } of arr) {
            next.push({ chars: [...prev.chars, ch], changes: prev.changes + changed })
            if (next.length >= 120) break
          }
          if (next.length >= 120) break
        }
        combos = next
      }
      for (const c of combos) scored.push({ plate: c.chars.join(''), score: c.changes + weight })
    }
  }
  scored.sort((a, b) => a.score - b.score)
  const seen = new Set(), result = []
  for (const s of scored) { if (!seen.has(s.plate)) { seen.add(s.plate); result.push(s.plate); if (result.length >= 60) break } }
  return result
}

function runSystemTesseract(imgPath) {
  return new Promise((resolve) => {
    execFile("tesseract", [imgPath, "stdout", "--psm", "7", "-c", "tessedit_char_whitelist=ABCDEFGHJKLMNPRSTUVWXYZ0123456789"],
      { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null)
        resolve(stdout.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      })
  })
}

async function preprocessPlate(base64Data) {
  const Jimp = require("jimp")
  const buf = Buffer.from(base64Data, "base64")
  const img = await Jimp.read(buf)
  if (img.getWidth() < 400) img.scale(Math.ceil(400 / img.getWidth()))
  const versions = []
  // V1: High contrast grayscale
  versions.push(img.clone().grayscale().contrast(0.6))
  // V2: Binary threshold dark
  const v2 = img.clone().grayscale().contrast(0.8)
  v2.scan(0, 0, v2.getWidth(), v2.getHeight(), function(x, y, idx) {
    const val = this.bitmap.data[idx] < 140 ? 0 : 255
    this.bitmap.data[idx] = val; this.bitmap.data[idx+1] = val; this.bitmap.data[idx+2] = val
  })
  versions.push(v2)
  // V3: Binary threshold light
  const v3 = img.clone().grayscale().contrast(0.4)
  v3.scan(0, 0, v3.getWidth(), v3.getHeight(), function(x, y, idx) {
    const val = this.bitmap.data[idx] < 110 ? 0 : 255
    this.bitmap.data[idx] = val; this.bitmap.data[idx+1] = val; this.bitmap.data[idx+2] = val
  })
  versions.push(v3)
  return versions
}

app.post("/api/plate/scan", async (req, res) => {
  const t0 = Date.now()
  try {
    const { image } = req.body
    if (!image) return res.json({ ok: false, error: "Geen afbeelding" })
    const imgType = image.charAt(0) === '/' ? 'image/jpeg' : 'image/png'

    // Strategy 1: OpenAI Vision (best accuracy)
    const apiKey = getApiKey("OPENAI_API_KEY")
    let ocrPlate = null

    if (apiKey && apiKey !== "sk-...") {
      try {
        const visionResp = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o-mini",
          max_tokens: 20,
          temperature: 0,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Read the Dutch license plate in this image. Return ONLY the characters, no dashes/spaces. Example: 59NDZ6. If unreadable return NONE." },
              { type: "image_url", image_url: { url: `data:${imgType};base64,${image}`, detail: "low" } }
            ]
          }]
        }, { headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 6000 })

        const raw = (visionResp.data?.choices?.[0]?.message?.content || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        if (raw.length >= 5 && raw !== "NONE") {
          ocrPlate = raw
          writeLog("ocr.log", `[Vision] Read: ${raw} (${Date.now()-t0}ms)`)
        }
      } catch(e) {
        writeLog("ocr.log", `[Vision] Failed: ${e.message}`)
      }
    }

    // Strategy 2: Tesseract fallback (if no OpenAI key or Vision failed)
    if (!ocrPlate) {
      const allRaw = new Set()
      try {
        const imgs = await preprocessPlate(image)
        const tmpDir = os.tmpdir()
        for (let i = 0; i < imgs.length; i++) {
          const tmpPath = path.join(tmpDir, `plate_${Date.now()}_${i}.png`)
          try {
            await imgs[i].writeAsync(tmpPath)
            const ocrText = await runSystemTesseract(tmpPath)
            if (ocrText && ocrText.length >= 4) allRaw.add(ocrText)
            try { fs.unlinkSync(tmpPath) } catch {}
          } catch(e) { try { fs.unlinkSync(tmpPath) } catch {} }
        }
        if (allRaw.size === 0) {
          try {
            const Tjs = require("tesseract.js")
            if (!global._tessWorker) {
              global._tessWorker = await Tjs.createWorker("eng")
              await global._tessWorker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', tessedit_pageseg_mode: '7' })
            }
            const buf = Buffer.from(image, "base64")
            const { data: { text } } = await global._tessWorker.recognize(buf)
            const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
            if (cleaned.length >= 4) allRaw.add(cleaned)
          } catch(e) { writeLog("ocr.log", "tesseract.js fallback: " + e.message) }
        }
        if (allRaw.size > 0) ocrPlate = [...allRaw][0]
      } catch(e) { writeLog("ocr.log", `[Tesseract] Error: ${e.message}`) }
    }

    if (!ocrPlate) return res.json({ ok: false, error: "Kon kenteken niet lezen", ms: Date.now() - t0 })

    // Try the exact Vision/OCR reading first (fastest path)
    writeLog("ocr.log", `OCR: ${ocrPlate} — trying direct RDW lookup`)
    try {
      const directCheck = await axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${ocrPlate}`, { timeout: 4000 })
      if (Array.isArray(directCheck.data) && directCheck.data.length > 0) {
        const d = directCheck.data[0]
        writeLog("ocr.log", `✓ DIRECT HIT: ${ocrPlate} (${d.merk} ${d.handelsbenaming}) ${Date.now()-t0}ms`)
        return res.json({ ok: true, plate: ocrPlate, make: d.merk || "", model: d.handelsbenaming || "", ms: Date.now() - t0 })
      }
    } catch(e) {}

    // Direct lookup failed — generate sidecode candidates and batch validate
    const candidates = serverSidecodeCandidates(ocrPlate).slice(0, 30)
    writeLog("ocr.log", `Direct miss, trying ${candidates.length} candidates`)

    for (let batch = 0; batch < candidates.length; batch += 20) {
      const chunk = candidates.slice(batch, batch + 20)
      const results = await Promise.allSettled(
        chunk.map(plate =>
          axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${plate}`, { timeout: 4000 })
            .then(r => ({ plate, found: Array.isArray(r.data) && r.data.length > 0, data: r.data[0] || null }))
            .catch(() => ({ plate, found: false, data: null }))
        )
      )
      const hits = results.filter(r => r.status === "fulfilled" && r.value.found).map(r => r.value)
      if (hits.length > 0) {
        const best = hits[0]
        writeLog("ocr.log", `✓ ${best.plate} (${best.data?.merk} ${best.data?.handelsbenaming}) ${Date.now()-t0}ms`)
        return res.json({ ok: true, plate: best.plate, make: best.data?.merk || "", model: best.data?.handelsbenaming || "", ms: Date.now() - t0 })
      }
    }
    res.json({ ok: false, plate: candidates[0] || ocrPlate, error: "Niet gevonden in RDW", ms: Date.now() - t0 })
  } catch (e) { res.json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   VEHICLE ENRICHED (for mobile app)
   Fetches RDW data + enriches server-side
   ═══════════════════════════════════════════════ */
// ═══ FINNIK DATA FETCH ═══
async function fetchFinnikData(plate) {
  try {
    const cleanPlate = plate.replace(/[\s-]/g, '').toUpperCase()
    const url = 'https://finnik.nl/kenteken/' + cleanPlate
    const resp = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' }
    })
    const html = resp.data || ''
    const result = {}

    // Helper: extract number after label
    const extractNum = (label) => {
      const re = new RegExp(label + '[\\s\\S]*?€\\s*([\\d.,]+)', 'i')
      const m = html.match(re)
      if (m) { const v = m[1].replace(/\./g, '').replace(',', '.'); const num = parseFloat(v); if (num > 0) return Math.round(num) }
      return null
    }

    // Nieuwprijs
    const np = extractNum('Nieuwprijs')
    if (np && np > 1000 && np < 500000) result.catalogPrice = np

    // Waarde-indicatie: € 1,0-2,5k
    const waardeMatch = html.match(/Waarde-indicatie[\s\S]*?€\s*([\d.,]+)\s*-\s*([\d.,]+)\s*k/i)
    if (waardeMatch) {
      result.waardeLow = Math.round(parseFloat(waardeMatch[1].replace(',', '.')) * 1000)
      result.waardeHigh = Math.round(parseFloat(waardeMatch[2].replace(',', '.')) * 1000)
    }

    // BPM
    const bpm = extractNum('(?:Bruto\\s+)?BPM(?!\\s*rest)')
    if (bpm && bpm > 0 && bpm < 100000) result.bpm = bpm

    // Rest BPM
    const restBpm = extractNum('Rest\\s*BPM')
    if (restBpm && restBpm > 0) result.bpmRest = restBpm

    // Bijtellingsklasse
    const bijtMatch = html.match(/Bijtellingsklasse[\s\S]*?(\d+)\s*%/i)
    if (bijtMatch) result.bijtelling = parseInt(bijtMatch[1])

    // Netto bijtelling
    const netBijt = html.match(/Netto bijtelling[\s\S]*?([\d.,]+%:\s*€\s*[\d.,]+[\s\S]*?[\d.,]+%:\s*€\s*[\d.,]+)/i)
    if (netBijt) result.nettoBijtelling = netBijt[1].trim()

    // Wegenbelasting - extract first province
    const wegMatch = html.match(/Wegenbelasting per kwartaal[\s\S]*?((?:[A-Z][a-z\-]+:\s*€\s*[\d.,]+[\s\S]*?){1,12})/i)
    if (wegMatch) {
      const lines = wegMatch[1].match(/([A-Z][a-z\-]+(?:\s+[A-Z][a-z\-]+)?):\s*€\s*([\d.,]+)/g) || []
      result.wegenbelasting = {}
      for (const line of lines.slice(0, 12)) {
        const parts = line.match(/([A-Za-z\-\s]+):\s*€\s*([\d.,]+)/)
        if (parts) result.wegenbelasting[parts[1].trim()] = Math.round(parseFloat(parts[2].replace('.', '').replace(',', '.')))
      }
    }

    // Energielabel / emissieklasse from Finnik
    const energieMatch = html.match(/Energielabel[\s\S]*?([A-G]\+{0,3})/i)
    if (energieMatch) result.energielabel = energieMatch[1]

    if (Object.keys(result).length > 0) {
      console.log('[FINNIK] Data:', Object.keys(result).join(', '))
      return result
    }
    return null
  } catch (e) {
    console.log('[FINNIK] Fetch failed:', e.message)
    return null
  }
}


// ═══ VINACLES API — VIN + NAP + Voertuighistorie ═══
async function vinaclesLookup(plate) {
  const apiKey = getApiKey("VINACLES_API_KEY")
  if (!apiKey) return null
  try {
    const resp = await axios.get(`https://api.vinacles.com/v1/vehicle/${plate}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      timeout: 10000
    })
    if (resp.data) {
      console.log(`[VINACLES] Data received for ${plate}`)
      return {
        vin: resp.data.vin,
        nap: resp.data.nap_check,
        history: resp.data.history,
        specs: resp.data.specifications,
        options: resp.data.options || [],
        recalls: resp.data.recalls || [],
        stolen: resp.data.stolen_check,
        import: resp.data.import_check,
        mileage_history: resp.data.mileage_history || [],
        first_registration: resp.data.first_registration,
        apk_history: resp.data.apk_history || []
      }
    }
  } catch(e) {
    console.log(`[VINACLES] Error for ${plate}: ${e.message}`)
  }
  return null
}

// ═══ RDW Open Data (gratis, geen key nodig) ═══
async function rdwOpenData(plate) {
  const clean = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  try {
    const [voertuig, brandstof, apk] = await Promise.allSettled([
      axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${clean}`, { timeout: 8000 }),
      axios.get(`https://opendata.rdw.nl/resource/8ys7-d773.json?kenteken=${clean}`, { timeout: 8000 }),
      axios.get(`https://opendata.rdw.nl/resource/sgfe-77wx.json?kenteken=${clean}`, { timeout: 8000 })
    ])
    const v = voertuig.status === 'fulfilled' ? voertuig.value?.data?.[0] : null
    const b = brandstof.status === 'fulfilled' ? brandstof.value?.data?.[0] : null
    const a = apk.status === 'fulfilled' ? apk.value?.data : []
    if (!v) return null
    return {
      make: v.merk, model: v.handelsbenaming, year: parseInt(v.datum_eerste_toelating?.slice(0,4)),
      fuel: b?.brandstof_omschrijving, power_kw: parseInt(b?.nettomaximumvermogen || 0),
      mass: parseInt(v.massa_rijklaar || 0), color: v.eerste_kleur,
      body: v.inrichting, doors: parseInt(v.aantal_deuren || 0), seats: parseInt(v.aantal_zitplaatsen || 0),
      cylinder: parseInt(b?.aantal_cilinders || 0), displacement: parseInt(b?.cilinderinhoud || 0),
      transmission: v.typegoedkeuringsnummer?.includes('AUT') ? 'Automaat' : 'Handgeschakeld',
      first_reg: v.datum_eerste_toelating, first_nl: v.datum_eerste_tenaamstelling_in_nederland,
      last_apk: a[0]?.vervaldatum_apk, apk_count: a.length,
      apk_history: a.slice(0, 10).map(x => ({ date: x.vervaldatum_apk, km: x.meldcode_teller_tellerstand })),
      catalog_price: parseInt(v.catalogusprijs || 0), bpm: parseInt(v.bruto_bpm || 0),
      export_indicator: v.export_indicator, wam_verzekerd: v.wam_verzekerd,
      stolen: v.gestolen_indicator === 'J', taxi: v.taxi_indicator === 'J',
      co2: parseInt(b?.co2_uitstoot_gecombineerd || 0), emission_class: b?.euroklasse,
      vin: v.voertuig_identificatienummer || null
    }
  } catch(e) {
    console.log(`[RDW] Open data error for ${plate}: ${e.message}`)
    return null
  }
}

app.get("/api/vehicle/enriched", async (req, res) => {
  try {
    const plate = (req.query.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
    const km = parseInt(req.query.km) || 0
    if (!plate || plate.length < 5) return res.status(400).json({ error: "Ongeldig kenteken" })
    const ck = "vehicle_" + plate
    const cached = getCached(ck)
    if (cached) return res.json(cached)

    const B = "https://opendata.rdw.nl/resource"
    const rdw = async (u) => { try { const r = await axios.get(u, { timeout: 5000 }); return Array.isArray(r.data) ? r.data : [] } catch { return [] } }
    const [mainA, catA, bodyA, fuelA, apkA, recallA, defectA, objectA, meldA, eigenaarA, milieuA, handelsA, brandstofSpecA, typeA, oviA] = await Promise.all([
      rdw(B+"/m9d7-ebf2.json?kenteken="+plate),
      rdw(B+"/8ys7-d773.json?kenteken="+plate),
      rdw(B+"/vezc-m2t6.json?kenteken="+plate),
      rdw(B+"/a34c-35wb.json?kenteken="+plate),
      rdw(B+"/vkij-7mwc.json?kenteken="+plate+"&$limit=100&$order=vervaldatum_keuring DESC"),
      rdw(B+"/t49b-isb7.json?kenteken="+plate),
      rdw(B+"/2u8a-sfar.json?kenteken="+plate+"&$limit=200"),
      rdw(B+"/sghb-dzxx.json?kenteken="+plate),
      rdw(B+"/sgfe-77wx.json?kenteken="+plate+"&$limit=100&$order=meld_datum_door_keuringsinstantie_dt DESC"),
      rdw(B+"/stcx-yhbq.json?kenteken="+plate+"&$limit=50&$order=datum_tenaamstelling DESC"),
      rdw(B+"/242p-gehg.json?kenteken="+plate),
      rdw(B+"/jhie-znh9.json?kenteken="+plate),
      rdw(B+"/55kv-xf7m.json?kenteken="+plate),
      rdw(B+"/mu2w-cjg5.json?kenteken="+plate),
      rdw(B+"/3huj-srit.json?kenteken="+plate)  // OVI: voertuigidentificatienummer (chassis)
    ])
    const d = mainA[0]; if(!d) return res.status(404).json({error:"Kenteken niet gevonden bij RDW"})
    const c = catA[0]||{}, b = bodyA[0]||{}
    const s = v => v ? String(v).trim() : ""
    const n = v => { const x=Number(v); return Number.isFinite(x)&&x>0?x:undefined }
    const fmD = v => { if(!v)return""; const z=String(v).replace(/[-/T:.]/g,"").slice(0,8); return z.length===8?z.slice(6,8)+"-"+z.slice(4,6)+"-"+z.slice(0,4):v }

    // Fuel detection
    let fB=null,fD=null,fE=null,fL=null,fO=null
    for(const fr of (fuelA.length?fuelA:catA)){const bo=s(fr.brandstof_omschrijving).toLowerCase();if(bo.includes("benzine"))fB=fr;else if(bo.includes("diesel"))fD=fr;else if(bo.includes("elektr"))fE=fr;else if(bo.includes("lpg")||bo.includes("cng"))fL=fr;else if(!fO)fO=fr}
    const fP=fB||fD||fE||fL||fO||c
    const isHybrid=!!(fE&&(fB||fD))||/hybr/i.test(s(d.handelsbenaming))
    const isPureEV=!!fE&&!fB&&!fD&&!isHybrid
    const fuelLabel=isHybrid?"Hybride":isPureEV?"Elektrisch":(s(fP.brandstof_omschrijving)||"Onbekend")
    
    // Power
    const normP=v=>{const x=n(v);if(!x)return undefined;return x<1?Math.round(x*1000):Math.round(x)}
    const pwN=normP(n(d.nettomaximumvermogen))||normP(n(c.nettomaximumvermogen))||normP(n(fP.nettomaximumvermogen))
    const pwE=normP(n(d.vermogen_motor_elektrisch))||(fE?normP(n(fE.nominaal_continu_maximumvermogen)):undefined)
    let powerKw=isPureEV?(pwE||pwN):isHybrid?(pwN&&pwN>15?pwN:pwE||pwN):(pwN||pwE)
    const powerHp=powerKw?Math.round(powerKw*1.36):0
    const cc=parseFloat(fP.cilinderinhoud||c.cilinderinhoud)||0
    let catalogPrice=n(d.catalogusprijs)||n(c.catalogusprijs)||0
    const year=parseInt((d.datum_eerste_toelating||"").substring(0,4))||0
    var engineLabel="";if(cc>0)engineLabel=(cc/1000).toFixed(1);if(isHybrid)engineLabel+=" Hybrid";if(isPureEV)engineLabel="EV";if(powerHp>0)engineLabel+=" "+powerHp+"pk"

    // APK + KM history
    const apkHistory=[], kmHistory=[]
    for(const a of apkA){const dt=fmD(a.vervaldatum_keuring||a.datum_keuring);const rs=s(a.beoordeling)||"Goedgekeurd";const kmV=n(a.kilometerstand_op_moment_keuring||a.kilometerstand);apkHistory.push({date:dt,result:rs,km:kmV});if(kmV&&dt)kmHistory.push({date:dt,km:kmV})}
    for(const m of meldA){const kmV=n(m.kilometerstand||m.kilometerstand_op_moment_keuring);const dt=fmD(m.meld_datum_door_keuringsinstantie_dt||m.meld_datum_door_keuringsinstantie);if(kmV&&dt&&!kmHistory.some(k=>k.date===dt&&k.km===kmV))kmHistory.push({date:dt,km:kmV})}
    kmHistory.sort((a,b)=>a.date.split("-").reverse().join("").localeCompare(b.date.split("-").reverse().join("")))
    const kmDed=[];for(const k of kmHistory){const ex=kmDed.find(e=>e.date===k.date);if(ex){if(k.km>ex.km)ex.km=k.km}else kmDed.push({...k})}
    
    // KM analysis
    let kmAnalysis=undefined
    if(kmDed.length>=2){const f=kmDed[0],l=kmDed[kmDed.length-1];const fd=new Date(f.date.split("-").reverse().join("-")),ld=new Date(l.date.split("-").reverse().join("-"));const yrs=Math.max(.5,(ld-fd)/(365.25*24*3600000));const avg=Math.round((l.km-f.km)/yrs);const ySL=(Date.now()-ld)/(365.25*24*3600000);const est=Math.round(l.km+avg*ySL);let anom=undefined;for(let i=1;i<kmDed.length;i++){if(kmDed[i].km-kmDed[i-1].km<-500){anom="Mogelijke tellerterugdraaiing: "+kmDed[i-1].date+" ("+kmDed[i-1].km+" km) -> "+kmDed[i].date+" ("+kmDed[i].km+" km)";break}};kmAnalysis={avgPerYear:avg,estimatedCurrent:est,anomaly:anom,total:kmDed.length}}

    // Recalls
    const recalls=recallA.map(r=>({description:s(r.beschrijving_van_het_defect||r.omschrijving||r.referentiecode_fabrikant),status:s(r.code_status||"Onbekend")}))
    // Installed objects
    const installedObjects=[];for(const o of objectA){const desc=s(o.object_omschrijving||o.omschrijving);if(desc&&!installedObjects.includes(desc))installedObjects.push(desc)}

    // Handelsbenaming (trade/marketing name from RDW)
    const handelsRec = handelsA[0] || {}
    const handelsbenaming = s(handelsRec.handelsbenaming || '')

    // Brandstof-specifiek (detailed fuel consumption from RDW)
    const bsRec = brandstofSpecA[0] || {}
    const verbruikGecomb = parseFloat(bsRec.brandstofverbruik_gecombineerd_wltp || bsRec.brandstofverbruik_gecombineerd || 0) || 0
    const verbruikStad = parseFloat(bsRec.brandstofverbruik_stad_wltp || bsRec.brandstofverbruik_stad || 0) || 0
    const verbruikSnelweg = parseFloat(bsRec.brandstofverbruik_buiten_wltp || bsRec.brandstofverbruik_buiten_de_stad || 0) || 0
    const actieradius = n(bsRec.actieradius_enkel_elektrisch_wltp || bsRec.actieradius_extern_opladen_wltp || bsRec.actieradius_enkel_elektrisch_stad_wltp)

    // Typegoedkeuring (EU type approval — extra specs from RDW)
    const typeRec = typeA[0] || {}
    const typegoedkeuringNr = s(typeRec.typegoedkeuringsnummer || '')
    const euVariant = s(typeRec.eu_type_goedkeuringssleutel || typeRec.variant || '')

    // Defects (basic - just codes)
    const defects=defectA.map(x=>({date:fmD(x.meld_datum_door_keuringsinstantie),code:s(x.gebrek_identificatie),description:s(x.gebrek_identificatie)})).sort((a,b)=>b.date.split("-").reverse().join("").localeCompare(a.date.split("-").reverse().join("")))

    // Ownership history (tenaamstellingen)
    const ownerCount = eigenaarA.length || 0
    const ownerHistory = eigenaarA.slice(0,20).map(e => ({
      date: fmD(e.datum_tenaamstelling),
      soort: s(e.soort_eigenaar_tenaamstelling) // Particulier, Bedrijf, etc.
    }))
    const lastOwnerType = ownerHistory.length > 0 ? ownerHistory[0].soort : null
    const isExDealer = ownerHistory.some(o => (o.soort||'').toLowerCase().includes('bedrijf') || (o.soort||'').toLowerCase().includes('rechtspersoon'))

    // Milieu/emissions data
    const milieuRec = milieuA[0] || {}
    const emissieKlasse = s(milieuRec.emissieklasse_eg_goedkeuring_zwaar || d.euroklasse || milieuRec.milieuklasse_eg_goedkeuring_licht || '')
    const roetFilter = s(milieuRec.roetfilter || '')
    const fijnstof = n(milieuRec.uitstoot_deeltjes_licht || milieuRec.uitstoot_deeltjes_zwaar)
    const nox = n(milieuRec.emissie_co2_gecombineerd_wltp || milieuRec.emissie_co2_gecombineerd)

    // BPM rest calculation — official PIT gids afschrijvingstabel (02-01-2025)
    // Table: [months_from, base_pct, monthly_add_pct]
    const bpmNieuw = parseFloat(d.bruto_bpm) || 0
    let bpmRest = 0, bpmRestPct = 0
    if (bpmNieuw > 0) {
      const vehAge = year > 0 ? (new Date().getFullYear() - year) : 0
      const firstUseDate = d.datum_eerste_toelating || d.datum_eerste_tenaamstelling_in_nederland || ''
      let ageMonths = vehAge * 12
      if (firstUseDate) {
        try {
          const fd = new Date(String(firstUseDate).replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
          if (!isNaN(fd)) ageMonths = Math.max(0, Math.floor((Date.now() - fd.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
        } catch(e){}
      }
      // Official table: [min_months, base_depreciation%, monthly_add%]
      const bpmTable = [
        [0, 0, 12],       // 0 dagen - 1 mnd: 0% + 12%/mnd
        [1, 12, 4],       // 1-3 mnd: 12% + 4%/mnd
        [3, 20, 3.5],     // 3-5 mnd: 20% + 3.5%/mnd
        [5, 27, 1.5],     // 5-9 mnd: 27% + 1.5%/mnd
        [9, 33, 1],       // 9-18 mnd: 33% + 1%/mnd
        [18, 42, 0.75],   // 18-30 mnd: 42% + 0.75%/mnd
        [30, 51, 0.5],    // 30-42 mnd: 51% + 0.5%/mnd
        [42, 57, 0.42],   // 42-54 mnd: 57% + 0.42%/mnd
        [54, 62, 0.42],   // 54-66 mnd: 62% + 0.42%/mnd
        [66, 67, 0.42],   // 66-78 mnd: 67% + 0.42%/mnd
        [78, 72, 0.25],   // 78-90 mnd: 72% + 0.25%/mnd
        [90, 75, 0.25],   // 90-102 mnd: 75% + 0.25%/mnd
        [102, 78, 0.25],  // 102-114 mnd: 78% + 0.25%/mnd
        [114, 81, 0.19],  // 114+ mnd: 81% + 0.19%/mnd
      ]
      let depPct = 0
      for (let t = bpmTable.length - 1; t >= 0; t--) {
        if (ageMonths >= bpmTable[t][0]) {
          depPct = bpmTable[t][1] + (ageMonths - bpmTable[t][0]) * bpmTable[t][2]
          break
        }
      }
      depPct = Math.min(depPct, 100)
      bpmRest = Math.round(bpmNieuw * (1 - depPct / 100))
      if (bpmRest < 0) bpmRest = 0
    }
    bpmRestPct = bpmNieuw > 0 ? Math.round(bpmRest / bpmNieuw * 100) : 0

    // Finnik data enrichment (nieuwprijs, waarde-indicatie, bijtelling, wegenbelasting)
    let finnikData = null
    let finnikSource = false
    try {
      const plate = req.query.plate || req.query.kenteken || ''
      if (plate) {
        finnikData = await fetchFinnikData(plate)
        if (finnikData) {
          finnikSource = true
          if (!catalogPrice && finnikData.catalogPrice) {
            catalogPrice = finnikData.catalogPrice
            console.log('[FINNIK] Nieuwprijs aangevuld:', catalogPrice)
          }
        }
      }
    } catch(fe) { console.log('[FINNIK] Skip:', fe.message) }

    // ═══ AUTOSCOUT24 WAARDEBEPALING (gratis ML-based tool) ═══
    let as24Waarde = null
    try {
      const mkL = s(d.merk).toLowerCase(), mlL = s(d.handelsbenaming).toLowerCase()
      const asUrl = `https://www.autoscout24.nl/auto-waardebepaling/result/?make=${encodeURIComponent(mkL)}&model=${encodeURIComponent(mlL)}&firstRegistration=${year}&fuelType=${fuelLabel.toLowerCase().includes('benzine')?'B':fuelLabel.toLowerCase().includes('diesel')?'D':fuelLabel.toLowerCase().includes('elek')?'E':'B'}&bodyType=${s(d.inrichting).toLowerCase().includes('sedan')?'sedan':s(d.inrichting).toLowerCase().includes('hatchback')?'hatchback':'suv'}&hp=${powerHp||0}&mileage=${km||50000}`
      const asResp = await axios.get(asUrl, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } })
      const asHtml = asResp.data || ''
      // Try to extract price from page
      const asMatch = asHtml.match(/(?:waarde|value|prijs)[^€]*€\s*([\d.,]+)/i) || asHtml.match(/€\s*([\d]{1,3}(?:[.]\d{3})*(?:,\d{2})?)/g)
      if (asMatch) {
        const prices = (Array.isArray(asMatch) ? asMatch : [asMatch[0]]).map(m => {
          const p = parseInt(String(m).replace(/[^0-9]/g, ''), 10)
          return p > 500 && p < 200000 ? p : 0
        }).filter(p => p > 0)
        if (prices.length) {
          as24Waarde = { low: Math.min(...prices), high: Math.max(...prices), source: 'autoscout24_waardebepaling' }
          console.log('[AS24-WAARDE] Found:', as24Waarde)
        }
      }
    } catch(e) { console.log('[AS24-WAARDE] Skip:', e.message) }

    // ═══ ANWB KOERSLIJST (gratis, conservatief maar betrouwbaar) ═══
    let anwbWaarde = null
    try {
      const cleanP = plate.replace(/[\s-]/g, '').toUpperCase()
      const anwbResp = await axios.get(`https://www.anwb.nl/auto/koerslijst/${cleanP}`, {
        timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }
      })
      const anwbHtml = anwbResp.data || ''
      // Extract values: "Inruilwaarde", "Verkoopwaarde", "Nieuwprijs"
      const extractAnwb = (label) => {
        const re = new RegExp(label + '[\\s\\S]*?€\\s*([\\d.,]+)', 'i')
        const m = anwbHtml.match(re)
        if (m) { const v = m[1].replace(/\\./g, '').replace(',', '.'); const num = parseFloat(v); if (num > 0) return Math.round(num) }
        return null
      }
      const inruil = extractAnwb('Inruilwaarde')
      const verkoop = extractAnwb('(?:Verkoop|Particulier).*waarde')
      const nieuw = extractAnwb('Nieuwprijs')
      if (inruil || verkoop) {
        anwbWaarde = { inruilwaarde: inruil, verkoopwaarde: verkoop, nieuwprijs: nieuw, source: 'anwb_koerslijst' }
        console.log('[ANWB] Found:', anwbWaarde)
        if (!catalogPrice && nieuw && nieuw > 1000) { catalogPrice = nieuw; console.log('[ANWB] Nieuwprijs aangevuld:', nieuw) }
      }
    } catch(e) { console.log('[ANWB] Skip:', e.message) }

    // ═══ VIN DECODE — AI-based COMPLETE vehicle intelligence ═══
    const vin = s(d.voertuig_identificatienummer) || s((oviA[0]||{}).voertuig_identificatienummer) || ""
    const rdwType = s(d.type), rdwVariant = s(d.variant), rdwUitvoering = s(d.uitvoering)
    let vinData = { transmission: null, transmissionDetail: null, motorCode: null, generation: null, trimLevel: null, drivetrain: null }
    
    // Trigger: need at least make+model OR type/variant codes
    const hasMakeModel = s(d.merk) && s(d.handelsbenaming)
    const hasTypeCodes = rdwType || rdwVariant || rdwUitvoering
    
    if (hasMakeModel && (hasTypeCodes || vin)) {
      const vinCk = "vin3_" + (vin || plate) + "_" + (km||0)
      const vinCached = getCached(vinCk, 86400000) // 24h cache
      if (vinCached) {
        vinData = vinCached
        console.log('[VIN] Cached:', vin, vinData.transmission)
      } else {
        try {
          const vinKey = getApiKey("OPENAI_API_KEY")
          if (vinKey && vinKey !== "sk-...") {
            console.log(`[VIN] Starting decode: ${s(d.merk)} ${s(d.handelsbenaming)} | Type:${rdwType} Var:${rdwVariant} Uitv:${rdwUitvoering} | VIN:${vin||'n/a'} | Key:${vinKey.slice(0,8)}...`)
            const vinResp = await axios.post("https://api.openai.com/v1/chat/completions", {
              model: "gpt-4o", temperature: 0, max_tokens: 1500,
              messages: [{
                role: "system",
                content: `Je bent een expert automotive analist. Analyseer het voertuig op basis van de RDW Type/Variant/Uitvoering codes, bouwjaar en vermogen.

REGELS:
- Geef ALLEEN informatie die je ZEKER weet op basis van de codes en het bouwjaar
- Motorcode: kies de ENIGE juiste code voor dit bouwjaar (bijv BMW 320i 2013 = N20B20, NIET B48)
- Opties: ALLEEN wat STANDAARD is bij deze uitvoering/trim. NIET gokken op extra opties
- Als je iets niet zeker weet: laat het veld LEEG (null/[])
- GEEN Harman Kardon, panoramadak, camera etc toekennen tenzij standaard bij trim
- Interior kleur is NIET af te leiden uit RDW data — laat leeg
- likelyOptions moet LEEG blijven — we kunnen opties niet verifiëren

Antwoord ALLEEN in JSON:
{
  "specificModel": "het EXACTE commerciële modelnaam (bijv '320i', 'Golf R-Line', 'A180', 'Yaris Cross', 'C5 Aircross'). Dit is hoe de auto op Marktplaats/AutoScout24 wordt aangeboden. NIET de RDW handelsbenaming.",
  "marketSearchName": "zoekterm voor marktplaatsen (bijv '320i' of 'golf 1.4 tsi' of 'a180'). Kort en specifiek.",
  "transmission": "Automaat" of "Handgeschakeld",
  "transmissionDetail": "bijv ZF 8-traps",
  "motorCode": "ENKELE correcte code voor dit bouwjaar",
  "generation": "bijv F30",
  "trimLevel": "bijv Luxury Line / M-Sport / SE",
  "drivetrain": "FWD/RWD/AWD",
  "gearCount": 8,
  "cylinders": 4,
  "turbo": true,
  "timingType": "Ketting" of "Distributieriem",
  "timingReplace": "bijv Niet nodig (ketting levenslang)",

  "standardEquipment": ["ALLEEN items die ZEKER standaard zijn bij deze trim, max 8"],
  "likelyOptions": [],
  "optionPackage": null,
  "interior": null,
  "interiorColor": null,
  "audioSystem": null,
  "naviType": null,
  "roofType": null,
  "wheelSize": "standaard voor deze trim of null",
  "camera": null,
  "driverAssist": [],
  "towbar": null,
  "heatedSeats": null,
  "heatedSteeringWheel": null,
  "headlightType": "standaard bij trim of null",
  "parkingSensors": "standaard bij trim of null",

  "knownIssues": ["ECHTE bekende problemen voor dit model+motor, max 5"],
  "maintenanceAdvice": "specifiek voor deze motor en km-stand, max 2 zinnen",
  "engineRiskProfile": "Laag/Gemiddeld/Hoog",
  "engineRiskDetail": "1 zin waarom",
  "expectedMaintenanceCost": 1200,

  "optionPriceImpact": [{"option":"Automaat","impact":1000}],
  "courantScore": 7,
  "courantExplain": "1 zin",
  "targetAudience": "doelgroep",
  "salesChannelAdvice": "kanaal",
  "sellingPoints": ["max 4 punten gebaseerd op FEITEN"],
  "dealBreakers": ["max 3"]
}`
              }, {
                role: "user",
                content: `${vin?'VIN: '+vin+'\n':''}Merk: ${s(d.merk)}\nModel: ${s(d.handelsbenaming)}\nType: ${rdwType||'?'}\nVariant: ${rdwVariant||'?'}\nUitvoering: ${rdwUitvoering||'?'}\nTypegoedkeuring: ${typegoedkeuringNr||'?'}\nBouwjaar: ${year}\nBrandstof: ${fuelLabel}\nVermogen: ${powerHp}pk\nCC: ${cc||'?'}\nGewicht: ${n(d.massa_rijklaar)||'?'}kg\nCarrosserie: ${s(d.inrichting)}\nKleur: ${s(d.eerste_kleur)}\nKM-stand: ${km||'onbekend'}\nAantal eigenaren: ${ownerCount||'?'}\nAPK tot: ${fmD(d.vervaldatum_apk)||'?'}\n1e toelating: ${fmD(d.datum_eerste_toelating)||'?'}\nNL toelating: ${fmD(d.datum_eerste_tenaamstelling_in_nederland)||'?'}`
              }]
            }, { headers: { "Authorization": "Bearer " + vinKey, "Content-Type": "application/json" }, timeout: 15000 })
            
            let vinTxt = String(vinResp.data?.choices?.[0]?.message?.content || '{}')
            vinTxt = vinTxt.replace(/```json/g, '').replace(/```/g, '').trim()
            // Robust JSON recovery: fix common truncation issues
            if (!vinTxt.endsWith('}')) {
              const openBrackets = (vinTxt.match(/\[/g)||[]).length - (vinTxt.match(/\]/g)||[]).length
              const openBraces = (vinTxt.match(/\{/g)||[]).length - (vinTxt.match(/\}/g)||[]).length
              vinTxt = vinTxt.replace(/,\s*"[^"]*"?\s*:?\s*[^}\]]*$/, '')
              for (let i = 0; i < openBrackets; i++) vinTxt += ']'
              for (let i = 0; i < openBraces; i++) vinTxt += '}'
              console.log('[VIN] Repaired truncated JSON')
            }
            const parsed = JSON.parse(vinTxt)
            vinData = { ...vinData, ...parsed }
            setCache(vinCk, vinData)
            console.log(`[VIN] ✓ Full decode: ${vin} → ${vinData.specificModel||'?'} | ${vinData.transmission} | ${vinData.motorCode} | ${vinData.generation} | ${vinData.trimLevel} | ${(vinData.standardEquipment||[]).length} std + ${(vinData.likelyOptions||[]).length} opts | risk: ${vinData.engineRiskProfile} | courant: ${vinData.courantScore}`)
          } else {
            console.log('[VIN] ✗ No OpenAI API key configured')
          }
        } catch(ve) {
          console.error('[VIN] ✗ Decode failed:', ve.message)
        }
      }
    }

    const isAuto = vinData.transmission?.toLowerCase()?.includes('automaat') || vinData.transmission?.toLowerCase()?.includes('automatic') || false
    const transmissionType = vinData.transmission || null
    const transmissionDetail = vinData.transmissionDetail || null

    const result = {
      make:s(d.merk), model:s(d.handelsbenaming), subModel: vinData.specificModel || vinData.marketSearchName || s(d.handelsbenaming),
      marketSearchName: vinData.marketSearchName || null, specificModel: vinData.specificModel || null,
      modelVariant:[d.type,d.variant,d.uitvoering].filter(x=>x&&String(x).trim()).map(x=>String(x).trim()).join(" ")||"",
      year, fuel:fuelLabel, km:km||parseInt(d.tellerstandoordeel_afgelezen_waarde)||0,
      color:s(d.eerste_kleur), colorSecondary:s(d.tweede_kleur), body:s(d.inrichting||b.type_carrosserie_europese_omschrijving||""),
      powerKw:powerKw||0, powerHp, engineLabel, catalogPrice, cc,
      bpm:parseFloat(d.bruto_bpm)||0, weightKg:n(d.massa_rijklaar)||n(d.massa_ledig_voertuig)||0,
      transmissionAuto:isAuto, transmissionType, transmissionDetail,
      vin, motorCode: vinData.motorCode || null, generation: vinData.generation || null,
      trimLevel: vinData.trimLevel || null, drivetrain: vinData.drivetrain || null,
      gearCount: vinData.gearCount || null,
      // Blok 1: Uitgebreide technische specs
      cylinders: vinData.cylinders || null, turbo: vinData.turbo || null,
      timingType: vinData.timingType || null, timingReplace: vinData.timingReplace || null,
      tireSize: vinData.tireSize || null, wheelSize: vinData.wheelSize || null,
      // Blok 1: Uitrusting & opties
      standardEquipment: vinData.standardEquipment || [], likelyOptions: vinData.likelyOptions || [],
      optionPackage: vinData.optionPackage || null, interior: vinData.interior || null,
      interiorColor: vinData.interiorColor || null, audioSystem: vinData.audioSystem || null,
      naviType: vinData.naviType || null, roofType: vinData.roofType || null,
      camera: vinData.camera || null, driverAssist: vinData.driverAssist || [],
      towbar: vinData.towbar || false, heatedSeats: vinData.heatedSeats || false,
      heatedSteeringWheel: vinData.heatedSteeringWheel || false,
      headlightType: vinData.headlightType || null, parkingSensors: vinData.parkingSensors || null,
      // Blok 2: Risico-analyse
      knownIssues: vinData.knownIssues || [], maintenanceAdvice: vinData.maintenanceAdvice || null,
      engineRiskProfile: vinData.engineRiskProfile || null, engineRiskDetail: vinData.engineRiskDetail || null,
      expectedMaintenanceCost: vinData.expectedMaintenanceCost || null,
      warrantyStatus: vinData.warrantyStatus || null,
      // Blok 3: Courantheid & verkoopadvies
      optionPriceImpact: vinData.optionPriceImpact || [],
      courantScore: vinData.courantScore || null, courantExplain: vinData.courantExplain || null,
      targetAudience: vinData.targetAudience || null, salesChannelAdvice: vinData.salesChannelAdvice || null,
      sellingPoints: vinData.sellingPoints || [], dealBreakers: vinData.dealBreakers || [],
      apkUntil:fmD(d.vervaldatum_apk),
      importFlag:s(d.datum_eerste_tenaamstelling_in_nederland)&&s(d.datum_eerste_toelating)&&s(d.datum_eerste_tenaamstelling_in_nederland)!==s(d.datum_eerste_toelating),
      stolenFlag:s(d.gestolen_indicator)==="Ja", exportFlag:s(d.export_indicator)==="Ja",
      wamInsured:s(d.wam_verzekerd)==="Ja", taxiIndicator:s(d.taxi_indicator)==="Ja",
      doors:parseInt(d.aantal_deuren)||null, seats:parseInt(d.aantal_zitplaatsen)||null,
      firstAdmission:fmD(d.datum_eerste_toelating), firstAdmissionNL:fmD(d.datum_eerste_tenaamstelling_in_nederland),
      registrationDateNL:fmD(d.datum_eerste_tenaamstelling_in_nederland),
      registrationDate:fmD(d.datum_tenaamstelling), plateStatus:s(d.tenaamstellen_mogelijk)==="Ja"?"Geldig":"Onbekend",
      topSpeed:n(d.maximum_snelheid), towWeight:n(d.maximum_massa_samenstelling||d.aanhangwagen_geremd),
      vehicleType:s(d.voertuigsoort), isHybrid, isPureEV,
      co2:n(fP.co2_uitstoot_gecombineerd||c.co2_uitstoot_gecombineerd),
      euroClass:s(fP.euroklasse||d.euroklasse||c.euroklasse),
      fuelConsumption:n(fP.brandstofverbruik_gecombineerd||c.brandstofverbruik_gecombineerd||fP.brandstofverbruik_gecombineerd_wltp||c.brandstofverbruik_gecombineerd_wltp),
      fuelConsumptionCity:n(fP.brandstofverbruik_stad||c.brandstofverbruik_stad||fP.brandstofverbruik_stad_wltp||c.brandstofverbruik_stad_wltp),
      fuelConsumptionHighway:n(fP.brandstofverbruik_buitenweg||c.brandstofverbruik_buitenweg||fP.brandstofverbruik_buitenweg_wltp||c.brandstofverbruik_buitenweg_wltp),
      mrb:(n(d.belasting_kwartaal_minimum)||n(d.belasting_kwartaal_maximum))?Math.round((n(d.belasting_kwartaal_minimum)||n(d.belasting_kwartaal_maximum))*4):undefined,
      taxQuarterMin:n(d.belasting_kwartaal_minimum), taxQuarterMax:n(d.belasting_kwartaal_maximum),
      lengthMm:n(b.lengte_voertuig||d.lengte), widthMm:n(b.breedte_voertuig||d.breedte),
      wheelbase:n(d.wielbasis), electricRange:n((fE||fP).actie_radius_enkel_elektrisch_wltp),
      // History data
      apkHistory, kmHistory:kmDed, kmAnalysis, recalls, defects, installedObjects,
      inspectionCount:meldA.length||undefined,
      equipmentLevel:"", source:{rdw:true,finnik:finnikSource,as24:!!as24Waarde,anwb:!!anwbWaarde},
      finnikData: finnikData || null,
      as24Waarde: as24Waarde || null,
      anwbWaarde: anwbWaarde || null,
      // Ownership
      ownerCount, ownerHistory: ownerHistory.slice(0,10), lastOwnerType, isExDealer,
      // Milieu
      emissieKlasse: emissieKlasse || null, roetFilter: roetFilter || null,
      // BPM rest (calculated)
      bpmRest, bpmRestPct, bpmNieuw,
      // Finnik extra
      bijtelling: finnikData?.bijtelling || null,
      nettoBijtelling: finnikData?.nettoBijtelling || null,
      wegenbelasting: finnikData?.wegenbelasting || null,
      energielabel: finnikData?.energielabel || null,
      // Extra RDW data
      handelsbenaming: handelsbenaming || null,
      verbruik: verbruikGecomb > 0 ? { gecombineerd: verbruikGecomb, stad: verbruikStad || null, snelweg: verbruikSnelweg || null } : null,
      actieradius: actieradius || null,
      typegoedkeuringNr: typegoedkeuringNr || null,
      euVariant: euVariant || null,
      typeApproval: s(d.typegoedkeuringsnummer),
      typeVariant: s(d.type), typeVersion: s(d.variant), typeUitvoering: s(d.uitvoering)
    }
    setCache(ck, result); res.json(result)
  } catch(e){ console.error("[API] vehicle/enriched error:",e.message); res.status(500).json({error:"RDW ophalen mislukt: "+e.message}) }
})


/* ── Vehicle Image (catalog photo) ────────── */
app.get("/api/image", async (req, res) => {
  const make = (req.query.make || "").trim()
  const model = (req.query.model || "").trim()
  const year = parseInt(req.query.year) || 0
  const variant = (req.query.variant || "").trim()
  const generation = (req.query.generation || "").trim()
  if (!make || !model) return res.json({ url: "" })

  // Clean model name: remove make prefix, trim generation codes
  const cleanModel = model.replace(new RegExp("^" + make + "\\s+", "i"), "").trim()
  const modelBase = cleanModel.split(/\s+/)[0] // First word only: "AYGO" from "AYGO X-PLAY"
  const genTag = generation || "" // e.g. "F30", "W205", "8Y"

  const ck = "img_" + make + "_" + cleanModel + "_" + year + "_" + genTag
  const cached = getCached(ck, 86400000 * 7) // 7 day cache
  if (cached) return res.json(cached)

  const ua = { "User-Agent": "CarDatax/2.0 (automotive-data-platform)" }
  const ok = (url) => { const r = { url, source: "auto" }; setCache(ck, r); return res.json(r) }

  try {
    // Determine generation for Wikipedia search
    // Most cars have 5-8 year generation cycles
    const genStart = Math.floor(year / 7) * 7 // approximate generation grouping

    // Map model to Wikipedia series name (320i → 3 Series, A4 → Audi A4, C200 → C-Class)
    const seriesName = (() => {
      const ml = modelBase.toLowerCase()
      if (make === 'BMW') {
        if (/^[1-8]\d{2}/i.test(ml)) return make + ' ' + ml[0] + ' Series'
        if (/^x[1-7]/i.test(ml)) return make + ' ' + ml.toUpperCase().slice(0,2)
        if (/^z[1-4]/i.test(ml)) return make + ' ' + ml.toUpperCase().slice(0,2)
        if (/^m[1-8]/i.test(ml)) return make + ' ' + ml.toUpperCase()
      }
      if (make === 'MERCEDES-BENZ' || make === 'MERCEDES') {
        if (/^[a-c]\s?\d/i.test(ml)) return 'Mercedes-Benz ' + ml[0].toUpperCase() + '-Class'
        if (/^[e-s]\s?\d/i.test(ml)) return 'Mercedes-Benz ' + ml[0].toUpperCase() + '-Class'
        if (/^gl[a-s]/i.test(ml)) return 'Mercedes-Benz ' + ml.toUpperCase().slice(0,3)
      }
      return null
    })()

    // ── Strategy 1: Wikipedia NL ──
    const nlSearches = [
      genTag && seriesName ? `${seriesName} (${genTag})` : null,
      genTag ? `${make} ${modelBase} (${genTag})` : null,
      seriesName || null,
      `${make} ${modelBase}`,
    ].filter(Boolean)
    for (const q of nlSearches) {
      try {
        const url = `https://nl.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(q)}&prop=pageimages&format=json&pithumbsize=800&redirects=1`
        const r = await axios.get(url, { timeout: 4000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          if (p.thumbnail?.source && p.thumbnail.width > 200) return ok(p.thumbnail.source)
        }
      } catch {}
    }

    // ── Strategy 2: Wikipedia EN with series names ──
    const enSearches = [
      genTag && seriesName ? `${seriesName} (${genTag})` : null,
      genTag ? `${make} ${genTag}` : null,
      seriesName || null,
      `${make} ${modelBase}`,
      `${make} ${modelBase} (car)`,
    ].filter(Boolean)
    for (const q of enSearches) {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(q)}&prop=pageimages&format=json&pithumbsize=800&redirects=1`
        const r = await axios.get(url, { timeout: 4000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          // Filter: must be wider than tall (landscape = real car photo, not logo/icon)
          if (p.thumbnail?.source && p.thumbnail.width > 200) {
            const w = p.thumbnail.width || 0, h = p.thumbnail.height || 0
            if (w > h * 0.8) return ok(p.thumbnail.source) // at least roughly landscape
          }
        }
      } catch {}
    }

    // ── Strategy 3: Wikipedia search API (broader) ──
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(make + " " + modelBase + " car automobile")}&gsrlimit=8&prop=pageimages&format=json&pithumbsize=800`
      const r = await axios.get(searchUrl, { timeout: 5000, headers: ua })
      const pages = r.data?.query?.pages || {}
      // Score pages by relevance
      const candidates = Object.values(pages).filter(p => p.thumbnail?.source && p.thumbnail.width > 200)
      // Prefer pages whose title contains the model name
      const best = candidates.find(p => p.title?.toLowerCase().includes(modelBase.toLowerCase())) || candidates[0]
      if (best) return ok(best.thumbnail.source)
    } catch {}

    // ── Strategy 4: Wikimedia Commons (largest free image library) ──
    const commonsSearches = [
      `${make} ${modelBase} ${genTag || year}`,
      `${make} ${modelBase}`,
      `${make} ${cleanModel} automobile`,
    ]
    for (const q of commonsSearches) {
      try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=8&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=800&format=json`
        const r = await axios.get(url, { timeout: 5000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          const ii = p.imageinfo?.[0]
          if (!ii) continue
          // Filter: must be JPEG/PNG, landscape, decent size
          const mime = ii.mime || ""
          if (!mime.includes("jpeg") && !mime.includes("png")) continue
          const w = ii.width || 0, h = ii.height || 0
          if (w < 400 || h < 200) continue
          if (w < h) continue // skip portrait images
          const thumbUrl = ii.thumburl || ii.url
          if (thumbUrl) return ok(thumbUrl)
        }
      } catch {}
    }

    // ── Strategy 5: Placeholder with make/model text ──
    setCache(ck, { url: "" })
    res.json({ url: "" })
  } catch { res.json({ url: "" }) }
})

/* ═══════════════════════════════════════════════
   GENERATE CAR IMAGES — DALL-E 3 (4 hoeken)
   ═══════════════════════════════════════════════ */
const GENERATED_DIR = path.join(DATA_DIR, "photos", "generated")
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true })
app.use("/photos/generated", express.static(GENERATED_DIR))

// Dutch → English color mapping for DALL-E prompts
const COLOR_MAP = {
  ZWART:"black",GRIJS:"grey",WIT:"white",BLAUW:"dark blue",ROOD:"red",GROEN:"green",
  GEEL:"yellow",BRUIN:"brown",ORANJE:"orange",PAARS:"purple",BEIGE:"beige",CREME:"cream",
  ZILVER:"silver",ANTRACIET:"anthracite grey",GROEN:"green",DIVERSEN:"dark grey",
  "LICHT BLAUW":"light blue","DONKER BLAUW":"dark blue","LICHT GRIJS":"light grey",
  "DONKER GRIJS":"dark grey","DONKER ROOD":"dark red","LICHT GROEN":"light green"
}

// Body type mapping
const BODY_MAP = {
  hatchback:"hatchback",sedan:"sedan",stationwagen:"station wagon",suv:"SUV",
  "sports utility vehicle":"SUV",cabriolet:"convertible",coupe:"coupe",coupé:"coupe",
  mpv:"MPV minivan",bus:"van",bedrijfswagen:"van",bestelwagen:"cargo van",
  "open terreinwagen":"open-top SUV",terreinwagen:"off-road SUV",pickup:"pickup truck"
}

app.post("/api/generate-car-images", express.json(), async (req, res) => {
  try {
    const { make, model, year, color, colorSecondary, body, plate, variant, generation, subModel, trimLevel } = req.body
    if (!make || !model) return res.status(400).json({ error: "make + model vereist" })

    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey || apiKey === "sk-...") return res.status(500).json({ error: "OpenAI API key niet geconfigureerd" })

    // Create plate-based folder for caching
    const plateClean = (plate || "AUTO").replace(/[^A-Z0-9]/gi, "").toUpperCase() || "UNKNOWN"
    const cacheDir = path.join(GENERATED_DIR, plateClean)

    // Check cache — if all 5 exist, return immediately
    const angles = ["1-front", "2-front-right", "3-right", "4-rear", "5-left"]
    const cached = angles.every(a => fs.existsSync(path.join(cacheDir, a + ".png")))
    if (cached) {
      console.log(`[IMG] Cache hit for ${plateClean}`)
      return res.json({
        ok: true, cached: true,
        images: angles.map(a => ({ angle: a, url: `/photos/generated/${plateClean}/${a}.png` }))
      })
    }

    // Build the car description
    const colorEn = COLOR_MAP[(color || "").toUpperCase()] || (color || "grey").toLowerCase()
    const colorDesc = colorSecondary ? `${colorEn} with ${COLOR_MAP[(colorSecondary||"").toUpperCase()]||colorSecondary.toLowerCase()} accents` : `${colorEn} metallic`
    const bodyEn = BODY_MAP[(body || "").toLowerCase()] || (body || "hatchback").toLowerCase()
    const trimInfo = [variant, generation, subModel, trimLevel].filter(Boolean).join(" ")
    const carDesc = `${year || 2020} ${make} ${model}${trimInfo ? " " + trimInfo : ""}, ${bodyEn}, ${colorDesc}`

    // 5 turntable angles — include plate text so DALL-E picks the right model, UI overlay corrects the text
    const plateText = plate || "XX-999-X"
    const scene = `Photorealistic car dealership photograph of a ${carDesc}. The car is centered on a round dark glossy turntable platform. Smooth gradient grey studio background, bright professional automotive lighting that clearly illuminates the entire car, soft reflections on the polished dark floor. No people, no text overlays, no watermarks. Do not add any aftermarket parts, stripes, accents, body kits or modifications — show the car exactly as it comes from the factory.`
    const prompts = [
      { angle: "1-front",       prompt: `${scene} Front 3/4 view. Dutch yellow license plate reading "${plateText}" on the front bumper.` },
      { angle: "2-front-right", prompt: `${scene} Front-right 45 degree angle showing grille and passenger side. Dutch yellow license plate on front bumper.` },
      { angle: "3-right",       prompt: `${scene} Perfect right side profile, full car visible front to rear bumper. IMPORTANT: Do NOT show any yellow Dutch license plate. Instead show a plain white rectangular dealer plate with only the word "CarDatax" in dark text, like a showroom display plate used by car dealers.` },
      { angle: "4-rear",        prompt: `${scene} Rear 3/4 view. Dutch yellow license plate reading "${plateText}" on the rear bumper.` },
      { angle: "5-left",        prompt: `${scene} Perfect left side profile, full car visible front to rear bumper. IMPORTANT: Do NOT show any yellow Dutch license plate. Instead show a plain white rectangular dealer plate with only the word "CarDatax" in dark text, like a showroom display plate used by car dealers.` }
    ]

    console.log(`[IMG] Generating 4 images for ${make} ${model} (${plateClean})...`)

    // Create cache dir
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

    // Call DALL-E 3 for all 4 angles in parallel
    const results = await Promise.allSettled(prompts.map(async ({ angle, prompt }) => {
      try {
        const dalleResp = await axios.post("https://api.openai.com/v1/images/generations", {
          model: "gpt-image-1.5",
          prompt,
          n: 1,
          size: "1536x1024",
          quality: "medium",
        }, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 120000 // 2 min per image
        })

        const b64 = dalleResp.data?.data?.[0]?.b64_json
        if (!b64) throw new Error("No image URL in response")

        const savePath = path.join(cacheDir, angle + ".png")
        fs.writeFileSync(savePath, Buffer.from(b64, "base64"))

        console.log(`[IMG] ✓ ${angle} saved for ${plateClean}`)
        return { angle, url: `/photos/generated/${plateClean}/${angle}.png` }
      } catch (err) {
        console.error(`[IMG] ✗ ${angle} failed:`, err.response?.data?.error?.message || err.message)
        return { angle, url: "", error: err.response?.data?.error?.message || err.message }
      }
    }))

    const images = results.map(r => r.status === "fulfilled" ? r.value : { angle: "?", url: "", error: "Failed" })
    const successCount = images.filter(i => i.url).length

    console.log(`[IMG] Done: ${successCount}/4 images generated for ${plateClean}`)
    res.json({ ok: true, cached: false, generated: successCount, images })

  } catch (err) {
    console.error("[IMG] Error:", err.message)
    res.status(500).json({ error: err.message })
  }
})

// Quick check if generated images exist (no generation, just cache check)
app.get("/api/car-images/:plate", (req, res) => {
  const plateClean = (req.params.plate || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()
  if (!plateClean) return res.json({ ok: false })
  const cacheDir = path.join(GENERATED_DIR, plateClean)
  const angles = ["1-front", "2-front-right", "3-right", "4-rear", "5-left"]
  const images = angles.map(a => {
    const exists = fs.existsSync(path.join(cacheDir, a + ".png"))
    return { angle: a, url: exists ? `/photos/generated/${plateClean}/${a}.png` : "" }
  }).filter(i => i.url)
  res.json({ ok: images.length > 0, images })
})

/* ═══════════════════════════════════════════════
   DEALER PRICE (server-side pricing engine)
   ═══════════════════════════════════════════════ */
app.post("/api/dealer/price", express.json(), async (req, res) => {
  try {
    const d = req.body
    const year = d.year || 2015
    const km = d.km || 100000
    const now = new Date().getFullYear()
    const age = now - year

    // Segment detection
    let segment = "C"
    const makeU = (d.make || "").toUpperCase()
    if (["BMW","MERCEDES","AUDI","VOLVO","LEXUS","INFINITI","JAGUAR","PORSCHE","MASERATI","ALFA ROMEO","LAND ROVER","TESLA"].includes(makeU)) segment = "P"
    else if (["BENTLEY","ROLLS","FERRARI","LAMBORGHINI","ASTON","MCLAREN","BUGATTI","MAYBACH"].some(s => makeU.includes(s))) segment = "L"
    else if (["DACIA","SUZUKI","FIAT","SEAT","SKODA","KIA","HYUNDAI","MITSUBISHI","CHEVROLET","SSANGYONG","MG","LADA"].includes(makeU)) segment = "B"

    // Residual curve
    const residualPcts = { L:[.85,.73,.62,.53,.45,.39,.34,.30,.27,.24,.21,.19,.17,.15,.13,.12,.10,.09,.08,.07,.06],
      P:[.78,.65,.54,.45,.38,.32,.28,.24,.21,.18,.16,.14,.12,.11,.10,.09,.08,.07,.06,.05,.04],
      C:[.72,.58,.47,.38,.31,.26,.22,.19,.16,.14,.12,.11,.10,.09,.08,.07,.06,.05,.04,.04,.03],
      B:[.68,.54,.43,.34,.27,.22,.18,.15,.13,.11,.10,.09,.08,.07,.06,.05,.05,.04,.03,.03,.02] }
    const curve = residualPcts[segment] || residualPcts.C
    const residualPct = age >= 0 && age < curve.length ? curve[age] : 0.03

    // KM factor
    const expectedKm = age * (segment === "L" ? 12000 : segment === "P" ? 18000 : segment === "B" ? 14000 : 16000)
    const kmRatio = expectedKm > 0 ? km / expectedKm : 1
    // Relative km factor (vs expected for age)
    let kmFactor = kmRatio <= 0.5 ? 1.12 : kmRatio <= 0.7 ? 1.08 : kmRatio <= 0.85 ? 1.03 : kmRatio <= 1.0 ? 1.0 : kmRatio <= 1.15 ? 0.96 : kmRatio <= 1.3 ? 0.90 : kmRatio <= 1.5 ? 0.82 : kmRatio <= 1.75 ? 0.72 : kmRatio <= 2.0 ? 0.62 : kmRatio <= 2.5 ? 0.50 : 0.40
    // Absolute km penalty — additional correction for very high km
    // Less aggressive: the relative factor already handles most of it
    if (km > 300000) kmFactor *= 0.70
    else if (km > 250000) kmFactor *= 0.80
    else if (km > 200000) kmFactor *= 0.88
    else if (km > 150000) kmFactor *= 0.95

    // Base calculation
    const catalog = d.catalogPrice || 0
    let base = catalog > 0 ? catalog * residualPct * kmFactor : 0

    // Market alignment
    const mAvg = d.marketAvg || 0
    const mMedian = d.marketMedian || 0
    const mCount = d.marketCount || 0
    const mCenter = mMedian > 0 ? mMedian : mAvg
    const p25 = d.marketP25 || 0
    const p75 = d.marketP75 || 0

    if (mCenter > 0 && base > 0) {
      // KM-aware blending: at very high km, market median represents AVERAGE km cars
      // So we must trust the km-adjusted formula more
      if (km > 250000) {
        // High km: trust formula more but still use market
        base = base * 0.75 + mCenter * 0.25
      } else if (km > 200000) {
        base = base * 0.70 + mCenter * 0.30
      } else if (km > 150000) {
        base = base * 0.65 + mCenter * 0.35
      } else if (km < 30000) {
        // Very low km: formula underestimates, trust market more
        base = base * 0.40 + mCenter * 0.60
      } else {
        // Normal km range: balanced blend
        const ratio = mCenter / base
        if (ratio > 1.5) base = base * 0.30 + mCenter * 0.70
        else if (ratio > 1.2) base = base * 0.50 + mCenter * 0.50
        else if (ratio < 0.6) base = base * 0.30 + mCenter * 0.70
        else if (ratio < 0.8) base = base * 0.50 + mCenter * 0.50
        else base = base * 0.60 + mCenter * 0.40
      }
    } else if (mCenter > 0 && base === 0) {
      base = mCenter
      // Apply km correction to pure market-based price too
      if (km > 250000) base *= 0.55
      else if (km > 200000) base *= 0.68
      else if (km > 150000) base *= 0.82
    }
    if (base === 0) base = 3000

    // Owner count factor: many owners = lower value
    const ownCount = d.ownerCount || 0
    if (ownCount > 5) base *= 0.92
    else if (ownCount > 3) base *= 0.96

    // Import discount (already flagged, apply small discount)
    if (d.importFlag) base *= 0.97

    // Transmission factor — automaat is worth more for most segments
    const isAuto = d.transmissionAuto === true
    const hasTrans = d.transmissionType && d.transmissionType !== 'Onbekend'
    if (hasTrans) {
      if (isAuto) {
        // Automaat premium: bigger for premium brands, smaller for budget
        if (segment === 'P' || segment === 'L') base *= 1.08  // BMW/Audi/Mercedes: +8%
        else if (segment === 'C') base *= 1.05  // VW/Ford/Opel: +5%
        else base *= 1.03  // Budget brands: +3%
      } else {
        // Handgeschakeld discount: inverse
        if (segment === 'P' || segment === 'L') base *= 0.92  // Premium: -8%
        else if (segment === 'C') base *= 0.95  // Midden: -5%
        else base *= 0.97  // Budget: -3%
      }
    }

    // Ex-taxi: massive value reduction
    if (d.taxiIndicator) base *= 0.78

    // Color impact: popular colors hold value
    const clrUp = (d.color||'').toUpperCase()
    if (['ZWART','WIT','GRIJS'].includes(clrUp)) base *= 1.02
    else if (['GEEL','ORANJE','PAARS'].includes(clrUp)) base *= 0.95

    // APK: expired or expiring = cost
    if (d.apkUntil) {
      const apkDate = new Date(d.apkUntil.split('-').reverse().join('-'))
      const now = new Date()
      const daysLeft = (apkDate - now) / (1000*60*60*24)
      if (daysLeft < 0) base -= 500  // Expired: keuring + reparatie
      else if (daysLeft < 60) base -= 200  // Expiring soon
    }

    // Not WAM insured = standing vehicle
    if (d.wamInsured === false) base *= 0.95

    // Low emission class = future risk
    if (d.emissieKlasse && String(d.emissieKlasse).match(/euro\s*[0-3]/i)) base *= 0.95

    // Pricing outputs
    // Handelswaarde ratio: newer/premium = tighter margin, older/budget = wider
    let hwRatio = 0.88
    if (age <= 3) hwRatio = 0.92       // Young: small dealer margin
    else if (age <= 6) hwRatio = 0.90  // Medium
    else if (age <= 10) hwRatio = 0.87 // Older: more margin needed
    else hwRatio = 0.84                // 10+: significant reconditioning
    if (segment === 'P' || segment === 'L') hwRatio += 0.02  // Premium: tighter
    if (km > 200000) hwRatio -= 0.03  // High km: harder to sell

    const verkoopadviees = Math.round(base / 50) * 50
    const handelswaarde = Math.round(verkoopadviees * hwRatio / 50) * 50
    const inkoopHigh = Math.round(handelswaarde * 0.92 / 50) * 50
    const inkoopLow = Math.round(inkoopHigh * 0.82 / 50) * 50
    const internetPrijs = Math.round(verkoopadviees * 1.06 / 50) * 50
    const t4cBod = Math.round((inkoopLow + inkoopHigh) / 2 / 50) * 50
    const margin = verkoopadviees - t4cBod
    const marginPct = verkoopadviees > 0 ? Math.round(margin / verkoopadviees * 100) : 0

    // Popular brands list (used in confidence + liquidity)
    const popularBrands = ["VOLKSWAGEN","BMW","MERCEDES","AUDI","TOYOTA","KIA","HYUNDAI","SKODA","PEUGEOT","RENAULT","FORD","OPEL","VOLVO","MAZDA","TESLA"]

    // Confidence — multi-factor scoring
    let conf = 30
    // Data sources
    if (catalog > 0) conf += 10
    if (mCount >= 20) conf += 20
    else if (mCount >= 10) conf += 15
    else if (mCount >= 5) conf += 10
    else if (mCount >= 2) conf += 5
    // Market quality
    if (p25 > 0 && p75 > 0 && mCenter > 0 && (p75 - p25) / mCenter < 0.3) conf += 10
    else if (p25 > 0 && p75 > 0 && mCenter > 0 && (p75 - p25) / mCenter < 0.5) conf += 5
    // Brand liquidity
    if (popularBrands.includes(makeU)) conf += 5
    // Age/km consistency
    if (age <= 10 && kmFactor >= 0.88) conf += 5
    else if (age <= 15) conf += 3
    // Ownership clarity
    if (ownCount === 1 && age >= 3) conf += 3
    else if (ownCount > 5) conf -= 3
    // BPM rest data adds confidence
    if ((d.bpmRest||0) > 0) conf += 2
    conf = Math.min(conf, 95)

    // Market scores
    // Liquidity: how easy to sell (brand demand + market activity)
    let liquidityScore = 35
    if (popularBrands.includes(makeU)) liquidityScore += 15
    if (mCount >= 20) liquidityScore += 25
    else if (mCount >= 10) liquidityScore += 18
    else if (mCount >= 5) liquidityScore += 10
    else if (mCount >= 2) liquidityScore += 5
    if (age <= 5) liquidityScore += 10
    else if (age <= 10) liquidityScore += 5
    // Many owners = slightly less liquid
    if (ownCount > 4) liquidityScore -= 5
    if (kmFactor >= 0.95) liquidityScore += 5
    else if (kmFactor < 0.80) liquidityScore -= 10
    liquidityScore = Math.max(10, Math.min(90, liquidityScore))

    // Market velocity: how fast they move (based on spread and count)
    let marketVelocity = 40
    if (mCount >= 10 && p25 > 0 && p75 > 0) {
      const spread = (p75 - p25) / mCenter
      if (spread < 0.15) marketVelocity += 25  // tight = fast moving
      else if (spread < 0.25) marketVelocity += 15
      else if (spread < 0.40) marketVelocity += 5
      else marketVelocity -= 10  // wide spread = slow/uncertain
    }
    if (mCount >= 15) marketVelocity += 10
    if (age <= 3) marketVelocity += 10
    marketVelocity = Math.max(10, Math.min(90, marketVelocity))

    // ATR score (1-10): hoe goed is de B2C waarde
    let atrScore = 5.0
    if (mCenter > 0 && verkoopadviees > 0) {
      const atrRatio = verkoopadviees / mCenter
      if (atrRatio < 0.85) atrScore += 2.0       // onder markt = goed voor koper
      else if (atrRatio < 0.95) atrScore += 1.0
      else if (atrRatio > 1.15) atrScore -= 1.5   // boven markt
      else if (atrRatio > 1.05) atrScore -= 0.5
    }
    if (mCount >= 10) atrScore += 0.5
    if (conf >= 70) atrScore += 0.5
    atrScore = Math.round(Math.max(1, Math.min(10, atrScore)) * 10) / 10

    // ETR score (1-10): hoe goed is de B2B deal
    let etrScore = 5.0
    if (marginPct >= 25) etrScore += 2.0
    else if (marginPct >= 18) etrScore += 1.5
    else if (marginPct >= 12) etrScore += 0.5
    else if (marginPct < 8) etrScore -= 1.5
    if (liquidityScore >= 60) etrScore += 1.0
    else if (liquidityScore < 30) etrScore -= 1.0
    if (mCount >= 10) etrScore += 0.5
    if (kmFactor >= 0.95) etrScore += 0.5
    etrScore = Math.round(Math.max(1, Math.min(10, etrScore)) * 10) / 10

    // ═══ LABELS & ANALYSIS ═══
    // Courant label (how tradeable is this car)
    let courantLabel = "Markt onbekend"
    if (mCount >= 15 && liquidityScore >= 60) courantLabel = "Zeer courant"
    else if (mCount >= 8 && liquidityScore >= 45) courantLabel = "Courant"
    else if (mCount >= 3 && liquidityScore >= 30) courantLabel = "Redelijk courant"
    else if (mCount >= 1) courantLabel = "Minder courant"
    else if (popularBrands.includes(makeU)) courantLabel = "Verwacht courant"

    // Confidence label
    let confidenceLabel = "Laag"
    if (conf >= 75) confidenceLabel = "Hoog"
    else if (conf >= 55) confidenceLabel = "Gemiddeld"

    // Sell speed estimate
    let sellSpeed = "Onbekend", sellDays = 0
    const velAvg = (liquidityScore + marketVelocity) / 2
    if (velAvg >= 65) { sellSpeed = "Snel"; sellDays = Math.round(15 + Math.random() * 10) }
    else if (velAvg >= 45) { sellSpeed = "Normaal"; sellDays = Math.round(30 + Math.random() * 20) }
    else if (velAvg >= 25) { sellSpeed = "Langzaam"; sellDays = Math.round(60 + Math.random() * 30) }
    else { sellSpeed = "Moeilijk"; sellDays = Math.round(90 + Math.random() * 60) }

    // Risk score (inverse of confidence + liquidity)
    let riskScore = Math.round(100 - (conf * 0.5 + liquidityScore * 0.3 + marketVelocity * 0.2))
    riskScore = Math.max(5, Math.min(95, riskScore))

    // Profit calculations
    const profitWholesale = handelswaarde - t4cBod
    const profitRetail = verkoopadviees - t4cBod
    const marginPercent = marginPct

    // JP (Japan-style) ETR rating
    const jpFactor = marginPct / 100
    const jpEtr = etrScore >= 8 ? "A+" : etrScore >= 7 ? "A" : etrScore >= 6 ? "B+" : etrScore >= 5 ? "B" : etrScore >= 4 ? "C+" : etrScore >= 3 ? "C" : "D"

    // Smart summary — dynamic analysis text
    const smartSummary = []
    if (mCount >= 10) smartSummary.push(`Sterke marktdata: ${mCount} vergelijkbare auto's gevonden — prijsberekening betrouwbaar`)
    else if (mCount >= 3) smartSummary.push(`Beperkte marktdata (${mCount} listings) — prijs indicatief, verifieer handmatig`)
    else if (mCount === 0 && popularBrands.includes(makeU)) smartSummary.push(`Geen live marktdata gevonden, maar ${d.make} is een courant merk — prijs gebaseerd op restwaarde-model`)
    else if (mCount === 0) smartSummary.push(`Geen marktdata beschikbaar — prijs volledig gebaseerd op restwaarde-model, extra voorzichtig inkopen`)

    if (catalog > 0) smartSummary.push(`Nieuwprijs €${catalog.toLocaleString("nl-NL")} — restwaarde ${Math.round(residualPct * 100)}% na ${age} jaar`)
    if (kmFactor < 0.88) smartSummary.push(`Hoge km-stand (factor ${kmFactor}) — drukt de prijs significant`)
    else if (kmFactor > 1.03) smartSummary.push(`Lage km-stand — positief effect op waarde (+${Math.round((kmFactor - 1) * 100)}%)`)
    if (marginPct >= 20) smartSummary.push(`Goede marge mogelijk: ${marginPct}% tussen inkoop en verkoop`)
    else if (marginPct < 8) smartSummary.push(`Krappe marge (${marginPct}%) — alleen interessant bij scherp bod`)
    if (liquidityScore >= 60) smartSummary.push(`Hoge liquiditeit — dit model verkoopt vlot door`)
    else if (liquidityScore < 30) smartSummary.push(`Lage liquiditeit — rekening houden met langere standtijd`)
    if (age <= 3 && segment === "P") smartSummary.push(`Jong premium voertuig — sterke restwaarde, interessant voor B2C`)
    if (age >= 12) smartSummary.push(`Ouder voertuig (${age}j) — focus op technische staat en APK historie`)
    // Ownership tips
    if (ownCount > 5) smartSummary.push(`Veel eigenaren (${ownCount}x) — negatief effect op restwaarde (-8%)`)
    else if (ownCount > 3) smartSummary.push(`${ownCount} eigenaren — licht negatief effect op restwaarde`)
    else if (ownCount === 1 && age >= 3) smartSummary.push(`1e eigenaar — positief voor restwaarde, goed onderhouden kans groot`)
    if (d.isExDealer) smartSummary.push(`Ex-bedrijfsauto/dealer — controleer gebruiksgeschiedenis`)
    // Import
    if (d.importFlag) smartSummary.push(`IMPORT voertuig — controleer buitenlandse schadehistorie, -3% waardecorrectie`)
    // BPM
    if ((d.bpmRest||0) > 500) smartSummary.push(`BPM rest \u20AC${Math.round(d.bpmRest).toLocaleString("nl-NL")} — relevant voor export/handelsprijs`)
    // Emissions
    if (d.emissieKlasse && String(d.emissieKlasse).match(/euro\s*[0-3]/i)) smartSummary.push(`Emissieklasse ${d.emissieKlasse} — risico milieuzones, drukt toekomstige verkoopbaarheid`)
    // Fuel consumption (not available in pricing endpoint - skip)
    // EV range (not available in pricing endpoint - skip)
    // Bijtelling
    if (d.bijtelling) smartSummary.push(`Bijtelling ${d.bijtelling}% — ${d.bijtelling <= 16 ? 'aantrekkelijk voor zakelijk' : d.bijtelling >= 25 ? 'minder interessant zakelijk' : 'gemiddeld voor zakelijk'}`)

    // ═══ AI-FIRST PRICING (GPT-4o) — AI bepaalt de prijs, formule is referentie ═══
    let aiValidation = null
    let finalVerkoop = verkoopadviees, finalHandel = handelswaarde
    let finalInkoopLow = inkoopLow, finalInkoopHigh = inkoopHigh
    let finalInternet = internetPrijs, finalBod = t4cBod

    try {
      const apiKey = getApiKey("OPENAI_API_KEY")
      if (apiKey && apiKey !== "sk-..." && typeof axios !== 'undefined') {

        // ── Build rich vehicle description ──
        const carDesc = (d.make||'?') + ' ' + (d.model||'?') + ' (' + year + '), ' + km.toLocaleString('nl-NL') + ' km, ' + (d.fuel||'?') + ', segment ' + segment + ', ' + age + ' jaar oud'
        const specDesc = [
          d.transmissionType ? 'Transmissie: ' + d.transmissionType + (d.transmissionDetail ? ' (' + d.transmissionDetail + ')' : '') + (d.transmissionType === 'Automaat' ? ' [AUTOMAAT = MEER WAARD]' : ' [HANDGESCHAKELD = MINDER WAARD]') : null,
          d.motorCode ? 'Motor: ' + d.motorCode : null,
          d.generation ? 'Generatie: ' + d.generation : null,
          d.trimLevel ? 'Trim/uitvoering: ' + d.trimLevel : null,
          d.drivetrain ? 'Aandrijving: ' + d.drivetrain : null,
          d.cc ? 'Cilinderinhoud: ' + d.cc + 'cc' : null,
          d.power ? d.power + ' kW' : null,
          d.body ? 'Carrosserie: ' + d.body : null,
          d.color ? 'Kleur: ' + d.color + (d.colorSecondary ? '/' + d.colorSecondary : '') + (['ZWART','WIT','GRIJS'].includes((d.color||'').toUpperCase()) ? ' [populaire kleur +waarde]' : ['GEEL','ORANJE','PAARS'].includes((d.color||'').toUpperCase()) ? ' [bijzondere kleur -verkoopbaarheid]' : '') : null,
          d.doors ? d.doors + '-deurs' : null,
          d.engineRiskProfile ? 'Motorrisico: ' + d.engineRiskProfile : null,
          d.courantScore ? 'Courantheid: ' + d.courantScore + '/10' : null,
          d.taxiIndicator ? '⚠ EX-TAXI [STERK WAARDE-DRUKKEND -15 tot -25%]' : null,
          d.isExDealer ? 'Ex-bedrijfsauto/lease' : null,
          d.importFlag ? 'IMPORT voertuig [-3%]' : null,
          d.emissieKlasse ? 'Emissieklasse: ' + d.emissieKlasse + (String(d.emissieKlasse).match(/euro\s*[0-3]/i) ? ' [LAAG = risico milieuzones]' : '') : null,
          d.co2 ? 'CO2: ' + d.co2 + ' g/km' : null,
          d.bpmRest ? 'BPM rest: EUR ' + Math.round(d.bpmRest) + (d.bpmRest > 2000 ? ' [hoog = export interessant]' : '') : null,
          d.bijtelling ? 'Bijtelling: ' + d.bijtelling + '%' : null,
          d.topSpeed ? 'Topsnelheid: ' + d.topSpeed + ' km/h' : null,
          d.wamInsured === false ? '⚠ NIET WAM-VERZEKERD [stilstaand = risico]' : null,
        ].filter(Boolean).join('\n- ')

        // ── APK & KM history — detect fraud, patterns ──
        const kmHist = Array.isArray(d.kmHistory) ? d.kmHistory : []
        const kmHistDesc = kmHist.length > 0
          ? 'KM-verloop (RDW APK registraties):\n' + kmHist.map(k => '  ' + (k.date||'?') + ': ' + ((k.km||0).toLocaleString ? (k.km||0).toLocaleString('nl-NL') : k.km) + ' km').join('\n')
          : ''

        const apkHist = Array.isArray(d.apkHistory) ? d.apkHistory : []
        const apkDesc = apkHist.length > 0
          ? 'APK historie:\n' + apkHist.map(a => '  ' + (a.date||'?') + ': ' + (a.result||'?')).join('\n')
          : ''
        const apkUntilDesc = d.apkUntil ? 'APK geldig tot: ' + d.apkUntil : ''

        // ── Owner history ──
        const ownerHist = Array.isArray(d.ownerHistory) ? d.ownerHistory : []
        const ownerDesc = ownerHist.length > 0
          ? (d.ownerCount||ownerHist.length) + ' eigenaren:\n' + ownerHist.map(o => '  ' + (o.date||'?') + ': ' + (o.soort||'?')).join('\n')
          : (d.ownerCount ? d.ownerCount + ' eigenaren' : '')

        // ── Recalls & defects ──
        const recallsArr = Array.isArray(d.recalls) ? d.recalls : []
        const recallDesc = recallsArr.length > 0
          ? 'Terugroepacties: ' + recallsArr.map(r => (r.description||'?') + ' (' + (r.status||'?') + ')').join('; ')
          : ''
        const defectsArr = Array.isArray(d.defects) ? d.defects : []
        const defectDesc = defectsArr.length > 0
          ? 'APK gebreken: ' + defectsArr.map(x => (x.description||'?') + ' (' + (x.date||'?') + ')').join('; ')
          : ''

        // ── VIN decode insights ──
        const knownIssArr = Array.isArray(d.knownIssues) ? d.knownIssues : []
        const issuesDesc = knownIssArr.length > 0 ? 'Bekende aandachtspunten: ' + knownIssArr.join('; ') : ''
        const spArr = Array.isArray(d.sellingPoints) ? d.sellingPoints : []
        const sellPoints = spArr.length > 0 ? 'Verkooppunten: ' + spArr.join('; ') : ''
        const dbArr = Array.isArray(d.dealBreakers) ? d.dealBreakers : []
        const dealBreak = dbArr.length > 0 ? 'Dealbreakers: ' + dbArr.join('; ') : ''

        // ── Build listings table — the core data for AI ──
        const listings = Array.isArray(d.marketListings) ? d.marketListings : []
        const listingsTable = listings.length > 0
          ? listings.map((l, i) => {
              const parts = [`${i+1}. ${l.title || '?'}`, `EUR ${l.price}`]
              if (l.km) parts.push(`${l.km.toLocaleString('nl-NL')} km`)
              if (l.sellerType && l.sellerType !== 'onbekend') parts.push(l.sellerType.toUpperCase())
              if (l.detectedTrims?.length) parts.push(`[${l.detectedTrims.join(', ')}]`)
              if (l.normalizedPrice && l.normalizedPrice !== l.price) parts.push(`(genorm. €${l.normalizedPrice} bij ${km?.toLocaleString('nl-NL')||'?'} km)`)
              parts.push(l.source || '?')
              return parts.join(' | ')
            }).join('\n')
          : 'Geen individuele listings beschikbaar'

        // Dealer vs Particulier prijsanalyse
        const priceBandsDesc = []
        if (d.marketListings?.some(l => l.sellerType === 'dealer')) {
          const dp = d.marketListings.filter(l => l.sellerType === 'dealer' && l.price > 0).map(l => l.price).sort((a,b) => a-b)
          if (dp.length >= 2) priceBandsDesc.push(`Dealerprijzen (${dp.length}x): mediaan EUR ${dp[Math.floor(dp.length/2)]}, range EUR ${dp[0]} - ${dp.at(-1)}`)
        }
        if (d.marketListings?.some(l => l.sellerType === 'particulier')) {
          const pp = d.marketListings.filter(l => l.sellerType === 'particulier' && l.price > 0).map(l => l.price).sort((a,b) => a-b)
          if (pp.length >= 2) priceBandsDesc.push(`Particulier (${pp.length}x): mediaan EUR ${pp[Math.floor(pp.length/2)]}, range EUR ${pp[0]} - ${pp.at(-1)}`)
        }
        const bandsText = priceBandsDesc.length > 0 ? '\nPRIJSBANDEN:\n' + priceBandsDesc.join('\n') : ''

        // KM normalisatie info
        const kmModelText = d.marketListings?.some(l => l.normalizedPrice) 
          ? `\nKM-NORMALISATIE: Op basis van ${listings.filter(l=>l.km>0).length} listings met km: elke 10.000 km = ca. EUR ${Math.abs(listings[0]?.normalizedPrice && listings[0]?.price ? Math.round((listings[0].normalizedPrice - listings[0].price) / ((listings[0].km - (km||0)) / 10000)) : 0)} prijsverschil`
          : ''

        // ── Build market stats summary ──
        const mktStats = mCount > 0
          ? `${mCount} vergelijkbare auto's gevonden:\n- Mediaan: EUR ${mMedian||'?'}\n- P25 (goedkoop): EUR ${p25||'?'}\n- P75 (duur): EUR ${p75||'?'}\n- Laagste: EUR ${d.marketPrices?.[0]||'?'}\n- Hoogste: EUR ${d.marketPrices?.[d.marketPrices.length-1]||'?'}`
          : 'Geen marktdata beschikbaar — alleen formule-referentie'

        const finWaarde = d.finnikWaardeLow && d.finnikWaardeHigh ? `\nFinnik (onafhankelijke) waarde: EUR ${d.finnikWaardeLow} - ${d.finnikWaardeHigh}` : ''
        const as24Ref = d.as24Waarde ? `\nAutoScout24 ML-waardebepaling: EUR ${d.as24Waarde.low}${d.as24Waarde.high !== d.as24Waarde.low ? ' - ' + d.as24Waarde.high : ''}` : ''
        const anwbRef = d.anwbWaarde ? `\nANWB Koerslijst: ${d.anwbWaarde.inruilwaarde ? 'Inruil EUR ' + d.anwbWaarde.inruilwaarde : ''}${d.anwbWaarde.verkoopwaarde ? ' | Verkoop EUR ' + d.anwbWaarde.verkoopwaarde : ''}` : ''
        const externalRefs = finWaarde + as24Ref + anwbRef
        const fmlRef = `Formule-referentie (NIET definitief): Retail EUR ${verkoopadviees}, Handel EUR ${handelswaarde}, Inkoop EUR ${inkoopLow}-${inkoopHigh}`

        // ── Price history from our database ──
        let priceHistoryDesc = ''
        try {
          const trends = stmts.getPriceTrends.all((d.make||'').toLowerCase(), (d.model||'').toLowerCase(), year)
          const soldData = stmts.getSoldListings.all((d.make||'').toLowerCase(), (d.model||'').toLowerCase(), year)
          const soldPrices = soldData.map(s => s.sold_estimate).filter(p => p > 0).sort((a, b) => a - b)

          const parts = []
          if (trends.length > 0) {
            parts.push('PRIJSTREND (eigen database):')
            for (const t of trends.slice(0, 6)) {
              parts.push(`  ${t.month}: mediaan EUR ${t.median_price}, gem EUR ${t.avg_price}, ${t.listing_count} listings${t.sold_count ? ', ~' + t.sold_count + ' verkocht' : ''}`)
            }
            // Trend direction
            if (trends.length >= 2) {
              const newest = trends[0].median_price
              const oldest = trends.at(-1).median_price
              if (newest && oldest) {
                const change = Math.round((newest - oldest) / oldest * 100)
                parts.push(`  → Trend: ${change > 2 ? 'STIJGEND' : change < -2 ? 'DALEND' : 'STABIEL'} (${change > 0 ? '+' : ''}${change}% over ${trends.length} maanden)`)
              }
            }
          }
          if (soldPrices.length >= 3) {
            const soldMed = soldPrices[Math.floor(soldPrices.length / 2)]
            const soldAvg = Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length)
            parts.push(`VERKOCHTE EXEMPLAREN (${soldPrices.length}x): mediaan EUR ${soldMed}, gem EUR ${soldAvg}, laagste EUR ${soldPrices[0]}, hoogste EUR ${soldPrices.at(-1)}`)
            parts.push('(Dit zijn vraagprijzen van verdwenen advertenties — werkelijke verkoopprijs is 5-15% lager)')
          }
          if (parts.length > 0) priceHistoryDesc = parts.join('\n')
        } catch {}


        // ── The AI-first prompt ──
        const sysPrompt = `Je bent een senior autotaxateur bij een Nederlands handelsbedrijf. Je bepaalt ZELF de prijzen.

JOUW TAAK:
Bepaal voor dit specifieke voertuig de accurate marktprijzen op basis van ALLE meegeleverde data.

PRIJSDEFINITIES:
- verkoopadviees (B2C retail): prijs waarvoor een dealer deze auto aan particulier verkoopt
- handelswaarde (B2B): prijs op handelsveilingen / tussen dealers (= het BIEDINGSBEDRAG)
- inkoopLow: laagste reële inkoopprijs (scherp maar eerlijk)
- inkoopHigh: hoogste reële inkoopprijs (bij competitie)

REGELS MARKTDATA:
1. De LISTINGS zijn vergelijkbare auto's die NU te koop staan — dit zijn VRAAGPRIJZEN
2. Werkelijke verkoopprijzen liggen 5-15% onder vraagprijzen
3. Handelswaarde = circa 82-92% van retail (jong/premium dichter bij 92%, oud dichter bij 82%)
4. Inkoop = circa 85-95% van handelswaarde

DEALER vs PARTICULIER:
- DEALER listings zijn 8-18% hoger dan werkelijke marktwaarde (overhead, garantie, APK)
- PARTICULIER listings zijn dichter bij werkelijke waarde (0-8% hoger)
- Gebruik PARTICULIER prijzen als referentie voor retail, corrigeer dealer-prijzen naar beneden
- Als er PRIJSBANDEN zijn: gebruik deze om realistischer te prijzen

KM-NORMALISATIE:
- Als er een KM-model is berekend: gebruik het om listings te normaliseren naar de km-stand van DIT voertuig
- Genormaliseerde prijzen zijn betrouwbaarder dan ruwe prijzen wanneer km sterk verschilt
- Hoge km (>150k) heeft exponentieel meer effect dan gemiddeld

EXTERNE WAARDEBRONNEN:
- Finnik, AutoScout24 ML, en ANWB Koerslijst zijn onafhankelijke waardebepalingen
- ANWB inruilwaarde ≈ handelswaarde (conservatief). ANWB verkoopwaarde ≈ retail (conservatief)
- Als externe bronnen het eens zijn: confidence omhoog. Als ze sterk afwijken: wees voorzichtig

PRIJSHISTORIE:
- Als er prijstrends zijn: gebruik ze. Dalende trend = voorzichtiger prijzen
- Als er verkochte exemplaren zijn: deze geven de beste indicatie van werkelijke transactieprijzen

WAARDE-FACTOREN (gebruik ALLES):
5. TRANSMISSIE: automaat = significant meer waard bij premium (8-15%), minder bij budget (3-5%)
6. KM-STAND: vergelijk met km in listings. Let op km-verloop in APK historie — teruggedraaid = groot risico
7. TRIM: Luxury/M-Sport/S-Line/AMG = premium. Base = minder
8. KLEUR: zwart/wit/grijs = populair (+waarde). Geel/oranje/paars = niche (-verkoopbaarheid)
9. EIGENAREN: 1-2 eigenaren = positief. 5+ = negatief. Kort eigenaarschap = onrustig
10. EX-TAXI: -15 tot -25% waardedaling (slijtage, km, imago)
11. APK: Verlopen of bijna verlopen = -€300-800 kosten. Afgekeurde APK = extra kosten
12. TERUGROEPACTIES: Onopgeloste recalls = risico en kosten
13. APK GEBREKEN: Terugkerend dezelfde gebreken = structureel probleem
14. IMPORT: -3% (onbekende historie, mogelijk andere specificatie)
15. NIET VERZEKERD (geen WAM): stilstaand voertuig, mogelijk problemen, extra voorzichtig
16. EMISSIEKLASSE: Euro 0-3 = risico milieuzones, moeilijker verkoopbaar
17. BPM REST: Hoog = export interessant (handelsprijs stijgt)
18. BIJTELLING: Laag % = aantrekkelijk zakelijk = hogere vraag

ANTWOORD UITSLUITEND IN JSON (geen markdown, geen backticks, geen uitleg buiten JSON):
{"verkoopadviees":12345,"handelswaarde":10800,"inkoopLow":9200,"inkoopHigh":10000,"confidence":75,"reasoning":"max 2 zinnen NL","transmissieImpact":"beschrijf effect","riskFlags":[]}`

        const usrPrompt = `VOERTUIG:
${carDesc}
- ${specDesc}

CATALOGUSPRIJS NIEUW: ${catalog > 0 ? 'EUR ' + catalog.toLocaleString('nl-NL') : 'Onbekend'}${externalRefs}

${ownerDesc ? 'EIGENAAR-HISTORIE:\n' + ownerDesc : ''}
${kmHistDesc}
${apkDesc}
${apkUntilDesc}
${recallDesc}
${defectDesc}
${issuesDesc}
${sellPoints}
${dealBreak}

VERGELIJKBARE AUTO'S TE KOOP (listings):
${listingsTable}
${bandsText}
${kmModelText}

MARKTSTATISTIEKEN:
${mktStats}

${fmlRef}

${priceHistoryDesc}
Bepaal nu de juiste prijzen voor DIT specifieke voertuig.`

        console.log('[AI-FIRST] Calling GPT-4o for', d.make, d.model, year, km + 'km')
        const aiResp = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o", temperature: 0.15, max_tokens: 400,
          messages: [{role: "system", content: sysPrompt}, {role: "user", content: usrPrompt}]
        }, {headers: {"Authorization": "Bearer " + apiKey, "Content-Type": "application/json"}, timeout: 18000})

        var rawTxt = String(aiResp.data.choices[0].message.content || '{}')
        rawTxt = rawTxt.replace(/```json/g, '').replace(/```/g, '').trim()
        const aiResult = JSON.parse(rawTxt)
        aiResult.available = true
        aiValidation = aiResult

        // ── AI prices become PRIMARY — apply with sanity bounds ──
        const aiVerkoop = Math.round((aiResult.verkoopadviees || 0) / 50) * 50
        const aiHandel = Math.round((aiResult.handelswaarde || 0) / 50) * 50
        const aiInkLow = Math.round((aiResult.inkoopLow || 0) / 50) * 50
        const aiInkHigh = Math.round((aiResult.inkoopHigh || 0) / 50) * 50

        // Sanity check: AI price must be within 40-250% of formula (catches hallucinations)
        const formulaBase = verkoopadviees || 3000
        const saneFloor = Math.round(formulaBase * 0.40)
        const saneCeiling = Math.round(formulaBase * 2.50)

        if (aiVerkoop >= saneFloor && aiVerkoop <= saneCeiling && aiVerkoop >= 500) {
          finalVerkoop = aiVerkoop
          finalHandel = aiHandel > 0 ? aiHandel : Math.round(aiVerkoop * hwRatio / 50) * 50
          finalInkoopLow = aiInkLow > 0 ? aiInkLow : Math.round(finalHandel * 0.85 / 50) * 50
          finalInkoopHigh = aiInkHigh > 0 ? aiInkHigh : Math.round(finalHandel * 0.95 / 50) * 50
          finalBod = finalHandel  // BOD = handelswaarde
          finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50
          conf += 25  // High confidence when AI provides prices
          console.log(`[AI-FIRST] Applied: Retail EUR ${finalVerkoop}, Handel EUR ${finalHandel}, Inkoop EUR ${finalInkoopLow}-${finalInkoopHigh}`)
        } else {
          console.log(`[AI-FIRST] SANITY FAIL: AI said EUR ${aiVerkoop} but formula says EUR ${formulaBase} (bounds ${saneFloor}-${saneCeiling}). Using formula.`)
          aiValidation.sanityFailed = true
          conf += 10
        }
      }
    } catch(aiErr) {
      var errMsg = aiErr && aiErr.message ? aiErr.message : String(aiErr)
      console.error("[AI-FIRST] Error:", errMsg, "— falling back to formula")
      aiValidation = {available: false, error: errMsg}
    }

    // If AI didn't run or failed, formula prices are already set as defaults
    // BOD = handelswaarde (always)
    finalBod = finalHandel

    // Finnik waarde cross-check
    const fwLow = d.finnikWaardeLow || 0, fwHigh = d.finnikWaardeHigh || 0
    if (fwLow > 0 && fwHigh > 0 && finalVerkoop > 0) {
      if (finalVerkoop >= fwLow * 0.7 && finalVerkoop <= fwHigh * 1.3) conf += 5
    }

    // AutoScout24 waardebepaling cross-check
    const as24 = d.as24Waarde
    if (as24 && as24.low > 0 && finalVerkoop > 0) {
      if (finalVerkoop >= as24.low * 0.7 && finalVerkoop <= (as24.high || as24.low) * 1.3) conf += 5
      // If AS24 agrees closely (within 10%), extra confidence
      const as24Mid = ((as24.low || 0) + (as24.high || as24.low || 0)) / 2
      if (as24Mid > 0 && Math.abs(finalVerkoop - as24Mid) / as24Mid < 0.1) conf += 3
    }

    // ANWB Koerslijst cross-check
    const anwb = d.anwbWaarde
    if (anwb && anwb.verkoopwaarde > 0 && finalVerkoop > 0) {
      if (finalVerkoop >= anwb.verkoopwaarde * 0.75 && finalVerkoop <= anwb.verkoopwaarde * 1.25) conf += 5
      // ANWB inruilwaarde should be close to handelswaarde
      if (anwb.inruilwaarde > 0 && finalHandel > 0) {
        if (Math.abs(finalHandel - anwb.inruilwaarde) / anwb.inruilwaarde < 0.15) conf += 3
      }
    }

    conf = Math.min(conf, 95)
    // Recalc confidence label
    confidenceLabel = conf >= 75 ? "Hoog" : conf >= 55 ? "Gemiddeld" : "Laag"

    const finalMargin = finalVerkoop - finalBod
    const finalMarginPct = finalVerkoop > 0 ? Math.round(finalMargin / finalVerkoop * 100) : 0

    const priceSource = (aiValidation && aiValidation.available && !aiValidation.sanityFailed) ? 'ai' : 'formula'

    res.json({
      verkoopadviees: finalVerkoop, handelswaarde: finalHandel,
      inkoopLow: finalInkoopLow, inkoopHigh: finalInkoopHigh,
      internetPrijs: finalInternet, t4cBod: finalBod,
      margin: finalMargin, marginPct: finalMarginPct, confidence: conf,
      liquidityScore, marketVelocity, atrScore, etrScore,
      marketUsed: mCount > 0, catalogUsed: catalog > 0,
      segment, age, kmFactor: Math.round(kmFactor * 100) / 100,
      residualPct: Math.round(residualPct * 1000) / 10,
      courantLabel, confidenceLabel, sellSpeed, sellDays, riskScore,
      profitWholesale: finalHandel - finalBod,
      profitRetail: finalVerkoop - finalBod,
      marginPercent: finalMarginPct, jpEtr, jpFactor,
      bpmRest: d.bpmRest||0, bpmNieuw: parseFloat(d.bpm||0)||0, ownerCount: ownCount,
      smartSummary,
      priceSource,
      aiReasoning: aiValidation?.reasoning || null,
      aiTransmissieImpact: aiValidation?.transmissieImpact || null,
      aiConfidence: aiValidation?.confidence || null,
      aiValidation
    })
  } catch (e) {
    console.error("[API] dealer/price error:", e.message)
    res.status(500).json({ error: e.message })
  }
})



/* ── PDF EXPORT (pure Node.js) ── */
const PDFDocument = require("pdfkit")
app.post("/api/pdf", authMiddleware, staffOnly, express.json({limit:"2mb"}), async (req, res) => {
  const data = req.body
  if (!data?.vehicle?.make) return res.status(400).json({error:"Missing vehicle data"})
  const v = data.vehicle||{}, r = data.result||{}, m = data.market||{}, km = data.km||0

  try {
    const doc = new PDFDocument({ size:"A4", margin:40, autoFirstPage:false,
      info:{ Title:`CarDatax Taxatie - ${v.make} ${v.model}`, Author:"CarDatax Intelligent Pricing" }})

    const chunks = []
    doc.on("data", c => chunks.push(c))
    doc.on("end", () => {
      const pdf = Buffer.concat(chunks)
      const plate = (v.plate||"onbekend").replace(/[^A-Za-z0-9-]/g,"")
      res.setHeader("Content-Type","application/pdf")
      res.setHeader("Content-Disposition",`attachment; filename="CarDatax_${plate}.pdf"`)
      res.send(pdf)
    })

    const fE = n => { if(!n||!isFinite(n)) return "\u2014"; return "\u20AC "+Math.round(n).toLocaleString("nl-NL") }
    const fN = n => { if(!n||!isFinite(n)) return "\u2014"; return Math.round(n).toLocaleString("nl-NL") }
    const PW = 515 // page width minus margins

    const ACCENT="#00FF9C",GREEN="#00FF9C",RED="#ef4444",TXT="#e8eaf0",TXT2="#8e94a8",TXT3="#505770",DARK="#060709",SURFACE="#1a1e27"
    const today = new Date().toLocaleDateString("nl-NL")

    const logoPath = path.join(__dirname,"..","sites","cardatax","logo-cardatax.png")
    function footer(d) {
      try { d.image(logoPath,40,808,{height:12}) } catch(e){}
      d.fontSize(6).fill(TXT3)
      const fModel = (v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim() || v.model || ""
      d.text(`${v.make||""} ${fModel} \u2014 ${v.plate||""}`,220,813,{lineBreak:false})
      d.text(today,460,813,{lineBreak:false})
    }

    // ════════════════════════════════════════
    // PAGE 1: TAXATIE RAPPORT
    // ════════════════════════════════════════
    doc.addPage({size:"A4",margin:40})
    doc.rect(0,0,595,842).fill(DARK)

    // ── HEADER ──
    doc.roundedRect(40,28,PW,36,6).fill(SURFACE)
    try { doc.image(logoPath,48,30,{height:32}) } catch(e){}
    doc.fontSize(12).fill(TXT).text(v.plate||"",40,36,{width:PW-12,align:"right",lineBreak:false})
    doc.fontSize(7).fill(TXT3).text(today,40,50,{width:PW-12,align:"right",lineBreak:false})

    // ── VOERTUIG ──
    let y = 78
    const dispModel = (v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim() || v.model || ""
    doc.fontSize(18).fill(TXT).text(`${v.make||""} ${dispModel}`,40,y,{lineBreak:false}); y+=22
    if (v.modelVariant) { doc.fontSize(8).fill(ACCENT).text(v.modelVariant,40,y,{lineBreak:false}); y+=12 }
    const info = [v.year, v.fuel, v.powerHp?`${v.powerHp} pk`:null, km?`${fN(km)} km`:null].filter(Boolean).join("  \u00B7  ")
    doc.fontSize(8).fill(TXT2).text(info,40,y,{lineBreak:false}); y+=18

    // ── PRIJZEN ──
    doc.roundedRect(40,y,PW,42,6).fill(SURFACE)
    doc.fontSize(22).fill(ACCENT).text(`${fE(r.inkoopLow)}  \u2014  ${fE(r.inkoopHigh)}`,40,y+6,{width:PW,align:"center",lineBreak:false})
    doc.fontSize(6.5).fill(TXT3).text("CarDatax Inkoop Advies  \u2014  aanbevolen biedrange bij particulier/inruil",40,y+30,{width:PW,align:"center",lineBreak:false})
    y+=50

    const prices = [
      ["Verkoopadviees (B2C)",fE(r.verkoopadviees),false],
      ["Handelswaarde (B2B)",fE(r.handelswaarde),false],
      ["CarDatax Inkoop Advies",`${fE(r.inkoopLow)} \u2014 ${fE(r.inkoopHigh)}`,true],
      ["Internet vraagprijs",fE(r.internetPrijs),false]
    ]
    for (const [label,val,hl] of prices) {
      if(hl) doc.roundedRect(40,y-2,PW,16,3).fillOpacity(0.06).fill(ACCENT).fillOpacity(1)
      doc.fontSize(8.5).fill(hl?ACCENT:TXT2).text(label,50,y,{lineBreak:false})
      doc.fontSize(9).fill(hl?ACCENT:TXT).text(String(val),40,y,{width:PW-10,align:"right",lineBreak:false})
      if(!hl){doc.save().strokeOpacity(0.04).moveTo(50,y+12).lineTo(40+PW-10,y+12).strokeColor(TXT3).stroke().restore()}
      y+=15
    }
    y+=12

    // ── SCORES ──
    doc.fontSize(5.5).fill(TXT3).text("SCORES",40,y,{lineBreak:false}); y+=8
    const scGap=5, scBW=(PW-(scGap*4))/5
    const sc = [
      ["ATR",r.atrScore?r.atrScore+"/10":"\u2014",ACCENT],
      ["ETR",r.etrScore?r.etrScore+"/10":"\u2014",ACCENT],
      ["LIQUIDITEIT",r.liquidityScore||"\u2014",r.liquidityScore>=55?GREEN:r.liquidityScore>=30?ACCENT:RED],
      ["RISICO",r.riskScore||"\u2014",(r.riskScore||50)<30?GREEN:(r.riskScore||50)<50?ACCENT:RED],
      ["BETROUWBAAR",r.confidence?r.confidence+"%":"\u2014",r.confidence>=70?GREEN:r.confidence>=50?ACCENT:RED]
    ]
    for(let i=0;i<5;i++){
      const sx=40+i*(scBW+scGap)
      doc.roundedRect(sx,y,scBW,32,4).fill(SURFACE)
      doc.fontSize(5).fill(TXT3).text(sc[i][0],sx,y+4,{width:scBW,align:"center",lineBreak:false})
      doc.fontSize(13).fill(sc[i][2]).text(String(sc[i][1]),sx,y+13,{width:scBW,align:"center",lineBreak:false})
    }
    y+=40

    // ── RENDEMENT ──
    doc.fontSize(5.5).fill(TXT3).text("RENDEMENT",40,y,{lineBreak:false}); y+=8
    const prGap=5, prBW=(PW-prGap*3)/4
    const pr=[
      ["WINST B2B",fE(r.profitWholesale),r.profitWholesale>0?GREEN:RED],
      ["WINST B2C",fE(r.profitRetail),GREEN],
      ["MARGE",`${r.marginPercent||0}%`,ACCENT],
      ["BPM REST",v.bpmRest?fE(v.bpmRest):"\u2014",TXT2]
    ]
    for(let i=0;i<4;i++){
      const px=40+i*(prBW+prGap)
      doc.roundedRect(px,y,prBW,26,4).fill(SURFACE)
      doc.fontSize(4.5).fill(TXT3).text(pr[i][0],px,y+4,{width:prBW,align:"center",lineBreak:false})
      doc.fontSize(10).fill(pr[i][2]).text(pr[i][1],px,y+13,{width:prBW,align:"center",lineBreak:false})
    }
    y+=34

    // ── STATUS ──
    const badges=[r.courantLabel,r.confidenceLabel?`${r.confidenceLabel} (${r.confidence}%)`:null,r.sellSpeed&&r.sellSpeed!=='Onbekend'?`${r.sellSpeed} (~${r.sellDays}d)`:null,r.jpEtr?`ETR ${r.jpEtr}`:null].filter(Boolean)
    doc.fontSize(7).fill(ACCENT).text(badges.join("   \u00B7   "),40,y,{lineBreak:false}); y+=16

    // ── ANALYSE ──
    const tips=r.smartSummary||[]
    if(tips.length){
      doc.save().strokeOpacity(0.06).moveTo(40,y).lineTo(40+PW,y).strokeColor(TXT3).stroke().restore(); y+=7
      doc.fontSize(5.5).fill(TXT3).text("ANALYSE",40,y,{lineBreak:false}); y+=10
      for(const t of tips.slice(0,6)){
        const isWarn=t.includes("GESTOLEN")||t.includes("Beperkte")||t.includes("Geen")||t.includes("IMPORT")
        doc.fontSize(7).fill(isWarn?RED:GREEN).text(isWarn?"\u26A0":"\u2713",42,y,{lineBreak:false})
        doc.fill(TXT2).text(t.slice(0,100),54,y,{lineBreak:false}); y+=10
      }
      y+=4
    }

    // ── MARKTDATA ──
    if(m.count){
      doc.save().strokeOpacity(0.06).moveTo(40,y).lineTo(40+PW,y).strokeColor(TXT3).stroke().restore(); y+=7
      doc.fontSize(5.5).fill(TXT3).text(`MARKTDATA  \u2014  ${m.count} vergelijkbare auto's`,40,y,{lineBreak:false}); y+=10
      const pVals = [["P10",m.p10],["P25",m.p25],["MEDIAAN",m.median],["P75",m.p75],["P90",m.p90]].filter(x=>x[1]>0)
      const pW = PW / pVals.length
      for(let i=0;i<pVals.length;i++){
        const px=40+i*pW, isMed=pVals[i][0]==="MEDIAAN"
        doc.fontSize(5).fill(TXT3).text(pVals[i][0],px,y,{width:pW,align:"center",lineBreak:false})
        doc.fontSize(isMed?10:8).fill(isMed?ACCENT:TXT2).text(fE(pVals[i][1]),px,y+7,{width:pW,align:"center",lineBreak:false})
      }
    }

    footer(doc)

    // ════════════════════════════════════════
    // PAGE 2: VOERTUIGGEGEVENS
    // ════════════════════════════════════════
    doc.addPage({size:"A4",margin:40})
    doc.rect(0,0,595,842).fill(DARK)

    // Header
    doc.roundedRect(40,28,PW,30,6).fill(SURFACE)
    try { doc.image(logoPath,48,31,{height:24}) } catch(e){}
    doc.fontSize(12).fill(TXT2).text("Voertuiggegevens",160,34,{lineBreak:false})
    doc.fontSize(8).fill(TXT3).text(`${v.plate||""} \u2014 ${v.make||""} ${((v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim())||v.model||""}`,40,36,{width:PW-12,align:"right",lineBreak:false})

    // Section drawing helper
    const hW = PW/2 - 12
    function sec(title, items, sy, xO) {
      doc.fontSize(9).fill(ACCENT).text(title,xO,sy,{lineBreak:false}); sy+=13
      doc.save().strokeOpacity(0.2).moveTo(xO,sy).lineTo(xO+hW,sy).strokeColor(ACCENT).stroke().restore(); sy+=6
      for(const[l,val]of items){
        if(!val || String(val)==="\u2014" || String(val)==="undefined" || String(val)==="null" || String(val)==="0" || String(val)==="false") continue
        doc.fontSize(8).fill(TXT2).text(String(l),xO+2,sy,{lineBreak:false})
        doc.fontSize(8).fill(TXT).text(String(val).slice(0,42),xO,sy,{width:hW,align:"right",lineBreak:false})
        sy+=13
      }
      return sy
    }

    // ── LEFT COLUMN ──
    let y1 = sec("Algemeen",[
      ["Merk",v.make],["Model",((v.model||"").replace(new RegExp("^"+String(v.make||"")+"\\s+","i"),"").trim())||v.model],["Uitvoering",v.modelVariant],
      ["Bouwjaar",v.year],["Brandstof",v.fuel],
      [v.fuelSecondary?"2e brandstof":null,v.fuelSecondary],
      [v.isHybrid?"Aandrijving":null,v.isHybrid?"Hybride":null],
      [v.isPureEV?"Aandrijving":null,v.isPureEV?"Volledig Elektrisch":null],
      ["Carrosserie",v.body],["Kleur",v.color],
      [v.colorSecondary?"2e kleur":null,v.colorSecondary],
      [v.doors?"Deuren":null,v.doors],
      [v.seats?"Zitplaatsen":null,v.seats],
    ], 60, 40)

    y1 = sec("Motor & Transmissie",[
      ["Motor type",v.engineLabel],
      [v.engineCapacity?"Cilinderinhoud":null,v.engineCapacity?`${fN(v.engineCapacity)} cc`:null],
      [v.cylinders?"Cilinders":null,v.cylinders],
      [v.engineCode?"Motorcode":null,v.engineCode],
      [v.powerKw?"Vermogen":null,v.powerHp?`${v.powerHp} pk (${v.powerKw} kW)`:null],
      [v.topSpeed?"Topsnelheid":null,v.topSpeed?`${v.topSpeed} km/u`:null],
      [v.transmissionType&&v.transmissionType!=="Onbekend"?"Transmissie":null,
        v.transmissionType&&v.transmissionType!=="Onbekend"?`${v.transmissionType}${v.gearCount?` (${v.gearCount}-bak)`:""}`
        :null],
      [v.equipmentLevel?"Uitrusting":null,v.equipmentLevel],
    ], y1+8, 40)

    y1 = sec("Milieu & Verbruik",[
      [v.emissionClass||v.emissieKlasse?"Emissieklasse":null,v.emissionClass||v.emissieKlasse],
      [v.energyLabel||v.energielabel?"Energielabel":null,v.energyLabel||v.energielabel],
      [v.co2?"CO2":null,v.co2?`${v.co2} g/km`:null],
      [v.co2Wltp?"CO2 (WLTP)":null,v.co2Wltp?`${v.co2Wltp} g/km`:null],
      [v.verbruik?.gecombineerd||v.fuelConsumptionCombined?"Verbruik combi":null,(v.verbruik?.gecombineerd||v.fuelConsumptionCombined)?`${v.verbruik?.gecombineerd||v.fuelConsumptionCombined} l/100km`:null],
      [v.verbruik?.stad?"Verbruik stad":null,v.verbruik?.stad?`${v.verbruik.stad} l/100km`:null],
      [v.verbruik?.snelweg?"Verbruik snelweg":null,v.verbruik?.snelweg?`${v.verbruik.snelweg} l/100km`:null],
      [v.actieradius||v.electricRange?"EV bereik":null,(v.actieradius||v.electricRange)?`${v.actieradius||v.electricRange} km`:null],
      [v.roetFilter?"Roetfilter":null,v.roetFilter],
    ], y1+8, 40)

    // ── RIGHT COLUMN ──
    const rx = 40 + hW + 24
    let y2 = sec("Afmetingen & Gewicht",[
      [v.weightKg?"Gewicht":null,v.weightKg?`${fN(v.weightKg)} kg`:null],
      [v.maxMass?"Max massa":null,v.maxMass?`${fN(v.maxMass)} kg`:null],
      [v.lengthMm?"Lengte":null,v.lengthMm?`${v.lengthMm} mm`:null],
      [v.widthMm?"Breedte":null,v.widthMm?`${v.widthMm} mm`:null],
      [v.heightMm?"Hoogte":null,v.heightMm?`${v.heightMm} mm`:null],
      [v.wheelbase?"Wielbasis":null,v.wheelbase?`${v.wheelbase} mm`:null],
      [v.towCapacityBraked?"Trek geremd":null,v.towCapacityBraked?`${fN(v.towCapacityBraked)} kg`:null],
    ], 60, rx)

    y2 = sec("Status & Registratie",[
      [v.handelsbenaming?"Handelsbenaming":null,v.handelsbenaming],
      ["1e toelating",v.firstAdmission],
      [v.firstAdmissionNL?"1e toelating NL":null,v.firstAdmissionNL],
      ["APK tot",v.apkUntil],
      [v.ownerCount?"Eigenaren":null,v.ownerCount?`${v.ownerCount}x`:null],
      [v.lastOwnerType?"Laatste eigenaar":null,v.lastOwnerType],
      [v.importFlag?"Import":null,v.importFlag?"Ja":null],
      [v.stolenFlag?"Gestolen":null,v.stolenFlag?"\u26A0 JA":null],
      ["WAM",v.wamInsured?"Verzekerd":"Niet verzekerd"],
      [v.typegoedkeuringNr?"Typegoedkeuring":null,v.typegoedkeuringNr],
    ], y2+8, rx)

    y2 = sec("Fiscaal & BPM",[
      ["Catalogusprijs",fE(v.catalogPrice)],
      ["BPM (nieuw)",fE(v.bpm||v.bpmNieuw)],
      [v.bpmRest?"BPM rest":null,v.bpmRest?`${fE(v.bpmRest)} (${v.bpmRestPct||0}%)`:null],
      [v.bijtelling?"Bijtelling":null,v.bijtelling?`${v.bijtelling}%`:null],
      [v.taxQuarterMin?"MRB kwartaal":null,v.taxQuarterMin?`\u20AC ${v.taxQuarterMin}${v.taxQuarterMax?` \u2013 \u20AC ${v.taxQuarterMax}`:""}`  :null],
      ["Leeftijd",v.year?`${new Date().getFullYear()-v.year} jaar`:null],
    ], y2+8, rx)

    // ── APK HISTORY ──
    const apkH = v.apkHistory||[]
    if(apkH.length) {
      y2 = sec("APK Keuringen", apkH.slice(0,6).map(a => [
        a.date, `${a.result}${a.km?` \u2014 ${fN(a.km)} km`:""}`
      ]), y2+8, rx)
    }

    // ── KM HISTORY (below both columns) ──
    const kh = v.kmHistory||[]
    let yK = Math.max(y1,y2)+14
    if(kh.length && yK<720){
      doc.fontSize(9).fill(ACCENT).text("Kilometerhistorie",40,yK,{lineBreak:false}); yK+=13
      doc.save().strokeOpacity(0.2).moveTo(40,yK).lineTo(40+PW,yK).strokeColor(ACCENT).stroke().restore(); yK+=7
      doc.fontSize(7).fill(TXT3)
      doc.text("DATUM",42,yK,{lineBreak:false})
      doc.text("KM-STAND",180,yK,{lineBreak:false})
      doc.text("VERSCHIL",320,yK,{lineBreak:false})
      yK+=13
      let prev=0
      for(const e of kh.slice(0,16)){
        if(yK>790) break
        const kv=e.km||0, d=prev?kv-prev:0
        doc.fontSize(8).fill(TXT2).text(e.date||"",42,yK,{lineBreak:false})
        doc.fill(TXT).text(fN(kv),180,yK,{lineBreak:false})
        if(prev) doc.fill(d<0?RED:TXT2).text(`${d>=0?"+":""}${fN(d)}`,320,yK,{lineBreak:false})
        prev=kv; yK+=12
      }
    }

    // ── RECALLS ──
    const recalls = v.recalls||[]
    if(recalls.length && yK<760) {
      yK+=6
      doc.fontSize(9).fill(ACCENT).text("Terugroepacties",40,yK,{lineBreak:false}); yK+=13
      for(const rc of recalls.slice(0,4)){
        if(yK>790) break
        doc.fontSize(8).fill(TXT2).text(`${rc.description||""} \u2014 ${rc.status||""}`,42,yK,{lineBreak:false})
        yK+=12
      }
    }

    // Sources
    const src = (r.sources||[]).join(" + ")
    if(src) {
      doc.fontSize(7).fill(TXT3).text(`Bronnen: ${src}`,40,800,{lineBreak:false})
    }

    footer(doc)

    // ── DONE — exactly 2 pages ──
    doc.end()
  } catch(e) {
    console.error("[PDF] Error:",e)
    res.status(500).json({error:"PDF generation failed: "+e.message})
  }
})



/* ── KNOWN ISSUES / AANDACHTSPUNTEN ───────── */
app.get("/api/known-issues", async (req,res)=>{
  const mk=(req.query.make||"").toLowerCase().trim()
  const ml=(req.query.model||"").toLowerCase().trim()
  const yr=parseInt(req.query.year)||0
  if(!mk||!ml)return res.json({issues:[],source:""})

  const ck=`issues|${mk}|${ml}|${yr}`
  const cc=getCached(ck,86400000) // cache 24h
  if(cc)return res.json(cc)

  const issues=[]
  let source=""

  // Clean model: strip make prefix if present
  let mlClean=ml
  if(mlClean.startsWith(mk+" "))mlClean=mlClean.slice(mk.length+1).trim()

  try{
    // Source 1: AutoCup.nl - structured known issues per model
    const autocupUrl=`https://autocup.nl/zwakke-punten-bekende-problemen/${mk}-${mlClean.replace(/\s+/g,"-")}/`
    const acHtml=await safeFetch(autocupUrl)
    if(acHtml){
      const $=cheerio.load(acHtml)
      // Extract issue paragraphs
      $("h2, h3").each((_,el)=>{
        const heading=$(el).text().trim().toLowerCase()
        if(heading.includes("probleem")||heading.includes("aandachtspunt")||heading.includes("zwak")||heading.includes("gebrek")||heading.includes("motor")||heading.includes("transmissie")||heading.includes("elektr")||heading.includes("roest")||heading.includes("ophang")||heading.includes("koppeling")){
          const headText=$(el).text().trim()
          let desc=""
          let next=$(el).next()
          for(let i=0;i<3&&next.length;i++){
            if(next.is("p")||next.is("ul")||next.is("li")){
              const t=next.text().trim()
              if(t.length>20&&t.length<500) desc+=(desc?" ":"")+t
            }
            if(next.is("h2")||next.is("h3"))break
            next=next.next()
          }
          if(desc&&desc.length>30) issues.push({category:headText,text:desc.slice(0,300)})
        }
      })
      if(issues.length) source="AutoCup.nl"
    }
  }catch{}

  // Source 2: Autoblog.nl aankoopadvies via Google
  if(issues.length<3){
    try{
      const gUrl=`https://www.google.nl/search?q=${encodeURIComponent(mk+" "+mlClean+" aandachtspunten bekende problemen site:autoblog.nl")}&num=3`
      const gHtml=await safeFetch(gUrl)
      if(gHtml){
        const $g=cheerio.load(gHtml)
        const links=[]
        $g("a").each((_,el)=>{
          const h=$g(el).attr("href")||""
          const m=h.match(/url\?q=(https:\/\/www\.autoblog\.nl[^&]+)/)
          if(m&&m[1]&&m[1].includes("aankoopadvies"))links.push(m[1])
        })
        for(const link of links.slice(0,1)){
          const abHtml=await safeFetch(link)
          if(abHtml){
            const $a=cheerio.load(abHtml)
            // Autoblog puts aandachtspunten in the article body
            let capturing=false
            $a("h2, h3, p, li").each((_,el)=>{
              const t=$a(el).text().trim()
              const tl=t.toLowerCase()
              if($a(el).is("h2")||$a(el).is("h3")){
                if(tl.includes("aandachtspunt"))capturing=true
                else if(capturing&&(tl.includes("verdict")||tl.includes("conclus")||tl.includes("uitvoering")||tl.includes("motoren")))capturing=false
              }
              if(capturing&&($a(el).is("p")||$a(el).is("li"))&&t.length>40&&t.length<500){
                issues.push({category:"Autoblog",text:t.slice(0,300)})
              }
            })
            if(!source&&issues.length)source="Autoblog.nl"
          }
        }
      }
    }catch{}
  }

  // Source 3: ANWB auto review
  if(issues.length<2){
    try{
      const anwbUrl=`https://www.google.nl/search?q=${encodeURIComponent(mk+" "+mlClean+" bevindingen wegenwacht problemen site:anwb.nl")}&num=3`
      const anwbHtml=await safeFetch(anwbUrl)
      if(anwbHtml){
        const $n=cheerio.load(anwbHtml)
        const anwbLinks=[]
        $n("a").each((_,el)=>{
          const h=$n(el).attr("href")||""
          const m=h.match(/url\?q=(https:\/\/www\.anwb\.nl\/auto\/tests\/auto-reviews[^&]+)/)
          if(m&&m[1])anwbLinks.push(m[1])
          const m2=h.match(/url\?q=(https:\/\/(www\.)?anwb\.nl\/experts\/auto[^&]+)/)
          if(m2&&m2[1])anwbLinks.push(m2[1])
        })
        for(const link of anwbLinks.slice(0,1)){
          const arHtml=await safeFetch(link)
          if(arHtml){
            const $r=cheerio.load(arHtml)
            $r("p").each((_,el)=>{
              const t=$r(el).text().trim()
              const tl=t.toLowerCase()
              if(t.length>60&&t.length<500&&(tl.includes("wegenwacht")||tl.includes("probleem")||tl.includes("aandacht")||tl.includes("defect")||tl.includes("kapot")||tl.includes("slijt"))){
                issues.push({category:"ANWB Wegenwacht",text:t.slice(0,300)})
              }
            })
            if(!source)source="ANWB.nl"
          }
        }
      }
    }catch{}
  }

  // Deduplicate similar issues
  const seen=new Set()
  const unique=[]
  for(const iss of issues){
    const key=iss.text.slice(0,60).toLowerCase()
    if(!seen.has(key)){seen.add(key);unique.push(iss)}
  }

  const result={issues:unique.slice(0,8),source,model:`${mk} ${mlClean}`,year:yr}
  if(unique.length>0)setCache(ck,result)
  res.json(result)
})

// SPA fallback — serve app index.html for all /app/ routes
app.get("/app/*", (req, res) => {
  const indexPath = path.join(CARDATAX_DIR, "app", "index.html")
  if (fs.existsSync(indexPath)) res.sendFile(indexPath)
  else res.status(404).send("App not built yet. Run: cd frontend && npm run build")
})

/* ═══════════════════════════════════════════════
   DATABASE API ENDPOINTS
   ═══════════════════════════════════════════════ */

// ── Save taxatie to database ──
app.post("/api/taxatie/save", authMiddleware, staffOnly, (req, res) => {
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
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── List taxatie history ──
app.get("/api/taxaties", authMiddleware, staffOnly, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 500)
    const rows = stmts.getTaxaties.all(limit)
    res.json({ ok: true, taxaties: rows, count: rows.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Get last taxatie for kenteken ──
app.get("/api/taxatie/:kenteken", authMiddleware, staffOnly, (req, res) => {
  try {
    const row = stmts.getTaxatieByKenteken.get(req.params.kenteken.toUpperCase().replace(/[-\s]/g, ""))
    res.json({ ok: true, taxatie: row || null })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Search taxaties ──
// ── Update taxatie status ──
// ── Portfolio management ──
app.post("/api/portfolio/add", authMiddleware, staffOnly, (req, res) => {
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

app.get("/api/portfolio", authMiddleware, staffOnly, (req, res) => {
  try {
    const rows = stmts.getPortfolio.all()
    res.json({ ok: true, portfolio: rows })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Database stats & management ──
app.post("/api/db/backup", authMiddleware, adminOnly, (req, res) => {
  try {
    backup()
    res.json({ ok: true, message: "Backup gestart" })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Market snapshot saving (hooks into existing /api/market) ──
// We wrap the response to also save to DB
const _origJsonMarket = app.response?.json
function saveMarketSnapshot(mk, ml, yr, data) {
  if (!data || !data.count) return
  try {
    stmts.saveMarketSnapshot.run(
      mk, ml, yr,
      data.avg || 0, data.median || 0, data.low || 0, data.high || 0,
      data.p10 || 0, data.p25 || 0, data.p75 || 0, data.p90 || 0,
      data.count || 0, JSON.stringify(data.sources || {})
    )
  } catch(e) { console.error("[DB] Market snapshot save error:", e.message) }
}

// ═══ MARKET HISTORY SYSTEM — Tracks individual listings over time ═══

const crypto = require("crypto")

function listingHash(title, price, source) {
  const raw = `${(title||'').slice(0,40).toLowerCase()}-${price}-${(source||'').toLowerCase()}`
  return crypto.createHash("md5").update(raw).digest("hex").slice(0,16)
}

function storeListingsForHistory(mk, ml, yr, listings, trans) {
  if (!listings || !listings.length) return
  const activeHashes = []
  let newCount = 0, updCount = 0

  for (const l of listings) {
    const hash = listingHash(l.title, l.price, l.source)
    activeHashes.push(hash)
    try {
      const result = stmts.upsertListing.run(hash, mk, ml, yr, l.title, l.price, l.km||null, trans||'', l.source, l.url||'')
      if (result === 'new') newCount++
      else updCount++
    } catch {}
  }

  // Mark disappeared listings as sold
  try {
    const soldCount = stmts.markSoldListings.run(mk, ml, yr, activeHashes)
    if (soldCount > 0) console.log(`[HISTORY] ${mk} ${ml} ${yr}: ${newCount} new, ${updCount} updated, ${soldCount} marked sold`)
  } catch {}

  // Add to crawl queue for background monitoring
  try { stmts.addToCrawlQueue.run(mk, ml, yr, trans||'') } catch {}

  // Update monthly price trends
  try {
    const month = new Date().toISOString().slice(0, 7) // "2026-02"
    const prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b)
    if (prices.length >= 3) {
      const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      const median = prices[Math.floor(prices.length / 2)]
      const soldListings = stmts.getSoldListings.all(mk, ml, yr)
      stmts.savePriceTrend.run(mk, ml, yr, month, avg, median, prices[0], prices.at(-1), prices.length, soldListings.length, 'crawl')
    }
  } catch {}
}

// ═══ BACKGROUND CRAWLER — Hergebruikt bestaande scrapers elke 4 uur ═══

let _crawlRunning = false
async function backgroundCrawl() {
  if (_crawlRunning) return
  _crawlRunning = true
  const startTime = Date.now()

  try {
    // Get items to crawl (stale or never crawled)
    const queue = stmts.getCrawlQueue.all(8) // Max 8 per run to limit load
    if (!queue.length) { _crawlRunning = false; return }

    console.log(`\n[CRAWLER] Starting background crawl: ${queue.length} models`)

    for (const item of queue) {
      try {
        const cap = maxPrice(item.year, item.make)
        const trans = item.transmission || ''

        // Use top 6 scrapers only (don't overload)
        const [mp, as24, at, gp, aw, vb] = await Promise.allSettled([
          scrapeMarktplaats(item.make, item.model, item.year, cap, 0, trans),
          scrapeAutoScout24NL(item.make, item.model, item.year, cap, 0, trans),
          scrapeAutoTrack(item.make, item.model, item.year, cap),
          scrapeGaspedaal(item.make, item.model, item.year, cap),
          scrapeAutowereld(item.make, item.model, item.year, cap),
          scrapeViaBovag(item.make, item.model, item.year, cap),
        ])

        // Collect prices
        const allPrices = []
        for (const r of [mp, as24, at, gp, aw, vb]) {
          if (r.status === 'fulfilled' && r.value?.length) allPrices.push(...r.value)
        }

        // Also get listings for title/url tracking
        const listingUrls = [
          { name: "Marktplaats", url: `https://www.marktplaats.nl/q/${item.make}+${item.model}+${item.year}/` },
          { name: "AutoScout24", url: `https://www.autoscout24.nl/lst/${item.make}/${item.model}?fregfrom=${item.year}&fregto=${item.year+1}&cy=NL` },
        ]
        const listingResults = await Promise.allSettled(listingUrls.map(async lu => {
          const html = await safeFetch(lu.url)
          return extractListings(html, cap, lu.url, lu.name)
        }))
        let listings = []
        listingResults.forEach(lr => { if (lr.status === 'fulfilled' && lr.value?.length) listings.push(...lr.value) })
        const seenL = new Set()
        listings = listings.filter(l => { const k = `${l.price}-${l.title?.slice(0,15)}`; if (seenL.has(k)) return false; seenL.add(k); return true }).slice(0, 15)

        // Store
        if (listings.length > 0) {
          storeListingsForHistory(item.make, item.model, item.year, listings, trans)
        }

        // Save snapshot
        if (allPrices.length >= 3) {
          const sorted = [...new Set(allPrices)].sort((a, b) => a - b)
          const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
          const pct = p => sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]
          try {
            stmts.saveMarketSnapshot.run(item.make, item.model, item.year,
              avg, pct(.5), sorted[0], sorted.at(-1),
              pct(.1), pct(.25), pct(.75), pct(.9),
              sorted.length, 'crawler')
          } catch {}
        }

        stmts.updateCrawlTime.run(item.make, item.model, item.year, trans)
        console.log(`  [CRAWLER] ${item.make} ${item.model} ${item.year}: ${allPrices.length} prices, ${listings.length} listings`)

        // Small delay between models to be respectful
        await new Promise(r => setTimeout(r, 2000))
      } catch (e) {
        console.log(`  [CRAWLER] Error ${item.make} ${item.model}: ${e.message}`)
      }
    }

    console.log(`[CRAWLER] Done in ${Math.round((Date.now() - startTime) / 1000)}s\n`)
  } catch (e) {
    console.error('[CRAWLER] Fatal:', e.message)
  }
  _crawlRunning = false
}

// ═══ WAYBACK MACHINE — Gratis historische prijsdata ═══

async function fetchWaybackPrices(mk, ml, yr) {
  try {
    // Search Wayback Machine CDX API for archived Marktplaats search pages
    const searchUrl = `www.marktplaats.nl/q/${mk}+${ml}+${yr}/`
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(searchUrl)}&output=json&limit=12&fl=timestamp,original&filter=statuscode:200&collapse=timestamp:6`

    const resp = await axios.get(cdxUrl, { timeout: 10000 })
    if (!resp.data || resp.data.length < 2) return []

    const snapshots = resp.data.slice(1) // Skip header row
    const results = []

    // Fetch max 3 snapshots (be respectful to Wayback Machine)
    for (const [timestamp, origUrl] of snapshots.slice(-3)) {
      try {
        const archiveUrl = `https://web.archive.org/web/${timestamp}/${origUrl}`
        const pageResp = await axios.get(archiveUrl, { timeout: 8000, headers: { 'User-Agent': 'CarDatax/1.0 (market research)' } })
        const html = pageResp.data || ''
        const prices = extractPrices(html, maxPrice(yr, mk))
        if (prices.length > 0) {
          const dateStr = timestamp.slice(0, 4) + '-' + timestamp.slice(4, 6) + '-' + timestamp.slice(6, 8)
          const sorted = prices.sort((a, b) => a - b)
          results.push({
            date: dateStr,
            median: sorted[Math.floor(sorted.length / 2)],
            avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
            low: sorted[0],
            high: sorted.at(-1),
            count: sorted.length,
            source: 'wayback'
          })
        }
        await new Promise(r => setTimeout(r, 1500)) // Respectful delay
      } catch {}
    }

    // Also try AutoScout24
    try {
      const as24Url = `www.autoscout24.nl/lst/${mk}/${ml}?fregfrom=${yr}&fregto=${yr+1}&cy=NL`
      const cdx2 = await axios.get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(as24Url)}&output=json&limit=6&fl=timestamp,original&filter=statuscode:200&collapse=timestamp:6`, { timeout: 10000 })
      if (cdx2.data && cdx2.data.length > 1) {
        for (const [timestamp, origUrl] of cdx2.data.slice(1, 3)) {
          try {
            const archiveUrl = `https://web.archive.org/web/${timestamp}/${origUrl}`
            const pageResp = await axios.get(archiveUrl, { timeout: 8000 })
            const prices = extractPrices(pageResp.data || '', maxPrice(yr, mk))
            if (prices.length > 0) {
              const dateStr = timestamp.slice(0, 4) + '-' + timestamp.slice(4, 6) + '-' + timestamp.slice(6, 8)
              const sorted = prices.sort((a, b) => a - b)
              results.push({
                date: dateStr,
                median: sorted[Math.floor(sorted.length / 2)],
                avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
                low: sorted[0], high: sorted.at(-1), count: sorted.length,
                source: 'wayback_as24'
              })
            }
            await new Promise(r => setTimeout(r, 1500))
          } catch {}
        }
      }
    } catch {}

    return results.sort((a, b) => a.date.localeCompare(b.date))
  } catch (e) {
    console.log('[WAYBACK] Error:', e.message)
    return []
  }
}

// ═══ PRICE HISTORY API ENDPOINT ═══

app.get("/api/public/voorraad", (req, res) => {
  try {
    const cars = stmts.getVoorraad.all()
    res.json({ ok: true, cars, count: cars.length })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Public: single car detail
app.get("/api/public/voorraad/:id", (req, res) => {
  try {
    const car = stmts.getVoorraadById.get(parseInt(req.params.id))
    if (!car) return res.status(404).json({ ok: false, error: "Auto niet gevonden" })
    const photos = stmts.getVoorraadPhotos.all(car.id)
    res.json({ ok: true, car, photos })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Admin: add car to voorraad
app.post("/api/voorraad/add", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    const result = stmts.addVoorraad.run({
      kenteken: d.kenteken || "", make: d.make || "", model: d.model || "",
      model_variant: d.model_variant || "", year: d.year || 0, fuel: d.fuel || "",
      km: d.km || 0, color: d.color || "", body: d.body || "",
      power_kw: d.power_kw || null, power_hp: d.power_hp || null,
      engine_label: d.engine_label || "", transmission: d.transmission || "",
      doors: d.doors || null, seats: d.seats || null,
      vraag_prijs: d.vraag_prijs || 0, beschrijving: d.beschrijving || "",
      highlights: d.highlights || "", apk_until: d.apk_until || "", vin: d.vin || "",
      status: d.status || "te_koop", featured: d.featured || false
    })
    res.json({ ok: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Admin: update car
app.put("/api/voorraad/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const d = req.body
    stmts.updateVoorraad.run(parseInt(req.params.id), d)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Photo upload + auto-branding
const PHOTOS_DIR = path.join(DATA_DIR, "photos")
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true })

const { brandPhoto } = require("./branding")

app.post("/api/voorraad/:id/photos", authMiddleware, staffOnly, express.raw({ type: "image/*", limit: "10mb" }), async (req, res) => {
  try {
    const carId = parseInt(req.params.id)
    const ext = (req.headers["content-type"] || "image/jpeg").split("/")[1] || "jpeg"
    const ts = Date.now()
    const origFilename = `car-${carId}-${ts}-orig.${ext}`
    const brandedFilename = `car-${carId}-${ts}.${ext}`
    const origPath = path.join(PHOTOS_DIR, origFilename)
    const brandedPath = path.join(PHOTOS_DIR, brandedFilename)

    // Save original
    fs.writeFileSync(origPath, req.body)

    // Brand the photo
    try {
      await brandPhoto(origPath, brandedPath)
      console.log(`[PHOTO] Branded: ${brandedFilename}`)
    } catch (brandErr) {
      console.error(`[PHOTO] Branding failed, using original:`, brandErr.message)
      fs.copyFileSync(origPath, brandedPath)
    }

    // Save to DB (branded version)
    const existing = stmts.getVoorraadPhotos.all(carId)
    const isCover = existing.length === 0 ? 1 : 0
    stmts.addCarPhoto.run(carId, brandedFilename, existing.length, isCover)

    res.json({ ok: true, filename: brandedFilename, original: origFilename, branded: true, cover: !!isCover })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


// Photo upload via kenteken (mobile app - JSON+base64)
app.post("/api/voorraad/plate/:kenteken/photos", authMiddleware, staffOnly, express.json({ limit: "15mb" }), async (req, res) => {
  try {
    const kenteken = req.params.kenteken.replace(/[^a-zA-Z0-9]/g,"").toUpperCase()
    const car = queryOne("SELECT id FROM voorraad WHERE REPLACE(UPPER(kenteken),\"-\",\"\") = ?", [kenteken])
    if (!car) return res.status(404).json({ ok: false, error: "Auto niet gevonden: " + kenteken })
    const { image, filename } = req.body
    if (!image) return res.status(400).json({ ok: false, error: "Geen image data" })
    const ext = (filename || "foto.jpg").split(".").pop() || "jpeg"
    const ts = Date.now()
    const origFilename = `car-${car.id}-${ts}-orig.${ext}`
    const brandedFilename = `car-${car.id}-${ts}.${ext}`
    const origPath = path.join(PHOTOS_DIR, origFilename)
    const brandedPath = path.join(PHOTOS_DIR, brandedFilename)
    fs.writeFileSync(origPath, Buffer.from(image, "base64"))
    try { await brandPhoto(origPath, brandedPath) }
    catch { fs.copyFileSync(origPath, brandedPath) }
    const existing = stmts.getVoorraadPhotos.all(car.id)
    const isCover = existing.length === 0 ? 1 : 0
    stmts.addCarPhoto.run(car.id, brandedFilename, existing.length, isCover)
    res.json({ ok: true, filename: brandedFilename, cover: !!isCover })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Add photo by URL (for imports)
app.post("/api/voorraad/:id/photo-url", authMiddleware, staffOnly, express.json(), (req, res) => {
  try {
    const carId = parseInt(req.params.id)
    const url = req.body.url
    if (!url) return res.status(400).json({ ok: false, error: "URL vereist" })
    const existing = stmts.getVoorraadPhotos.all(carId)
    const isCover = existing.length === 0 ? 1 : 0
    stmts.addCarPhoto.run(carId, url, existing.length, isCover)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Serve photos statically
app.use("/photos", express.static(PHOTOS_DIR))

// Public: contact form
function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ ok: false, error: "Niet ingelogd" })
  try { req.user = jwt.verify(token, JWT_SECRET); req.userId = req.user.userId || req.user.uid || 0; next() }
  catch { return res.status(401).json({ ok: false, error: "Sessie verlopen" }) }
}
const auth = authMiddleware
// ── Rollen: admin > t4c > inkoper > dealer > koper > klant ──
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Geen admin rechten" })
  next()
}
function t4cOnly(req, res, next) {
  if (!["admin","t4c"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Alleen T4C medewerkers" })
  next()
}
function staffOnly(req, res, next) {
  if (!["admin","t4c","inkoper"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Geen toegang" })
  next()
}
function dealerPlus(req, res, next) {
  if (!["admin","t4c","inkoper","dealer"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Geen toegang" })
  next()
}

/* ═══════════════════════════════════════════════
   MULTI-USER BEHEER
   ═══════════════════════════════════════════════ */

app.post("/api/voorraad/:id/photos/enhanced", authMiddleware, staffOnly, express.raw({ type: "image/*", limit: "10mb" }), async (req, res) => {
  try {
    const Jimp = require("jimp")
    const carId = parseInt(req.params.id)
    const ts = Date.now()
    const origFilename = `car-${carId}-${ts}-orig.jpg`
    const brandedFilename = `car-${carId}-${ts}.jpg`
    
    fs.writeFileSync(path.join(PHOTOS_DIR, origFilename), req.body)
    
    // AI Enhancement: brightness, contrast, sharpness, saturation
    const img = await Jimp.read(req.body)
    let totalBright = 0, pixels = 0
    img.scan(0, 0, img.getWidth(), img.getHeight(), function(x, y, idx) {
      totalBright += (this.bitmap.data[idx] + this.bitmap.data[idx+1] + this.bitmap.data[idx+2]) / 3
      pixels++
    })
    const avgBright = totalBright / pixels
    if (avgBright < 110) img.brightness((110 - avgBright) / 255 * 0.8)
    else if (avgBright > 180) img.brightness((180 - avgBright) / 255 * 0.4)
    img.contrast(0.12)
    img.convolute([[0,-0.5,0],[-0.5,3,-0.5],[0,-0.5,0]])
    img.color([{ apply: "saturate", params: [15] }])
    
    const enhancedPath = path.join(PHOTOS_DIR, `car-${carId}-${ts}-enhanced.jpg`)
    await img.quality(92).writeAsync(enhancedPath)
    
    // Brand the enhanced version
    try { await brandPhoto(enhancedPath, path.join(PHOTOS_DIR, brandedFilename)) }
    catch { fs.copyFileSync(enhancedPath, path.join(PHOTOS_DIR, brandedFilename)) }
    
    const existing = stmts.getVoorraadPhotos.all(carId)
    stmts.addCarPhoto.run(carId, brandedFilename, existing.length, existing.length === 0 ? 1 : 0)
    
    res.json({ ok: true, filename: brandedFilename, original: origFilename, enhanced: true, branded: true, cover: existing.length === 0 })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   PLATFORM EXPORT
   ═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   AI SERVICE — GPT-4o Integratie (CardDatax AI)
   ═══════════════════════════════════════════════ */

// Helper: get API key from DB settings first, then .env fallback
function getApiKey(name) {
  try {
    const row = queryOne("SELECT value FROM settings WHERE key=?", ["api_key_" + name])
    if (row && row.value && row.value.length > 5) return row.value
  } catch(e) {}
  return process.env[name] || ""
}

function hasApiKey(name) {
  const key = getApiKey(name)
  return !!(key && key.length > 5 && key !== "sk-...")
}

function maskKey(key) {
  if (!key || key.length < 10 || key === "sk-...") return ""
  return key.substring(0, 7) + "..." + key.substring(key.length - 4)
}

// Helper: call OpenAI API
async function callGPT(systemPrompt, userPrompt, opts = {}) {
  const apiKey = getApiKey("OPENAI_API_KEY")
  if (!apiKey || apiKey === "sk-...") throw new Error("OPENAI_API_KEY niet geconfigureerd — ga naar Admin → AI Services")
  
  const body = {
    model: opts.model || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.max_tokens || 2000
  }
  
  // Support vision (images)
  if (opts.imageUrl) {
    body.messages[1].content = [
      { type: "text", text: userPrompt },
      { type: "image_url", image_url: { url: opts.imageUrl, detail: "high" } }
    ]
  }
  
  const resp = await axios.post("https://api.openai.com/v1/chat/completions", body, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout: 30000
  })
  
  return resp.data.choices[0].message.content
}

// ── API Key Management ──

// Get all API keys (masked) + status
app.post("/api/ai/chat", authMiddleware, express.json(), async (req, res) => {
  try {
    const { vraag, context } = req.body
    if (!vraag) return res.status(400).json({ ok: false, error: "Vraag is vereist" })
    
    const systemPrompt = `Je bent de CardDatax AI-assistent, een expert in de Nederlandse automarkt. 
Je helpt dealers met taxaties, marktanalyses, en voertuigvragen.
Antwoord kort, concreet en in het Nederlands. Gebruik cijfers en feiten waar mogelijk.`
    
    const result = await callGPT(systemPrompt, `${context ? context + "\n\n" : ""}Vraag: ${vraag}`, { temperature: 0.5 })
    res.json({ ok: true, antwoord: result })
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// AI Taxatie Validatie — automatische controle na elke taxatie
// ═══ AI Photo Validation — Quick check if photo is valid for scan step ═══
app.delete("/api/voorraad/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const car = stmts.getVoorraadById.get(id)
    if (!car) return res.status(404).json({ ok: false, error: "Auto niet gevonden" })
    // Delete photos from filesystem
    const photos = stmts.getVoorraadPhotos.all(id)
    for (const p of photos) {
      try {
        const fpath = path.join(PHOTOS_DIR, p.filename)
        if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
        // Also try to remove branded/original variants
        const origPath = fpath.replace(/(\.\w+)$/, "-orig$1")
        if (fs.existsSync(origPath)) fs.unlinkSync(origPath)
      } catch {}
    }
    stmts.deletePhotosByVoorraad.run(id)
    stmts.deleteVoorraad.run(id)
    res.json({ ok: true, message: `Auto ${car.make} ${car.model} verwijderd` })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Voorraad: DELETE single photo ──
app.delete("/api/voorraad/:carId/photos/:photoId", authMiddleware, (req, res) => {
  try {
    const photoId = parseInt(req.params.photoId)
    const photo = stmts.getCarPhoto.get(photoId)
    if (!photo) return res.status(404).json({ ok: false, error: "Foto niet gevonden" })
    // Delete from filesystem
    try {
      const fpath = path.join(PHOTOS_DIR, photo.filename)
      if (fs.existsSync(fpath)) fs.unlinkSync(fpath)
    } catch {}
    stmts.deleteCarPhoto.run(photoId)
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Taxatie: DELETE ──
app.delete("/api/taxatie/:id", authMiddleware, staffOnly, (req, res) => {
  try {
    stmts.deleteTaxatie.run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ── Portfolio: DELETE ──
app.delete("/api/portfolio/:id", authMiddleware, (req, res) => {
  try {
    stmts.deletePortfolioItem.run(parseInt(req.params.id))
    res.json({ ok: true })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// ══════════════════════════════════════════════
// STARTUP — init DB then start server
// ══════════════════════════════════════════════
;(async () => {
  try {
    await initDB()
    JWT_SECRET = getJwtSecret()
    console.log("[DB] Database ready")

    // Auto-backup every 6 hours (safe - handles both sync throws and async rejections)
    const safeBackup = () => { try { const r = backup(); if (r && r.catch) r.catch(e => console.error("[BACKUP] Async error:", e.message)) } catch(e) { console.error("[BACKUP] Error:", e.message) } }
    setInterval(safeBackup, 6 * 60 * 60 * 1000)
    setTimeout(safeBackup, 10000)

    // Background market crawler — every 4 hours, crawl popular models
    // Crawler interval moved to startup (30 min)
    // First crawl after 60 seconds (let server warm up)
    setTimeout(() => { try { backgroundCrawl() } catch(e) { console.error("[CRAWLER] First run error:", e.message) } }, 60000)


// Start crawler every 30 min
setTimeout(() => { backgroundCrawl(); setInterval(backgroundCrawl, 30 * 60 * 1000) }, 15000)

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
  ║  AI: ${hasAI ? "GPT-4o ACTIEF ✓" : "Niet geconfigureerd (.env)"}${hasAI ? "                        " : "          "}║
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
