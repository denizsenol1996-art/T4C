// T4C Admin Routes
const express = require("express")
const router = express.Router()
const fs = require("fs")
const path = require("path")
const { stmts, queryAll, queryOne, run, DATA_DIR } = require("../db")
const { authMiddleware, adminOnly } = require("../lib/auth")
const { getApiKey, hasApiKey, maskKey } = require("../lib/ai")
const { VERSION, _serverStats, writeLog, LOG_DIR } = require("../lib/state")
const { maxPrice, safeFetch, extractListings } = require("../lib/helpers")
const { scrapeMarktplaats, scrapeAutoScout24NL, scrapeAutoTrack, scrapeGaspedaal, scrapeAutowereld, scrapeViaBovag, scrapeAutoWeek, scrapeAutosNL, scrapeAutoGids, scrapeMobileDE, scrapeAutoScout24DE, scrapeAutoScout24BE } = require("../lib/scrapers")
// Lazy-load market.js to avoid circular deps — crawler functions
let _marketModule = null
function getMarket() { if (!_marketModule) _marketModule = require("./market"); return _marketModule }

// ══════════════════════════════════════════════
// HEALTH & MONITORING ENDPOINTS
// ══════════════════════════════════════════════
router.get("/api/health", (_, res) => {
  const uptime = Math.floor((Date.now() - _serverStats.startTime) / 1000)
  const memUsage = process.memoryUsage()
  res.json({
    status: "ok",
    version: VERSION,
    uptime,
    uptimeStr: `${Math.floor(uptime/3600)}u ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`,
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB"
    },
    requests: _serverStats.requestCount,
    errors: _serverStats.errorCount,
    lastError: _serverStats.lastError,
    pid: process.pid,
    guardian: !!process.env.T4C_GUARDIAN
  })
})

// Admin: get recent errors (requires auth)
// Admin: get API call stats

// Admin table browser
router.get("/api/admin/table/:name", authMiddleware, adminOnly, (req, res) => {
  const allowed = ['users','search_history','voorraad','inspecties','crawl_queue','market_prices','market_listings','market_snapshots','api_logs','taxaties','learned_prices','car_photos','damage_reports','price_trends','settings','veilingen','biedingen','verkopen','portfolio','deals_history'];
  const name = req.params.name;
  if (!allowed.includes(name)) return res.json({ ok:false, error:'Tabel niet toegestaan' });
  const limit = Math.min(parseInt(req.query.limit)||100, 500);
  try {
    const rows = queryAll(`SELECT * FROM ${name} ORDER BY rowid DESC LIMIT ?`, [limit]);
    res.json({ ok:true, rows, count:rows.length });
  } catch(e) {
    res.json({ ok:false, error: e.message, rows:[] });
  }
});

