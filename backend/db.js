/**
 * T4C Database Layer — sql.js (Pure JavaScript SQLite)
 * 
 * No native compilation needed! Works everywhere Node.js runs.
 * All persistent data in DATA_DIR/t4c.db
 */
const path = require("path")
const fs = require("fs")
const initSqlJs = require("sql.js")

// ── DATA DIRECTORY ── lives OUTSIDE backend/ so updates don't touch it
const DATA_DIR = process.env.T4C_DATA_DIR || path.join(__dirname, "..", "data")
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = path.join(DATA_DIR, "t4c.db")
const BACKUP_DIR = path.join(DATA_DIR, "backups")
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })

console.log(`[DB] Data directory: ${DATA_DIR}`)
console.log(`[DB] Database path: ${DB_PATH}`)

// ══════════════════════════════════════════════
// DB INSTANCE — initialized async, then sync
// ══════════════════════════════════════════════

let db = null
let _saveTimer = null

function scheduleSave() {
  // Debounced write — saves at most every 2 seconds
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    if (db) {
      try {
        const data = db.export()
        fs.writeFileSync(DB_PATH, Buffer.from(data))
      } catch (e) { console.error("[DB] Save error:", e.message) }
    }
  }, 2000)
}

function forceSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null }
  if (db) {
    try {
      const data = db.export()
      fs.writeFileSync(DB_PATH, Buffer.from(data))
    } catch (e) { console.error("[DB] Force save error:", e.message) }
  }
}

