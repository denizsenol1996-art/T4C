// T4C Shared Helpers
const axios = require("axios")
const cheerio = require("cheerio")
const fs = require("fs")
const path = require("path")

// ── User Agents ──
const UAs = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
]
function ua() { return UAs[Math.floor(Math.random() * UAs.length)] }

// ── Cache ──
const cache = new Map()
function getCached(k, ttl = 1200000) { const e = cache.get(k); if (!e) return null; if (Date.now()-e.ts > ttl) { cache.delete(k); return null }; return e.d }
function setCache(k, d) { cache.set(k, { d, ts: Date.now() }); if (cache.size > 500) { const o=[...cache.entries()].sort((a,b)=>a[1].ts-b[1].ts); for (let i=0;i<100;i++) cache.delete(o[i][0]) } }

// ── Constants ──
const MIN_PRICE = 500
const MAX_PRICE = 500000
const TIMEOUT = 12000

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
function parsePrice(t) {
  if (!t) return 0
  const s = String(t).trim()
  // Reject non-price patterns
  if (/p\/m|per\s*maand|lease|aanbetaling|vanaf|bieden|op\s*aanvraag|n\.?o\.?t\.?k|verkocht|gereserveerd/i.test(s)) return 0
  // Strip currency symbols and whitespace
  let c = s.replace(/[€$EUR\s]/ig, '')
  // Handle NL format: 8.950 or 8.950,- or 8.950,00
  c = c.replace(/\./g, '')       // 8.950 → 8950
  c = c.replace(/,-$/, '')       // 8950,- → 8950
  c = c.replace(/,(\d{2})$/, '') // 8950,00 → 8950
  c = c.replace(/,/g, '')        // any remaining commas
  // Extract integer
  const m = c.match(/\d{3,6}/)
  if (!m) return 0
  const n = parseInt(m[0], 10)
  return Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE ? n : 0
}


// ── Safe fetch ──
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

// ── Extract prices from HTML ──
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
          const dealer = item.seller?.name || item.offers?.[0]?.seller?.name || item.brand?.name || ""
          if (!seen.has(key)) { seen.add(key); listings.push({ title: title.slice(0, 80), price, km: km || null, year: year || null, url: url.startsWith("http") ? url : (url ? baseUrl + url : ""), source: sourceName, dealer: dealer.slice(0,60) }) }
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
      const dealer = $c.find("[class*=dealer],[class*=seller],[class*=vendor],[data-dealer]").first().text().trim().slice(0,60) || ""
      if (title && !seen.has(key)) { seen.add(key); listings.push({ title, price, km, year, url, source: sourceName, dealer }) }
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

// ── Formatting ──
function fmtE(n) { return "\u20AC " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n) }

module.exports = { ua, cache, getCached, setCache, MIN_PRICE, MAX_PRICE, TIMEOUT, parsePrice, safeFetch, extractPrices, extractListings, fmtE, maxPrice, UAs, LUX, PREM }
