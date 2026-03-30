/**
 * T4C Smart Sold Estimator + RDW Extra Data
 * 
 * 1. Vervangt de platte price*0.92 met een data-driven schatting
 * 2. Haalt extra RDW datasets op (tenaamstellingen, APK gebreken, terugroepacties)
 * 3. Price velocity analyzer — prijsdalingen als signaal
 */

const axios = require("axios")

// ══════════════════════════════════════════════
// 1. SMART SOLD ESTIMATOR
// ══════════════════════════════════════════════
// Vervangt: sold_estimate = price * 0.92
// Gebruikt: days_on_market, price_changes, segment, seller type
//
// Logica:
// - Korter online = dichter bij vraagprijs verkocht (1-14 dagen → 97%)
// - Langer online = meer onderhandeld (60+ dagen → 85-88%)
// - Prijsverlagingen = de LAATSTE prijs is het echte verkooppunt
// - Dealer verkoopt dichter bij vraagprijs dan particulier
// - Premium segment onderhandelt minder dan budget

function estimateSoldPrice(listing) {
  const price = listing.price || listing.last_price || 0
  if (!price || price < 500) return 0
  
  const dom = listing.days_on_market || 30 // days on market
  const changes = listing.price_changes || 0
  const firstPrice = listing.first_price || price
  const lastPrice = listing.last_price || price
  const dealer = (listing.dealer || "").toLowerCase()
  const make = (listing.make || "").toLowerCase()
  
  // Basis: hoe lang stond ie online?
  let daysDiscount
  if (dom <= 7)       daysDiscount = 0.98  // Snel verkocht, bijna vraagprijs
  else if (dom <= 14) daysDiscount = 0.96
  else if (dom <= 21) daysDiscount = 0.94
  else if (dom <= 30) daysDiscount = 0.92
  else if (dom <= 45) daysDiscount = 0.90
  else if (dom <= 60) daysDiscount = 0.88
  else if (dom <= 90) daysDiscount = 0.85
  else                daysDiscount = 0.82  // 90+ dagen = flinke korting
  
  // Als er prijsverlagingen waren, gebruik de trend
  let priceDropFactor = 1.0
  if (changes > 0 && firstPrice > lastPrice) {
    // De verkoper heeft al korting gegeven — de markt sprak
    const dropPct = (firstPrice - lastPrice) / firstPrice
    // De verkoper gaf X% korting, de koper onderhandelde nog ~3-5% extra
    priceDropFactor = 0.97 // Nog 3% extra na de laatste prijsverlaging
  }
  
  // Dealer vs particulier
  let sellerFactor = 1.0
  const isDealerSource = dealer.length > 2 || /automotive|autobedrijf|bv|b\.v\.|group|cars|bovag/i.test(dealer)
  if (isDealerSource) {
    sellerFactor = 1.02 // Dealers verkopen 2% dichter bij vraagprijs (minder onderhandeling)
  } else {
    sellerFactor = 0.97 // Particulier geeft meer weg
  }
  
  // Premium segment: minder korting (koper is minder prijsgevoelig)
  let segmentFactor = 1.0
  const premium = ["bmw", "mercedes", "mercedes-benz", "audi", "volvo", "lexus", "porsche", "jaguar", "land rover", "tesla"]
  const budget = ["dacia", "suzuki", "fiat", "seat", "kia", "hyundai", "mg"]
  if (premium.includes(make)) segmentFactor = 1.02
  else if (budget.includes(make)) segmentFactor = 0.98
  
  // Gebruik de LAATSTE bekende prijs als basis (niet de eerste)
  const basePrice = lastPrice || price
  const estimate = Math.round(basePrice * daysDiscount * priceDropFactor * sellerFactor * segmentFactor)
  
  return Math.max(estimate, 200)
}

