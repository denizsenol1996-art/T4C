// T4C Market Routes
const express = require("express")
const router = express.Router()
const { stmts, queryAll, queryOne, run } = require("../db")
const { authMiddleware, adminOnly } = require("../lib/auth")
const { getCached, setCache, parsePrice, maxPrice, safeFetch, extractListings, extractPrices } = require("../lib/helpers")
const scrapers = require("../lib/scrapers")
const { scrapeMarktplaats, scrapeAutoScout24NL, scrapeAutoTrack, scrapeGaspedaal, scrapeAutowereld, scrapeViaBovag, scrapeAutoWeek, scrapeAutosNL, scrapeAutoGids, scrapeDealerOccasions, scrapeAutoBedrijven, scrapeAutoBedrijf24, scrapeAutoKopen, scrapeAutoDealers, scrapeAutoWerk, scrapeVakgarage, scrapeAutoBedrijfNL, scrapeMobileDE, scrapeAutoScout24DE, scrapeAutoScout24BE, scrape2eHandsBE, scrapeAutoScout24COM, scrapeLeBonCoin, scrapeAutoVeiling, scrapeBCA, scrapeOpenLane, scrapeAdesaEU, scrapeCopart, scrapeAutoBidDE, scrapeGoogleSearch, scrapeBingSearch, scrapeDuckDuckGo, scrapeEcosia, scrapeVanMossel, scrapeLouwman, scrapeWensink, scrapeBroekhuis, scrapeHerwers, scrapePonCenter, scrapeZeeuwZeeuw, scrapeTerwolde, scrapeStam, scrapeMulder, scrapeHartgerink, scrapeLeasePlan, scrapeAthlon, scrapeArval, scrapeAlphabet, scrapeAutoTraderNL, scrapeAutoFirstNL, scrapeBoschCarService, scrapeAutoScout24FR, scrapeAutoTraderUK, buildSearchUrls, med, validate } = scrapers
const pricing = require("../lib/pricing")
const { getLearned, recordTaxatie, learn, getSeasonFactor, getDepreciation, getMarketPressure, normalizeKm, generateInsights } = pricing
const crypto = require("crypto")
const { scoreSource } = require("../lib/intelligence")
const { buildComparableSet } = require("../lib/comparable-engine")
const { normalizeModel, normalizeMake } = require("../lib/comparable-engine/model-normalizer")

