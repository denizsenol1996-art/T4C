// routes/valuation.js — /api/dealer/price (AI-first pricing endpoint)
const router = require("express").Router()
const express = require("express")
const axios = require("axios")
const { stmts, queryAll, queryOne, run } = require("../db")
const { getCached, setCache, maxPrice, MIN_PRICE, fmtE, safeFetch } = require("../lib/helpers")
const { getSeasonFactor, getDepreciation, getMarketPressure, normalizeKm, generateInsights, recordTaxatie, learn, getLearned, kmCorrection } = require("../lib/pricing")
const { med, validate, buildSearchUrls } = require("../lib/scrapers")
const { getApiKey, hasApiKey } = require("../lib/ai")
const { authMiddleware, staffOnly } = require("../lib/auth")
const { getTwinListings } = require("../lib/twins")
const { writeLog } = require("../lib/state")
const { calculateTradeBid } = require('../lib/trade-engine')
const { calculateQualityScore, calculateTechniekScore, calculateCourantScore, calculateMargeScore, calculateVergelijkScore, calculateTotalScore, generateDealerAdvice } = require("../lib/scoring")
const { buildComparableSet } = require("../lib/comparable-engine")
const { getExpertPriceEstimate } = require("../lib/quick-price-expert")
const { getModelLifecycle } = require("../lib/model-lifecycle")
let _bodAdjustments = { rules: [] }
try { _bodAdjustments = require("../config/bod-adjustments.json") } catch(e) { console.log("[BOD-ADJ] geen config geladen:", e.message) }

// v10.18.69 — gedeelde matcher (gebruikt door /api/dealer/price en /api/dealer/quick-price)
// Supports: make, model, fuel_contains, km_gte (alias km_min), km_lte (alias km_max), year_gte, year_lte
function matchBodAdjustment(vehicle) {
  const makeUp = (vehicle.make || "").toUpperCase()
  const modelUp = (vehicle.model || "").toUpperCase()
  const fuelLow = (vehicle.fuel || "").toLowerCase()
  const km = parseInt(vehicle.km) || 0
  const year = parseInt(vehicle.year) || 0
  for (const rule of (_bodAdjustments.rules || [])) {
    if (rule.enabled === false) continue
    const c = rule.conditions || {}
    if (c.make && makeUp !== String(c.make).toUpperCase()) continue
    if (c.model && modelUp !== String(c.model).toUpperCase()) continue
    if (c.fuel_contains && !fuelLow.includes(String(c.fuel_contains).toLowerCase())) continue
    const kmGte = c.km_gte != null ? c.km_gte : c.km_min
    const kmLte = c.km_lte != null ? c.km_lte : c.km_max
    if (kmGte != null && km < kmGte) continue
    if (kmLte != null && km > kmLte) continue
    if (c.year_gte != null && year && year < c.year_gte) continue
    if (c.year_lte != null && year && year > c.year_lte) continue
    return rule
  }
  return null
}

// v10.18.64 — soft confidence-tag voor low-data cases (geen cap, alleen flag)
function deriveDataConfidence(compResult, marketCount) {
  const reasons = []
  if (compResult && compResult.status && compResult.status !== "ok") {
    reasons.push("comp_engine_" + compResult.status)
  }
  const cleanCount = (compResult && (compResult.cleanCount != null ? compResult.cleanCount : compResult.comp_count)) ?? null
  if (cleanCount !== null && cleanCount < 3) {
    reasons.push("low_comp_count")
  } else if (cleanCount === null && (marketCount || 0) < 3) {
    reasons.push("low_market_count")
  }
  return {
    level: reasons.length > 0 ? "low" : "normal",
    reasons,
    message: reasons.length > 0 ? "Weinig marktdata beschikbaar — controleer bod handmatig" : null
  }
}

