// T4C Pricing Engine
const { stmts, queryAll, queryOne, run } = require("../db")
const path = require("path")

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



// ═══ KM CORRECTIE — dealer breakpoints ═══
// Referentie = 100.000 km (factor 1.0)
function kmCorrection(km) {
  if (!km || km <= 0) return { factor: 1.0, label: 'onbekend', export: false }
  const points = [
    [10000, 1.15, 'bijna nieuw'], [30000, 1.10, 'jong gebruikt'],
    [60000, 1.05, 'sweet spot'], [100000, 1.00, 'standaard'],
    [120000, 0.97, 'prima occasion'], [150000, 0.92, 'hoger km'],
    [180000, 0.85, 'garantie lastig'], [225000, 0.75, 'minder interessant'],
    [300000, 0.60, 'export/budget'], [999999, 0.50, 'export']
  ]
  let prevKm = 0, prevFactor = 1.20
  for (const [maxKm, factor, label] of points) {
    if (km <= maxKm) {
      const range = maxKm - prevKm
      const pos = (km - prevKm) / range
      const interpolated = prevFactor + (factor - prevFactor) * pos
      return { factor: Math.round(interpolated * 1000) / 1000, label, export: km >= 300000 }
    }
    prevKm = maxKm; prevFactor = factor
  }
  return { factor: 0.50, label: 'export', export: true }
}

module.exports = { kmCorrection, recordTaxatie, learn, getLearned, getSeasonFactor, loadHist, getDepreciation, getMarketPressure, normalizeKm, generateInsights }