// /api/market
router.get("/api/market",async(req,res)=>{
  const mk=String(req.query.make||"").toLowerCase().trim()
  let ml=String(req.query.model||"").toLowerCase().trim()
  const yr=Number(req.query.year||0)
  const km=Number(req.query.km||0)
  const sub=String(req.query.sub||"").toLowerCase().trim()
  const bodyType=String(req.query.body||"").trim()
  const fuel=String(req.query.fuel||"").trim()
  const trans=String(req.query.transmission||"").toLowerCase().trim() // "automaat" or "handgeschakeld"
  if(ml.startsWith(mk+" "))ml=ml.slice(mk.length+1).trim()
  if(!mk||!ml||!yr)return res.json({avg:0,median:0,low:0,high:0,count:0,prices:[]})

  // Build search queries
  const searchMl = sub && !ml.includes(sub) ? `${ml} ${sub}` : ml
  const baseMl = ml  // Without submodel for broad search
  // Normalize for DB lookup (e.g. "e 350 cgi" → "e-klasse")
  const _norm = normalizeModel(mk, ml)
  const _crawlerMl = _norm.crawlerModel || ml
  if (_norm.confidence !== 'passthrough') console.log('[MARKET-NORM]', mk, ml, '→', _crawlerMl, '(' + _norm.confidence + ')')

  const ck=`m|${mk}|${searchMl}|${yr}|${km?Math.round(km/25000)*25000:0}|${trans}`
  const cc=getCached(ck);if(cc)return res.json(cc)
  const cap=maxPrice(yr,mk)

  // ══ MULTI-TIER SEARCH STRATEGY — NEDERLAND ONLY ══
  const scraperDefs = [
    // Tier 1: NL Primary (grote platforms)
    { name:"marktplaats",    fn:(m,d,y,c,k)=>scrapeMarktplaats(m,d,y,c,k,trans) },
    { name:"autoscout24.nl", fn:(m,d,y,c,k)=>scrapeAutoScout24NL(m,d,y,c,k,trans) },
    { name:"autotrack",      fn:(m,d,y,c)=>scrapeAutoTrack(m,d,y,c) },
    { name:"gaspedaal",      fn:(m,d,y,c)=>scrapeGaspedaal(m,d,y,c) },
    { name:"autowereld",     fn:(m,d,y,c)=>scrapeAutowereld(m,d,y,c) },
    { name:"viabovag",       fn:(m,d,y,c)=>scrapeViaBovag(m,d,y,c) },
    // Tier 2: NL Secondary (kleinere platforms)
    { name:"autoweek",       fn:(m,d,y,c)=>scrapeAutoWeek(m,d,y,c) },
    { name:"autos.nl",       fn:(m,d,y,c)=>scrapeAutosNL(m,d,y,c) },
    { name:"autogids",       fn:(m,d,y,c)=>scrapeAutoGids(m,d,y,c) },
    { name:"dealeroccasions", fn:(m,d,y,c)=>scrapeDealerOccasions(m,d,y,c) },
    { name:"autobedrijven",  fn:(m,d,y,c)=>scrapeAutoBedrijven(m,d,y,c) },
    { name:"autobedrijf24",  fn:(m,d,y,c)=>scrapeAutoBedrijf24(m,d,y,c) },
    { name:"autokopen",      fn:(m,d,y,c)=>scrapeAutoKopen(m,d,y,c) },
    { name:"autodealers",    fn:(m,d,y,c)=>scrapeAutoDealers(m,d,y,c) },
    { name:"autowerk",       fn:(m,d,y,c)=>scrapeAutoWerk(m,d,y,c) },
    { name:"vakgarage",      fn:(m,d,y,c)=>scrapeVakgarage(m,d,y,c) },
    { name:"autobedrijf.nl", fn:(m,d,y,c)=>scrapeAutoBedrijfNL(m,d,y,c) },
    // Tier 3: NL Dealer Groups
    { name:"vanmossel",      fn:(m,d,y,c)=>scrapeVanMossel(m,d,y,c) },
    { name:"louwman",        fn:(m,d,y,c)=>scrapeLouwman(m,d,y,c) },
    { name:"wensink",        fn:(m,d,y,c)=>scrapeWensink(m,d,y,c) },
    { name:"broekhuis",      fn:(m,d,y,c)=>scrapeBroekhuis(m,d,y,c) },
    { name:"herwers",        fn:(m,d,y,c)=>scrapeHerwers(m,d,y,c) },
    { name:"poncenter",      fn:(m,d,y,c)=>scrapePonCenter(m,d,y,c) },
    { name:"zeeuw&zeeuw",    fn:(m,d,y,c)=>scrapeZeeuwZeeuw(m,d,y,c) },
    { name:"terwolde",       fn:(m,d,y,c)=>scrapeTerwolde(m,d,y,c) },
    { name:"stam",           fn:(m,d,y,c)=>scrapeStam(m,d,y,c) },
    { name:"mulder",         fn:(m,d,y,c)=>scrapeMulder(m,d,y,c) },
    { name:"hartgerink",     fn:(m,d,y,c)=>scrapeHartgerink(m,d,y,c) },
    // Tier 4: NL Lease Occasions
    { name:"leaseplan",      fn:(m,d,y,c)=>scrapeLeasePlan(m,d,y,c) },
    { name:"athlon",         fn:(m,d,y,c)=>scrapeAthlon(m,d,y,c) },
    { name:"arval",          fn:(m,d,y,c)=>scrapeArval(m,d,y,c) },
    { name:"alphabet",       fn:(m,d,y,c)=>scrapeAlphabet(m,d,y,c) },
    // Tier 5: NL Extra
    { name:"autotrader.nl",  fn:(m,d,y,c)=>scrapeAutoTraderNL(m,d,y,c) },
    { name:"autofirst",      fn:(m,d,y,c)=>scrapeAutoFirstNL(m,d,y,c) },
    { name:"boschcar",       fn:(m,d,y,c)=>scrapeBoschCarService(m,d,y,c) },
    // Tier 6: NL Veiling
    { name:"autoveiling",    fn:(m,d,y,c)=>scrapeAutoVeiling(m,d,y,c) },
    { name:"bca",            fn:(m,d,y,c)=>scrapeBCA(m,d,y,c) },
    { name:"openlane",       fn:(m,d,y,c)=>scrapeOpenLane(m,d,y,c) },
    // Tier 7: International (DE/BE) — import pricing reference
    { name:"mobile.de",      fn:(m,d,y,c)=>scrapeMobileDE(m,d,y,c) },
    { name:"autoscout24.de", fn:(m,d,y,c)=>scrapeAutoScout24DE(m,d,y,c) },
    { name:"2dehands.be",    fn:(m,d,y,c)=>scrape2eHandsBE(m,d,y,c) },
    { name:"autoscout24.be", fn:(m,d,y,c)=>scrapeAutoScout24BE(m,d,y,c) },
  ]
  const names = scraperDefs.map(s=>s.name)
  const hasSubModel = sub && sub !== baseMl && !baseMl.includes(sub)

  console.log(`\n[SCRAPE] ${mk} ${searchMl} ${yr}${km?` | ${km}km`:""} | cap \u20AC${cap} | ${scraperDefs.length} scrapers${hasSubModel?` | DUAL: "${searchMl}" + "${baseMl}"`:""}\n`)

  // ══ Run EVERYTHING in parallel: all scrapers + listing extraction at once ══
  const listingUrls = [
    // Tier 1: Main NL platforms
    { name: "Marktplaats", url: `https://www.marktplaats.nl/q/${mk}+${searchMl}+${yr}/`, type: 'mixed' },
    { name: "AutoScout24", url: `https://www.autoscout24.nl/lst/${mk}/${searchMl}?fregfrom=${yr}&fregto=${yr+1}&cy=NL&sort=price&desc=0`, type: 'dealer' },
    { name: "AutoTrack", url: `https://www.autotrack.nl/aanbod?merk=${mk}&model=${searchMl}&bouwjaar_van=${yr}&bouwjaar_tot=${yr}`, type: 'dealer' },
    { name: "Gaspedaal", url: `https://www.gaspedaal.nl/${mk}-${searchMl}/jaar-${yr}`, type: 'mixed' },
    // Tier 2: NL secondary
    { name: "Autowereld", url: `https://www.autowereld.nl/${mk}/${mk}-${searchMl}/b_${yr}`, type: 'dealer' },
    { name: "ViaBovag", url: `https://www.viabovag.nl/auto/merk-${mk}/model-${searchMl}?bouwjaarVan=${yr}&bouwjaarTot=${yr+1}`, type: 'dealer' },
    { name: "AutoWeek", url: `https://www.autoweek.nl/occasions/?merk=${mk}&model=${searchMl}&bouwjaarvan=${yr}&bouwjaartm=${yr}`, type: 'mixed' },
    // Tier 3: International (referentie)
    { name: "Mobile.de", url: `https://www.mobile.de/nl/auto/${mk}/${searchMl}/vhc:car,pgn:1,pgs:50,frn:${yr},frx:${yr+1},srt:price,sro:asc`, type: 'dealer' },
    { name: "AutoScout24.de", url: `https://www.autoscout24.de/lst/${mk}/${searchMl}?fregfrom=${yr}&fregto=${yr+1}&sort=price&desc=0`, type: 'dealer' },
    { name: "AutoScout24.be", url: `https://www.autoscout24.be/nl/lst/${mk}/${searchMl}?fregfrom=${yr}&fregto=${yr+1}&cy=B&sort=price&desc=0`, type: 'mixed' },
  ]
  const listingPromise = Promise.allSettled(listingUrls.map(async (lu) => {
    const html = await safeFetch(lu.url)
    return extractListings(html, cap, lu.url, lu.name)
  }))

  // Round 1 + Listings run SIMULTANEOUSLY
  const [R1, listingResults] = await Promise.all([
    Promise.allSettled(scraperDefs.map(s=>s.fn(mk,searchMl,yr,cap,km))),
    listingPromise
  ])
  const src={};let trimPrices=[];let broadPrices=[]
  R1.forEach((r,i)=>{
    const p=r.status==="fulfilled"?r.value:[]
    src[names[i]]=p.length
    trimPrices.push(...p)
    if(p.length)console.log(`  OK [${names[i]}] ${p.length}`)
  })
  const r1Total=trimPrices.length
  console.log(`  -- Round 1: ${r1Total} prices from ${R1.filter((r,i)=>r.status==="fulfilled"&&r.value.length>0).length}/${scraperDefs.length} sources`)

  // Process listings with enrichment
  let allListings = []
  listingResults.forEach((lr, i) => {
    if (lr.status === "fulfilled" && lr.value.length > 0) {
      const srcType = listingUrls[i]?.type || 'mixed'
      lr.value.forEach(l => { l.sourceType = srcType; allListings.push(l) })
    }
  })
  const seenL = new Set()
  allListings = allListings.filter(l => {
    const k = `${l.price}-${l.title?.slice(0,15)}`
    if (seenL.has(k)) return false
    seenL.add(k)
    return true
  }).sort((a, b) => a.price - b.price).slice(0, 25)

  // ═══ ENRICHMENT: Dealer vs Particulier, Trim Match, KM extraction ═══
  allListings = allListings.map(l => {
    const t = (l.title || '').toLowerCase()
    const src = (l.source || '').toLowerCase()
    // Dealer detection
    const dealerSources = ['autoscout24', 'autotrack', 'autowereld', 'viabovag', 'mobile.de']
    const dealerWords = ['dealer', 'automotive', 'autobedrijf', 'bv', 'b.v.', 'group', 'cars', 'lease', 'bovag', 'nap']
    const partWords = ['particulier', 'zelf', 'wegens', 'ophalen']
    l.sellerType = dealerSources.some(ds => src.includes(ds)) || dealerWords.some(dw => t.includes(dw)) ? 'dealer' : partWords.some(pw => t.includes(pw)) ? 'particulier' : 'onbekend'
    // Trim detection
    const trims = ['highline','comfortline','trendline','r-line','gti','gtd','gte','m-sport','m sport','luxury','sport','executive','business','edition','amg','avantgarde','elegance','s-line','s line','design','style','active','premium','intense','tekna','lounge','intens','zen','feel','shine','allure','gt line','automaat','dsg','hybrid','phev']
    l.detectedTrims = trims.filter(tw => t.includes(tw))
    if (!l.detectedTrims.length) l.detectedTrims = null
    // KM from title
    if (!l.km) { const m = t.match(/(\d{1,3}(?:[.]\d{3})*)\s*km/i); if (m) { const v = parseInt(m[1].replace(/\./g,''),10); if (v > 1000 && v < 500000) l.km = v } }
    return l
  })
  // Fallback URLs
  allListings = allListings.map(l => {
    if (!l.url && l.source) {
      if (l.source === "Marktplaats") l.url = `https://www.marktplaats.nl/l/auto-s/#q:${mk}+${searchMl}+${yr}`
      else if (l.source === "AutoScout24") l.url = `https://www.autoscout24.nl/lst/${mk}/${searchMl}?fregfrom=${yr}&fregto=${yr+1}&cy=NL`
      else if (l.source === "AutoTrack") l.url = `https://www.autotrack.nl/aanbod?merk=${mk}&model=${searchMl}&bouwjaar_van=${yr}`
      else if (l.source === "Gaspedaal") l.url = `https://www.gaspedaal.nl/${mk}-${searchMl}/jaar-${yr}`
    }
    return l
  })

  // ═══ KM PRICE MODEL — lineaire regressie uit listings ═══
  const listingsWithKm = allListings.filter(l => l.km > 0 && l.price > 0)
  let kmPriceModel = null
  if (listingsWithKm.length >= 4) {
    const n = listingsWithKm.length
    const sX = listingsWithKm.reduce((s,l) => s+l.km, 0), sY = listingsWithKm.reduce((s,l) => s+l.price, 0)
    const sXY = listingsWithKm.reduce((s,l) => s+l.km*l.price, 0), sX2 = listingsWithKm.reduce((s,l) => s+l.km*l.km, 0)
    const den = n*sX2 - sX*sX
    if (den !== 0) {
      const b = (n*sXY - sX*sY) / den, a = (sY - b*sX) / n
      if (b < 0) {
        kmPriceModel = { intercept: Math.round(a), per10k: Math.round(b*10000), samples: n }
        if (km > 0) allListings.forEach(l => { if (l.km > 0 && l.price > 0) { l.normalizedPrice = Math.round(l.price + b*(km - l.km)); l.kmDiff = l.km - km } })
      }
    }
  }

  // Price bands by seller type
  const dealerPrices = allListings.filter(l => l.sellerType === 'dealer' && l.price > 0).map(l => l.price).sort((a,b) => a-b)
  const partPrices = allListings.filter(l => l.sellerType === 'particulier' && l.price > 0).map(l => l.price).sort((a,b) => a-b)
  const priceBands = {
    dealer: dealerPrices.length >= 2 ? { median: med(dealerPrices), count: dealerPrices.length, low: dealerPrices[0], high: dealerPrices.at(-1) } : null,
    particulier: partPrices.length >= 2 ? { median: med(partPrices), count: partPrices.length, low: partPrices[0], high: partPrices.at(-1) } : null,
  }

  
  // === COMPARABLE ENGINE ===
  let compResult = null
  try {
    const compTarget = {
      make: mk, model: searchMl, generation: '',
      trim: '', bodyType: '', fuel: fuel || '',
      transmission: trans || '', year: yr, km: km || 0,
      powerHp: 0, isEV: false,
    }
    compResult = buildComparableSet(compTarget, allListings)
    console.log(`  -- CompEngine: status=${compResult.status} clean=${compResult.cleanCount} strong=${compResult.strongCount} median=\u20AC${compResult.marketMedian} conf=${compResult.confidenceComparable}`)
  } catch(compErr) {
    console.log('[COMP-ENGINE] Error:', compErr.message)
  }

  const listingsForResponse = allListings.slice(0, 15)
  console.log(`  -- Listings: ${allListings.length} total | ${allListings.filter(l=>l.sellerType==="dealer").length} dealer | ${allListings.filter(l=>l.sellerType==="particulier").length} part | ${listingsWithKm.length} w/km${kmPriceModel?" | \u20ac"+kmPriceModel.per10k+"/10k km":""}`)

  // Round 2: Broad search (without trim) — only if submodel AND not enough data
  if(hasSubModel && trimPrices.length < 8){
    console.log(`  -- Round 2 needed: only ${trimPrices.length} trim prices, searching broad...`)
    const R2=await Promise.allSettled(scraperDefs.slice(0,10).map(s=>s.fn(mk,baseMl,yr,cap,km)))
    R2.forEach((r,i)=>{
      const p=r.status==="fulfilled"?r.value:[]
      src[names[i]+"_broad"]=p.length
      broadPrices.push(...p)
    })
    console.log(`  -- Round 2 (broad): ${broadPrices.length} prices`)
  } else if(hasSubModel) {
    console.log(`  -- Round 2 SKIPPED: ${trimPrices.length} trim prices is enough`)
  }

  // ══ WEIGHTED MERGE ══
  // Trim-specific prices count 2x (duplicate them in the array)
  // This pulls the median/avg toward the trim-specific market
  let all=[]
  const uniqueTrim=[...new Set(trimPrices)]
  const uniqueBroad=[...new Set(broadPrices)]
  // Remove broad prices that are already in trim results (±5% match)
  const filteredBroad=uniqueBroad.filter(bp=>!uniqueTrim.some(tp=>Math.abs(tp-bp)/Math.max(tp,bp)<0.05))

  if(hasSubModel&&uniqueTrim.length>=3){
    // Good trim data: weight 2:1 trim vs broad
    all=[...uniqueTrim,...uniqueTrim,...filteredBroad]
    console.log(`  => MERGE: ${uniqueTrim.length} trim (×2) + ${filteredBroad.length} broad = ${all.length} total`)
  } else {
    // No submodel or too few trim results: use everything equally
    all=[...uniqueTrim,...filteredBroad]
    console.log(`  => MERGE: ${uniqueTrim.length} trim + ${filteredBroad.length} broad = ${all.length} total`)
  }

  // Add learned prices
  const lr=getLearned(mk,ml,yr)
  if(lr.length){const n=Math.min(8,Math.floor(all.length*.25)||3);all.push(...lr.slice(0,n));src.learned=lr.length}

  const v=validate(all,yr,mk);if(v.v.length>=3)learn(mk,ml,yr,v.v)
  const sorted=[...v.v].sort((a,b)=>a-b);const sum=sorted.reduce((a,b)=>a+b,0)
  const pct=p=>sorted.length?sorted[Math.min(Math.floor(sorted.length*p),sorted.length-1)]:0
  const medianVal = Math.round(med(sorted))
  const avgVal = sorted.length?Math.round(sum/sorted.length):0

  // ═══ INTELLIGENCE ═══
  const season = getSeasonFactor(mk, ml, bodyType, fuel)
  const depreciation = getDepreciation(mk, ml, yr)
  const marketPressure = getMarketPressure(sorted.length, v.q, v.cv)
  const kmNorm = normalizeKm(medianVal, km, yr)
  const insights = generateInsights({
    mk, ml, yr, km, median: medianVal, avg: avgVal, count: sorted.length,
    quality: v.q, cv: v.cv, p10: pct(.10), p90: pct(.90),
    season, depreciation, marketPressure, kmNorm, bodyType, fuel
  })

  // Season-adjusted prices
  const seasonAdj = season.factor !== 1.0 ? {
    adjustedMedian: Math.round(medianVal * season.factor),
    adjustedAvg: Math.round(avgVal * season.factor),
    factor: season.factor,
    reason: season.reason
  } : null

  // Record taxatie for learning
  recordTaxatie(mk, ml, yr, km, sorted, medianVal, sorted.length, v.q)

  const result={avg:avgVal,median:medianVal,low:sorted[0]||0,high:sorted.at(-1)||0,count:sorted.length,prices:sorted,p10:pct(.10),p25:pct(.25),p75:pct(.75),p90:pct(.90),maxPriceCap:cap,sources:src,
    trimMatch:hasSubModel?{trimPrices:uniqueTrim.length,broadPrices:filteredBroad.length,searchTrim:searchMl,searchBroad:baseMl}:undefined,
    validation:{quality:v.q,cv:v.cv,removed:v.rm,totalScraped:all.length},
    intelligence:{ season, seasonAdj, depreciation, marketPressure, kmNorm, insights },
    // Vergelijkbare listings — zoek URLs per platform
    searchUrls: buildSearchUrls(mk, searchMl, yr),
    // Echte gevonden listings met titel, prijs, km, url
    listings: listingsForResponse,
    listingAnalysis: {
      total: allListings.length,
      withKm: listingsWithKm.length,
      dealerCount: allListings.filter(l => l.sellerType === 'dealer').length,
      partCount: allListings.filter(l => l.sellerType === 'particulier').length,
      priceBands,
      kmPriceModel: kmPriceModel ? { per10k: kmPriceModel.per10k, samples: kmPriceModel.samples } : null,
    }
  }
  console.log(`  => avg \u20AC${result.avg} | med \u20AC${result.median} | ${result.count} valid | ${insights.length} insights\n`)
  if(result.count>0)setCache(ck,result)
  // Save snapshot to database for historical tracking
  try { saveMarketSnapshot(mk, searchMl, yr, result) } catch {}
  // ═══ STORE INDIVIDUAL LISTINGS FOR PRICE HISTORY ═══
  try { storeListingsForHistory(mk, searchMl, yr, allListings, trans) } catch(e) { console.log('[HISTORY] Store error:', e.message) }
  // ═══ COMP ENGINE OVERRIDE ═══
  let compMedianOverride = null
  if (compResult && compResult.status === 'ok' && compResult.marketMedian && compResult.confidenceComparable >= 25) {
    compMedianOverride = compResult.marketMedian
    console.log(`  >> CompEngine override: median €${medianVal} → €${compMedianOverride} (conf=${compResult.confidenceComparable})`)
  }
  if (compResult) result.comparableEngine = compResult
  if (compMedianOverride) {
    result.compMedian = compMedianOverride
    result.originalMedian = result.median
    result.median = compMedianOverride
  }
  res.json(result)
})