// ── Initialize ──
async function initDB() {
  const SQL = await initSqlJs()

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
    console.log("[DB] Loaded existing database")
  } else {
    db = new SQL.Database()
    console.log("[DB] Created new database")
  }

  // Enable WAL-like behavior and foreign keys
  db.run("PRAGMA foreign_keys = ON")

  // ── SCHEMA ──
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'dealer',
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS taxaties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kenteken TEXT NOT NULL,
      make TEXT, model TEXT, model_variant TEXT,
      year INTEGER, fuel TEXT, km INTEGER,
      color TEXT, body TEXT, power_kw REAL, power_hp REAL,
      engine_label TEXT, transmission TEXT,
      catalog_price REAL, bpm REAL, bpm_rest REAL,
      market_avg REAL, market_median REAL, market_count INTEGER,
      p25 REAL, p50 REAL, p75 REAL,
      verkoopadviees REAL, handelswaarde REAL,
      inkoop_low REAL, inkoop_high REAL, internet_prijs REAL,
      reconditie_kosten REAL DEFAULT 0,
      import_flag INTEGER DEFAULT 0, export_flag INTEGER DEFAULT 0,
      apk_until TEXT, vin TEXT,
      user_id INTEGER, notes TEXT,
      status TEXT DEFAULT 'concept',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_taxaties_kenteken ON taxaties(kenteken)")
  db.run("CREATE INDEX IF NOT EXISTS idx_taxaties_created ON taxaties(created_at)")

  db.run(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL,
      avg REAL, median REAL, low REAL, high REAL,
      p10 REAL, p25 REAL, p75 REAL, p90 REAL,
      count INTEGER, sources TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_market_mm ON market_snapshots(make, model, year)")

  db.run(`
    CREATE TABLE IF NOT EXISTS deals_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      make TEXT, model TEXT, year INTEGER,
      price REAL, market_median REAL, margin REAL, margin_pct REAL,
      title TEXT, url TEXT, source TEXT, km INTEGER, score REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS learned_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      make TEXT NOT NULL, model TEXT NOT NULL,
      year INTEGER NOT NULL, km INTEGER,
      median REAL, avg REAL, low REAL, high REAL,
      count INTEGER, quality TEXT, month INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_learned_mm ON learned_prices(make, model, year)")

  db.run(`
    CREATE TABLE IF NOT EXISTS portfolio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taxatie_id INTEGER, kenteken TEXT NOT NULL,
      make TEXT, model TEXT, year INTEGER,
      inkoop_prijs REAL, vraag_prijs REAL, reconditie_kosten REAL DEFAULT 0,
      status TEXT DEFAULT 'in_stock',
      verkoop_prijs REAL, verkoop_datum TEXT, winst REAL, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_portfolio_status ON portfolio(status)")

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // ── PUBLIC WEBSITE TABLES ──
  db.run(`
    CREATE TABLE IF NOT EXISTS contact_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      naam TEXT DEFAULT '',
      bedrijf TEXT DEFAULT '',
      email TEXT DEFAULT '',
      telefoon TEXT DEFAULT '',
      kvk TEXT DEFAULT '',
      onderwerp TEXT DEFAULT '',
      bericht TEXT DEFAULT '',
      type TEXT DEFAULT 'contact',
      status TEXT DEFAULT 'nieuw',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS voorraad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kenteken TEXT NOT NULL,
      make TEXT, model TEXT, model_variant TEXT,
      year INTEGER, fuel TEXT, km INTEGER,
      color TEXT, body TEXT,
      power_kw REAL, power_hp REAL,
      engine_label TEXT, transmission TEXT,
      doors INTEGER, seats INTEGER,
      vraag_prijs REAL,
      beschrijving TEXT,
      highlights TEXT,
      apk_until TEXT,
      vin TEXT,
      status TEXT DEFAULT 'te_koop',
      featured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_voorraad_status ON voorraad(status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_voorraad_make ON voorraad(make, model)")

  db.run(`
    CREATE TABLE IF NOT EXISTS car_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voorraad_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_cover INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (voorraad_id) REFERENCES voorraad(id)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_photos_car ON car_photos(voorraad_id)")

  // ── TRANSPORT ──
  db.run(`
    CREATE TABLE IF NOT EXISTS transport (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voorraad_id INTEGER,
      kenteken TEXT,
      van_postcode TEXT, van_plaats TEXT,
      naar_postcode TEXT, naar_plaats TEXT,
      afstand_km REAL,
      basis_kosten REAL, opslag_pct REAL DEFAULT 10,
      totaal_kosten REAL,
      bron TEXT DEFAULT 'fallback',
      status TEXT DEFAULT 'offerte',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // ── INSPECTIE / GEBREKEN ──
  db.run(`
    CREATE TABLE IF NOT EXISTS inspecties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voorraad_id INTEGER, kenteken TEXT NOT NULL,
      inspecteur TEXT,
      exterieur_score INTEGER DEFAULT 3,
      interieur_score INTEGER DEFAULT 3,
      technisch_score INTEGER DEFAULT 3,
      totaal_score REAL,
      totaal_kosten REAL DEFAULT 0,
      opmerkingen TEXT,
      status TEXT DEFAULT 'concept',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS gebreken (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspectie_id INTEGER NOT NULL,
      categorie TEXT,
      omschrijving TEXT NOT NULL,
      ernst TEXT DEFAULT 'gemiddeld',
      geschatte_kosten REAL DEFAULT 0,
      foto TEXT,
      FOREIGN KEY (inspectie_id) REFERENCES inspecties(id)
    )
  `)

  // ── BIEDINGEN ──
  db.run(`
    CREATE TABLE IF NOT EXISTS biedingen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voorraad_id INTEGER, kenteken TEXT,
      bieder TEXT NOT NULL,
      bedrag REAL NOT NULL,
      notitie TEXT,
      status TEXT DEFAULT 'actief',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_biedingen_kenteken ON biedingen(kenteken)")

  // ── VEILINGEN (Auction System) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS veilingen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voorraad_id INTEGER,
      kenteken TEXT NOT NULL,
      titel TEXT,
      beschrijving TEXT,
      merk TEXT, model TEXT, bouwjaar INTEGER,
      km INTEGER, brandstof TEXT, kleur TEXT,
      minimumprijs REAL NOT NULL,
      startprijs REAL DEFAULT 0,
      huidige_bod REAL DEFAULT 0,
      aantal_biedingen INTEGER DEFAULT 0,
      start_datum TEXT NOT NULL,
      eind_datum TEXT NOT NULL,
      ronde INTEGER DEFAULT 1,
      status TEXT DEFAULT 'actief',
      winnaar_user_id INTEGER,
      winnaar_bod REAL,
      transport_status TEXT DEFAULT 'pending',
      transport_keuze TEXT,
      transport_kosten REAL,
      leverdatum TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_veilingen_status ON veilingen(status)")
  db.run("CREATE INDEX IF NOT EXISTS idx_veilingen_eind ON veilingen(eind_datum)")
  db.run("CREATE INDEX IF NOT EXISTS idx_veilingen_winnaar ON veilingen(winnaar_user_id)")

  db.run(`
    CREATE TABLE IF NOT EXISTS veiling_biedingen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      veiling_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT,
      bedrag REAL NOT NULL,
      auto_bod INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (veiling_id) REFERENCES veilingen(id)
    )
  `)
  db.run("CREATE INDEX IF NOT EXISTS idx_vbied_veiling ON veiling_biedingen(veiling_id)")
  db.run("CREATE INDEX IF NOT EXISTS idx_vbied_user ON veiling_biedingen(user_id)")

  db.run(`
    CREATE TABLE IF NOT EXISTS veiling_watchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      veiling_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      email TEXT,
      notify_email INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(veiling_id, user_id)
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT DEFAULT 'veiling',
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    )
  `)

  // ── VERKOPEN (sales history) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS verkopen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kenteken TEXT, make TEXT, model TEXT, year INTEGER,
      type TEXT DEFAULT 'veiling',
      inkoop_prijs REAL, verkoop_prijs REAL, reconditie REAL DEFAULT 0,
      marge REAL,
      koper_naam TEXT, koper_email TEXT, koper_id INTEGER,
      veiling_id INTEGER, portfolio_id INTEGER, voorraad_id INTEGER,
      notities TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // ── VEILING BIEDINGEN ARCHIEF (bewaar bids na herstart) ──
  db.run(`
    CREATE TABLE IF NOT EXISTS veiling_biedingen_archief (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      veiling_id INTEGER, ronde INTEGER,
      user_id INTEGER, username TEXT, bedrag REAL,
      original_created_at TEXT,
      archived_at TEXT DEFAULT (datetime('now'))
    )
  `)

  // ── Alter users table for multi-user (add columns if missing) ──
  try { db.run("ALTER TABLE users ADD COLUMN email TEXT") } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN phone TEXT") } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1") } catch {}
  try { db.run("ALTER TABLE users ADD COLUMN company TEXT DEFAULT ''") } catch {}

  console.log("[DB] Schema verified")

  // ── MIGRATE from JSON files ──
  migrateFromJSON()

  // Save initial state
  forceSave()

  // Auto-save every 30 seconds
  setInterval(forceSave, 30000)

  // Save on process exit
  process.on("exit", forceSave)
  process.on("SIGINT", () => { forceSave(); process.exit() })
  process.on("SIGTERM", () => { forceSave(); process.exit() })

  // ── SCHEMA MIGRATIONS (v9.3 → v9.4) ──
  try {
    const cols = db.exec("PRAGMA table_info(users)")[0]?.values?.map(r => r[1]) || []
    if (!cols.includes("email")) db.run("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
    if (!cols.includes("phone")) db.run("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")
    if (!cols.includes("active")) db.run("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1")
    scheduleSave()
  } catch (e) { console.log("[DB] Column migration:", e.message) }

  // ── SEED DEFAULT ADMIN ──
  const userCount = queryOne("SELECT COUNT(*) as c FROM users")
  if (!userCount || userCount.c === 0) {
    const bcrypt = require("bcryptjs")
    run("INSERT OR IGNORE INTO users (username,password,name,role) VALUES (?,?,?,?)",
      ["admin", bcrypt.hashSync("t4c2025!", 10), "Admin", "admin"])
    run("INSERT OR IGNORE INTO users (username,password,name,role) VALUES (?,?,?,?)",
      ["dealer", bcrypt.hashSync("dealer2025", 10), "Dealer", "dealer"])
    console.log("[DB] Seeded default users (bcrypt)")
    scheduleSave()
  }

  // ── SECURE JWT SECRET ──
  const jwtRow = queryOne("SELECT value FROM settings WHERE key='jwt_secret'")
  if (!jwtRow || jwtRow.value === "CHANGE_THIS_TO_RANDOM_STRING_t4c2025" || jwtRow.value === "t4c-secret-2025") {
    const crypto = require("crypto")
    run("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('jwt_secret',?,datetime('now'))",
      [crypto.randomBytes(48).toString("hex")])
    console.log("[DB] Generated secure JWT secret")
    scheduleSave()
  }

  return db
}

// ══════════════════════════════════════════════
// MIGRATION — import existing JSON data
// ══════════════════════════════════════════════

function migrateFromJSON() {
  const existing = queryOne("SELECT value FROM settings WHERE key = 'migrated_json'")
  if (existing) return

  console.log("[DB] Migrating existing JSON data...")

  // Users
  const usersFile = path.join(__dirname, "users.json")
  if (fs.existsSync(usersFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(usersFile, "utf8"))
      const bcrypt = require("bcryptjs")
      for (const u of (data.users || [])) {
        const pw = (u.password.startsWith("$2a$") || u.password.startsWith("$2b$"))
          ? u.password : bcrypt.hashSync(u.password, 10)
        run("INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)",
          [u.username, pw, u.name || u.username, u.role || "dealer"])
      }
      if (data.secret) {
        run("INSERT OR REPLACE INTO settings (key, value) VALUES ('jwt_secret', ?)", [data.secret])
      }
      console.log(`[DB] Migrated ${(data.users || []).length} users`)
    } catch (e) { console.error("[DB] Users migration:", e.message) }
  }

  // Learned prices
  const lpFile = path.join(__dirname, "learned_prices.json")
  if (fs.existsSync(lpFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(lpFile, "utf8"))
      let count = 0
      for (const [key, val] of Object.entries(data)) {
        const [mk, ml] = key.split("|")
        if (mk && ml && val) {
          run("INSERT INTO learned_prices (make, model, year, median, avg, low, high, count) VALUES (?,?,?,?,?,?,?,?)",
            [mk, ml, val.year || 0, val.median || 0, val.avg || 0, val.low || 0, val.high || 0, val.count || 0])
          count++
        }
      }
      console.log(`[DB] Migrated ${count} learned prices`)
    } catch (e) { console.error("[DB] Prices migration:", e.message) }
  }

  // Price history
  const phFile = path.join(__dirname, "price_history.json")
  if (fs.existsSync(phFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(phFile, "utf8"))
      let count = 0
      for (const [key, entries] of Object.entries(data)) {
        const [mk, ml] = key.split("|")
        if (!mk || !ml || !Array.isArray(entries)) continue
        for (const e of entries) {
          try {
            run("INSERT INTO learned_prices (make,model,year,km,median,avg,low,high,count,quality,month) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              [mk, ml, e.yr||0, e.km||0, e.median||0, e.avg||0, e.low||0, e.high||0, e.count||0, e.quality||"", e.month||0])
            count++
          } catch {}
        }
      }
      console.log(`[DB] Migrated ${count} history entries`)
    } catch (e) { console.error("[DB] History migration:", e.message) }
  }

  run("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_json', ?)", [new Date().toISOString()])
  forceSave()
  console.log("[DB] Migration complete")
}