// Batch: herbereken alle sold_estimates in de database
function recalculateSoldEstimates(queryAll, run) {
  const sold = queryAll("SELECT id, price, last_price, first_price, days_on_market, price_changes, dealer, make FROM market_listings WHERE status='sold'")
  let updated = 0
  for (const listing of sold) {
    const newEstimate = estimateSoldPrice(listing)
    if (newEstimate && newEstimate !== listing.sold_estimate) {
      run("UPDATE market_listings SET sold_estimate=? WHERE id=?", [newEstimate, listing.id])
      updated++
    }
  }
  console.log(`[SOLD-EST] Herberekend: ${updated}/${sold.length} listings`)
  return updated
}


// ══════════════════════════════════════════════
// 2. PRICE VELOCITY ANALYZER
// ══════════════════════════════════════════════
// Kijkt naar prijsdalingen in price_history als signaal
// Auto die van €15k naar €12k zakt → echte waarde is ~€12k

function analyzePriceVelocity(queryAll, make, model, year) {
  try {
    // Haal price_history op voor dit model
    const history = queryAll(
      "SELECT listing_hash, price, previous_price, recorded_at FROM price_history WHERE make=? AND model LIKE ? AND year=? ORDER BY recorded_at DESC LIMIT 200",
      [make.toLowerCase(), model.toLowerCase() + "%", year]
    )
    
    if (history.length < 3) return null
    
    // Groepeer per listing
    const byListing = {}
    for (const h of history) {
      if (!byListing[h.listing_hash]) byListing[h.listing_hash] = []
      byListing[h.listing_hash].push(h)
    }
    
    let totalDropPct = 0
    let dropCount = 0
    let avgDaysToFirstDrop = 0
    const finalPrices = [] // Laatste bekende prijs per listing
    
    for (const [hash, entries] of Object.entries(byListing)) {
      entries.sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
      
      // Laatste prijs = meest realistische marktprijs
      const lastEntry = entries[entries.length - 1]
      if (lastEntry.price > 500) finalPrices.push(lastEntry.price)
      
      // Bereken totale daling per listing
      for (const e of entries) {
        if (e.previous_price && e.price < e.previous_price) {
          const drop = (e.previous_price - e.price) / e.previous_price
          totalDropPct += drop
          dropCount++
        }
      }
    }
    
    finalPrices.sort((a, b) => a - b)
    
    return {
      listingsTracked: Object.keys(byListing).length,
      priceChanges: history.length,
      avgDropPct: dropCount > 0 ? Math.round((totalDropPct / dropCount) * 1000) / 10 : 0,
      dropCount,
      // Dit is de key metric: waar eindigen prijzen na onderhandeling?
      finalMedian: finalPrices.length > 0 ? finalPrices[Math.floor(finalPrices.length / 2)] : null,
      finalLow: finalPrices[0] || null,
      finalHigh: finalPrices[finalPrices.length - 1] || null,
      finalCount: finalPrices.length,
      // Hoe snel dalen prijzen? (indicator van oververhitte markt)
      velocityLabel: dropCount === 0 ? "stabiel" :
        (totalDropPct / dropCount) > 0.10 ? "snel dalend" :
        (totalDropPct / dropCount) > 0.05 ? "geleidelijk dalend" : "licht dalend"
    }
  } catch (e) {
    console.error("[PRICE-VEL] Error:", e.message)
    return null
  }
}


// ══════════════════════════════════════════════
// 3. RDW EXTRA DATASETS
// ══════════════════════════════════════════════

const RDW_BASE = "https://opendata.rdw.nl/resource"

