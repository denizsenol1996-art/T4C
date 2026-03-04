#!/usr/bin/env node
// Transfer4Cars — Marktplaats Importer v2
// Uses Marktplaats search API for structured data
// Run: node marktplaats-import.js

const https = require("https");
const path = require("path");

const SELLER_ID = "17478300";
const DB_PATH = path.join(__dirname, "..", "data", "t4c.db");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ── Database ──
let db;
try {
  const Database = require("better-sqlite3");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
} catch (e) {
  console.error("better-sqlite3 niet gevonden. Run: npm install better-sqlite3");
  process.exit(1);
}

function ensureSchema() {
  const cols = db.prepare("PRAGMA table_info(voorraad)").all().map(c => c.name);
  const add = (col, type) => {
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE voorraad ADD COLUMN ${col} ${type}`);
      console.log(`  + kolom ${col} toegevoegd`);
    }
  };
  add("cover_photo", "TEXT");
  add("photos", "TEXT");
  add("mp_id", "TEXT");
  add("mp_url", "TEXT");
  add("options", "TEXT");
}

// ── HTTP ──
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json, text/html",
        "Accept-Language": "nl-NL,nl;q=0.9",
        "X-MP-GFBT": "1"
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch listings via search API ──
async function fetchListings() {
  const all = [];
  let offset = 0;
  const limit = 30;

  while (true) {
    const url = `https://www.marktplaats.nl/lrp/api/search?attributeRanges[]=PriceCents%3A0%3A&l1CategoryId=91&limit=${limit}&offset=${offset}&sellerIds=${SELLER_ID}&sortBy=SORT_INDEX&sortOrder=DECREASING&viewOptions=list-view`;
    
    console.log(`  API offset=${offset}...`);
    const res = await fetch(url);
    
    if (res.status !== 200) {
      console.log(`  Status ${res.status} - stoppen`);
      break;
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch (e) {
      console.log(`  JSON parse fout - stoppen`);
      break;
    }

    const listings = data.listings || [];
    if (listings.length === 0) break;

    all.push(...listings);
    console.log(`  ${listings.length} advertenties (totaal: ${all.length})`);

    if (listings.length < limit) break;
    offset += limit;
    await sleep(1500);
  }

  return all;
}

// ── Fetch single listing detail ──
async function fetchDetail(itemId) {
  const url = `https://www.marktplaats.nl/v/detail.json?id=${itemId}`;
  try {
    const res = await fetch(url);
    if (res.status === 200) {
      return JSON.parse(res.body);
    }
  } catch (e) {}
  return null;
}

// ── Parse listing from API data ──
function parseListing(item) {
  const car = {
    mp_id: String(item.itemId || item.l1CategoryId || ""),
    mp_url: item.vipUrl ? `https://www.marktplaats.nl${item.vipUrl}` : "",
    make: "",
    model: "",
    model_variant: "",
    year: null,
    fuel: null,
    km: null,
    color: "",
    body: "",
    power_kw: null,
    power_hp: null,
    transmission: "",
    doors: null,
    seats: null,
    vraag_prijs: null,
    beschrijving: "",
    highlights: "",
    cover_photo: "",
    photos: [],
    options: [],
    status: "te_koop",
    featured: 0
  };

  // ID
  car.mp_id = String(item.itemId || "");

  // Title parsing
  const title = item.title || "";
  // Pattern: "Make Model Variant (bj YYYY, ...)"
  const bjMatch = title.match(/\(bj\s+(\d{4})/);
  if (bjMatch) car.year = parseInt(bjMatch[1]);

  const cleanTitle = title.replace(/\s*\(bj.*$/, "").trim();
  const words = cleanTitle.split(/\s+/);
  if (words.length >= 2) {
    car.make = words[0];
    car.model = words[1];
    car.model_variant = words.slice(2).join(" ");
  }

  // Price (in cents from API)
  const priceCents = item.priceInfo?.priceCents;
  if (priceCents && priceCents > 0) {
    car.vraag_prijs = priceCents / 100;
  } else {
    // Try priceType display
    const priceStr = item.priceInfo?.priceDisplayText || item.priceInfo?.displayPrice || "";
    const pm = priceStr.replace(/[^\d]/g, "");
    if (pm) car.vraag_prijs = parseInt(pm);
  }

  // Photos from API
  const images = item.imageUrls || item.pictures || [];
  if (typeof images === "object" && !Array.isArray(images)) {
    // Sometimes it's { "0": {...}, "1": {...} }
    car.photos = Object.values(images).map(img => {
      if (typeof img === "string") return img;
      return img.extraExtraLargeUrl || img.extraLargeUrl || img.largeUrl || img.mediumUrl || "";
    }).filter(Boolean);
  } else if (Array.isArray(images)) {
    car.photos = images.map(img => {
      if (typeof img === "string") {
        // Upgrade to full size
        if (img.includes("rule=")) return img.replace(/rule=[^&]+/, "rule=ecg_mp_eps$_86");
        return img + "?rule=ecg_mp_eps$_86";
      }
      return img.extraExtraLargeUrl || img.extraLargeUrl || img.largeUrl || img.mediumUrl || img.url || "";
    }).filter(Boolean);
  }
  if (car.photos.length) car.cover_photo = car.photos[0];

  // Attributes
  const attrs = item.attributes || item.categorySpecificAttributes || [];
  if (Array.isArray(attrs)) {
    for (const attr of attrs) {
      const key = (attr.key || "").toLowerCase();
      const val = attr.value || attr.values?.[0] || "";
      const valStr = String(val);

      if (key.includes("constructionyear") || key.includes("bouwjaar")) car.year = parseInt(valStr) || car.year;
      if (key.includes("mileage") || key.includes("kilometerstand")) car.km = parseInt(valStr.replace(/\D/g, "")) || null;
      if (key.includes("fuel") || key.includes("brandstof")) {
        const f = valStr.toLowerCase();
        car.fuel = f.includes("benzine") ? "Benzine" : f.includes("diesel") ? "Diesel" : f.includes("elek") ? "Elektrisch" : f.includes("hybr") ? "Hybride" : f.includes("lpg") ? "LPG" : valStr;
      }
      if (key.includes("transmission") || key.includes("transmissie")) {
        car.transmission = valStr.toLowerCase().includes("automaat") ? "Automaat" : "Handgeschakeld";
      }
      if (key.includes("power") || key.includes("vermogen")) {
        const pk = valStr.match(/(\d+)/);
        if (pk) { car.power_hp = parseInt(pk[1]); car.power_kw = Math.round(car.power_hp * 0.7355); }
      }
      if (key.includes("color") || key.includes("kleur")) car.color = valStr;
      if (key.includes("body") || key.includes("carrosserie")) car.body = valStr;
      if (key.includes("doors") || key.includes("deuren")) car.doors = parseInt(valStr) || null;
      if (key.includes("seats") || key.includes("stoelen")) car.seats = parseInt(valStr) || null;
    }
  }

  // Verticals (another attribute format)
  const verts = item.verticals || {};
  if (verts.constructionYear) car.year = parseInt(verts.constructionYear) || car.year;
  if (verts.mileage) car.km = parseInt(String(verts.mileage).replace(/\D/g, "")) || car.km;
  if (verts.fuelType) {
    const f = verts.fuelType.toLowerCase();
    car.fuel = car.fuel || (f.includes("benz") ? "Benzine" : f.includes("dies") ? "Diesel" : f.includes("elek") ? "Elektrisch" : verts.fuelType);
  }
  if (verts.bodyType) car.body = car.body || verts.bodyType;

  // Extended attrs
  const extAttrs = item.extendedAttributes || [];
  if (Array.isArray(extAttrs)) {
    for (const attr of extAttrs) {
      const key = (attr.key || "").toLowerCase();
      const val = attr.value || "";
      if (key.includes("constructionyear")) car.year = parseInt(val) || car.year;
      if (key.includes("mileage")) car.km = parseInt(String(val).replace(/\D/g, "")) || car.km;
    }
  }

  // Description
  car.beschrijving = (item.description || item.body || "").substring(0, 5000);

  return car;
}

// ── Upsert ──
function upsertCar(car) {
  const existing = db.prepare("SELECT id FROM voorraad WHERE mp_id = ?").get(car.mp_id);

  if (existing) {
    db.prepare(`UPDATE voorraad SET
      make=?, model=?, model_variant=?, year=?, fuel=?, km=?, color=?, body=?,
      power_kw=?, power_hp=?, transmission=?, doors=?, seats=?,
      vraag_prijs=?, beschrijving=?, highlights=?, cover_photo=?, photos=?,
      options=?, mp_url=?, status=?, updated_at=datetime('now')
      WHERE mp_id=?`).run(
      car.make, car.model, car.model_variant, car.year, car.fuel, car.km, car.color, car.body,
      car.power_kw, car.power_hp, car.transmission, car.doors, car.seats,
      car.vraag_prijs, car.beschrijving, car.highlights,
      car.cover_photo, JSON.stringify(car.photos), JSON.stringify(car.options),
      car.mp_url, car.status, car.mp_id
    );
    return "updated";
  } else {
    db.prepare(`INSERT INTO voorraad (
      make, model, model_variant, year, fuel, km, color, body,
      power_kw, power_hp, transmission, doors, seats,
      vraag_prijs, beschrijving, highlights, cover_photo, photos,
      options, mp_id, mp_url, status, featured
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      car.make, car.model, car.model_variant, car.year, car.fuel, car.km, car.color, car.body,
      car.power_kw, car.power_hp, car.transmission, car.doors, car.seats,
      car.vraag_prijs, car.beschrijving, car.highlights,
      car.cover_photo, JSON.stringify(car.photos), JSON.stringify(car.options),
      car.mp_id, car.mp_url, car.status, car.featured
    );
    return "inserted";
  }
}

// ── Main ──
async function main() {
  console.log(`\n=== Marktplaats Import v2 — ${new Date().toISOString()} ===\n`);
  ensureSchema();

  // Step 1: Fetch all listings via API
  console.log("Stap 1: Advertenties ophalen via API...");
  const listings = await fetchListings();
  console.log(`\n${listings.length} advertenties gevonden\n`);

  if (!listings.length) {
    console.log("Geen advertenties. Check of Marktplaats API bereikbaar is.");
    process.exit(1);
  }

  // Step 2: Process each listing
  let inserted = 0, updated = 0, errors = 0;

  for (let i = 0; i < listings.length; i++) {
    const item = listings[i];
    const title = item.title || "?";

    try {
      const car = parseListing(item);

      if (!car.make) {
        console.log(`  [${i+1}] ${title} — skip (geen merk)`);
        errors++;
        continue;
      }

      const action = upsertCar(car);
      if (action === "inserted") inserted++;
      else updated++;

      const prijsStr = car.vraag_prijs ? `€${car.vraag_prijs.toLocaleString("nl-NL")}` : "?";
      console.log(`  [${i+1}] ${action}: ${car.make} ${car.model} ${car.model_variant || ""} — ${prijsStr} — ${car.photos.length} foto's`);

    } catch (e) {
      console.log(`  [${i+1}] ${title} — fout: ${e.message}`);
      errors++;
    }
  }

  // Step 3: Mark removed listings as sold
  const activeIds = listings.map(l => String(l.itemId));
  const dbCars = db.prepare("SELECT id, mp_id, make, model FROM voorraad WHERE mp_id IS NOT NULL AND status='te_koop'").all();
  let sold = 0;
  for (const c of dbCars) {
    if (c.mp_id && !activeIds.includes(c.mp_id)) {
      db.prepare("UPDATE voorraad SET status='verkocht', updated_at=datetime('now') WHERE id=?").run(c.id);
      console.log(`  Verkocht: ${c.make} ${c.model}`);
      sold++;
    }
  }

  const total = db.prepare("SELECT COUNT(*) as c FROM voorraad WHERE status='te_koop'").get().c;
  console.log(`\n=== Resultaat ===`);
  console.log(`  Nieuw:       ${inserted}`);
  console.log(`  Bijgewerkt:  ${updated}`);
  console.log(`  Verkocht:    ${sold}`);
  console.log(`  Fouten:      ${errors}`);
  console.log(`  Totaal:      ${total} te koop`);
  console.log(`=================\n`);

  db.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