// ══════════════════════════════════════════════
// QUERY HELPERS
// ══════════════════════════════════════════════

function run(sql, params = []) {
  if (!db) throw new Error("DB not initialized")
  db.run(sql, params)
  scheduleSave()
  return { lastInsertRowid: queryOne("SELECT last_insert_rowid() as id")?.id || 0 }
}

function queryAll(sql, params = []) {
  if (!db) return []
  const stmt = db.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(stmt.getAsObject())
  stmt.free()
  return rows
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params)
  return rows[0] || null
}

// ══════════════════════════════════════════════
// PREPARED OPERATIONS (same interface as before)
// ══════════════════════════════════════════════

const stmts = {
  // Users
  getUser: { get: (username) => queryOne("SELECT * FROM users WHERE username = ?", [username]) },
  updateLogin: { run: (username) => run("UPDATE users SET last_login = datetime('now') WHERE username = ?", [username]) },

  // Taxaties
  saveTaxatie: {
    run: (d) => run(`INSERT INTO taxaties (kenteken,make,model,model_variant,year,fuel,km,color,body,
      power_kw,power_hp,engine_label,transmission,catalog_price,bpm,bpm_rest,
      market_avg,market_median,market_count,p25,p50,p75,
      verkoopadviees,handelswaarde,inkoop_low,inkoop_high,internet_prijs,
      reconditie_kosten,import_flag,export_flag,apk_until,vin,user_id,notes,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.kenteken,d.make,d.model,d.model_variant,d.year,d.fuel,d.km,d.color,d.body,
       d.power_kw,d.power_hp,d.engine_label,d.transmission,d.catalog_price,d.bpm,d.bpm_rest,
       d.market_avg,d.market_median,d.market_count,d.p25,d.p50,d.p75,
       d.verkoopadviees,d.handelswaarde,d.inkoop_low,d.inkoop_high,d.internet_prijs,
       d.reconditie_kosten,d.import_flag?1:0,d.export_flag?1:0,d.apk_until,d.vin,d.user_id,d.notes,d.status])
  },
  getTaxaties: { all: (limit) => queryAll("SELECT * FROM taxaties ORDER BY created_at DESC LIMIT ?", [limit]) },
  getTaxatieByKenteken: { get: (k) => queryOne("SELECT * FROM taxaties WHERE kenteken = ? ORDER BY created_at DESC LIMIT 1", [k]) },
  searchTaxaties: { all: (q1,q2,q3) => queryAll("SELECT * FROM taxaties WHERE kenteken LIKE ? OR make LIKE ? OR model LIKE ? ORDER BY created_at DESC LIMIT 50", [q1,q2,q3]) },
  updateTaxatieStatus: { run: (status, id) => run("UPDATE taxaties SET status=?, updated_at=datetime('now') WHERE id=?", [status, id]) },

  // Market
  saveMarketSnapshot: {
    run: (mk,ml,yr,avg,med,lo,hi,p10,p25,p75,p90,cnt,src) =>
      run("INSERT INTO market_snapshots (make,model,year,avg,median,low,high,p10,p25,p75,p90,count,sources) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [mk,ml,yr,avg,med,lo,hi,p10,p25,p75,p90,cnt,src])
  },
  getMarketHistory: { all: (mk,ml,yr) => queryAll("SELECT * FROM market_snapshots WHERE make=? AND model=? AND year=? ORDER BY created_at DESC LIMIT 30", [mk,ml,yr]) },

  // Deals
  saveDeal: {
    run: (mk,ml,yr,price,med,margin,mpct,title,url,src,km,score) =>
      run("INSERT INTO deals_history (make,model,year,price,market_median,margin,margin_pct,title,url,source,km,score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [mk,ml,yr,price,med,margin,mpct,title,url,src,km,score])
  },
  getRecentDeals: { all: (limit) => queryAll("SELECT * FROM deals_history ORDER BY created_at DESC LIMIT ?", [limit]) },

  // Learned prices
  saveLearnedPrice: {
    run: (mk,ml,yr,km,med,avg,lo,hi,cnt,q,mo) =>
      run("INSERT INTO learned_prices (make,model,year,km,median,avg,low,high,count,quality,month) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [mk,ml,yr,km,med,avg,lo,hi,cnt,q,mo])
  },
  getLearnedPrice: { all: (mk,ml) => queryAll("SELECT * FROM learned_prices WHERE make=? AND model=? ORDER BY created_at DESC LIMIT 50", [mk,ml]) },

  // Portfolio
  addToPortfolio: {
    run: (d) => run("INSERT INTO portfolio (taxatie_id,kenteken,make,model,year,inkoop_prijs,vraag_prijs,reconditie_kosten,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [d.taxatie_id,d.kenteken,d.make,d.model,d.year,d.inkoop_prijs,d.vraag_prijs,d.reconditie_kosten,d.status,d.notes])
  },
  getPortfolio: { all: () => queryAll("SELECT * FROM portfolio ORDER BY created_at DESC") },
  updatePortfolioStatus: { run: (status,id) => run("UPDATE portfolio SET status=?, updated_at=datetime('now') WHERE id=?", [status,id]) },
  sellPortfolioItem: { run: (prijs,prijs2,id) => run("UPDATE portfolio SET status='verkocht', verkoop_prijs=?, verkoop_datum=date('now'), winst=?-inkoop_prijs-reconditie_kosten, updated_at=datetime('now') WHERE id=?", [prijs,prijs2,id]) },

  // Settings
  getSetting: { get: (k) => queryOne("SELECT value FROM settings WHERE key=?", [k]) },
  setSetting: { run: (k,v) => run("INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES (?,?,datetime('now'))", [k,v]) },

  // Voorraad (public website)
  addVoorraad: {
    run: (d) => run(`INSERT INTO voorraad (kenteken,make,model,model_variant,year,fuel,km,color,body,
      power_kw,power_hp,engine_label,transmission,doors,seats,vraag_prijs,beschrijving,highlights,apk_until,vin,status,featured)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [d.kenteken,d.make,d.model,d.model_variant,d.year,d.fuel,d.km,d.color,d.body,
       d.power_kw,d.power_hp,d.engine_label,d.transmission,d.doors,d.seats,
       d.vraag_prijs,d.beschrijving,d.highlights,d.apk_until,d.vin,d.status||'te_koop',d.featured?1:0])
  },
  getVoorraad: { all: () => queryAll("SELECT v.*, (SELECT filename FROM car_photos WHERE voorraad_id=v.id AND is_cover=1 LIMIT 1) as cover_photo FROM voorraad v WHERE v.status='te_koop' ORDER BY v.featured DESC, v.created_at DESC") },
  getVoorraadById: { get: (id) => queryOne("SELECT * FROM voorraad WHERE id=?", [id]) },
  getVoorraadPhotos: { all: (id) => queryAll("SELECT * FROM car_photos WHERE voorraad_id=? ORDER BY sort_order, id", [id]) },
  updateVoorraad: { run: (id, d) => run("UPDATE voorraad SET make=?,model=?,year=?,km=?,vraag_prijs=?,beschrijving=?,status=?,featured=?,updated_at=datetime('now') WHERE id=?",
    [d.make,d.model,d.year,d.km,d.vraag_prijs,d.beschrijving,d.status,d.featured?1:0,id]) },
  addCarPhoto: { run: (vid,fn,order,cover) => run("INSERT INTO car_photos (voorraad_id,filename,sort_order,is_cover) VALUES (?,?,?,?)", [vid,fn,order,cover?1:0]) },
  countVoorraad: { get: () => queryOne("SELECT COUNT(*) as count FROM voorraad WHERE status='te_koop'") },

  // DELETE operations
  deleteTaxatie: { run: (id) => run("DELETE FROM taxaties WHERE id=?", [id]) },
  deletePortfolioItem: { run: (id) => run("DELETE FROM portfolio WHERE id=?", [id]) },
  deleteVoorraad: { run: (id) => run("DELETE FROM voorraad WHERE id=?", [id]) },
  deleteCarPhoto: { run: (id) => run("DELETE FROM car_photos WHERE id=?", [id]) },
  deletePhotosByVoorraad: { run: (id) => run("DELETE FROM car_photos WHERE voorraad_id=?", [id]) },
  getCarPhoto: { get: (id) => queryOne("SELECT * FROM car_photos WHERE id=?", [id]) },

  // Voorraad (authenticated - all statuses, full data)
  getVoorraadAll: { all: () => queryAll("SELECT v.*, (SELECT filename FROM car_photos WHERE voorraad_id=v.id AND is_cover=1 LIMIT 1) as cover_photo, (SELECT COUNT(*) FROM car_photos WHERE voorraad_id=v.id) as photo_count FROM voorraad v ORDER BY v.featured DESC, v.created_at DESC") },

  // Contact requests
  getContactRequests: { all: () => queryAll("SELECT * FROM contact_requests ORDER BY created_at DESC") },
  getContactRequestById: { get: (id) => queryOne("SELECT * FROM contact_requests WHERE id=?", [id]) },
  updateContactStatus: { run: (id, status) => run("UPDATE contact_requests SET status=? WHERE id=?", [status, id]) },
  deleteContactRequest: { run: (id) => run("DELETE FROM contact_requests WHERE id=?", [id]) },

  // All inspecties (for desktop overview)
  getAllInspecties: { all: () => queryAll("SELECT * FROM inspecties ORDER BY created_at DESC") },

  // Password change (self)
  changePassword: { run: (username, hash) => run("UPDATE users SET password=? WHERE username=?", [hash, username]) },

  // Transport
  addTransport: { run: (d) => run(`INSERT INTO transport (voorraad_id,kenteken,van_postcode,van_plaats,naar_postcode,naar_plaats,afstand_km,basis_kosten,opslag_pct,totaal_kosten,bron,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.voorraad_id,d.kenteken,d.van_postcode,d.van_plaats,d.naar_postcode,d.naar_plaats,d.afstand_km,d.basis_kosten,d.opslag_pct||10,d.totaal_kosten,d.bron||'fallback',d.status||'offerte']) },
  getTransport: { all: (kenteken) => queryAll("SELECT * FROM transport WHERE kenteken=? ORDER BY created_at DESC", [kenteken]) },

  // Inspecties
  addInspectie: { run: (d) => run(`INSERT INTO inspecties (voorraad_id,kenteken,inspecteur,exterieur_score,interieur_score,technisch_score,totaal_score,totaal_kosten,opmerkingen,status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [d.voorraad_id,d.kenteken,d.inspecteur,d.exterieur_score||3,d.interieur_score||3,d.technisch_score||3,d.totaal_score,d.totaal_kosten||0,d.opmerkingen,d.status||'concept']) },
  getInspectie: { get: (id) => queryOne("SELECT * FROM inspecties WHERE id=?", [id]) },
  getInspecties: { all: (kenteken) => queryAll("SELECT * FROM inspecties WHERE kenteken=? ORDER BY created_at DESC", [kenteken]) },
  updateInspectie: { run: (id, d) => run("UPDATE inspecties SET exterieur_score=?,interieur_score=?,technisch_score=?,totaal_score=?,totaal_kosten=?,opmerkingen=?,status=? WHERE id=?",
    [d.exterieur_score,d.interieur_score,d.technisch_score,d.totaal_score,d.totaal_kosten,d.opmerkingen,d.status||'afgerond',id]) },
  addGebrek: { run: (d) => run("INSERT INTO gebreken (inspectie_id,categorie,omschrijving,ernst,geschatte_kosten,foto) VALUES (?,?,?,?,?,?)",
    [d.inspectie_id,d.categorie,d.omschrijving,d.ernst||'gemiddeld',d.geschatte_kosten||0,d.foto]) },
  getGebreken: { all: (inspId) => queryAll("SELECT * FROM gebreken WHERE inspectie_id=?", [inspId]) },
  deleteGebrek: { run: (id) => run("DELETE FROM gebreken WHERE id=?", [id]) },

  // Biedingen
  addBod: { run: (d) => run("INSERT INTO biedingen (voorraad_id,kenteken,bieder,bedrag,notitie,status) VALUES (?,?,?,?,?,?)",
    [d.voorraad_id,d.kenteken,d.bieder,d.bedrag,d.notitie,d.status||'actief']) },
  getBiedingen: { all: (kenteken) => queryAll("SELECT * FROM biedingen WHERE kenteken=? ORDER BY created_at DESC", [kenteken]) },
  getAllBiedingen: { all: () => queryAll("SELECT * FROM biedingen WHERE status='actief' ORDER BY created_at DESC") },
  updateBod: { run: (id, status) => run("UPDATE biedingen SET status=? WHERE id=?", [status, id]) },
  getBiedingStats: { get: (kenteken) => queryOne("SELECT COUNT(*) as count, AVG(bedrag) as avg, MIN(bedrag) as min, MAX(bedrag) as max FROM biedingen WHERE kenteken=? AND status='actief'", [kenteken]) },

  // Veilingen
  addVeiling: { run: (d) => run(`INSERT INTO veilingen (voorraad_id,kenteken,titel,beschrijving,merk,model,bouwjaar,km,brandstof,kleur,minimumprijs,startprijs,start_datum,eind_datum,created_by,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [d.voorraad_id,d.kenteken,d.titel,d.beschrijving,d.merk,d.model,d.bouwjaar,d.km,d.brandstof,d.kleur,d.minimumprijs,d.startprijs||0,d.start_datum,d.eind_datum,d.created_by,d.status||'actief']) },
  getVeiling: { get: (id) => queryOne("SELECT * FROM veilingen WHERE id=?", [id]) },
  getVeilingen: { all: (status) => status ? queryAll("SELECT * FROM veilingen WHERE status=? ORDER BY eind_datum ASC", [status]) : queryAll("SELECT * FROM veilingen ORDER BY created_at DESC") },
  getActieveVeilingen: { all: () => queryAll("SELECT * FROM veilingen WHERE status='actief' AND eind_datum > datetime('now') ORDER BY eind_datum ASC") },
  getVerlopenVeilingen: { all: () => queryAll("SELECT * FROM veilingen WHERE status='actief' AND eind_datum <= datetime('now')") },
  updateVeiling: { run: (id, d) => { const sets=[]; const vals=[]; for(const[k,v] of Object.entries(d)){sets.push(k+"=?");vals.push(v)} vals.push(id); run("UPDATE veilingen SET "+sets.join(",")+",updated_at=datetime('now') WHERE id=?", vals) }},
  deleteVeiling: { run: (id) => { run("DELETE FROM veiling_biedingen WHERE veiling_id=?", [id]); run("DELETE FROM veiling_watchers WHERE veiling_id=?", [id]); run("DELETE FROM veilingen WHERE id=?", [id]) }},
  countVeilingen: { get: () => queryOne("SELECT COUNT(*) as total, SUM(CASE WHEN status='actief' THEN 1 ELSE 0 END) as actief, SUM(CASE WHEN status='gewonnen' THEN 1 ELSE 0 END) as gewonnen, SUM(CASE WHEN status='gepland' THEN 1 ELSE 0 END) as gepland FROM veilingen") },

  addVeilingBod: { run: (d) => run("INSERT INTO veiling_biedingen (veiling_id,user_id,username,bedrag) VALUES (?,?,?,?)", [d.veiling_id,d.user_id,d.username,d.bedrag]) },
  getVeilingBiedingen: { all: (veilingId) => queryAll("SELECT * FROM veiling_biedingen WHERE veiling_id=? ORDER BY bedrag DESC", [veilingId]) },
  getHoogsteBod: { get: (veilingId) => queryOne("SELECT * FROM veiling_biedingen WHERE veiling_id=? ORDER BY bedrag DESC LIMIT 1", [veilingId]) },
  getUserVeilingBiedingen: { all: (userId) => queryAll("SELECT vb.*, v.titel, v.kenteken, v.merk, v.model, v.status as veiling_status, v.winnaar_user_id, v.eind_datum FROM veiling_biedingen vb JOIN veilingen v ON vb.veiling_id=v.id WHERE vb.user_id=? ORDER BY vb.created_at DESC", [userId]) },
  getUserGewonnenVeilingen: { all: (userId) => queryAll("SELECT * FROM veilingen WHERE winnaar_user_id=? ORDER BY updated_at DESC", [userId]) },

  addWatcher: { run: (d) => run("INSERT OR IGNORE INTO veiling_watchers (veiling_id,user_id,email) VALUES (?,?,?)", [d.veiling_id,d.user_id,d.email]) },
  getWatchers: { all: (veilingId) => queryAll("SELECT * FROM veiling_watchers WHERE veiling_id=?", [veilingId]) },
  getAllWatcherEmails: { all: () => queryAll("SELECT DISTINCT email FROM veiling_watchers WHERE notify_email=1 AND email IS NOT NULL AND email != ''") },

  addEmailQueue: { run: (d) => run("INSERT INTO email_queue (to_email,subject,body,type) VALUES (?,?,?,?)", [d.to_email,d.subject,d.body,d.type||'veiling']) },
  getPendingEmails: { all: () => queryAll("SELECT * FROM email_queue WHERE status='pending' ORDER BY created_at ASC LIMIT 50") },
  markEmailSent: { run: (id) => run("UPDATE email_queue SET status='sent', sent_at=datetime('now') WHERE id=?", [id]) },

  // Users (multi-user)
  getAllUsers: { all: () => queryAll("SELECT id, username, name, role, email, phone, active, last_login FROM users") },
  addUser: { run: (d) => run("INSERT INTO users (username,password,name,role,email,phone,active) VALUES (?,?,?,?,?,?,?)",
    [d.username,d.password,d.name,d.role||'dealer',d.email,d.phone,d.active!==false?1:0]) },
  updateUser: { run: (id, d) => run("UPDATE users SET name=?,role=?,email=?,phone=?,active=? WHERE id=?",
    [d.name,d.role,d.email,d.phone,d.active?1:0,id]) },
  deleteUser: { run: (id) => run("DELETE FROM users WHERE id=?", [id]) },

  // Stats
  countTaxaties: { get: () => queryOne("SELECT COUNT(*) as count FROM taxaties") },
  countDeals: { get: () => queryOne("SELECT COUNT(*) as count FROM deals_history") },
  countPortfolio: { get: () => queryOne("SELECT COUNT(*) as count, SUM(CASE WHEN status='in_stock' THEN 1 ELSE 0 END) as in_stock, SUM(CASE WHEN status='verkocht' THEN 1 ELSE 0 END) as verkocht FROM portfolio") },
  
  // Verkopen (sales history)
  addVerkoop: { run: (d) => run("INSERT INTO verkopen (kenteken,make,model,year,type,inkoop_prijs,verkoop_prijs,reconditie,marge,koper_naam,koper_email,koper_id,veiling_id,portfolio_id,voorraad_id,notities) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [d.kenteken,d.make,d.model,d.year,d.type||'direct',d.inkoop_prijs||0,d.verkoop_prijs||0,d.reconditie||0,d.marge||0,d.koper_naam,d.koper_email,d.koper_id,d.veiling_id,d.portfolio_id,d.voorraad_id,d.notities]) },
  getVerkopen: { all: (limit) => queryAll("SELECT * FROM verkopen ORDER BY created_at DESC LIMIT ?", [limit||100]) },
  countVerkopen: { get: () => queryOne("SELECT COUNT(*) as count, SUM(marge) as totale_marge FROM verkopen") },
  
  // Veiling biedingen archief
  archiveBids: { run: (veilingId, ronde) => run("INSERT INTO veiling_biedingen_archief (veiling_id, ronde, user_id, username, bedrag, original_created_at) SELECT veiling_id, ?, user_id, username, bedrag, created_at FROM veiling_biedingen WHERE veiling_id=?", [ronde, veilingId]) },
  
  // Taxatie delete
  deleteTaxatie: { run: (id) => run("DELETE FROM taxaties WHERE id=?", [id]) },
  dbSize: () => fs.existsSync(DB_PATH) ? Math.round(fs.statSync(DB_PATH).size / 1024) : 0,
}

// ══════════════════════════════════════════════
// BACKUP
// ══════════════════════════════════════════════

function backup() {
  forceSave() // Ensure latest data is on disk
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const backupFile = path.join(BACKUP_DIR, `t4c-backup-${ts}.db`)
  try {
    fs.copyFileSync(DB_PATH, backupFile)
    console.log(`[DB] Backup: ${backupFile}`)
    // Keep only last 10
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".db")).sort()
    while (backups.length > 10) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, backups.shift())) } catch {}
    }
  } catch (e) { console.error("[DB] Backup failed:", e.message) }
}

// ══════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════

module.exports = {
  initDB, db: () => db, stmts, DATA_DIR, DB_PATH, BACKUP_DIR, backup, forceSave,
  queryOne, queryAll, run,

  getJwtSecret() {
    const row = stmts.getSetting.get("jwt_secret")
    return row?.value || "t4c-secret-2025"
  },

  verifyUser(username, password) {
    const user = stmts.getUser.get(username)
    if (!user) return null
    if (user.active === 0) return null
    let valid = false
    if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
      valid = require("bcryptjs").compareSync(password, user.password)
    } else {
      valid = (user.password === password)
      if (valid) {
        run("UPDATE users SET password=? WHERE id=?", [require("bcryptjs").hashSync(password, 10), user.id])
        scheduleSave()
      }
    }
    if (!valid) return null
    stmts.updateLogin.run(username)
    return { id: user.id, username: user.username, name: user.name, role: user.role }
  },

  getStats() {
    return {
      taxaties: stmts.countTaxaties.get()?.count || 0,
      deals: stmts.countDeals.get()?.count || 0,
      portfolio: stmts.countPortfolio.get() || { count: 0, in_stock: 0, verkocht: 0 },
      dbSizeKb: stmts.dbSize(),
    }
  },
}