// 3a. Tenaamstellingen — hoe vaak wisselt dit model van eigenaar?
// Dataset: 3huj-srit (tenaamstellingen tijdvak)
async function getRDWTenaamstellingen(plate) {
  try {
    const cleanPlate = plate.replace(/[\s-]/g, "").toUpperCase()
    const resp = await axios.get(`${RDW_BASE}/3huj-srit.json`, {
      params: { kenteken: cleanPlate, "$limit": 50, "$order": "datum_tenaamstelling DESC" },
      timeout: 10000
    })
    
    if (!resp.data?.length) return null
    
    const records = resp.data
    const eigenaarCount = records.length
    
    // Bereken gemiddelde bezitsduur
    let totalDays = 0
    let transitions = 0
    for (let i = 1; i < records.length; i++) {
      const d1 = new Date(records[i - 1].datum_tenaamstelling)
      const d2 = new Date(records[i].datum_tenaamstelling)
      const days = Math.abs(d1 - d2) / 86400000
      if (days > 0 && days < 10000) {
        totalDays += days
        transitions++
      }
    }
    
    const avgOwnershipDays = transitions > 0 ? Math.round(totalDays / transitions) : null
    const avgOwnershipYears = avgOwnershipDays ? Math.round(avgOwnershipDays / 365 * 10) / 10 : null
    
    // Risico-indicator: veel eigenaren in korte tijd = probleem-auto
    let riskLabel = "normaal"
    if (eigenaarCount >= 6 && avgOwnershipYears && avgOwnershipYears < 1.5) riskLabel = "hoog_verloop"
    else if (eigenaarCount >= 4 && avgOwnershipYears && avgOwnershipYears < 2) riskLabel = "veel_eigenaren"
    else if (eigenaarCount <= 2) riskLabel = "weinig_eigenaren"
    
    return {
      eigenaarCount,
      avgOwnershipDays,
      avgOwnershipYears,
      riskLabel,
      lastChange: records[0]?.datum_tenaamstelling || null,
      records: records.slice(0, 10).map(r => ({
        datum: r.datum_tenaamstelling,
        soort: r.soort_tenaamstelling_omschrijving || r.soort_tenaamstelling || ""
      }))
    }
  } catch { return null }
}

// 3b. APK Gebreken — welke problemen komen voor bij dit model?
// Dataset: t49b-isb7 (geconstateerde_gebreken)
async function getRDWGebreken(plate) {
  try {
    const cleanPlate = plate.replace(/[\s-]/g, "").toUpperCase()
    const resp = await axios.get(`${RDW_BASE}/t49b-isb7.json`, {
      params: { kenteken: cleanPlate, "$limit": 100, "$order": "meld_datum_door_keuringsinstantie DESC" },
      timeout: 10000
    })
    
    if (!resp.data?.length) return null
    
    const gebreken = resp.data
    
    // Categoriseer gebreken
    const categories = {}
    let ernstCount = { advies: 0, reparatie: 0, afkeur: 0 }
    
    for (const g of gebreken) {
      const cat = g.gebrek_identificatie || g.soort_gebrek_omschrijving || "overig"
      if (!categories[cat]) categories[cat] = 0
      categories[cat]++
      
      const ernst = (g.soort_gebrek_omschrijving || "").toLowerCase()
      if (ernst.includes("afkeur") || ernst.includes("afwijzing")) ernstCount.afkeur++
      else if (ernst.includes("reparatie") || ernst.includes("herstel")) ernstCount.reparatie++
      else ernstCount.advies++
    }
    
    // Sorteer categorieën op frequentie
    const topGebreken = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([naam, count]) => ({ naam, count }))
    
    return {
      totaal: gebreken.length,
      ernst: ernstCount,
      topGebreken,
      riskScore: ernstCount.afkeur * 3 + ernstCount.reparatie * 1.5 + ernstCount.advies * 0.5,
      lastApk: gebreken[0]?.meld_datum_door_keuringsinstantie || null
    }
  } catch { return null }
}

// 3c. Terugroepacties — open recalls
// Dataset: t49b-isb7 or af-check via RDW
async function getRDWRecalls(plate) {
  try {
    const cleanPlate = plate.replace(/[\s-]/g, "").toUpperCase()
    const resp = await axios.get(`${RDW_BASE}/j9yg-7rg9.json`, {
      params: { kenteken: cleanPlate, "$limit": 50 },
      timeout: 10000
    })
    
    if (!resp.data?.length) return null
    
    return {
      count: resp.data.length,
      recalls: resp.data.map(r => ({
        code: r.referentiecode_rdw || "",
        omschrijving: r.omschrijving_gebrek || r.code_gebrek || "",
        status: r.status || "",
        datum: r.meld_datum_door_keuringsinstantie || ""
      }))
    }
  } catch { return null }
}