router.get("/api/admin/stats", authMiddleware, adminOnly, (req, res) => {
  const uptime = Math.floor((Date.now() - _serverStats.startTime) / 1000)
  const memUsage = process.memoryUsage()
  
  // Read guardian status if available
  let guardian = null
  try {
    const gPath = path.join(LOG_DIR, "guardian-status.json")
    if (fs.existsSync(gPath)) guardian = JSON.parse(fs.readFileSync(gPath, "utf8"))
  } catch {}

  // Sort API calls by count
  const topRoutes = Object.entries(_serverStats.apiCalls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([route, count]) => ({ route, count }))

  // ── DATABASE COUNTS ──
  const taxaties = queryOne("SELECT COUNT(*) as c FROM taxaties")?.c || 0
  const voorraad = queryOne("SELECT COUNT(*) as c FROM voorraad")?.c || 0
  const voorraad_te_koop = queryOne("SELECT COUNT(*) as c FROM voorraad WHERE status='te_koop'")?.c || 0
  const users = queryOne("SELECT COUNT(*) as c FROM users")?.c || 0
  const kopers = queryOne("SELECT COUNT(*) as c FROM users WHERE role='koper'")?.c || 0
  const dealers = queryOne("SELECT COUNT(*) as c FROM users WHERE role='dealer'")?.c || 0
  const biedingen_direct = queryOne("SELECT COUNT(*) as c FROM biedingen")?.c || 0
  const biedingen_veiling = queryOne("SELECT COUNT(*) as c FROM veiling_biedingen")?.c || 0
  const veilingen_actief = queryOne("SELECT COUNT(*) as c FROM veilingen WHERE status='actief'")?.c || 0
  const veilingen_totaal = queryOne("SELECT COUNT(*) as c FROM veilingen")?.c || 0
  const portfolio = queryOne("SELECT COUNT(*) as c FROM portfolio")?.c || 0
  const deals = queryOne("SELECT COUNT(*) as c FROM deals_history")?.c || 0
  const inbox = queryOne("SELECT COUNT(*) as c FROM contact_requests WHERE status='nieuw'")?.c || 0
  const verkopen_count = queryOne("SELECT COUNT(*) as c FROM verkopen")?.c || 0
  const verkopen_marge = queryOne("SELECT SUM(marge) as m FROM verkopen")?.m || 0
  
  // Listings & health
  const listings = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='active' AND km > 0 AND price > 0")?.c || 0
  const feedback_count = queryOne("SELECT COUNT(*) as c FROM dealer_feedback")?.c || 0
  const merken = queryOne("SELECT COUNT(DISTINCT make) as c FROM market_listings WHERE status='active'")?.c || 0
  const modellen_sterk = queryOne("SELECT COUNT(*) as c FROM (SELECT make||model as mm FROM market_listings WHERE status='active' AND km>0 GROUP BY make,model HAVING COUNT(*)>=10)")?.c || 0
  let health_score = 0
  if (listings >= 10000) health_score += 30; else if (listings >= 5000) health_score += 20; else health_score += 10
  if (merken >= 25) health_score += 20; else if (merken >= 15) health_score += 10; else health_score += 5
  if (modellen_sterk >= 100) health_score += 25; else if (modellen_sterk >= 50) health_score += 15; else health_score += 5
  health_score += Math.min(25, Math.round(feedback_count * 2))

  // DB file size
  let db_size = "?"
  try {
    const dbPath = path.join(DATA_DIR, "t4c.db")
    if (fs.existsSync(dbPath)) {
      const s = fs.statSync(dbPath).size
      db_size = s > 1048576 ? (s / 1048576).toFixed(1) + " MB" : Math.round(s / 1024) + " KB"
    }
  } catch {}

  res.json({
    version: VERSION,
    uptime,
    uptimeStr: `${Math.floor(uptime/3600)}u ${Math.floor((uptime%3600)/60)}m ${uptime%60}s`,
    memory: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024)
    },
    requests: _serverStats.requestCount,
    errors: _serverStats.errorCount,
    topRoutes,
    guardian,
    pid: process.pid,
    nodeVersion: process.version,
    // Database counts
    taxaties, voorraad, voorraad_te_koop, users, kopers, dealers,
    listings, feedback_count, health_score, merken, modellen_sterk,
    biedingen: biedingen_direct + biedingen_veiling,
    biedingen_direct, biedingen_veiling,
    veilingen_actief, veilingen_totaal,
    portfolio, deals, inbox, db_size,
    verkopen: verkopen_count, verkopen_marge
  })
})