/* ── DEALS / MARGE PAKKERS ────────────────── 
   Smart deal detection: not just cheap, but ACTUALLY interesting.
   Filters: min price floor, title quality, margin sweet spot, km sanity */
const DEAL_MODELS = [
  // Populaire occasionmodellen NL — breed assortiment
  { mk:"volkswagen", ml:"golf", yrs:[2016,2017,2018,2019,2020] },
  { mk:"volkswagen", ml:"polo", yrs:[2016,2017,2018,2019,2020] },
  { mk:"volkswagen", ml:"tiguan", yrs:[2017,2018,2019,2020,2021] },
  { mk:"volkswagen", ml:"t-roc", yrs:[2018,2019,2020,2021] },
  { mk:"toyota", ml:"aygo", yrs:[2016,2017,2018,2019,2020] },
  { mk:"toyota", ml:"yaris", yrs:[2017,2018,2019,2020,2021] },
  { mk:"toyota", ml:"corolla", yrs:[2019,2020,2021,2022] },
  { mk:"toyota", ml:"c-hr", yrs:[2017,2018,2019,2020,2021] },
  { mk:"renault", ml:"clio", yrs:[2017,2018,2019,2020,2021] },
  { mk:"renault", ml:"captur", yrs:[2017,2018,2019,2020,2021] },
  { mk:"peugeot", ml:"208", yrs:[2017,2018,2019,2020,2021] },
  { mk:"peugeot", ml:"308", yrs:[2017,2018,2019,2020] },
  { mk:"peugeot", ml:"2008", yrs:[2017,2018,2019,2020,2021] },
  { mk:"ford", ml:"focus", yrs:[2016,2017,2018,2019,2020] },
  { mk:"ford", ml:"fiesta", yrs:[2016,2017,2018,2019,2020] },
  { mk:"ford", ml:"kuga", yrs:[2017,2018,2019,2020] },
  { mk:"opel", ml:"corsa", yrs:[2017,2018,2019,2020,2021] },
  { mk:"opel", ml:"astra", yrs:[2016,2017,2018,2019,2020] },
  { mk:"opel", ml:"crossland", yrs:[2018,2019,2020,2021] },
  { mk:"bmw", ml:"1 serie", yrs:[2017,2018,2019,2020] },
  { mk:"bmw", ml:"3 serie", yrs:[2017,2018,2019,2020] },
  { mk:"bmw", ml:"x1", yrs:[2017,2018,2019,2020] },
  { mk:"mercedes", ml:"a klasse", yrs:[2017,2018,2019,2020] },
  { mk:"mercedes", ml:"c klasse", yrs:[2017,2018,2019] },
  { mk:"audi", ml:"a3", yrs:[2017,2018,2019,2020] },
  { mk:"audi", ml:"a4", yrs:[2017,2018,2019] },
  { mk:"audi", ml:"q3", yrs:[2018,2019,2020] },
  { mk:"kia", ml:"niro", yrs:[2017,2018,2019,2020,2021] },
  { mk:"kia", ml:"sportage", yrs:[2017,2018,2019,2020] },
  { mk:"kia", ml:"ceed", yrs:[2018,2019,2020,2021] },
  { mk:"hyundai", ml:"i20", yrs:[2017,2018,2019,2020] },
  { mk:"hyundai", ml:"kona", yrs:[2018,2019,2020,2021] },
  { mk:"hyundai", ml:"tucson", yrs:[2017,2018,2019,2020] },
  { mk:"skoda", ml:"octavia", yrs:[2017,2018,2019,2020,2021] },
  { mk:"skoda", ml:"karoq", yrs:[2018,2019,2020,2021] },
  { mk:"seat", ml:"ibiza", yrs:[2017,2018,2019,2020] },
  { mk:"seat", ml:"leon", yrs:[2017,2018,2019,2020] },
  { mk:"mazda", ml:"cx-5", yrs:[2017,2018,2019,2020] },
  { mk:"mazda", ml:"3", yrs:[2017,2018,2019,2020] },
  { mk:"volvo", ml:"xc40", yrs:[2018,2019,2020,2021] },
  { mk:"volvo", ml:"v40", yrs:[2016,2017,2018,2019] },
  { mk:"nissan", ml:"qashqai", yrs:[2017,2018,2019,2020] },
  { mk:"fiat", ml:"500", yrs:[2017,2018,2019,2020] },
  { mk:"citroen", ml:"c3", yrs:[2017,2018,2019,2020] },
  { mk:"suzuki", ml:"swift", yrs:[2017,2018,2019,2020] },
  { mk:"mini", ml:"cooper", yrs:[2017,2018,2019,2020] },
]

