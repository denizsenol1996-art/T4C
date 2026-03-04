#!/usr/bin/env node
/**
 * Transfer4Cars — Marktplaats Voorraad Importer
 * 
 * Scraped alle advertenties van je Marktplaats profiel
 * en importeert ze in de voorraad tabel.
 * 
 * Gebruik: node marktplaats-import.js
 * Cron:    */30 * * * * cd /opt/t4c/backend && node marktplaats-import.js >> /opt/t4c/logs/mp-import.log 2>&1
 */

const https = require("https");
const http = require("http");
const path = require("path");

// ─── Config ───
const SELLER_ID = "17478300";
const SELLER_SLUG = "transfer4cars";
const MP_BASE = "https://www.marktplaats.nl";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const DB_PATH = path.join(__dirname, "..", "data", "t4c.db");

// ─── Database ───
let db;
try {
  const Database = require("better-sqlite3");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
} catch (e) {
  console.error("❌ better-sqlite3 niet gevonden. Run: cd /opt/t4c/backend && npm install better-sqlite3");
  process.exit(1);
}

// ─── Ensure columns exist ───
function ensureSchema() {
  // Add cover_photo column if missing
  const cols = db.prepare("PRAGMA table_info(voorraad)").all().map(c => c.name);
  if (!cols.includes("cover_photo")) {
    db.exec("ALTER TABLE voorraad ADD COLUMN cover_photo TEXT");
    console.log("  ✅ Kolom cover_photo toegevoegd");
  }
  if (!cols.includes("photos")) {
    db.exec("ALTER TABLE voorraad ADD COLUMN photos TEXT");
    console.log("  ✅ Kolom photos toegevoegd");
  }
  if (!cols.includes("mp_id")) {
    db.exec("ALTER TABLE voorraad ADD COLUMN mp_id TEXT");
    console.log("  ✅ Kolom mp_id toegevoegd");
  }
  if (!cols.includes("mp_url")) {
    db.exec("ALTER TABLE voorraad ADD COLUMN mp_url TEXT");
    console.log("  ✅ Kolom mp_url toegevoegd");
  }
  if (!cols.includes("options")) {
    db.exec("ALTER TABLE voorraad ADD COLUMN options TEXT");
    console.log("  ✅ Kolom options toegevoegd");
  }
}

// ─── HTTP Fetch ───
function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/json", "Accept-Language": "nl-NL,nl;q=0.9" } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : MP_BASE + res.headers.location;
        return fetch(loc).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Parse seller page for listing URLs ───
function parseSellerPage(html) {
  const listings = [];
  // Match listing links: /v/auto-s/{brand}/m{id}-{slug}
  const linkRegex = /href="(\/v\/auto-s\/[^"]+\/m(\d+)-[^"]+)"/g;
  const seen = new Set();
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    const mpId = match[2];
    if (!seen.has(mpId)) {
      seen.add(mpId);
      listings.push({ url: MP_BASE + url, mpId });
    }
  }
  return listings;
}