// Admin: get log file contents
router.get("/api/admin/logs/:file", authMiddleware, adminOnly, (req, res) => {
  const allowed = ["server.log", "errors.log", "guardian.log", "ai.log", "t4c-server-out.log", "t4c-server-error.log"]
  const file = req.params.file
  if (!allowed.includes(file)) return res.status(400).json({ error: "Ongeldig logbestand" })
  
  try {
    const pm2Logs = ["t4c-server-out.log", "t4c-server-error.log"]
    const logPath = pm2Logs.includes(file) ? path.join("/home/deniz/.pm2/logs", file) : path.join(LOG_DIR, file)
    if (!fs.existsSync(logPath)) return res.json({ lines: [], size: 0, content: "Leeg" })
    
    const stat = fs.statSync(logPath)
    const content = fs.readFileSync(logPath, "utf8")
    const lines = content.trim().split("\n")
    
    // Return last N lines (default 200)
    const n = Math.min(parseInt(req.query.n) || 200, 1000)
    const tail = lines.slice(-n)
    
    res.json({ lines: tail, totalLines: lines.length, size: stat.size, file, content: tail.join("\n") })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Admin: clear a log file
router.delete("/api/admin/logs/:file", authMiddleware, adminOnly, (req, res) => {
  const allowed = ["server.log", "errors.log", "guardian.log"]
  const file = req.params.file
  if (!allowed.includes(file)) return res.status(400).json({ error: "Ongeldig logbestand" })
  
  try {
    const pm2Logs = ["t4c-server-out.log", "t4c-server-error.log"]
    const logPath = pm2Logs.includes(file) ? path.join("/home/deniz/.pm2/logs", file) : path.join(LOG_DIR, file)
    fs.writeFileSync(logPath, "")
    res.json({ ok: true, message: `${file} geleegd` })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

/* ═══════════════════════════════════════════════
   PLATE OCR VALIDATION
   Quick RDW check for OCR scanner — tests plate variants
   ═══════════════════════════════════════════════ */

// Users CRUD
router.get("/api/users", authMiddleware, adminOnly, (req, res) => {
  try {
    const users = queryAll(`
      SELECT u.id, u.username, u.name, u.role, u.email, u.phone, u.active, u.last_login,
        (SELECT COUNT(*) FROM taxaties WHERE user_id = u.id) as taxatie_count,
        (SELECT MAX(created_at) FROM taxaties WHERE user_id = u.id) as last_taxatie
      FROM users u ORDER BY u.id
    `)
    res.json({ ok: true, users })
  }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.post("/api/users", authMiddleware, adminOnly, (req, res) => {
  try {
    const d = req.body
    if (!d.username || !d.password) return res.status(400).json({ ok: false, error: "Username en wachtwoord vereist" })
    const bcrypt = require("bcryptjs")
    const hash = bcrypt.hashSync(d.password, 10)
    run("INSERT INTO users (username,password,name,role) VALUES (?,?,?,?)",
      [d.username, hash, d.name||d.username, d.role||'dealer'])
    res.json({ ok: true })
  } catch(e) {
    if (e.message?.includes("UNIQUE")) return res.status(409).json({ ok: false, error: "Gebruikersnaam bestaat al" })
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.put("/api/users/:id", authMiddleware, adminOnly, (req, res) => {
  try {
    const d = req.body
    const uid = parseInt(req.params.id)
    if (d.password) {
      const bcrypt = require("bcryptjs")
      const hash = bcrypt.hashSync(d.password, 10)
      run("UPDATE users SET password=? WHERE id=?", [hash, uid])
      return res.json({ ok: true, message: "Wachtwoord gewijzigd" })
    }
    run("UPDATE users SET name=?,role=? WHERE id=?", [d.name||'',d.role||'dealer', uid])
    res.json({ ok: true })
  }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.delete("/api/users/:id", authMiddleware, adminOnly, (req, res) => {
  try { run("DELETE FROM users WHERE id=?", [parseInt(req.params.id)]); res.json({ ok: true }) }
  catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   AI FOTO VERBETERING
   ═══════════════════════════════════════════════ */

// API Keys management
router.get("/api/ai/status", authMiddleware, adminOnly, (req, res) => {
  const keys = {
    OPENAI_API_KEY: { label: "OpenAI (GPT-4o)", description: "AI Prijsanalyse, Marktinzicht, Schade-analyse, Verkoopteksten", model: "gpt-4o", placeholder: "sk-proj-..." },
    ANTHROPIC_API_KEY: { label: "Anthropic (Claude)", description: "Second Opinion & Vision", model: "claude-sonnet-4-20250514", placeholder: "sk-ant-..." },
    VINACLES_API_KEY: { label: "Vinacles", description: "NAP + Voertuighistorie + Uitvoeringen", placeholder: "Vinacles API key" },
    CARFAX_API_KEY: { label: "CARFAX", description: "Internationaal Schadeverleden", placeholder: "CARFAX API key" },
    FINNIK_API_KEY: { label: "Finnik", description: "Marktdata & Prijsstatistieken", placeholder: "Finnik API key" }
  }
  
  const services = {}
  for (const [envName, info] of Object.entries(keys)) {
    const active = hasApiKey(envName)
    const masked = maskKey(getApiKey(envName))
    services[envName] = { ...info, active, masked, source: active ? (queryOne("SELECT value FROM settings WHERE key=?", ["api_key_" + envName])?.value ? "database" : "env") : "none" }
  }
  
  res.json({ ok: true, services })
})

// Save API key
router.post("/api/admin/api-keys", authMiddleware, adminOnly, express.json(), (req, res) => {
  try {
    const { key_name, key_value } = req.body
    if (!key_name) return res.status(400).json({ ok: false, error: "key_name vereist" })
    
    const allowed = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "VINACLES_API_KEY", "CARFAX_API_KEY", "FINNIK_API_KEY"]
    if (!allowed.includes(key_name)) return res.status(400).json({ ok: false, error: "Onbekende key: " + key_name })
    
    if (key_value && key_value.length > 0) {
      stmts.setSetting.run("api_key_" + key_name, key_value)
      // Also set in process.env for immediate use
      process.env[key_name] = key_value
      writeLog("ai.log", `API KEY SET: ${key_name} (${maskKey(key_value)}) by ${req.user.sub}`)
    } else {
      // Clear key
      run("DELETE FROM settings WHERE key=?", ["api_key_" + key_name])
      delete process.env[key_name]
      writeLog("ai.log", `API KEY REMOVED: ${key_name} by ${req.user.sub}`)
    }
    
    res.json({ ok: true, active: hasApiKey(key_name), masked: maskKey(key_value || "") })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Test API key
router.post("/api/admin/api-keys/test", authMiddleware, adminOnly, express.json(), async (req, res) => {
  try {
    const { key_name } = req.body
    const apiKey = getApiKey(key_name)
    if (!apiKey || apiKey === "sk-...") return res.json({ ok: false, error: "Geen key geconfigureerd" })
    
    if (key_name === "OPENAI_API_KEY") {
      const testBody = {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Zeg alleen: OK" }],
        max_tokens: 5
      }
      const r = await axios.post("https://api.openai.com/v1/chat/completions", testBody, {
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 15000
      })
      const reply = r.data.choices?.[0]?.message?.content || ""
      res.json({ ok: true, message: `OpenAI verbonden! Model: gpt-4o. Response: "${reply}"` })
    } else if (key_name === "ANTHROPIC_API_KEY") {
      const r = await axios.post("https://api.anthropic.com/v1/messages", {
        model: "claude-sonnet-4-20250514", max_tokens: 10,
        messages: [{ role: "user", content: "Zeg alleen: OK" }]
      }, {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        timeout: 15000
      })
      const reply = r.data.content?.[0]?.text || ""
      res.json({ ok: true, message: `Anthropic verbonden! Response: "${reply}"` })
    } else {
      // Generic test — just confirm key is set
      res.json({ ok: true, message: `Key is geconfigureerd (${maskKey(apiKey)}). Verbinding niet automatisch testbaar.` })
    }
  } catch(e) {
    const msg = e.response?.data?.error?.message || e.message || "Onbekende fout"
    writeLog("errors.log", `API KEY TEST FAILED: ${req.body.key_name} — ${msg}`)
    res.json({ ok: false, error: msg })
  }
})

// AI Chat — algemene vraag over auto's/markt

// Scraper monitor
// ═══ SCRAPER MONITOR API ═══

// Live test a single scraper
router.get("/api/admin/scraper/test", authMiddleware, adminOnly, async (req, res) => {
  const mk = String(req.query.make || "volkswagen").toLowerCase()
  const ml = String(req.query.model || "golf").toLowerCase()
  const yr = Number(req.query.year || 2018)
  const cap = maxPrice(yr, mk)

  const scrapers = [
    { name: "marktplaats", fn: () => scrapeMarktplaats(mk, ml, yr, cap, 0, '') },
    { name: "autoscout24.nl", fn: () => scrapeAutoScout24NL(mk, ml, yr, cap, 0, '') },
    { name: "autotrack", fn: () => scrapeAutoTrack(mk, ml, yr, cap) },
    { name: "gaspedaal", fn: () => scrapeGaspedaal(mk, ml, yr, cap) },
    { name: "autowereld", fn: () => scrapeAutowereld(mk, ml, yr, cap) },
    { name: "viabovag", fn: () => scrapeViaBovag(mk, ml, yr, cap) },
    { name: "autoweek", fn: () => scrapeAutoWeek(mk, ml, yr, cap) },
    { name: "autos.nl", fn: () => scrapeAutosNL(mk, ml, yr, cap) },
    { name: "autogids", fn: () => scrapeAutoGids(mk, ml, yr, cap) },
    { name: "mobile.de", fn: () => scrapeMobileDE(mk, ml, yr, cap) },
    { name: "autoscout24.de", fn: () => scrapeAutoScout24DE(mk, ml, yr, cap) },
    { name: "autoscout24.be", fn: () => scrapeAutoScout24BE(mk, ml, yr, cap) },
  ]

  const results = []
  const startAll = Date.now()

  // Also test listings extraction
  const listingUrl = `https://www.marktplaats.nl/q/${mk}+${ml}+${yr}/`

  await Promise.allSettled(scrapers.map(async (s) => {
    const t0 = Date.now()
    try {
      const prices = await s.fn()
      results.push({
        name: s.name, status: 'ok', count: prices.length,
        prices: prices.slice(0, 5).sort((a, b) => a - b),
        ms: Date.now() - t0
      })
    } catch (e) {
      results.push({ name: s.name, status: 'error', error: e.message, ms: Date.now() - t0 })
    }
  }))

  // Test listing extraction
  let listingsResult = null
  try {
    const t0 = Date.now()
    const html = await safeFetch(listingUrl)
    const listings = extractListings(html, cap, listingUrl, 'Marktplaats')
    listingsResult = { count: listings.length, sample: listings.slice(0, 3), ms: Date.now() - t0 }
  } catch (e) { listingsResult = { count: 0, error: e.message } }

  results.sort((a, b) => (b.count || 0) - (a.count || 0))

  res.json({
    ok: true,
    query: { make: mk, model: ml, year: yr, cap },
    totalMs: Date.now() - startAll,
    scrapers: results,
    working: results.filter(r => r.status === 'ok' && r.count > 0).length,
    total: results.length,
    totalPrices: results.reduce((sum, r) => sum + (r.count || 0), 0),
    listings: listingsResult
  })
})

// Market history stats
router.get("/api/admin/market-stats", authMiddleware, adminOnly, (req, res) => {
  try {
    const active = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='active' AND km > 0 AND price > 0")?.c || 0
    const sold = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='sold'")?.c || 0
    const brands = queryOne("SELECT COUNT(DISTINCT make) as c FROM market_listings WHERE status='active'")?.c || 0
    const models_total = queryOne("SELECT COUNT(*) as c FROM (SELECT make||model as mm FROM market_listings WHERE status='active' AND km>0 GROUP BY make,model)")?.c || 0
    const models_strong = queryOne("SELECT COUNT(*) as c FROM (SELECT make||model as mm FROM market_listings WHERE status='active' AND km>0 GROUP BY make,model HAVING COUNT(*)>=10)")?.c || 0
    const days_tracked = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE days_on_market > 0")?.c || 0
    const queue = queryOne("SELECT COUNT(*) as c FROM crawl_queue")?.c || 0
    const top_brands = queryAll("SELECT make, COUNT(*) as count FROM market_listings WHERE status='active' AND km>0 GROUP BY make ORDER BY count DESC LIMIT 15")
    const sources = queryAll("SELECT source, COUNT(*) as count FROM market_listings WHERE status='active' AND km>0 AND source IS NOT NULL AND source != '' GROUP BY source ORDER BY count DESC")
    let health_score = 0
    if (active >= 10000) health_score += 30; else if (active >= 5000) health_score += 20; else health_score += 10
    if (brands >= 25) health_score += 20; else if (brands >= 15) health_score += 10; else health_score += 5
    if (models_strong >= 100) health_score += 25; else if (models_strong >= 50) health_score += 15; else health_score += 5
    if (days_tracked > 0) health_score += 15
    health_score = Math.min(100, health_score + 4)
    res.json({ ok: true, active, sold, brands, models_total, models_strong, days_tracked, queue, top_brands, sources, health_score })
  } catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

// Force crawl now
router.post("/api/admin/crawl-now", authMiddleware, adminOnly, async (req, res) => {
  if (getMarket().isCrawlRunning()) return res.json({ ok: false, error: "Crawler draait al" })
  getMarket().backgroundCrawl()
  res.json({ ok: true, message: "Crawler gestart" })
})

// Add model to crawl queue
router.post("/api/admin/crawl-add", authMiddleware, adminOnly, (req, res) => {
  const { make, model, year } = req.body || {}
  if (!make || !model || !year) return res.json({ ok: false, error: "make, model, year required" })
  try {
    stmts.addToCrawlQueue.run(make.toLowerCase(), model.toLowerCase(), Number(year), '')
    res.json({ ok: true })
  } catch (e) { res.json({ ok: false, error: e.message }) }
})



// ── Bulk seed crawl queue (moved from server.js) ──
router.get("/api/admin/bulk-seed-queue", (req, res) => {
  const makes = {
    volkswagen:["golf","polo","tiguan","t-roc","touran","passat","up","arteon","id.3","id.4","caddy","transporter","crafter"],
    toyota:["yaris","corolla","aygo","c-hr","rav4","avensis","auris","prius","camry","hilux","proace","yaris cross"],
    ford:["fiesta","focus","puma","kuga","mondeo","transit","transit custom","ranger"],
    renault:["clio","megane","captur","kadjar","scenic","twingo","zoe","trafic","master","kangoo"],
    peugeot:["208","308","508","2008","3008","5008","partner","boxer","expert"],
    opel:["corsa","astra","mokka","crossland","grandland","insignia","vivaro","combo","movano"],
    bmw:["1 serie","2 serie","3 serie","4 serie","5 serie","x1","x2","x3","x5","i3","i4"],
    "mercedes-benz":["a-klasse","b-klasse","c-klasse","e-klasse","cla","gla","glc","gle","sprinter","vito"],
    audi:["a1","a3","a4","a5","a6","q2","q3","q5","q7","e-tron","tt"],
    hyundai:["i10","i20","i30","tucson","kona","ioniq 5"],
    kia:["picanto","rio","ceed","sportage","niro","ev6","sorento"],
    skoda:["fabia","octavia","superb","kamiq","karoq","kodiaq","scala","enyaq"],
    fiat:["500","panda","tipo","500x","ducato","doblo"],
    citroen:["c1","c3","c4","c5 aircross","berlingo","jumpy"],
    seat:["ibiza","leon","arona","ateca"],
    nissan:["qashqai","juke","micra","leaf","x-trail"],
    mazda:["2","3","6","cx-3","cx-30","cx-5","mx-5"],
    suzuki:["swift","vitara","s-cross","ignis","jimny"],
    volvo:["v40","v60","v90","xc40","xc60","xc90","s60","c40"],
    mitsubishi:["space star","outlander","asx","l200"],
    dacia:["sandero","duster","spring","jogger"],
    honda:["civic","jazz","hr-v","cr-v"],
    mg:["zs","hs","mg4"],
    mini:["cooper","countryman"],
    tesla:["model 3","model y","model s"],
    cupra:["formentor","born","leon"],
    porsche:["cayenne","macan","taycan"],
    "land rover":["range rover evoque","discovery sport","defender"],
    jeep:["compass","renegade","avenger"],
    alfa:["giulia","stelvio","giulietta","mito"],
    lexus:["ux","nx","rx"],
    dfsk:["c35","ec35"],
    smart:["fortwo","forfour"],
    ds:["ds3","ds4","ds7"],
    iveco:["daily"],
    man:["tge"]
  }
  let n = 0
  for (const [mk, mds] of Object.entries(makes)) {
    for (const md of mds) {
      for (let y = 2008; y <= 2025; y++) {
        try { run("INSERT OR IGNORE INTO crawl_queue(make,model,year) VALUES(?,?,?)", [mk, md, y]); n++ } catch(e) {}
      }
    }
  }
  const t = queryAll("SELECT COUNT(*) as c FROM crawl_queue")
  res.json({ ok: true, added: n, total: t && t[0] ? t[0].c : 0 })
})


// ── DB Cleanup endpoint ──
router.post("/api/admin/cleanup-db", (req, res) => {
  try {
    const { run, queryAll, forceSave } = require("../db")
    let removed = 0
    // Decimals
    const d = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE price!=ROUND(price) AND price>0')[0].c
    run('DELETE FROM market_listings WHERE price!=ROUND(price) AND price>0')
    removed += d
    // Under 1500
    const u = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE price>0 AND price<1500')[0].c
    run('DELETE FROM market_listings WHERE price>0 AND price<1500')
    removed += u
    // Over 200000
    const o = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE price>200000')[0].c
    run('DELETE FROM market_listings WHERE price>200000')
    removed += o
    // Fake (no km + generic title)
    const f = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE km IS NULL AND title LIKE make||" "||model||"%"')[0].c
    run('DELETE FROM market_listings WHERE km IS NULL AND title LIKE make||" "||model||"%"')
    removed += f
    // Dubbele model tokens
    const dt = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE model LIKE "% % %"')[0].c
    run('DELETE FROM market_listings WHERE model LIKE "% % %"')
    removed += dt
    // km > 500000
    const k = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE km > 500000')[0].c
    run('DELETE FROM market_listings WHERE km > 500000')
    removed += k
    forceSave()
    const active = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE status="active" AND price>0')[0].c
    const bad = queryAll('SELECT COUNT(*) as c FROM market_listings WHERE price>0 AND (price<500 OR price>200000 OR price!=ROUND(price))')[0].c
    res.json({ ok: true, removed, decimals: d, under1500: u, over200k: o, fakes: f, dupeModels: dt, highKm: k, remaining: active, bad })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


// ── Dealer Feedback & Learning ──
router.post("/api/feedback", authMiddleware, (req, res) => {
  try {
    const { run, queryAll } = require("../db")
    const { kenteken, make, model, year, km, segment, onze_inkoop_high, onze_verkoop, eigen_bod, status, notitie } = req.body
    if (!eigen_bod && status !== 'niet_gekocht') return res.json({ ok: false, error: "eigen_bod is verplicht" })
    // Pak user_id uit auth token als aanwezig
    let userId = req.body.user_id || 0
    try {
      const token = (req.headers.authorization || "").replace("Bearer ", "")
      if (token) {
        const jwt = require("jsonwebtoken")
        const { getSecret } = require("../lib/auth")
        const decoded = jwt.verify(token, getSecret())
        userId = decoded.userId || decoded.sub || 0
      }
    } catch(authErr) {}
    
    // Gebruik bestaande tabel met extra velden
    run("INSERT INTO dealer_feedback (make,model,year,our_bod,sold_price,feedback) VALUES (?,?,?,?,?,?)",
      [make||'', model||'', year||0, onze_inkoop_high||0, eigen_bod||0, JSON.stringify({status:status||'gekocht',km:km||0,kenteken:kenteken||'',segment:segment||'midden',onze_verkoop:onze_verkoop||0,notitie:notitie||'',user_id:userId})])
    
    // Bereken correctie voor dit segment
    const seg = segment || 'midden'
    const all = queryAll("SELECT sold_price, our_bod, feedback FROM dealer_feedback WHERE sold_price > 0 AND our_bod > 0")
    const segFeedbacks = all.filter(f => { try { return JSON.parse(f.feedback).segment === seg && JSON.parse(f.feedback).status === 'gekocht' } catch(e) { return false } })
    
    if (segFeedbacks.length >= 3) {
      const diffs = segFeedbacks.map(f => f.sold_price - f.our_bod)
      const avgVerschil = Math.round(diffs.reduce((a,b) => a+b, 0) / diffs.length)
      const avgOnze = Math.round(segFeedbacks.reduce((a,f) => a+f.our_bod, 0) / segFeedbacks.length)
      const correctionPct = avgOnze > 0 ? Math.round(avgVerschil / avgOnze * 1000) / 10 : 0
      
      console.log("[FEEDBACK]", make, model, ": eigen EUR" + eigen_bod, "vs onze EUR" + onze_inkoop_high, "| verschil EUR" + (eigen_bod - onze_inkoop_high), "| correctie:", correctionPct + "% (" + segFeedbacks.length + " feedbacks)")
      
      // GPT leerregel genereren als er een notitie bij zit
      if (notitie && notitie.length > 5) {
        try {
          const axios = require("axios")
          const { getApiKey } = require("../lib/ai")
          const aiKey = getApiKey("OPENAI_API_KEY")
          if (aiKey) {
            const verschil = eigen_bod - (onze_inkoop_high || 0)
            const richting = verschil > 0 ? 'HOGER' : verschil < 0 ? 'LAGER' : 'GELIJK'
            axios.post("https://api.openai.com/v1/chat/completions", {
              model: "gpt-5.4", temperature: 0, max_completion_tokens: 200,
              messages: [{
                role: "system",
                content: "Je bent een pricing coach voor autohandelaren. Maak een korte, bruikbare leerregel (1-2 zinnen) op basis van feedback van een ervaren inkoper. De regel moet toepasbaar zijn op vergelijkbare auto\'s in de toekomst. Antwoord ALLEEN met de regel, geen uitleg."
              }, {
                role: "user",
                content: make + " " + model + " " + (year||"") + " " + (km||"") + "km | Systeem zei: EUR " + (onze_inkoop_high||0) + " | Inkoper bood: EUR " + eigen_bod + " (" + richting + " " + Math.abs(verschil) + ") | Reden inkoper: " + notitie
              }]
            }, { headers: { "Authorization": "Bearer " + aiKey, "Content-Type": "application/json" }, timeout: 10000 })
            .then(resp => {
              const rule = (resp.data?.choices?.[0]?.message?.content || "").trim()
              if (rule && rule.length > 10) {
                run("INSERT INTO pricing_lessons (make, model, segment, rule, source_feedback_id) VALUES (?, ?, ?, ?, last_insert_rowid())",
                  [(make||"").toLowerCase(), (model||"").toLowerCase(), seg, rule])
                console.log("[LEARNING] Nieuwe regel:", make, model, "→", rule)
              }
            }).catch(e => console.log("[LEARNING] GPT error:", e.message))
          }
        } catch(le) { console.log("[LEARNING] Error:", le.message) }
      }
      
      res.json({ ok: true, correction: correctionPct, feedbackCount: segFeedbacks.length, avgVerschil })
    } else {
      console.log("[FEEDBACK]", make, model, ": eigen EUR" + eigen_bod, "| nog", (3 - segFeedbacks.length), "nodig")
      res.json({ ok: true, correction: null, feedbackCount: segFeedbacks.length, message: "Nog " + (3 - segFeedbacks.length) + " feedbacks nodig" })
    }
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})

router.get("/api/feedback/stats", authMiddleware, (req, res) => {
  try {
    const { queryAll } = require("../db")
    const all = queryAll("SELECT * FROM dealer_feedback ORDER BY created_at DESC LIMIT 50")
    const total = queryAll("SELECT COUNT(*) as c FROM dealer_feedback")[0].c
    res.json({ ok: true, total, recent: all })
  } catch(e) { res.status(500).json({ ok: false, error: e.message }) }
})


// ── Live crawler stats per bron ──
router.get("/api/admin/crawler-stats", authMiddleware, adminOnly, (req, res) => {
  try {
    const sources = queryAll(`
      SELECT source,
        COUNT(*) as total,
        SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN fuel IS NOT NULL AND fuel != '' THEN 1 ELSE 0 END) as with_fuel,
        SUM(CASE WHEN transmission IS NOT NULL AND transmission != '' THEN 1 ELSE 0 END) as with_trans,
        SUM(CASE WHEN options IS NOT NULL AND options != '' THEN 1 ELSE 0 END) as with_options,
        MAX(last_seen) as last_activity,
        SUM(CASE WHEN last_seen > datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
        ROUND(AVG(price), 0) as avg_price
      FROM market_listings
      GROUP BY source
      ORDER BY total DESC
    `)
    const queue = queryOne("SELECT COUNT(*) as c FROM crawl_queue")?.c || 0
    const total = queryOne("SELECT COUNT(*) as c FROM market_listings")?.c || 0
    const active = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='active'")?.c || 0
    const vehicle_cache = queryOne("SELECT COUNT(*) as c FROM vehicle_cache")?.c || 0
    res.json({ ok: true, sources, queue, total, active, vehicle_cache })
  } catch(e) { res.json({ ok: false, error: e.message }) }
})

module.exports = router