// Smart deal quality scoring
function scoreDeal(listing, median, combo) {
  let score = 0
  const age = new Date().getFullYear() - combo.yr
  const minFloor = age <= 3 ? 4000 : age <= 5 ? 2500 : age <= 8 ? 1500 : 800
  
  // Price floor — too cheap = schade/onderdelen/nep
  if (listing.price < minFloor) return -1
  
  // Title quality — must have actual car name, not "ONDERDELEN" or "EXPORT"
  const titleLow = (listing.title || "").toLowerCase()
  const junkWords = ["onderdel","slop","schade","export","sloop","salvage","parts","demontage","motor uit","niet rijdend","geen apk","defect","kapot","reparatie object"]
  if (junkWords.some(w => titleLow.includes(w))) return -1
  
  // Sweet spot: 15-35% under median is realistic deal, >40% is suspicious
  const pctUnder = (1 - listing.price / median) * 100
  if (pctUnder >= 15 && pctUnder <= 25) score += 30  // Best sweet spot
  else if (pctUnder > 25 && pctUnder <= 35) score += 20  // Good deal
  else if (pctUnder > 35 && pctUnder <= 45) score += 5   // Might be OK but risky
  else if (pctUnder > 45) return -1  // Too good = scam/schade
  else score += 10  // 10-15% under
  
  // Has KM? Bonus for transparency
  if (listing.km && listing.km > 0) {
    score += 10
    // KM sanity: reasonable for age
    const expectedKm = age * 15000
    if (listing.km < expectedKm * 2) score += 5
    if (listing.km > expectedKm * 3) score -= 10  // Extreme km = less interesting
  }
  
  // Has year? Bonus
  if (listing.year) score += 5
  
  // Has actual URL (not fallback)? Big bonus
  if (listing.url && (listing.url.includes("/a/") || listing.url.includes("/lst/") || listing.url.includes("/aanbod/"))) score += 15
  
  // Source bonus: known platforms are more reliable
  if (listing.source === "AutoScout24" || listing.source === "Marktplaats") score += 5
  
  // Potential margin > 1500 is interesting for dealers
  const margin = median - listing.price
  if (margin >= 2500) score += 10
  else if (margin >= 1500) score += 5
  
  return score
}
let dealsCache = { ts: 0, deals: [] }