router.post("/api/dealer/price", express.json(), async (req, res) => {
  try {
    // Optionele auth: pak user als token meegegeven
    let _userId = null
    try { const { verifyToken } = require("../lib/auth"); const t = (req.headers.authorization||"").replace("Bearer ",""); if (t) { const u = verifyToken(t); _userId = u?.uid || null } } catch{}
    let d = req.body
    const _t0 = Date.now()
    // If plate is provided, enrich with full vehicle data first
    if (d.plate) {
      try {
        // Direct cache lookup — no HTTP roundtrip (same process, shared cache)
        const _ck = "vehicle_" + d.plate.replace(/[\s-]/g, "").toUpperCase()
        let e = getCached(_ck, 14400000)  // 4 uur cache voor enrichment
        if (!e) {
          // Cache miss — call enrichment via HTTP (fills cache for next time)
          const enrichResp = await axios.get("http://localhost:3000/api/vehicle/enriched?plate=" + encodeURIComponent(d.plate) + "&km=" + (d.km || 0), {timeout: 30000})
          e = enrichResp.data || {}
        } else {
          console.log("[DEALER-PRICE] Cache hit for", d.plate)
        }
        // Merge enriched data into request, keeping any explicit overrides
        d = {
          ...d,
          make: d.make || e.make,
          model: d.model || e.model,
          year: d.year || e.year,
          fuel: d.fuel || e.fuel,
          catalogPrice: d.catalogPrice || e.catalogPrice,
          engineLabel: d.engineLabel || e.engineLabel,
          subModel: d.subModel || e.specificModel || e.subModel,
          transmissionType: d.transmissionType || e.transmission,
          transmissionAuto: d.transmissionAuto != null ? d.transmissionAuto : (e.transmission === "Automaat"),
          trimLevel: d.trimLevel || e.trimLevel,
          generation: d.generation || e.generation,
          motorCode: d.motorCode || e.motorCode,
          drivetrain: d.drivetrain || e.drivetrain,
          body: d.body || e.body,
          doors: d.doors || e.doors || null,
          color: d.color || e.color,
          ownerCount: d.ownerCount || e.ownerCount,
          apkUntil: d.apkUntil || e.apkUntil,
          bpmRest: d.bpmRest || e.bpmRest,
          bijtelling: d.bijtelling || e.bijtelling,
          emissieKlasse: d.emissieKlasse || e.emissieKlasse,
          importFlag: d.importFlag || e.importFlag,
          engineRiskProfile: d.engineRiskProfile || e.engineRiskProfile,
          courantScore: d.courantScore || e.courantScore,
          co2: d.co2 || e.co2,
          powerKw: d.powerKw || e.powerKw || e.power,
          firstAdmission: d.firstAdmission || e.firstAdmission,
          firstAdmissionNL: d.firstAdmissionNL || e.firstAdmissionNL,
          registrationDate: d.registrationDate || e.registrationDate,
          wamInsured: d.wamInsured !== undefined ? d.wamInsured : e.wamInsured,
          defects: d.defects || e.defects || [],
          recalls: d.recalls || e.recalls || [],
          apkHistory: d.apkHistory || e.apkHistory || [],
          kmAnalysis: d.kmAnalysis || e.kmAnalysis || null,
          euroClass: d.euroClass || e.euroClass,
          as24Waarde: d.as24Waarde || e.as24Waarde,
          anwbWaarde: d.anwbWaarde || e.anwbWaarde,
          finnikData: d.finnikData || e.finnikData,
          marktCount: d.marktCount || e.marktCount || 0, marketCount: d.marktCount || e.marktCount || d.marketCount || e.marketCount || 0,
          enrichedVerkoop: e.verkoopadviees || null,
          enrichedHandel: e.handelswaarde || null,
        }
        console.log("[DEALER-PRICE] Enriched from plate:", d.plate, "->", d.make, d.model, d.subModel, d.year)
      } catch(eErr) { console.log("[DEALER-PRICE] Enrich failed:", eErr.message) }
    }
    const year = d.year || 2015

    // === FEATURE 2: model-lifecycle GPT-call PARALLEL met rest van pricing ===
    const _lifecyclePromise = getModelLifecycle(d.make, d.model, year).catch(() => null)

    // Haal individuele listings op als ze niet in d zitten
    if (!(d.marketListings && d.marketListings.length)) {
      try {
        const mk = (d.make||'').toLowerCase(); let ml = (d.model||'').toLowerCase(); if (ml.startsWith(mk + ' ')) ml = ml.slice(mk.length + 1)
        if (mk && ml) {
          // Smart model matching: probeer exact, dan eerste woord, dan nummer-extractie
          let dbListings = queryAll('SELECT title, price, km, source, dealer as sellerType, first_seen, days_on_market, options, transmission, fuel FROM market_listings WHERE make=? AND model LIKE ? AND year BETWEEN ? AND ? AND price > 0 ORDER BY price ASC LIMIT 50', [mk, ml + '%', (d.year||2015)-2, (d.year||2015)+2])
          // Fallback 1: eerste woord (maar niet als het een nummer is dat andere modellen matcht)
          if (dbListings.length < 3 && ml.includes(' ')) {
            const firstWord = ml.split(' ')[0]
            // Voorkom dat "3" matcht met "x3" — gebruik "3 %" ipv "3%"
            const safePattern = /^\d+$/.test(firstWord) ? firstWord + ' %' : firstWord + '%'
            dbListings = queryAll('SELECT title, price, km, source, dealer as sellerType, first_seen, days_on_market, options, transmission, fuel FROM market_listings WHERE make=? AND model LIKE ? AND year BETWEEN ? AND ? AND price > 0 ORDER BY price ASC LIMIT 50', [mk, safePattern, (d.year||2015)-2, (d.year||2015)+2])
            if (dbListings.length > 0) console.log('[MODEL-MATCH] Fallback 1:', mk, ml, '->', safePattern, ':', dbListings.length, 'listings')
          }
          // Fallback 2: zoek in title (RDW zegt "3 SERIE", Marktplaats zegt "320d")
          if (dbListings.length < 3) {
            const numMatch = ml.match(/^(\d+)/)
            if (numMatch) {
              const altListings = queryAll('SELECT title, price, km, source, dealer as sellerType, first_seen, days_on_market, options, transmission, fuel FROM market_listings WHERE make=? AND (model LIKE ? OR model LIKE ? OR title LIKE ?) AND year BETWEEN ? AND ? AND price > 0 ORDER BY price ASC LIMIT 50', [mk, numMatch[1] + '%', numMatch[1] + ' %', '%' + numMatch[1] + '%', (d.year||2015)-2, (d.year||2015)+2])
              // Filter: alleen als het model BEGINT met het nummer (voorkom x3 bij 3 serie)
              const filtered = altListings.filter(l => {
                const m = (l.model||l.title||'').toLowerCase()
                return m.startsWith(numMatch[1]) || m.includes(numMatch[1] + '0') || m.includes(numMatch[1] + '1') || m.includes(numMatch[1] + '2')
              })
              if (filtered.length > dbListings.length) {
                dbListings = filtered
                console.log('[MODEL-MATCH] Fallback 2 (number):', mk, ml, '->', numMatch[1] + 'xx variants:', dbListings.length, 'listings')
              }
            }
          }
          console.log('[DEALER-PRICE] Loaded', dbListings.length, 'listings from DB for', mk, ml)
          // Twin car listings (zelfde platform, ander badge)
          const twinListings = getTwinListings(queryAll, mk, ml, d.year||2015)
          const twinCount = twinListings.length
          if (twinCount > 0) {
            const twinPriced = twinListings.filter(l => l.price > 0).map(l => ({
              title: l.title || (l.twin_source + ' ' + (l.year||'')),
              price: l.price, km: l.km, source: (l.source||'') + ' (twin: ' + l.twin_source + ')',
              sellerType: l.dealer, first_seen: l.first_seen, days_on_market: l.days_on_market, isTwin: true
            }))
            dbListings.push(...twinPriced)
            dbListings.sort((a,b) => a.price - b.price)
            console.log('[TWINS]', mk, ml.split(" ")[0], ':', twinCount, 'twin listings toegevoegd van', [...new Set(twinListings.map(l=>l.twin_source))].join(', '))
          }
          if (dbListings.length > 0) {
            d.marketListings = dbListings
            console.log('[DEALER-PRICE] Loaded', dbListings.length, 'listings from DB')
          }
        }
      } catch(e) { console.log('[DEALER-PRICE] DB listings error:', e.message) }
    }
        // === COMP ENGINE VALUATION ===
    let compResult = null
    try {
      const _compListings = Array.isArray(d.marketListings) ? d.marketListings : []
      if (_compListings.length > 0) {
        const _fuel = (d.fuel||'').toLowerCase()
        const _trans = (d.transmissionType||'').toLowerCase()
        const _transNorm = d.transmissionAuto ? 'automaat' : (_trans.includes('handgeschakeld') || _trans.includes('manual') ? 'handgeschakeld' : _trans.includes('automaat') || _trans.includes('auto') ? 'automaat' : '')
        const compTarget = {
          make: d.make || '', model: d.model || '',
          generation: d.generation || '',
          trim: d.trimLevel || d.subModel || '',
          bodyType: d.body || '',
          fuel: _fuel.includes('diesel') ? 'Diesel' : _fuel.includes('benzine') ? 'Benzine' : _fuel.includes('elektr') ? 'Elektrisch' : d.fuel || '',
          transmission: _transNorm ? _transNorm.charAt(0).toUpperCase() + _transNorm.slice(1) : '',
          year: d.year || 0, km: d.km || 0,
          powerHp: d.powerKw ? Math.round(d.powerKw * 1.36) : 0,
          isEV: /elektr|electric/i.test(d.fuel || ''),
        }
        compResult = buildComparableSet(compTarget, _compListings)
        console.log(`[COMP-ENGINE-VAL] ${d.make} ${d.model}: status=${compResult.status} clean=${compResult.cleanCount} strong=${compResult.strongCount} median=EUR${compResult.marketMedian} conf=${compResult.confidenceComparable}`)
      }
    } catch(compErr) { console.log('[COMP-ENGINE-VAL] Error:', compErr.message) }

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
    const mCount = (compResult ? compResult.cleanCount : 0) || (Array.isArray(d.marketListings) ? d.marketListings.length : 0) || d.marketCount || 0
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

    // ═══ AUTO-DETECTIE CORRECTIES (uit 323 feedback entries) ═══
    const _autoCorr = []
    
    // 3-deurs: minder courant, -7%
    const doorCount = parseInt(d.doors || d.aantal_deuren || 0)
    if (doorCount === 2 || doorCount === 3) {
      const bodyLow = (d.body || d.inrichting || '').toLowerCase()
      if (!bodyLow.includes('cabrio') && !bodyLow.includes('coupe') && !bodyLow.includes('sport')) {
        base *= 0.93
        _autoCorr.push('3-deurs uitvoering — minder courant [-7%]')
      }
    }

    // Veel aanbod: drukt de prijs
    const _listCount = Array.isArray(d.marketListings) ? d.marketListings.length : 0
    if (_listCount >= 40) {
      base *= 0.95
      _autoCorr.push('Veel aanbod (' + _listCount + ' listings) — drukt de prijs [-5%]')
    }

    // Kale uitvoering: lage catalogusprijs tov segment gemiddelde
    const catPrice = d.catalogPrice || 0
    if (catPrice > 0 && catPrice < 18000 && (segment === 'C' || segment === 'P')) {
      base *= 0.95
      _autoCorr.push('Relatief kale uitvoering — minder opties [-5%]')
    }

    // Veel eigenaren (5+)
    if (ownCount >= 6) {
      _autoCorr.push(ownCount + ' eigenaren — extra risico')
    }

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
    if (velAvg >= 65) { sellSpeed = "Snel"; sellDays = 22 }
    else if (velAvg >= 45) { sellSpeed = "Normaal"; sellDays = 45 }
    else if (velAvg >= 25) { sellSpeed = "Langzaam"; sellDays = 75 }
    else { sellSpeed = "Moeilijk"; sellDays = 120 }

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
    if (_autoCorr) _autoCorr.forEach(s => smartSummary.push(s))
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
    let _auditAiVerkoop = null, _auditBlendVerkoop = null, _auditDataWeight = null
    let _bodAdjustment = null

    try {
      const apiKey = getApiKey("OPENAI_API_KEY")
      if (apiKey && apiKey !== "sk-..." && typeof axios !== 'undefined') {

        // ── Build rich vehicle description ──
        const _variant = [d.subModel, d.engineLabel, d.trimLevel].filter(Boolean).join(' / ')
        const carDesc = (d.plate ? '[Kenteken: ' + d.plate + '] ' : '') + (d.make||'?') + ' ' + (d.model||'?') + (_variant ? ' [' + _variant + ']' : '') + ' (' + year + '), ' + km.toLocaleString('nl-NL') + ' km, ' + (d.fuel||'?') + ', segment ' + segment + ', ' + age + ' jaar oud'
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

          // ── FILTER + KM-NORMALISATIE ──
          const rawListings = Array.isArray(d.marketListings) ? d.marketListings : []
          const targetKm = km || 100000
          const kmPerEuro = Math.max(50, Math.min(500, Math.round(targetKm < 50000 ? 200 : targetKm < 100000 ? 150 : targetKm < 150000 ? 120 : 80)))
          // Filter: alleen listings met km binnen ±60% van target (of zonder km)
          const filteredListings = rawListings.filter(l => {
            if (!l.km || l.km <= 0) return true // geen km = behouden
            const ratio = l.km / targetKm
            return ratio >= 0.4 && ratio <= 2.0 // 40% - 200% van target
          })
          // KM-normalisatie: corrigeer prijs naar target km
          const normalizedListings = filteredListings.map(l => {
            if (!l.km || l.km <= 0 || !l.price) return l
            const kmDiff = l.km - targetKm
            const correction = Math.round((kmDiff / 10000) * kmPerEuro)
            return { ...l, normalizedPrice: Math.max(200, l.price + correction), kmCorrection: correction }
          }).sort((a,b) => (a.normalizedPrice||a.price) - (b.normalizedPrice||b.price))
          // Bereken genormaliseerde mediaan
          const normPrices = normalizedListings.map(l => l.normalizedPrice || l.price).filter(p => p > 0).sort((a,b) => a-b)
          const normMedian = normPrices.length > 0 ? normPrices[Math.floor(normPrices.length/2)] : 0
          const normP25 = normPrices.length >= 4 ? normPrices[Math.floor(normPrices.length*0.25)] : normPrices[0] || 0
          const normP75 = normPrices.length >= 4 ? normPrices[Math.floor(normPrices.length*0.75)] : normPrices[normPrices.length-1] || 0
          console.log('[LISTINGS]', rawListings.length, 'raw →', filteredListings.length, 'filtered →', 'normMediaan:', normMedian, '| kmPerEuro:', kmPerEuro)

          // Title filter: verwijder listings die niet bij het model passen
          const _mk = (d.make||'').toLowerCase()
          const _ml = (d.model||'').toLowerCase()
          const _mlWords = _ml.split(' ').filter(w => w.length >= 2)
          const cleanListings = normalizedListings.filter(l => {
            const t = (l.title||'').toLowerCase()
            if (!t) return true  // geen title = vertrouw het
            // Title moet merk + alle model-woorden bevatten
            if (_mlWords.length > 0 && !_mlWords.every(w => t.includes(w))) {
              return false  // bijv "A 180" past niet bij model "E 350"
            }
            return true
          })
          // SAFETY: >70% weggefilterd? Model-string te abstract (bv "5 Series" matched niet op "535i F11"). Gebruik ongefilterd.
          const _titleRatio = normalizedListings.length > 0 ? cleanListings.length / normalizedListings.length : 1
          const _titleSkipped = _titleRatio < 0.3 && normalizedListings.length >= 5
          const listings = _titleSkipped ? normalizedListings : cleanListings
          if (cleanListings.length < normalizedListings.length) {
            console.log('[TITLE-FILTER]', d.make, d.model, ':', normalizedListings.length, '->', cleanListings.length, _titleSkipped ? '(SKIPPED — te strikt, gebruik ongefilterd)' : 'listings na title check')
          }
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
          ? `${mCount} vergelijkbare gevonden (ruwe data):
- Ruwe mediaan: EUR ${mMedian||"?"}

GEFILTERD + KM-GENORMALISEERD:
- ${filteredListings.length} listings binnen km-range
- Genormaliseerde mediaan: EUR ${normMedian||"?"} (gecorrigeerd naar ${km} km)
- Genorm P25: EUR ${normP25||"?"}
- Genorm P75: EUR ${normP75||"?"}
- KM-correctie: EUR ${kmPerEuro} per 10.000 km
GEBRUIK DE GENORMALISEERDE MEDIAAN ALS BASIS.`
          : "Geen marktdata beschikbaar"

        const finWaarde = d.finnikWaardeLow && d.finnikWaardeHigh ? `\nFinnik (onafhankelijke) waarde: EUR ${d.finnikWaardeLow} - ${d.finnikWaardeHigh}` : ''
        const as24Ref = d.as24Waarde ? `\nAutoScout24 ML-waardebepaling: EUR ${d.as24Waarde.low}${d.as24Waarde.high !== d.as24Waarde.low ? ' - ' + d.as24Waarde.high : ''}` : ''
        const anwbRef = d.anwbWaarde ? `\nANWB Koerslijst: ${d.anwbWaarde.inruilwaarde ? 'Inruil EUR ' + d.anwbWaarde.inruilwaarde : ''}${d.anwbWaarde.verkoopwaarde ? ' | Verkoop EUR ' + d.anwbWaarde.verkoopwaarde : ''}` : ''
        const externalRefs = finWaarde + as24Ref + anwbRef
        const enrichedRef = d.enrichedVerkoop ? `GPT-5.4 eerste inschatting (vehicle endpoint): Retail EUR ${d.enrichedVerkoop}, Handel EUR ${d.enrichedHandel || '?'} — gebruik dit als ANKERPUNT` : ''
          const fmlRef = `Formule-referentie (NIET definitief): Retail EUR ${verkoopadviees}, Handel EUR ${handelswaarde}, Inkoop EUR ${inkoopLow}-${inkoopHigh}`

        // ── Price history from our database ──
        let priceHistoryDesc = ''
        try {
          const trends = stmts.getPriceTrends.all((d.make||'').toLowerCase(), ((d.model||'').toLowerCase().startsWith((d.make||'').toLowerCase()+' ') ? (d.model||'').toLowerCase().slice((d.make||'').length+1) : (d.model||'').toLowerCase()), year)
          const soldData = stmts.getSoldListings.all((d.make||'').toLowerCase(), ((d.model||'').toLowerCase().startsWith((d.make||'').toLowerCase()+' ') ? (d.model||'').toLowerCase().slice((d.make||'').length+1) : (d.model||'').toLowerCase()), year)
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
        const sysPrompt = `Je bent de hoofd-taxateur van een Nederlandse dealerapp. Je denkt als een topniveau occasionhandelaar, taxateur en risicoanalist in één.

ZOEK OP INTERNET naar actuele prijzen voor dit EXACTE model+motorvariant op Marktplaats.nl, AutoScout24.nl en Gaspedaal.nl.
Interne marktdata bevat ALLE varianten door elkaar — jouw websearch voor de SPECIFIEKE uitvoering is essentieel.

VERPLICHTE WERKWIJZE:
1. Bepaal eerst exact wat voor voertuig dit is (merk, model, generatie, motor, transmissie, uitvoering)
2. Classificeer als type A, B of C
3. Zoek op internet naar vergelijkbare exemplaren van de EXACTE variant
4. Bepaal pas daarna de prijs

CLASSIFICATIE:
- Type A = standaard volume-auto, veel aanbod, modeldata mag zwaar meewegen
- Type B = sterkere of minder gangbare uitvoering waarbij variant, motor of trim duidelijk prijsrelevant is. Variantwaarde weegt zwaarder dan modelgemiddelde
- Type C = uitzonderlijk, zeldzaam, niche of dunne markt. Generieke modeldata is onbetrouwbaar — alleen als zwakke referentie gebruiken
Bij twijfel tussen B en C: kies C alleen wanneer de markt aantoonbaar dun is of generieke data misleidend zou zijn.

MODEL-VERIFICATIE (CRUCIAAL):
- Controleer of de combinatie model + carrosserie + motor + catalogusprijs LOGISCH is
- Een Golf GTE bestaat ALLEEN als hatchback, NOOIT als Variant/stationwagen. Als RDW 'stationwagen' zegt maar het is een GTE: corrigeer naar hatchback
- Een Toyota Corolla met catalogusprijs >€35.000 is waarschijnlijk een Corolla CROSS, niet een gewone Corolla
- Een Kia Picanto met catalogusprijs >€20.000 of sportbumpers is waarschijnlijk een Picanto GT of GT-Line
- Een Seat Leon met catalogusprijs >€28.000 is waarschijnlijk een FR of Cupra uitvoering
- Als de catalogusprijs NIET past bij het basismodel, zoek online wat het WERKELIJK is
- RDW inrichting (stationwagen/hatchback) kan FOUT zijn bij import of speciale modellen — verifieer altijd
- Als je een correctie doet, vermeld dit expliciet in je reasoning
KERNREGELS:
- Exacte variant gaat ALTIJD boven generiek modelgemiddelde
- Meng NIET: sedan/coupé, benzine/diesel, 4-cil/V6, basis/AMG-GTI-M-Sport
- Hoge km en import drukken waarde, maar vernietigen NIET de variantwaarde van een sterke uitvoering
- Bij type C: generieke data alleen als zwakke referentie
- Bij type A: marktdata mag normaal meewegen
- Particuliere vraagprijzen zijn realistischer dan dealerprijzen (dealer +8-18% overhead)
- Werkelijke verkoopprijs = vraagprijs -5 tot -15%

PRIJSDEFINITIES:
- verkoopadviees (B2C): realistische dealer-vraagprijs, geen droomprijs maar ook geen geld laten liggen
- handelswaarde (B2B): 82-92% van retail (jong/premium bij 92%, oud bij 82%)
- inkoopLow/inkoopHigh: moet dealer ruimte geven voor marge, garantie, reconditioning, advertentie, stilstandrisico. 85-95% van handelswaarde

EXTRA INSCHATTING:
- reconEstimate: geschatte kosten verkoopklaar maken in euro's (technisch + optisch)
- sellSpeed: "snel" (<30d), "normaal" (30-60d), "langzaam" (60-120d), "specialistisch" (>120d)
- facelift: "pre-facelift", "facelift", of "onbekend" — alleen als redelijk afleidbaar

WAARDE-FACTOREN:
- TRANSMISSIE: automaat +8-15% premium, +3-5% budget. Handgeschakeld omgekeerd
- KM-IMPACT OP DEALER-VRAAGPRIJS:
  * <50k km: +5-10% premium
  * 50-100k: marktgemiddelde
  * 100-150k: -5 tot -15%
  * 150-200k: -15 tot -25%
  * 200-250k: -25 tot -40%
  * 250-300k: -35 tot -50%
  * >300k: -50 tot -65%
  Dit is de DEALER-VRAAGPRIJS correctie, niet de particuliere. Een BMW 535i 289k km verkoopt bij een dealer nog voor EUR 8000-10000
- TRIM: M-Sport/S-Line/AMG/GTI = premium. Base = minder
- KLEUR: zwart/wit/grijs = populair. Geel/oranje/paars = niche
- IMPORT: -3%, mag marktwaarde niet blind vernietigen
- EIGENAREN: 1-2 positief, 5+ negatief
- EX-TAXI: -15 tot -25%
- APK: verlopen = -€300-800. Terugkerend = structureel
- EMISSIEKLASSE: Euro 0-3 = milieuzonerisico
- BPM REST: hoog = exportinteressant
- RECALLS: onopgelost = risico

ANTWOORD UITSLUITEND IN JSON (geen markdown, geen backticks):
{"verkoopadviees":12345,"handelswaarde":10800,"inkoopLow":9200,"inkoopHigh":10000,"confidence":75,"vehicleType":"B","sellSpeed":"normaal","reconEstimate":800,"facelift":"onbekend","reasoning":"max 3 zinnen NL","transmissieImpact":"beschrijf effect","riskFlags":[]}`

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

${enrichedRef}
${fmlRef}

${priceHistoryDesc}
Bepaal nu de juiste prijzen voor DIT specifieke voertuig.`

        console.log('[AI-FIRST] Calling GPT-5.4 + web search for', d.make, d.model, year, km + 'km')
        const aiResp = await axios.post("https://api.openai.com/v1/responses", {
          model: "gpt-5.4",
          temperature: 0,
          max_output_tokens: 1200,
          tools: [{ type: "web_search_preview" }],
          input: sysPrompt + "\n\n" + usrPrompt
        }, {headers: {"Authorization": "Bearer " + apiKey, "Content-Type": "application/json"}, timeout: 45000})

        // Parse Responses API output (different format than Chat Completions)
        const _outBlocks = aiResp.data.output || []
        const _textBlock = _outBlocks.find(b => b.type === 'message')
        var rawTxt = (_textBlock && _textBlock.content ? (_textBlock.content.find(c => c.type === 'output_text') || _textBlock.content[0] || {}).text : null) || '{}'
        rawTxt = rawTxt.replace(/```json/g, '').replace(/```/g, '').trim()
        // Extract JSON from possible surrounding text
        const _jsonMatch = rawTxt.match(/\{[\s\S]*\}/)
        if (_jsonMatch) rawTxt = _jsonMatch[0]
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
        const saneFloor = 100  // GPT-5.4 is primary, minimal sanity only
        const saneCeiling = 500000  // GPT-5.4 is primary, trust it

        if (aiVerkoop >= saneFloor && aiVerkoop <= saneCeiling && aiVerkoop >= 500) {
          // ═══ GEWOGEN DATA+GPT PRICING ═══
          // Data = vraagprijzen uit DB (x0.93 = geschatte verkoopprijs)
          // GPT = AI schatting op basis van kennis + context
          // Gewogen blend: meer data = meer vertrouwen op data
          const _kmTarget = km || 100000
          const _kmLow = Math.round(_kmTarget * 0.4)
          const _kmHigh = Math.round(_kmTarget * 1.6)
          const _clampListings = queryAll('SELECT price, km FROM market_listings WHERE UPPER(make)=? AND UPPER(model) LIKE ? AND year BETWEEN ? AND ? AND status=\'active\' AND price > 0 AND (km IS NULL OR (km BETWEEN ? AND ?))', [(d.make||'').toUpperCase(), (d.model||'').toUpperCase().split(' ')[0]+'%', (year||2015)-2, (year||2015)+2, _kmLow, _kmHigh])
          const _dbPrices = _clampListings.map(l=>l.price).sort((a,b)=>a-b)
          const _dbMedian = _dbPrices.length > 0 ? _dbPrices[Math.floor(_dbPrices.length/2)] : 0
          const _dbCount = _dbPrices.length
          // Vraagprijs -> verkoopprijs correctie (dealers verkopen gem. 7% onder vraagprijs)
          const _dataVerkoop = _dbMedian > 0 ? Math.round(_dbMedian * 0.93 / 50) * 50 : 0
          // Filter: verwijder listings waarvan de title niet bij het model past
          const _modelCheck = (d.model||'').toLowerCase().replace(/\s+/g, ' ').trim()
          if (_modelCheck.length >= 2) {
            const _before = _dbPrices.length
            const _validListings = _clampListings.filter(l => {
              const t = (l.title||'').toLowerCase()
              if (!t) return true  // geen title = vertrouw model veld
              // Check of title het model bevat (bijv "e 350" in "Mercedes-Benz E 350 CGI")
              const modelWords = _modelCheck.split(' ').filter(w => w.length >= 2)
              return modelWords.every(w => t.includes(w))
            })
            if (_validListings.length < _dbPrices.length && _validListings.length > 0) {
              const _vPrices = _validListings.map(l=>l.price).sort((a,b)=>a-b)
              _dbPrices.length = 0
              _vPrices.forEach(p => _dbPrices.push(p))
              const newMedian = _dbPrices[Math.floor(_dbPrices.length/2)]
              console.log('[DATA-FILTER]', d.make, d.model, ':', _before, '->', _dbPrices.length, 'listings na title check, mediaan was', _dbMedian, 'nu', newMedian)
            }
          }
          const _filteredMedian = _dbPrices.length > 0 ? _dbPrices[Math.floor(_dbPrices.length/2)] : _dbMedian
          const _filteredVerkoop = _filteredMedian > 0 ? Math.round(_filteredMedian * 0.93 / 50) * 50 : _dataVerkoop
          const _filteredCount = _dbPrices.length

          // Gewogen blend
          let _blendedVerkoop = aiVerkoop
          if (_filteredVerkoop > 0 && _filteredCount >= 1) {
            // Comp Engine data is schoon — gebruik die als beschikbaar
          let _dataWeight = 0.0
          let _useCompEngine = false
          if (compResult && compResult.status === 'ok' && compResult.confidenceComparable >= 15 && compResult.marketMedian > 0) {
            _useCompEngine = true
            // Comp engine levert schone retail mediaan — gebruik als data bron
            const compVerkoop = Math.round(compResult.marketMedian * 0.93 / 50) * 50
            _dataWeight = Math.min(0.70, Math.max(0.20, compResult.confidenceComparable / 100 * 1.5))
            _blendedVerkoop = Math.round((compVerkoop * _dataWeight + aiVerkoop * (1 - _dataWeight)) / 50) * 50
            console.log('[PRICING-COMP]', d.make, d.model, ':', compResult.cleanCount, 'clean comps, compMedian', compResult.marketMedian, '-> compVP', compVerkoop, '| GPT:', aiVerkoop, '| blend(' + Math.round(_dataWeight*100) + '/' + Math.round((1-_dataWeight)*100) + '):', _blendedVerkoop)
          }
          if (!_useCompEngine) { _dataWeight = _filteredCount >= 15 ? 0.50 : _filteredCount >= 8 ? 0.35 : _filteredCount >= 3 ? 0.20 : 0.0  // RE-ENABLED — km-filter zit nu in SQL hierboven
            _blendedVerkoop = Math.round((_filteredVerkoop * _dataWeight + aiVerkoop * (1 - _dataWeight)) / 50) * 50
            console.log('[PRICING-BLEND]', d.make, d.model, ':', _filteredCount, 'listings (van', _dbCount, 'raw), mediaan', _filteredMedian, '-> VP', _filteredVerkoop, '| GPT:', aiVerkoop, '| blend(' + Math.round(_dataWeight*100) + '/' + Math.round((1-_dataWeight)*100) + '):', _blendedVerkoop)
          } else {
          }
            console.log('[PRICING-GPT]', d.make, d.model, ': geen data, 100% GPT:', aiVerkoop)
            _auditDataWeight = _dataWeight
          }
          // GPT houdt al rekening met km — geen extra km correctie
          _auditAiVerkoop = aiVerkoop
          _auditBlendVerkoop = _blendedVerkoop
          finalVerkoop = _blendedVerkoop
          const _kmC = kmCorrection(km)
          if (_kmC.export) { d.exportFlag = true }
          // Trade Engine: deterministic bid calculation
          const _tradeResult = calculateTradeBid(finalVerkoop, aiResult, {...d, km, year, segment}, {count: mCount})
          if (_tradeResult) {
            finalHandel = _tradeResult.handelswaarde
            finalBod = _tradeResult.maxBid
            finalInkoopLow = _tradeResult.inkoopLow
            finalInkoopHigh = _tradeResult.inkoopHigh
            finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50
          } else {
            finalHandel = Math.round(finalVerkoop * hwRatio / 50) * 50
            finalBod = finalHandel
            finalInkoopLow = Math.round(finalHandel * 0.85 / 50) * 50
            finalInkoopHigh = Math.round(finalHandel * 0.95 / 50) * 50
            finalInternet = Math.round(finalVerkoop * 1.06 / 50) * 50
          }
          conf += 25  // High confidence when AI provides prices
          console.log(`[AI-FIRST] TIMING: ${Date.now()-_t0}ms`)
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

    // ═══ v10.18.63 BOD-ADJUSTMENTS — config-driven (v10.18.69: model/year_gte/year_lte support) ═══
    {
      const _bodBase = finalBod
      const _matched = matchBodAdjustment({ make: d.make, model: d.model, fuel: d.fuel, km, year: d.year || year })
      if (_matched) {
        finalBod = Math.round(finalBod * _matched.factor / 50) * 50
        const _tag = _matched.id || _matched.tag
        _bodAdjustment = { base: _bodBase, adjusted: finalBod, tag: _tag, factor: _matched.factor }
        console.log("[BOD-ADJ]", d.make, d.model, ":", _tag, "×", _matched.factor, "→ bod", _bodBase, "→", finalBod)
      } else {
        _bodAdjustment = { base: _bodBase, adjusted: finalBod, tag: null, factor: 1.0 }
      }
    }

    // ═══ v10.18.64 SOFT CONFIDENCE-TAG (geen cap, alleen hint) ═══
    const _dataConfidence = deriveDataConfidence(compResult, mCount)
    if (_dataConfidence.level === "low") {
      console.log("[DATA-CONF]", d.make, d.model, ":", _dataConfidence.reasons.join(","))
    }

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

    // ═══ AUTO-SAVE TAXATIE (dataset opbouwen) ═══
    try {
      stmts.saveTaxatie.run({
        kenteken: d.plate || "", make: d.make || "", model: d.model || "",
        model_variant: d.subModel || d.trimLevel || "",
        year, fuel: d.fuel || "", km,
        color: d.color || "", body: d.body || "",
        power_kw: d.powerKw || null, power_hp: d.power || null,
        engine_label: d.engineLabel || "", transmission: d.transmissionType || "",
        catalog_price: d.catalogPrice || null, bpm: d.bpm || null, bpm_rest: d.bpmRest || null,
        market_avg: mAvg || null, market_median: mMedian || null, market_count: mCount || 0,
        p25: p25 || null, p50: mMedian || null, p75: p75 || null,
        verkoopadviees: finalVerkoop, handelswaarde: finalHandel,
        inkoop_low: finalInkoopLow, inkoop_high: finalInkoopHigh,
        internet_prijs: finalInternet,
        reconditie_kosten: 0,
        import_flag: d.importFlag ? 1 : 0, export_flag: 0,
        apk_until: d.apkUntil || "", vin: d.vin || "",
        user_id: _userId, notes: "", status: "auto",
        final_bod: finalBod,
        data_weight: _auditDataWeight,
        comp_status: compResult ? compResult.status : null,
        comp_count: compResult ? compResult.cleanCount : null,
        ai_verkoop: _auditAiVerkoop,
        blend_verkoop: _auditBlendVerkoop,
        bod_adjustment_tag: _bodAdjustment ? _bodAdjustment.tag : null,
        bod_adjustment_factor: _bodAdjustment ? _bodAdjustment.factor : null,
        confidence_level: _dataConfidence ? _dataConfidence.level : null,
        confidence_reasons: (_dataConfidence && _dataConfidence.reasons && _dataConfidence.reasons.length) ? _dataConfidence.reasons.join(",") : null
      })
      console.log("[TAXATIE-SAVE]", d.make, d.model, year, "-> saved")
    } catch(saveErr) { console.log("[TAXATIE-SAVE] Error:", saveErr.message) }

    // Auto-queue model voor crawler (hogere prioriteit)
    try {
      const mk = (d.make||'').toLowerCase(), ml = (d.model||'').toLowerCase().replace(new RegExp('^' + mk + '\s+'), '')
      if (mk && ml) run('INSERT OR IGNORE INTO crawl_queue(make,model,year) VALUES(?,?,?)', [mk, ml, year])
    } catch(eq) {}



    // ═══ NIEUWE SCORING MODULE ═══
    const _qualityScore = calculateQualityScore(d, { marginPct: finalMarginPct, liquidityScore, marketVelocity, riskScore, confidence: conf, marketUsed: mCount > 0, marktCount: mCount })
    const _techniekScore = calculateTechniekScore(d)
    const _courantScore = calculateCourantScore(d, { liquidityScore, marketVelocity, confidence: conf, marketUsed: mCount > 0, marktCount: mCount })
    const _margeScore = calculateMargeScore(d, { marginPct: finalMarginPct, liquidityScore, riskScore })
    const _vergelijkScore = calculateVergelijkScore(d, { confidence: conf, marktCount: mCount })
    const _totalScore = calculateTotalScore(_qualityScore, _techniekScore, _courantScore, _margeScore, _vergelijkScore)
    const _scores = { quality: _qualityScore, techniek: _techniekScore, courant: _courantScore, marge: _margeScore, vergelijk: _vergelijkScore, total: _totalScore }
    const _advice = generateDealerAdvice(_scores, d, { marginPct: finalMarginPct, margin: finalVerkoop - finalBod, marktCount: mCount })

    // Await model-lifecycle (al parallel gestart, hier wachten als nog niet klaar)
    const modelLifecycle = await _lifecyclePromise

    res.json({
      modelLifecycle,
      verkoopadviees: finalVerkoop, handelswaarde: finalHandel,
      inkoopLow: finalInkoopLow, inkoopHigh: finalInkoopHigh,
      internetPrijs: finalInternet, t4cBod: finalBod,
      _bodAdjustment,
      dataConfidence: _dataConfidence,
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
      aiValidation,
      compEngine: compResult,
      confidenceL4: {
        label: confidenceLabel,
        confidence: conf,
        color: conf >= 75 ? 'green' : conf >= 55 ? 'orange' : 'red',
        crossCheckAgree: (compResult ? 1 : 0) + (aiValidation ? 1 : 0),
        crossCheckCount: 2
      },
      // Nieuwe scoring module
      scores: {
        quality: _qualityScore,
        techniek: _techniekScore,
        courant: _courantScore,
        marge: _margeScore,
        vergelijk: _vergelijkScore,
        total: _totalScore,
        advice: _advice
      }
    })
  } catch (e) {
    console.error("[API] dealer/price error:", e.message)
    res.status(500).json({ error: e.message })
  }
})



/* ── v10.18.65 SNELLE TAXATIE (no GPT, alleen marktdata) ── */
router.post("/api/dealer/quick-price", express.json(), async (req, res) => {
  const _t0 = Date.now()
  try {
    let _userId = null
    try { const { verifyToken } = require("../lib/auth"); const t = (req.headers.authorization||"").replace("Bearer ",""); if (t) { const u = verifyToken(t); _userId = u?.uid || null } } catch{}

    const body = req.body || {}
    const kentekenRaw = (body.kenteken || "").toString()
    const kenteken = kentekenRaw.toUpperCase().replace(/[^A-Z0-9]/g, "")
    const km = parseInt(body.km) || 0
    const staat = (body.staat || "").toString().toUpperCase()
    const rijdt = (body.rijdt || "JA").toString().toUpperCase()

    if (!kenteken || kenteken.length < 5) return res.status(400).json({ error: "Ongeldig kenteken" })
    if (staat && !["GOED","NORMAAL","SLECHT","DEFECT"].includes(staat)) return res.status(400).json({ error: "Ongeldige staat" })
    if (!["JA","NEE"].includes(rijdt)) return res.status(400).json({ error: "Ongeldige rijdt-waarde" })

    // 1. RDW + Finnik via /api/vehicle/enriched
    let v
    try {
      const enrichResp = await axios.get("http://localhost:3000/api/vehicle/enriched?plate=" + encodeURIComponent(kenteken) + "&km=" + km, { timeout: 30000 })
      v = enrichResp.data
    } catch (eErr) {
      return res.status(502).json({ error: "Enrichment failed: " + eErr.message })
    }
    if (!v || !v.make) return res.status(404).json({ error: "Kenteken niet gevonden bij RDW" })

    // v10.18.67 — kick off expert price estimate parallel met comp-pipeline
    // v10.18.70 — staat doorgeven zodat expert SLECHT/DEFECT meeneemt in inschatting
    // v10.18.71 — ook rijdt doorgeven; expert krijgt nu volledige user-context
    const _expertPromise = getExpertPriceEstimate({
      make: v.make, model: v.model, year: v.year, km,
      fuel: v.fuel || "", transmission: v.transmissionType || "",
      body: v.body || "", staat, rijdt
    }).catch(() => null)

    // 2. Listings + comp-engine (zelfde patroon als /api/dealer/price)
    const mk = (v.make||"").toLowerCase()
    let ml = (v.model||"").toLowerCase()
    if (ml.startsWith(mk + " ")) ml = ml.slice(mk.length + 1)
    let dbListings = []
    if (mk && ml) {
      try {
        dbListings = queryAll(
          "SELECT title, price, km, source, dealer as sellerType, first_seen, days_on_market, options, transmission, fuel FROM market_listings WHERE make=? AND model LIKE ? AND year BETWEEN ? AND ? AND price > 0 ORDER BY price ASC LIMIT 50",
          [mk, ml + "%", (v.year||2015)-2, (v.year||2015)+2]
        )
      } catch(e) { console.log("[QUICK-PRICE] listings query error:", e.message) }
    }

    let compResult = null
    try {
      if (dbListings.length > 0) {
        const fuelStr = (v.fuel||"").toLowerCase()
        const compTarget = {
          make: v.make||"", model: v.model||"",
          generation: v.generation||"",
          trim: v.trimLevel || v.subModel || "",
          bodyType: v.body||"",
          fuel: fuelStr.includes("diesel") ? "Diesel" : fuelStr.includes("benzine") ? "Benzine" : fuelStr.includes("elektr") ? "Elektrisch" : v.fuel || "",
          transmission: "",
          year: v.year||0, km: km||0,
          powerHp: v.powerKw ? Math.round(v.powerKw * 1.36) : 0,
          isEV: /elektr|electric/i.test(v.fuel||"")
        }
        compResult = buildComparableSet(compTarget, dbListings)
        console.log("[QUICK-COMP]", v.make, v.model, ":", compResult.status, "clean=", compResult.cleanCount, "median=EUR", compResult.marketMedian)
      }
    } catch(compErr) { console.log("[QUICK-PRICE] comp-engine error:", compErr.message) }

    // 3. Base prices
    const compMedian = (compResult && compResult.marketMedian) || 0
    const verkoopMid = compMedian > 0 ? Math.round(compMedian * 0.93 / 50) * 50 : 0
    let verkoopLow = verkoopMid > 0 ? Math.round(verkoopMid * 0.95 / 50) * 50 : 0
    let verkoopHigh = verkoopMid > 0 ? Math.round(verkoopMid * 1.05 / 50) * 50 : 0
    let handelswaarde = verkoopMid > 0 ? Math.round(verkoopMid * 0.85 / 50) * 50 : 0
    let bod = handelswaarde > 0 ? Math.round(handelswaarde * 0.90 / 50) * 50 : 0
    const bodBase = bod

    // 4. Bod-adjustment (v10.18.69: config-driven, was inline Toyota-only in v10.18.65)
    const _bodAdjustment = { tag: null, factor: 1.0, rijdt_correction: 1.0, staat_factor: 1.0 }
    {
      const _matched = matchBodAdjustment({ make: v.make, model: v.model, fuel: v.fuel, km, year: v.year })
      if (_matched) {
        bod = Math.round(bod * _matched.factor / 50) * 50
        _bodAdjustment.tag = _matched.id || _matched.tag
        _bodAdjustment.factor = _matched.factor
        console.log("[QUICK-BOD-ADJ]", v.make, v.model, ":", _bodAdjustment.tag, "×", _matched.factor)
      }
    }

    // v10.18.71 — STAAT_FACTORS multiplier + rijdt×0.50 multiplier zijn VERWIJDERD.
    // User-input (staat/rijdt) gaat nu volledig via expert-context (zie prompt in
    // lib/quick-price-expert.js). Bij SLECHT/DEFECT/NEE forceren we expert_user_context
    // pad hieronder (DEEL B), dus comp wordt overslagen omdat die geen staat/rijdt kent.
    // staat_factor blijft als audit-veld voor backwards-compat (altijd 1.0 vanaf v10.18.71).
    const staatFactor = 1.00
    _bodAdjustment.staat_factor = staatFactor

    // 6. Confidence-tag (zelfde helper als /api/dealer/price)
    const mCount = compResult ? compResult.cleanCount : 0
    const dataConfidence = deriveDataConfidence(compResult, mCount)

    // 7. Staat-flag (geen prijswijziging, alleen confidence reason)
    if (staat === "SLECHT" || staat === "DEFECT") {
      dataConfidence.reasons.push("user_staat_" + staat.toLowerCase())
      dataConfidence.level = "low"
      dataConfidence.message = "Staat " + staat.toLowerCase() + " volgens dealer — controleer bod handmatig"
    }

    // v10.18.67 — await expert estimate (parallel met comp-pipeline)
    const expertEstimate = await _expertPromise

    // Agreement check (alleen wanneer beide aanwezig)
    let priceAgreement = null
    if (expertEstimate && bod > 0) {
      const expertBodMid = (expertEstimate.bod_low + expertEstimate.bod_high) / 2
      const denom = Math.max(bod, expertBodMid)
      const delta = denom > 0 ? Math.abs(bod - expertBodMid) / denom : 0
      if (delta <= 0.30) {
        priceAgreement = { status: "agree", delta_pct: Math.round(delta * 100) }
      } else {
        priceAgreement = {
          status: bod < expertBodMid ? "comp_lower" : "comp_higher",
          delta_pct: Math.round(delta * 100),
          expected_bod_range: { low: expertEstimate.bod_low, high: expertEstimate.bod_high }
        }
      }
    }

    // 8. Fallback bij thin pool — expert override OF bod=null + range
    let bodFinal = bod, bodRange = null, needsReview = false
    let priceSource = "comp"
    const cleanCount = (compResult && compResult.cleanCount) || 0
    const compStatus = compResult ? compResult.status : null
    const thinPool = !compResult || compStatus !== "ok" || cleanCount < 3

    if (thinPool && expertEstimate) {
      // Override met expert (per spec: geen bonus/rijdt-correctie re-toepassing)
      const eVerkoopMid = Math.round((expertEstimate.verkoop_low + expertEstimate.verkoop_high) / 2 / 50) * 50
      verkoopLow = Math.round(expertEstimate.verkoop_low / 50) * 50
      verkoopHigh = Math.round(expertEstimate.verkoop_high / 50) * 50
      // Behoud verkoopMid voor save als nieuw mid
      const eHandel = Math.round(eVerkoopMid * 0.85 / 50) * 50
      handelswaarde = eHandel
      bodFinal = Math.round((expertEstimate.bod_low + expertEstimate.bod_high) / 2 / 50) * 50
      bodRange = null
      needsReview = false
      priceSource = "expert_fallback"
      // verkoopMid moet ook geüpdate worden voor save + response
      // (heroverschrijven lokaal — was eerder const, dus apart bewaren)
    } else if (thinPool) {
      // Geen expert beschikbaar — bestaande cap-fallback (bod=null, range)
      bodFinal = null
      if (compMedian > 0) {
        bodRange = {
          low: Math.round(compMedian * 0.55 / 50) * 50,
          high: Math.round(compMedian * 0.75 / 50) * 50
        }
      }
      needsReview = true
      if (!dataConfidence.reasons.includes("low_comp_count") && !dataConfidence.reasons.some(r => r.startsWith("comp_engine_"))) {
        dataConfidence.reasons.push("needs_review_thin_pool")
        dataConfidence.level = "low"
      }
    }

    // v10.18.68 — auto-override naar expert bij delta > 50%
    // (comp had genoeg data om door cap te komen, maar zit fors af van expert → expert wint)
    if (priceSource === "comp" && priceAgreement && priceAgreement.delta_pct > 50
        && expertEstimate && expertEstimate.bod_low > 0) {
      verkoopLow = Math.round(expertEstimate.verkoop_low / 50) * 50
      verkoopHigh = Math.round(expertEstimate.verkoop_high / 50) * 50
      const eVerkoopMid = Math.round((expertEstimate.verkoop_low + expertEstimate.verkoop_high) / 2 / 50) * 50
      handelswaarde = Math.round(eVerkoopMid * 0.85 / 50) * 50
      bodFinal = Math.round((expertEstimate.bod_low + expertEstimate.bod_high) / 2 / 50) * 50
      bodRange = null
      needsReview = false
      priceSource = "expert_override"
      console.log("[QUICK-OVERRIDE]", v.make, v.model, ": comp_bod=" + bod + " expert_bod_mid=" + bodFinal + " delta=" + priceAgreement.delta_pct + "%")
    }

    // v10.18.71 — Forceer expert-pad bij problematische user-input (staat SLECHT/DEFECT of rijdt NEE).
    // Comp-engine kent geen staat/rijdt context en slaat grof mis op deze cases. Expert kreeg
    // wel de volledige context (zie quick-price-expert.js prompt-bouw) → gebruik expert bod direct.
    const isProblematicInput = staat === "SLECHT" || staat === "DEFECT" || rijdt === "NEE"
    if (isProblematicInput && expertEstimate && expertEstimate.bod_low > 0) {
      verkoopLow = Math.round(expertEstimate.verkoop_low / 50) * 50
      verkoopHigh = Math.round(expertEstimate.verkoop_high / 50) * 50
      const _eVMid = Math.round((expertEstimate.verkoop_low + expertEstimate.verkoop_high) / 2 / 50) * 50
      handelswaarde = Math.round(_eVMid * 0.85 / 50) * 50
      bodFinal = Math.round((expertEstimate.bod_low + expertEstimate.bod_high) / 2 / 50) * 50
      bodRange = null
      needsReview = false
      priceSource = "expert_user_context"
      console.log("[QUICK-USER-CONTEXT]", v.make, v.model, ":", "staat=" + (staat || "-"), "rijdt=" + (rijdt || "-"), "→ bod=" + bodFinal)
    }

    // Geen post-multipliers meer; expert kreeg al staat+rijdt context.
    // verkoopLow/High/handel/bodFinal staan na hun bron (comp of expert) direct correct.

    // Effectieve verkoopMid voor save/response
    const finalVerkoopMid = (priceSource === "expert_fallback" || priceSource === "expert_override" || priceSource === "expert_user_context") && expertEstimate
      ? Math.round((expertEstimate.verkoop_low + expertEstimate.verkoop_high) / 2 / 50) * 50
      : verkoopMid

    // v10.18.69 — bod-adjustment is alleen relevant bij comp-bod; reset wanneer expert overheen ging
    if (priceSource !== "comp" && _bodAdjustment.tag) {
      console.log("[QUICK-BOD-ADJ] cleared (priceSource=" + priceSource + "): was " + _bodAdjustment.tag)
      _bodAdjustment.tag = null
      _bodAdjustment.factor = 1.0
    }

    // 9. Save naar taxaties
    try {
      stmts.saveTaxatie.run({
        kenteken, make: v.make||"", model: v.model||"",
        model_variant: v.trimLevel || "",
        model_platform: v.subModel || null,
        year: v.year, fuel: v.fuel||"", km,
        color: v.color||"", body: v.body||"",
        power_kw: v.powerKw||null, power_hp: v.powerHp||null,
        engine_label: v.engineLabel||"", transmission: v.transmissionType||"",
        catalog_price: v.catalogPrice||null, bpm: v.bpm||null, bpm_rest: v.bpmRest||null,
        market_avg: null, market_median: compMedian||null, market_count: dbListings.length||0,
        p25: null, p50: compMedian||null, p75: null,
        verkoopadviees: finalVerkoopMid||null, handelswaarde: handelswaarde||null,
        inkoop_low: verkoopLow||null, inkoop_high: verkoopHigh||null,
        internet_prijs: null, reconditie_kosten: 0,
        import_flag: v.importFlag ? 1 : 0, export_flag: 0,
        apk_until: v.apkUntil||"", vin: v.vin||"",
        user_id: _userId, notes: "", status: "auto",
        final_bod: bodFinal,
        data_weight: null,
        comp_status: compStatus,
        comp_count: cleanCount,
        ai_verkoop: null, blend_verkoop: null,
        bod_adjustment_tag: _bodAdjustment.tag,
        bod_adjustment_factor: _bodAdjustment.factor,
        staat_factor: staatFactor,
        confidence_level: dataConfidence.level,
        confidence_reasons: (dataConfidence.reasons||[]).join(",") || null,
        user_staat: staat || null,
        user_rijdt: rijdt || null,
        taxatie_type: "snel",
        expert_verkoop_low: expertEstimate ? expertEstimate.verkoop_low : null,
        expert_verkoop_high: expertEstimate ? expertEstimate.verkoop_high : null,
        expert_bod_low: expertEstimate ? expertEstimate.bod_low : null,
        expert_bod_high: expertEstimate ? expertEstimate.bod_high : null,
        expert_reasoning: expertEstimate ? expertEstimate.reasoning : null,
        price_agreement_status: priceAgreement ? priceAgreement.status : null,
        price_agreement_delta_pct: priceAgreement ? priceAgreement.delta_pct : null,
        price_source: priceSource
      })
    } catch(saveErr) { console.log("[QUICK-SAVE] Error:", saveErr.message) }

    res.json({
      voertuig: {
        make: v.make, model: v.model, year: v.year,
        transmission: v.transmissionType || "",
        trim: v.trimLevel || "",
        platform: v.subModel || null,
        km
      },
      verkoop: bodFinal !== null ? { low: verkoopLow, mid: finalVerkoopMid, high: verkoopHigh } : null,
      handelswaarde: bodFinal !== null ? handelswaarde : null,
      bod: bodFinal,
      bodRange,
      needsReview,
      dataConfidence,
      _bodAdjustment,
      priceSource,
      priceAgreement,
      expert_estimate: expertEstimate,
      _userInput: { staat: staat || null, rijdt: rijdt || null },
      _timing_ms: Date.now() - _t0
    })
  } catch (e) {
    console.error("[QUICK-PRICE] Fatal:", e.message)
    res.status(500).json({ error: e.message || "quick-price failed" })
  }
})

/* ── PDF EXPORT (pure Node.js) ── */
const PDFDocument = require("pdfkit")


module.exports = router