// 3d. Model-niveau statistieken — hoeveel van dit model zijn er in NL?
// Geaggregeerd via de basis-dataset
async function getRDWModelStats(make, model) {
  try {
    const mk = make.toUpperCase()
    // Query: hoeveel actieve kentekens van dit merk+model?
    const resp = await axios.get(`${RDW_BASE}/m9d7-ebf2.json`, {
      params: {
        merk: mk,
        "$select": "datum_eerste_toelating, vervaldatum_apk",
        "$where": `handelsbenaming LIKE '%${model.toUpperCase().replace(/'/g, "''")}%'`,
        "$limit": 500,
        "$order": "datum_eerste_toelating DESC"
      },
      timeout: 15000
    })
    
    if (!resp.data?.length) return null
    
    const records = resp.data
    const now = new Date()
    
    // Verdeling per jaar
    const yearDist = {}
    let activeApk = 0
    
    for (const r of records) {
      const year = r.datum_eerste_toelating?.substring(0, 4)
      if (year) {
        if (!yearDist[year]) yearDist[year] = 0
        yearDist[year]++
      }
      // APK nog geldig = actief op de weg
      if (r.vervaldatum_apk) {
        const apkDate = new Date(r.vervaldatum_apk.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"))
        if (apkDate > now) activeApk++
      }
    }
    
    return {
      totalFound: records.length,
      activeApk,
      activePct: records.length > 0 ? Math.round(activeApk / records.length * 100) : 0,
      yearDistribution: yearDist,
      // Liquiditeit: meer exemplaren = makkelijker verkoopbaar
      liquidityLabel: records.length > 100 ? "hoog" : records.length > 30 ? "normaal" : records.length > 10 ? "beperkt" : "schaars",
      note: `${records.length} exemplaren gevonden (max 500 opgehaald)`
    }
  } catch { return null }
}


// ══════════════════════════════════════════════
// MASTER: Alle RDW extra data parallel
// ══════════════════════════════════════════════
async function getRDWExtraData(plate, make, model) {
  const start = Date.now()
  
  const [tenaam, gebreken, recalls, modelStats] = await Promise.allSettled([
    getRDWTenaamstellingen(plate),
    getRDWGebreken(plate),
    getRDWRecalls(plate),
    make && model ? getRDWModelStats(make, model) : null
  ])
  
  const result = {
    tenaamstellingen: tenaam.status === "fulfilled" ? tenaam.value : null,
    gebreken: gebreken.status === "fulfilled" ? gebreken.value : null,
    recalls: recalls.status === "fulfilled" ? recalls.value : null,
    modelStats: modelStats.status === "fulfilled" ? modelStats.value : null,
    ms: Date.now() - start
  }
  
  // Bereken een overall risk score
  let riskScore = 0
  if (result.tenaamstellingen?.riskLabel === "hoog_verloop") riskScore += 3
  else if (result.tenaamstellingen?.riskLabel === "veel_eigenaren") riskScore += 1.5
  if (result.gebreken?.riskScore > 10) riskScore += 3
  else if (result.gebreken?.riskScore > 5) riskScore += 1.5
  if (result.recalls?.count > 0) riskScore += 1
  
  result.overallRisk = riskScore >= 5 ? "hoog" : riskScore >= 2.5 ? "gemiddeld" : "laag"
  result.riskScore = riskScore
  
  const parts = [
    result.tenaamstellingen ? `tenaam:${result.tenaamstellingen.eigenaarCount}` : null,
    result.gebreken ? `gebreken:${result.gebreken.totaal}` : null,
    result.recalls ? `recalls:${result.recalls.count}` : null,
    result.modelStats ? `model:${result.modelStats.totalFound}x` : null,
  ].filter(Boolean).join(", ")
  
  console.log(`[RDW-EXTRA] ${plate}: ${parts} | risk=${result.overallRisk} (${Date.now()-start}ms)`)
  
  return result
}


// ══════════════════════════════════════════════
// 4. FEEDBACK-GEWOGEN SOLD SCHATTING
// ══════════════════════════════════════════════
// Gebruikt dealer_feedback tabel om sold_estimate te verbeteren
function getFeedbackAdjustment(queryAll, make, model, year) {
  try {
    const JURGEN_ID = 3  // Jurgen = leidend, weging 3x
    const allFeedback = queryAll(
      "SELECT make, model, year, our_bod, sold_price, feedback FROM dealer_feedback WHERE sold_price > 0 AND our_bod > 0"
    )
    
    if (allFeedback.length < 2) return null
    
    // Parse feedback JSON
    const parsed = allFeedback.map(f => {
      let userId = 0, segment = "midden"
      try {
        const fb = typeof f.feedback === "string" ? JSON.parse(f.feedback) : f.feedback
        userId = fb?.user_id || 0
        segment = fb?.segment || "midden"
      } catch {}
      return { ...f, userId, segment }
    }).filter(f => f.our_bod > 0 && f.sold_price > 0)
    
    if (parsed.length < 2) return null
    
    // Bepaal segment
    const makeU = (make || "").toUpperCase()
    let currentSegment = "midden"
    if (["BMW","MERCEDES","MERCEDES-BENZ","AUDI","VOLVO","LEXUS","JAGUAR","PORSCHE","LAND ROVER","TESLA","ALFA ROMEO"].includes(makeU)) currentSegment = "premium"
    else if (["DACIA","SUZUKI","FIAT","SEAT","KIA","HYUNDAI","MG"].includes(makeU)) currentSegment = "budget"
    
    // Filter op segment
    const segmentData = parsed.filter(f => f.segment === currentSegment)
    const useData = segmentData.length >= 2 ? segmentData : parsed
    const source = segmentData.length >= 2 ? "segment:" + currentSegment : "all"
    
    // Gewogen correctie: Jurgen telt 3x, anderen 1x
    // Vergelijking: sold_price (wat dealer betaalde) vs our_bod (wat systeem zei)
    let totalDiff = 0
    let totalWeight = 0
    const details = []
    
    for (const f of useData) {
      const weight = f.userId === JURGEN_ID ? 3 : 1
      const diffPct = (f.sold_price - f.our_bod) / f.our_bod
      totalDiff += diffPct * weight
      totalWeight += weight
      details.push({
        auto: f.make + " " + f.model,
        systeemBod: f.our_bod,
        dealerBod: f.sold_price,
        verschilPct: Math.round(diffPct * 100),
        isJurgen: f.userId === JURGEN_ID,
        weight
      })
    }
    
    if (totalWeight === 0) return null
    const avgDiffPct = totalDiff / totalWeight
    
    // Correctie: begrensd op -15% tot +25%
    const adjustment = Math.max(-0.15, Math.min(0.25, avgDiffPct))
    const jurgenCount = useData.filter(f => f.userId === JURGEN_ID).length
    
    return {
      adjustment: Math.round(adjustment * 1000) / 1000,
      avgVerschilPct: Math.round(avgDiffPct * 100),
      source,
      sampleSize: useData.length,
      jurgenCount,
      note: adjustment > 0.02
        ? "Systeem biedt " + Math.round(avgDiffPct*100) + "% te laag vs dealer-ervaring — bod +" + Math.round(adjustment*100) + "% omhoog"
        : adjustment < -0.02
        ? "Systeem biedt te hoog — bod " + Math.round(adjustment*100) + "%"
        : "Systeem in lijn met dealer-ervaring",
      details: details.slice(0, 5)
    }
  } catch { return null }
}


module.exports = {
  // Smart sold estimator
  estimateSoldPrice,
  recalculateSoldEstimates,
  
  // Price velocity
  analyzePriceVelocity,
  
  // RDW extra
  getRDWTenaamstellingen,
  getRDWGebreken,
  getRDWRecalls,
  getRDWModelStats,
  getRDWExtraData,
  
  // Feedback
  getFeedbackAdjustment
}