router.get("/api/deals", async (req, res) => {
  const maxAge = 30 * 60 * 1000
  if (dealsCache.ts > Date.now() - maxAge && dealsCache.deals.length > 0) {
    return res.json({ deals: dealsCache.deals, cached: true, ts: dealsCache.ts })
  }

  // Pick 12 random model+year combos for broad coverage
  const combos = []
  const shuffled = [...DEAL_MODELS].sort(() => Math.random() - 0.5)
  for (const m of shuffled.slice(0, 12)) {
    const yr = m.yrs[Math.floor(Math.random() * m.yrs.length)]
    combos.push({ mk: m.mk, ml: m.ml, yr })
  }

  const allDeals = []
  const results = await Promise.allSettled(combos.map(async (c) => {
    // Scrape ALL platforms per combo, not just Marktplaats
    const cap = maxPrice(c.yr, c.mk)
    const platformUrls = [
      { name: "Marktplaats", url: `https://www.marktplaats.nl/q/${c.mk}+${c.ml}+${c.yr}/` },
      { name: "AutoScout24", url: `https://www.autoscout24.nl/lst/${c.mk}/${c.ml}?fregfrom=${c.yr}&fregto=${c.yr+1}&cy=NL&sort=price&desc=0&priceto=${cap}` },
      { name: "AutoTrack", url: `https://www.autotrack.nl/aanbod?merk=${c.mk}&model=${c.ml}&bouwjaar_van=${c.yr}&bouwjaar_tot=${c.yr}` },
      { name: "Gaspedaal", url: `https://www.gaspedaal.nl/${c.mk}-${c.ml}/jaar-${c.yr}` },
    ]

    // Fetch all platforms in parallel
    const platformResults = await Promise.allSettled(platformUrls.map(async (pu) => {
      const html = await safeFetch(pu.url)
      if (!html) return { listings: [], prices: [] }
      return {
        listings: extractListings(html, cap, pu.url, pu.name),
        prices: extractPrices(html, cap)
      }
    }))

    let allListings = []
    let allPrices = []
    platformResults.forEach((pr, i) => {
      if (pr.status === "fulfilled") {
        allListings.push(...pr.value.listings)
        allPrices.push(...pr.value.prices)
      }
    })

    if (allPrices.length < 3 || allListings.length < 1) return []
    const median = med(allPrices)
    if (median < 1500) return []

    // Deduplicate listings
    const seen = new Set()
    allListings = allListings.filter(l => {
      const k = `${l.price}-${l.title?.slice(0,12)}`
      if (seen.has(k)) return false; seen.add(k); return true
    })

    return allListings
      .map(l => {
        const score = scoreDeal(l, median, c)
        if (score < 0) return null  // Filtered out by quality check
        // Fallback URL: if no individual listing URL, link to search page
        let url = l.url || ""
        if (!url) {
          if (l.source === "Marktplaats") url = `https://www.marktplaats.nl/l/auto-s/#q:${c.mk}+${c.ml}+${c.yr}`
          else if (l.source === "AutoScout24") url = `https://www.autoscout24.nl/lst/${c.mk}/${c.ml}?fregfrom=${c.yr}&fregto=${c.yr+1}&cy=NL&sort=price&desc=0`
          else if (l.source === "AutoTrack") url = `https://www.autotrack.nl/aanbod?merk=${c.mk}&model=${c.ml}&bouwjaar_van=${c.yr}&bouwjaar_tot=${c.yr}`
          else if (l.source === "Gaspedaal") url = `https://www.gaspedaal.nl/${c.mk}-${c.ml}/jaar-${c.yr}`
          else url = `https://www.google.nl/search?q=${c.mk}+${c.ml}+${c.yr}+occasion`
        }
        return {
          ...l, url, score,
          mk: c.mk, ml: c.ml, yr: c.yr,
          marketMedian: Math.round(median),
          potentialMargin: Math.round(median - l.price),
          marginPct: Math.round((1 - l.price / median) * 100),
        }
      }).filter(Boolean)
  }))

  results.forEach(r => { if (r.status === "fulfilled") allDeals.push(...r.value) })
  // Sort by deal quality score (smart), not just margin
  const deals = allDeals.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 30)
  dealsCache = { ts: Date.now(), deals }
  console.log(`[DEALS] Scanned ${combos.length} combos across 4 platforms, found ${deals.length} quality deals (filtered from ${allDeals.length + deals.length} raw)`)
  res.json({ deals, cached: false, ts: Date.now(), scanned: combos.length })
})