// ─── Parse listing detail page ───
function parseListingPage(html, mpId, mpUrl) {
  const car = {
    mp_id: mpId,
    mp_url: mpUrl,
    make: "",
    model: "",
    model_variant: "",
    year: null,
    fuel: "",
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
    kenteken: "",
    apk_until: "",
    cover_photo: "",
    photos: [],
    options: [],
    status: "te_koop",
    featured: 0
  };

  // Try to find __NEXT_DATA__ JSON (Marktplaats uses Next.js)
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const listing = nextData?.props?.pageProps?.listing || nextData?.props?.pageProps?.ad;
      if (listing) {
        return parseNextData(listing, mpId, mpUrl);
      }
    } catch (e) {
      // Fall through to regex parsing
    }
  }

  // Regex-based parsing as fallback
  
  // Title
  const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/s);
  if (titleMatch) {
    const raw = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    const parts = raw.match(/^(\w+)\s+(.+?)(?:\s+\(bj\s+(\d{4}).*\))?$/);
    if (parts) {
      car.make = parts[1];
      car.model = parts[2];
      if (parts[3]) car.year = parseInt(parts[3]);
    } else {
      const words = raw.split(/\s+/);
      car.make = words[0] || "";
      car.model = words.slice(1, 3).join(" ");
      car.model_variant = words.slice(3).join(" ");
    }
  }

  // Price
  const priceMatch = html.match(/€\s*([\d.,]+)/);
  if (priceMatch) {
    car.vraag_prijs = parseFloat(priceMatch[1].replace(/\./g, "").replace(",", "."));
  }

  // Year
  if (!car.year) {
    const yearMatch = html.match(/(?:Bouwjaar|bouwjaar)[^<]*?(\d{4})/);
    if (yearMatch) car.year = parseInt(yearMatch[1]);
  }

  // KM
  const kmMatch = html.match(/(?:Kilometerstand|kilometerstand)[^<]*?([\d.]+)\s*km/);
  if (kmMatch) car.km = parseInt(kmMatch[1].replace(/\./g, ""));

  // Fuel
  const fuelMatch = html.match(/(?:Brandstof|brandstof)[^<]*?(?:<[^>]+>)?\s*(Benzine|Diesel|Elektrisch|Hybride|LPG)/i);
  if (fuelMatch) {
    const f = fuelMatch[1].toLowerCase();
    car.fuel = f === "benzine" ? "B" : f === "diesel" ? "D" : f === "elektrisch" ? "E" : f === "hybride" ? "H" : f === "lpg" ? "L" : f;
  }

  // Transmission
  const transMatch = html.match(/(?:Transmissie|transmissie)[^<]*?(?:<[^>]+>)?\s*(Automaat|Handgeschakeld|Semi-automaat)/i);
  if (transMatch) {
    const t = transMatch[1].toLowerCase();
    car.transmission = t.includes("automaat") && !t.includes("semi") ? "A" : t.includes("hand") ? "H" : "S";
  }

  // Power
  const pkMatch = html.match(/(\d+)\s*(?:pk|PK)/);
  if (pkMatch) {
    car.power_hp = parseInt(pkMatch[1]);
    car.power_kw = Math.round(car.power_hp * 0.7355);
  }

  // Color
  const colorMatch = html.match(/(?:Kleur|kleur)[^<]*?(?:<[^>]+>)?\s*(\w+(?:\s+\w+)?)/i);
  if (colorMatch) car.color = colorMatch[1];

  // Photos - look for Marktplaats image URLs
  const photoRegex = /https:\/\/images\.marktplaats\.com\/api\/v1\/listing-mp-p\/images\/[a-f0-9]{2}\/[a-f0-9-]+\?rule=[^\s"']+/g;
  const rawPhotos = html.match(photoRegex) || [];
  const photoSet = new Set();
  rawPhotos.forEach(p => {
    // Get full-size version
    const fullSize = p.replace(/\?rule=.*/, "?rule=ecg_mp_eps$_86");
    photoSet.add(fullSize);
  });
  car.photos = [...photoSet];
  if (car.photos.length) car.cover_photo = car.photos[0];

  // Description
  const descMatch = html.match(/(?:Beschrijving|Bijzonderheden)[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    car.beschrijving = descMatch[1].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim().substring(0, 5000);
  }

  // Body type
  const bodyMatch = html.match(/(?:Carrosserie|carrosserie)[^<]*?(?:<[^>]+>)?\s*(\w+(?:\s+\w+)*)/i);
  if (bodyMatch) car.body = bodyMatch[1];

  return car;
}

// ─── Parse from Next.js data ───
function parseNextData(listing, mpId, mpUrl) {
  const car = {
    mp_id: mpId,
    mp_url: mpUrl,
    make: "",
    model: "",
    model_variant: "",
    year: null,
    fuel: "",
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
    kenteken: "",
    apk_until: "",
    cover_photo: "",
    photos: [],
    options: [],
    status: "te_koop",
    featured: 0
  };

  // Title parsing
  const title = listing.title || listing.titleShort || "";
  const titleParts = title.match(/^(\w+)\s+(.+?)(?:\s+\(bj\s+(\d{4}).*\))?$/);
  if (titleParts) {
    car.make = titleParts[1];
    car.model = titleParts[2];
    if (titleParts[3]) car.year = parseInt(titleParts[3]);
  }

  // Price
  const price = listing.priceInfo?.priceCents || listing.price?.amount;
  if (price) car.vraag_prijs = price > 1000 ? price / 100 : price;
  
  // Alternative price formats
  if (!car.vraag_prijs && listing.priceInfo?.priceDisplayText) {
    const m = listing.priceInfo.priceDisplayText.match(/([\d.,]+)/);
    if (m) car.vraag_prijs = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  }

  // Attributes
  const attrs = listing.attributes || listing.categorySpecificAttributes || [];
  for (const attr of attrs) {
    const key = (attr.key || attr.label || "").toLowerCase();
    const val = attr.value || attr.values?.[0] || "";
    
    if (key.includes("bouwjaar") || key === "constructionYear") car.year = parseInt(val);
    if (key.includes("kilometerstand") || key === "mileage") car.km = parseInt(String(val).replace(/\D/g, ""));
    if (key.includes("brandstof") || key === "fuel") {
      const f = val.toLowerCase();
      car.fuel = f.includes("benzine") ? "B" : f.includes("diesel") ? "D" : f.includes("elek") ? "E" : f.includes("hybr") ? "H" : f.includes("lpg") ? "L" : val;
    }
    if (key.includes("transmissie") || key === "transmission") {
      car.transmission = val.toLowerCase().includes("automaat") ? "A" : "H";
    }
    if (key.includes("vermogen") || key === "power") {
      const pk = String(val).match(/(\d+)/);
      if (pk) { car.power_hp = parseInt(pk[1]); car.power_kw = Math.round(car.power_hp * 0.7355); }
    }
    if (key.includes("kleur") || key === "color") car.color = val;
    if (key.includes("carrosserie") || key === "body") car.body = val;
    if (key.includes("deuren") || key === "doors") car.doors = parseInt(val);
    if (key.includes("stoelen") || key === "seats") car.seats = parseInt(val);
  }

  // Photos
  const images = listing.images || listing.imageUrls || [];
  car.photos = images.map(img => {
    if (typeof img === "string") return img;
    return img.extraExtraLargeUrl || img.extraLargeUrl || img.largeUrl || img.mediumUrl || img.url || "";
  }).filter(Boolean);
  if (car.photos.length) car.cover_photo = car.photos[0];

  // Description
  car.beschrijving = (listing.description || listing.body || "").substring(0, 5000);

  return car;
}

// ─── Insert/Update in database ───
function upsertCar(car) {
  // Check if exists by mp_id
  const existing = db.prepare("SELECT id FROM voorraad WHERE mp_id = ?").get(car.mp_id);
  
  if (existing) {
    db.prepare(`UPDATE voorraad SET 
      make = ?, model = ?, model_variant = ?, year = ?, fuel = ?, km = ?, color = ?, body = ?,
      power_kw = ?, power_hp = ?, transmission = ?, doors = ?, seats = ?,
      vraag_prijs = ?, beschrijving = ?, highlights = ?, cover_photo = ?, photos = ?,
      options = ?, mp_url = ?, status = ?, updated_at = datetime('now')
      WHERE mp_id = ?`).run(
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      car.make, car.model, car.model_variant, car.year, car.fuel, car.km, car.color, car.body,
      car.power_kw, car.power_hp, car.transmission, car.doors, car.seats,
      car.vraag_prijs, car.beschrijving, car.highlights,
      car.cover_photo, JSON.stringify(car.photos), JSON.stringify(car.options),
      car.mp_id, car.mp_url, car.status, car.featured
    );
    return "inserted";
  }
}

// ─── Main ───
async function main() {
  console.log(`\n═══ Marktplaats Import — ${new Date().toISOString()} ═══`);
  
  ensureSchema();
  
  // Step 1: Fetch all pages of seller listings
  let allListings = [];
  let page = 1;
  const maxPages = 5;
  
  while (page <= maxPages) {
    const url = `${MP_BASE}/u/${SELLER_SLUG}/${SELLER_ID}/${page > 1 ? `?pageNumber=${page}` : ""}`;
    console.log(`\n📄 Pagina ${page}: ${url}`);
    
    try {
      const res = await fetch(url);
      if (res.status !== 200) {
        console.log(`  ⚠️  Status ${res.status} — stoppen`);
        break;
      }
      
      const listings = parseSellerPage(res.body);
      console.log(`  Gevonden: ${listings.length} advertenties`);
      
      if (listings.length === 0) break;
      allListings = allListings.concat(listings);
      
      // Check if there's a next page
      if (!res.body.includes(`pageNumber=${page + 1}`) && !res.body.includes(`Pagina ${page + 1}`)) {
        // Also check for "Volgende" or page 2 link
        if (page > 1 || !res.body.includes("2</a>")) break;
      }
      
      page++;
      await sleep(1500);
    } catch (e) {
      console.log(`  ❌ Fout: ${e.message}`);
      break;
    }
  }
  
  // Deduplicate
  const seen = new Set();
  allListings = allListings.filter(l => {
    if (seen.has(l.mpId)) return false;
    seen.add(l.mpId);
    return true;
  });
  
  console.log(`\n📊 Totaal: ${allListings.length} unieke advertenties gevonden`);
  
  if (allListings.length === 0) {
    console.log("❌ Geen advertenties gevonden. Mogelijk blokkeert Marktplaats het verzoek.");
    console.log("   Tip: probeer later opnieuw of check de URL handmatig.");
    process.exit(1);
  }
  
  // Step 2: Fetch each listing detail
  let imported = 0, updated = 0, errors = 0;
  
  for (let i = 0; i < allListings.length; i++) {
    const listing = allListings[i];
    console.log(`\n🚗 [${i + 1}/${allListings.length}] ${listing.url.split("/").pop()}`);
    
    try {
      await sleep(2000 + Math.random() * 1500); // Random delay 2-3.5s
      
      const res = await fetch(listing.url);
      if (res.status !== 200) {
        console.log(`  ⚠️  Status ${res.status} — overgeslagen`);
        errors++;
        continue;
      }
      
      const car = parseListingPage(res.body, listing.mpId, listing.url);
      
      if (!car.make && !car.model) {
        console.log(`  ⚠️  Kon geen voertuigdata parsen — overgeslagen`);
        errors++;
        continue;
      }
      
      const action = upsertCar(car);
      if (action === "inserted") imported++;
      else updated++;
      
      console.log(`  ✅ ${action}: ${car.make} ${car.model} ${car.model_variant || ""} — €${car.vraag_prijs || "?"} — ${car.photos.length} foto's`);
      
    } catch (e) {
      console.log(`  ❌ Fout: ${e.message}`);
      errors++;
    }
  }
  
  // Step 3: Mark sold cars (in DB but not on Marktplaats anymore)
  const mpIds = allListings.map(l => l.mpId);
  const dbCars = db.prepare("SELECT id, mp_id, make, model FROM voorraad WHERE mp_id IS NOT NULL AND status = 'te_koop'").all();
  let soldCount = 0;
  for (const dbCar of dbCars) {
    if (dbCar.mp_id && !mpIds.includes(dbCar.mp_id)) {
      db.prepare("UPDATE voorraad SET status = 'verkocht', updated_at = datetime('now') WHERE id = ?").run(dbCar.id);
      console.log(`  🏷️  Verkocht: ${dbCar.make} ${dbCar.model} (niet meer op Marktplaats)`);
      soldCount++;
    }
  }
  
  // Summary
  const total = db.prepare("SELECT COUNT(*) as c FROM voorraad WHERE status = 'te_koop'").get().c;
  console.log(`\n═══ Resultaat ═══`);
  console.log(`  ✅ Nieuw: ${imported}`);
  console.log(`  🔄 Bijgewerkt: ${updated}`);
  console.log(`  🏷️  Verkocht: ${soldCount}`);
  console.log(`  ❌ Fouten: ${errors}`);
  console.log(`  📊 Totaal te koop: ${total}`);
  console.log(`═════════════════\n`);
  
  db.close();
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