/* ── IMAGE ───────────────────────────────── */

// Market history system
// ═══ MARKET HISTORY SYSTEM — Tracks individual listings over time ═══

// crypto already required above

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
      const result = stmts.upsertListing.run(hash, mk, ml, yr, l.title, l.price, l.km||null, trans||'', l.source, l.url||'', l.dealer||'')
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


// AS24 MODEL EXPANDER - BMW/Mercedes use individual model numbers
const AS24_EXPAND = {
  'bmw': {
    '1 serie': ['116','118','120'],
    '2 serie': ['218','220','225'],
    '3 serie': ['316','318','320','325','330'],
    '4 serie': ['420','430','435'],
    '5 serie': ['520','530','535','540'],
  },
  'mercedes-benz': {
    'a-klasse': ['a-160','a-180','a-200','a-220'],
    'b-klasse': ['b-180','b-200','b-220'],
    'c-klasse': ['c-180','c-200','c-220','c-250','c-300'],
    'e-klasse': ['e-200','e-220','e-250','e-300','e-350'],
    's-klasse': ['s-350','s-400','s-500'],
    'v-klasse': ['v-220','v-250','v-300'],
    'gla': ['gla-180','gla-200','gla-220'],
    'glb': ['glb-180','glb-200','glb-220'],
    'glc': ['glc-200','glc-220','glc-300'],
    'gle': ['gle-300','gle-350','gle-450'],
    'cla': ['cla-180','cla-200','cla-220'],
    'cls': ['cls-220','cls-350','cls-450'],
  },
}
function getAS24ListingUrls(make, model, year) {
  const mk = (make || '').toLowerCase()
  const ml = (model || '').toLowerCase()
  const expand = AS24_EXPAND[mk] && AS24_EXPAND[mk][ml]
  if (expand) {
    return expand.slice(0, 3).map(slug => ({
      name: "AutoScout24",
      url: 'https://www.autoscout24.nl/lst/' + mk + '/' + slug + '?fregfrom=' + year + '&fregto=' + (year+1) + '&cy=NL'
    }))
  }
  return [{ name: "AutoScout24", url: 'https://www.autoscout24.nl/lst/' + mk + '/' + ml + '?fregfrom=' + year + '&fregto=' + (year+1) + '&cy=NL' }]
}

let _crawlRunning = false
async function backgroundCrawl() {
  if (_crawlRunning) return
  _crawlRunning = true
  const startTime = Date.now()

  try {
    // Get items to crawl (stale or never crawled)
    const queue = stmts.getCrawlQueue.all(300) // 100 per run — continu crawlen — Z440 kan het aan
    if (!queue.length) { _crawlRunning = false; return }

    console.log(`\n[CRAWLER] Starting background crawl: ${queue.length} models`)

    for (const item of queue) {
      try {
        // Anti-block: random delay 1-3 sec tussen modellen
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
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
          ...getAS24ListingUrls(item.make, item.model, item.year),
        ]
        const listingResults = await Promise.allSettled(listingUrls.map(async lu => {
          const html = await safeFetch(lu.url)
          return extractListings(html, cap, lu.url, lu.name)
        }))
        let listings = []
        listingResults.forEach(lr => { if (lr.status === 'fulfilled' && lr.value?.length) listings.push(...lr.value) })
        const seenL = new Set()
        listings = listings.filter(l => { const k = `${l.price}-${l.title?.slice(0,15)}`; if (seenL.has(k)) return false; seenL.add(k); return true }).slice(0, 15)

        // Als extractListings niks geeft, maak listings van de losse prijzen
        if (false && listings.length === 0 && allPrices.length > 0) { // DISABLED: creates fake listings without km/title
          const sources = ['Marktplaats','AutoScout24','AutoTrack','Gaspedaal','Autowereld','ViaBovag']
          const results = [mp, as24, at, gp, aw, vb]
          results.forEach((r, idx) => {
            if (r.status === 'fulfilled' && r.value?.length) {
              r.value.forEach(price => {
                listings.push({ title: item.make + ' ' + item.model + ' ' + item.year, price, km: null, source: sources[idx], dealer: '' })
              })
            }
          })
          const seenP = new Set()
          listings = listings.filter(l => { const k = l.price + '-' + l.source; if (seenP.has(k)) return false; seenP.add(k); return true }).slice(0, 30)
          if (listings.length > 0) console.log('  [CRAWLER] Converted', listings.length, 'prices to listings for', item.make, item.model, item.year)
        }

        // Store
        if (listings.length > 0) {
          storeListingsForHistory(item.make, item.model, item.year, listings, trans)
          // ── FLYWHEEL: Track price changes + days on market ──
          try {
            const { queryAll, run } = require("../db")
            for (const l of listings) {
              const crypto = require("crypto")
              const hash = crypto.createHash("md5").update((l.price||0)+"-"+(l.title||"").slice(0,30)+"-"+(l.source||"")).digest("hex").slice(0,12)
              const existing = queryAll("SELECT id, price, first_seen FROM market_listings WHERE hash=? LIMIT 1", [hash])
              if (existing.length > 0) {
                const ex = existing[0]
                // Track price change
                if (ex.price && l.price && Math.abs(ex.price - l.price) > 50) {
                  run("INSERT INTO price_history (listing_hash,make,model,year,price,previous_price,source,recorded_at) VALUES (?,?,?,?,?,?,?,datetime('now'))",
                    [hash, item.make, item.model, item.year, l.price, ex.price, l.source || ""])
                  run("UPDATE market_listings SET last_price=?, price=?, price_changes=COALESCE(price_changes,0)+1 WHERE id=?",
                    [ex.price, l.price, ex.id])
                }
                // Update days on market
                if (ex.first_seen) {
                  const days = Math.max(1, Math.round((Date.now() - new Date(ex.first_seen).getTime()) / 86400000))
                  run("UPDATE market_listings SET days_on_market=?, last_seen=datetime('now') WHERE id=?", [days, ex.id])
                }
              } else if (l.price) {
                // New listing: set first_price
                run("UPDATE market_listings SET first_price=? WHERE hash=? AND first_price IS NULL", [l.price, hash])
              }
            }
          } catch(pe) { console.log("  [CRAWLER] Price tracking error:", pe.message) }
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
        // Score sources for intelligence
        const srcNames=["marktplaats","autoscout24.nl","autotrack","gaspedaal","autowereld","viabovag"];
        [mp,as24,at,gp,aw,vb].forEach((r,idx)=>{
          const prices=r.status==="fulfilled"?r.value||[]:[];
          const allMedian=allPrices.length>2?[...allPrices].sort((a,b)=>a-b)[Math.floor(allPrices.length/2)]:0;
          try{scoreSource(srcNames[idx],prices.length,prices,allMedian,0)}catch(e){}
        });
        console.log(`  [CRAWLER] ${item.make} ${item.model} ${item.year}: ${allPrices.length} prices, ${listings.length} listings`)

        // Small delay between models to be respectful
        await new Promise(r => setTimeout(r, 1000))
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


// Price history API
// ═══ PRICE HISTORY API ENDPOINT ═══

router.get("/api/market/history", async (req, res) => {
  const mk = String(req.query.make || "").toLowerCase().trim()
  const ml = String(req.query.model || "").toLowerCase().trim()
  const yr = Number(req.query.year || 0)
  if (!mk || !ml || !yr) return res.json({ ok: false, error: "make, model, year required" })

  try {
    // 1. Our own tracked listings
    const activeListings = stmts.getListingHistory.all(mk, ml, yr)
    const soldListings = stmts.getSoldListings.all(mk, ml, yr)

    // 2. Price trends over time
    const trends = stmts.getPriceTrends.all(mk, ml, yr)

    // 3. Market snapshots
    const snapshots = stmts.getMarketHistory.all(mk, ml, yr)

    // 4. Wayback Machine historical data (cached for 24h)
    const wbCk = `wb|${mk}|${ml}|${yr}`
    let waybackData = getCached(wbCk, 86400000)
    if (!waybackData) {
      waybackData = await fetchWaybackPrices(mk, ml, yr)
      if (waybackData.length > 0) setCache(wbCk, waybackData)
    }

    // Build price timeline
    const timeline = []

    // Add wayback data (oldest)
    for (const wb of (waybackData || [])) {
      timeline.push({ date: wb.date, median: wb.median, avg: wb.avg, count: wb.count, source: wb.source })
    }

    // Add our snapshots
    for (const snap of snapshots) {
      timeline.push({ date: snap.created_at?.slice(0, 10), median: snap.median, avg: snap.avg, count: snap.count, source: 'snapshot' })
    }

    // Add trends
    for (const t of trends) {
      timeline.push({ date: t.month + '-15', median: t.median_price, avg: t.avg_price, count: t.listing_count, sold: t.sold_count, source: 'trend' })
    }

    // Sort chronologically and deduplicate by month
    timeline.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const monthSeen = new Set()
    const uniqueTimeline = timeline.filter(t => {
      const m = (t.date || '').slice(0, 7)
      if (monthSeen.has(m + t.source)) return false
      monthSeen.add(m + t.source)
      return true
    })

    // Price direction
    let priceDirection = 'stable'
    if (uniqueTimeline.length >= 2) {
      const recent = uniqueTimeline.at(-1)?.median || 0
      const older = uniqueTimeline.at(-2)?.median || 0
      if (recent && older) {
        const pctChange = (recent - older) / older
        if (pctChange < -0.05) priceDirection = 'dalend'
        else if (pctChange > 0.05) priceDirection = 'stijgend'
      }
    }

    // Sold price analysis
    const soldPrices = soldListings.map(s => s.sold_estimate).filter(p => p > 0).sort((a, b) => a - b)
    const soldAnalysis = soldPrices.length >= 2 ? {
      count: soldPrices.length,
      avgSoldPrice: Math.round(soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length),
      medianSoldPrice: soldPrices[Math.floor(soldPrices.length / 2)],
      lowestSold: soldPrices[0],
      highestSold: soldPrices.at(-1),
    } : null

    res.json({
      ok: true,
      make: mk, model: ml, year: yr,
      activeListings: activeListings.length,
      soldListings: soldListings.length,
      priceDirection,
      soldAnalysis,
      timeline: uniqueTimeline,
      trends,
      stats: stmts.getMarketStats.get()
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Market history ──


module.exports = router
module.exports.backgroundCrawl = backgroundCrawl
module.exports.isCrawlRunning = () => _crawlRunning
