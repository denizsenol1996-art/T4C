// T4C Kwaliteitsscore — Dealer-perspectief scoring module
// Basis 5, range 1-10. Gebaseerd op echte data, niet GPT meningen.

const POPULAR_COLORS = ['ZWART', 'WIT', 'GRIJS', 'ZILVER', 'BLAUW', 'ANTRACIET']
const UNPOPULAR_COLORS = ['GEEL', 'ORANJE', 'PAARS', 'ROZE', 'LICHTGROEN']
const POPULAR_BRANDS = ['VOLKSWAGEN','BMW','MERCEDES','MERCEDES-BENZ','AUDI','TOYOTA','KIA','HYUNDAI','SKODA','PEUGEOT','RENAULT','FORD','OPEL','VOLVO','MAZDA','TESLA','SUZUKI','NISSAN','HONDA','SEAT','DACIA','MINI','FIAT','CITROEN','MITSUBISHI']

function calculateQualityScore(v, r) {
  // v = vehicle data (from /api/vehicle/enriched)
  // r = pricing data (from /api/dealer/price)
  let score = 5.0
  const details = []

  // ═══ POSITIEF ═══

  // NL geleverd (niet import)
  if (v.firstAdmission && v.firstAdmissionNL && v.firstAdmission === v.firstAdmissionNL && !v.importFlag) {
    score += 1.0
    details.push({ factor: 'NL geleverd', impact: +1.0, type: 'pos' })
  }

  // Eerste eigenaar (schatting: als datum_tenaamstelling dicht bij eerste toelating ligt)
  if (v.registrationDate && v.firstAdmission) {
    const regYear = parseInt(v.registrationDate.split('-').pop()) || 0
    const firstYear = parseInt(v.firstAdmission.split('-').pop()) || 0
    if (regYear === firstYear && (v.year || 0) >= new Date().getFullYear() - 3) {
      // Recente auto, zelfde jaar als toelating = waarschijnlijk 1e eigenaar
      score += 1.0
      details.push({ factor: 'Waarschijnlijk 1e eigenaar', impact: +1.0, type: 'pos' })
    } else if (regYear > 0 && firstYear > 0 && regYear - firstYear <= 2) {
      score += 0.5
      details.push({ factor: 'Max 2 eigenaren (geschat)', impact: +0.5, type: 'pos' })
    }
  }

  // Eigenaren (als beschikbaar via ownerCount)
  if (v.ownerCount > 0) {
    if (v.ownerCount === 1) {
      // Override schatting hierboven
      const existing = details.findIndex(d => d.factor.includes('eigenaar'))
      if (existing >= 0) { score -= details[existing].impact; details.splice(existing, 1) }
      score += 1.0
      details.push({ factor: '1e eigenaar', impact: +1.0, type: 'pos' })
    } else if (v.ownerCount <= 2) {
      const existing = details.findIndex(d => d.factor.includes('eigenaar'))
      if (existing >= 0) { score -= details[existing].impact; details.splice(existing, 1) }
      score += 0.5
      details.push({ factor: 'Max 2 eigenaren', impact: +0.5, type: 'pos' })
    } else if (v.ownerCount >= 3 && v.ownerCount <= 4) {
      score -= 1.0
      details.push({ factor: v.ownerCount + ' eigenaren', impact: -1.0, type: 'neg' })
    } else if (v.ownerCount >= 5) {
      score -= 2.0
      details.push({ factor: v.ownerCount + ' eigenaren (veel)', impact: -2.0, type: 'neg' })
    }
  }

  // KM onder segment gemiddelde
  const age = new Date().getFullYear() - (v.year || 2015)
  const expectedKm = age * 15000
  const km = v.km || 0
  if (km > 0 && expectedKm > 0) {
    const kmRatio = km / expectedKm
    if (kmRatio < 0.7) {
      score += 1.0
      details.push({ factor: 'Lage km-stand (' + Math.round(kmRatio * 100) + '% van gemiddeld)', impact: +1.0, type: 'pos' })
    } else if (kmRatio > 1.5) {
      score -= 1.0
      details.push({ factor: 'Hoge km-stand (' + Math.round(kmRatio * 100) + '% van gemiddeld)', impact: -1.0, type: 'neg' })
    } else if (kmRatio > 2.0) {
      score -= 2.0
      details.push({ factor: 'Zeer hoge km-stand (' + Math.round(kmRatio * 100) + '% van gemiddeld)', impact: -2.0, type: 'neg' })
    }
  }

  // Aantrekkelijke kleur
  const clr = (v.color || '').toUpperCase()
  if (POPULAR_COLORS.includes(clr)) {
    score += 0.5
    details.push({ factor: 'Populaire kleur (' + v.color + ')', impact: +0.5, type: 'pos' })
  } else if (UNPOPULAR_COLORS.includes(clr)) {
    score -= 0.5
    details.push({ factor: 'Ongewone kleur (' + v.color + ')', impact: -0.5, type: 'neg' })
  }

  // APK clean (geen recente gebreken)
  const defects = v.defects || []
  const recalls = v.recalls || []
  const apkHistory = v.apkHistory || []
  const recentDefects = defects.filter(d => {
    if (!d.date) return false
    const parts = d.date.split('-')
    const yr = parseInt(parts[2] || parts[0]) || 0
    return yr >= new Date().getFullYear() - 1
  })

  if (apkHistory.length >= 2 && recentDefects.length === 0 && recalls.length === 0) {
    score += 1.0
    details.push({ factor: 'Schone APK historie, geen recalls', impact: +1.0, type: 'pos' })
  } else {
    if (recentDefects.length > 3) {
      score -= 0.5
      details.push({ factor: recentDefects.length + ' recente APK gebreken', impact: -0.5, type: 'neg' })
    }
    if (recalls.length > 0) {
      score -= 0.5
      details.push({ factor: recalls.length + ' open terugroepactie(s)', impact: -0.5, type: 'neg' })
    }
  }

  // WAM niet verzekerd — alleen negatief als NIET import en NIET dealer voorraad
  // Dealer voorraad is vaak niet WAM verzekerd, dat is normaal
  if (v.wamInsured === false && !v.importFlag) {
    score -= 0.5
    details.push({ factor: 'Niet WAM verzekerd', impact: -0.5, type: 'neg' })
  }

  // Import
  if (v.importFlag) {
    score -= 1.0
    details.push({ factor: 'Import voertuig', impact: -1.0, type: 'neg' })
  }

  // Geen onderhoudshistorie (weinig APK data voor leeftijd)
  // Import auto's hebben geen NL APK historie — niet dubbel straffen
  if (age > 4 && apkHistory.length <= 1 && !v.importFlag) {
    score -= 1.0
    details.push({ factor: 'Geen onderhoudshistorie (te weinig APK data)', impact: -1.0, type: 'neg' })
  } else if (age > 4 && apkHistory.length <= 1 && v.importFlag) {
    score -= 0.3
    details.push({ factor: 'Import — geen NL onderhoudshistorie', impact: -0.3, type: 'neg' })
  }

  // Clamp
  score = Math.round(Math.max(1, Math.min(10, score)) * 10) / 10

  return { score, details, grade: score >= 8 ? 'A' : score >= 6.5 ? 'B' : score >= 5 ? 'C' : 'D' }
}

function calculateTechniekScore(v) {
  let score = 5.0
  const details = []

  // Engine risk profile (GPT basis, maar we combineren met echte data)
  const risk = (v.engineRiskProfile || '').toLowerCase()
  if (risk === 'laag') { score += 1.5; details.push({ factor: 'Motor: laag risicoprofiel', impact: +1.5, type: 'pos' }) }
  else if (risk === 'hoog') { score -= 2.0; details.push({ factor: 'Motor: hoog risicoprofiel', impact: -2.0, type: 'neg' }) }
  else if (risk === 'gemiddeld') { /* neutraal */ }

  // APK gebreken tellen
  const defects = v.defects || []
  if (defects.length === 0) {
    score += 1.0
    details.push({ factor: 'Geen APK gebreken', impact: +1.0, type: 'pos' })
  } else if (defects.length >= 5) {
    score -= 1.5
    details.push({ factor: defects.length + ' APK gebreken', impact: -1.5, type: 'neg' })
  } else if (defects.length >= 3) {
    score -= 0.5
    details.push({ factor: defects.length + ' APK gebreken', impact: -0.5, type: 'neg' })
  }

  // Open recalls
  const recalls = v.recalls || []
  if (recalls.length > 0) {
    score -= 1.0
    details.push({ factor: recalls.length + ' open terugroepactie(s)', impact: -1.0, type: 'neg' })
  }

  // Leeftijd motor
  const age = new Date().getFullYear() - (v.year || 2015)
  if (age <= 5) { score += 1.0; details.push({ factor: 'Jonge auto (' + age + 'j)', impact: +1.0, type: 'pos' }) }
  else if (age >= 15) { score -= 1.0; details.push({ factor: 'Oud voertuig (' + age + 'j)', impact: -1.0, type: 'neg' }) }

  // Emissieklasse
  const emissie = v.emissieKlasse || v.euroClass || ''
  if (String(emissie).match(/euro\s*[0-3]/i)) {
    score -= 1.0
    details.push({ factor: 'Lage emissieklasse (' + emissie + ')', impact: -1.0, type: 'neg' })
  }

  // KM-verloop anomalie
  if (v.kmAnalysis?.anomaly) {
    score -= 2.0
    details.push({ factor: 'KM terugdraai gedetecteerd', impact: -2.0, type: 'neg' })
  }

  score = Math.round(Math.max(1, Math.min(10, score)) * 10) / 10
  return { score, details }
}

function calculateCourantScore(v, r) {
  let score = 5.0
  const details = []

  // Marktdata beschikbaarheid
  const mCount = r?.marketUsed ? (r?.confidence > 50 ? 1 : 0) : 0
  const listings = v?.marktCount || r?.marktCount || 0

  if (listings >= 20) { score += 2.0; details.push({ factor: listings + ' vergelijkbare listings', impact: +2.0, type: 'pos' }) }
  else if (listings >= 10) { score += 1.5; details.push({ factor: listings + ' vergelijkbare listings', impact: +1.5, type: 'pos' }) }
  else if (listings >= 5) { score += 1.0; details.push({ factor: listings + ' listings gevonden', impact: +1.0, type: 'pos' }) }
  else if (listings === 0) { score -= 1.0; details.push({ factor: 'Geen listings gevonden', impact: -1.0, type: 'neg' }) }

  // Merk populariteit
  const make = (v.make || '').toUpperCase()
  if (POPULAR_BRANDS.includes(make)) {
    score += 1.0
    details.push({ factor: 'Populair merk (' + v.make + ')', impact: +1.0, type: 'pos' })
  }

  // Liquiditeit + velocity uit backend
  const liq = r?.liquidityScore || 50
  const vel = r?.marketVelocity || 40
  if (liq >= 65) { score += 0.5; details.push({ factor: 'Hoge liquiditeit', impact: +0.5, type: 'pos' }) }
  else if (liq < 30) { score -= 1.0; details.push({ factor: 'Lage liquiditeit', impact: -1.0, type: 'neg' }) }

  // Segment: SUV/hatchback verkoopt sneller
  const body = (v.body || '').toLowerCase()
  if (body.includes('suv') || body.includes('hatchback')) {
    score += 0.5
    details.push({ factor: 'Populair type (' + v.body + ')', impact: +0.5, type: 'pos' })
  } else if (body.includes('mpv') || body.includes('cabrio')) {
    score -= 0.5
    details.push({ factor: 'Niche type (' + v.body + ')', impact: -0.5, type: 'neg' })
  }

  // Leeftijd
  const age = new Date().getFullYear() - (v.year || 2015)
  if (age <= 5) { score += 0.5; details.push({ factor: 'Jong (' + age + 'j)', impact: +0.5, type: 'pos' }) }
  else if (age >= 15) { score -= 0.5; details.push({ factor: 'Oud (' + age + 'j)', impact: -0.5, type: 'neg' }) }

  score = Math.round(Math.max(1, Math.min(10, score)) * 10) / 10
  return { score, details }
}

function calculateMargeScore(v, r) {
  let score = 5.0
  const details = []

  // Werkelijke marge
  const marginPct = r?.marginPct || 0
  if (marginPct >= 25) { score += 2.5; details.push({ factor: 'Uitstekende marge (' + marginPct + '%)', impact: +2.5, type: 'pos' }) }
  else if (marginPct >= 18) { score += 2.0; details.push({ factor: 'Goede marge (' + marginPct + '%)', impact: +2.0, type: 'pos' }) }
  else if (marginPct >= 12) { score += 1.0; details.push({ factor: 'Redelijke marge (' + marginPct + '%)', impact: +1.0, type: 'pos' }) }
  else if (marginPct >= 8) { /* neutraal */ }
  else if (marginPct > 0) { score -= 1.0; details.push({ factor: 'Krappe marge (' + marginPct + '%)', impact: -1.0, type: 'neg' }) }
  else { score -= 2.0; details.push({ factor: 'Geen/negatieve marge', impact: -2.0, type: 'neg' }) }

  // Liquiditeit (snel verkopen = minder standkosten)
  const liq = r?.liquidityScore || 50
  if (liq >= 65) { score += 1.0; details.push({ factor: 'Verkoopt snel door', impact: +1.0, type: 'pos' }) }
  else if (liq < 30) { score -= 1.0; details.push({ factor: 'Langzaam verkopend', impact: -1.0, type: 'neg' }) }

  // Risico (hoog risico = onverwachte kosten = marge verdampt)
  const riskScore = r?.riskScore || 50
  if (riskScore <= 30) { score += 0.5; details.push({ factor: 'Laag risico', impact: +0.5, type: 'pos' }) }
  else if (riskScore >= 70) { score -= 1.0; details.push({ factor: 'Hoog risico', impact: -1.0, type: 'neg' }) }

  score = Math.round(Math.max(1, Math.min(10, score)) * 10) / 10
  return { score, details }
}

function calculateVergelijkScore(v, r) {
  let score = 5.0
  const details = []

  // Hoeveel vergelijkingsdata
  const mCount = v?.marktCount || 0
  if (mCount >= 20) { score += 2.0; details.push({ factor: mCount + ' vergelijkbare auto\'s', impact: +2.0, type: 'pos' }) }
  else if (mCount >= 10) { score += 1.5; details.push({ factor: mCount + ' vergelijkbare auto\'s', impact: +1.5, type: 'pos' }) }
  else if (mCount >= 5) { score += 1.0; details.push({ factor: mCount + ' listings', impact: +1.0, type: 'pos' }) }
  else if (mCount === 0) { score -= 2.0; details.push({ factor: 'Geen marktdata', impact: -2.0, type: 'neg' }) }

  // Externe bronnen beschikbaar
  let bronnen = 0
  if (v.as24Waarde) { bronnen++; score += 0.5 }
  if (v.anwbWaarde) { bronnen++; score += 0.5 }
  if (v.finnikData) { bronnen++; score += 0.5 }
  if (bronnen >= 2) details.push({ factor: bronnen + ' externe bronnen', impact: bronnen * 0.5, type: 'pos' })
  else if (bronnen === 0) details.push({ factor: 'Geen externe bronnen', impact: 0, type: 'neutral' })

  // Confidence uit backend
  const conf = r?.confidence || 50
  if (conf >= 75) { score += 0.5; details.push({ factor: 'Hoge betrouwbaarheid', impact: +0.5, type: 'pos' }) }
  else if (conf < 40) { score -= 1.0; details.push({ factor: 'Lage betrouwbaarheid', impact: -1.0, type: 'neg' }) }

  score = Math.round(Math.max(1, Math.min(10, score)) * 10) / 10
  return { score, details }
}

// ═══ TOTAALSCORE — de "porno de la creme" detector ═══
function calculateTotalScore(quality, techniek, courant, marge, vergelijk) {
  const total = Math.round((quality.score * 0.30 + techniek.score * 0.20 + courant.score * 0.20 + marge.score * 0.20 + vergelijk.score * 0.10) * 10) / 10
  let verdict = 'Niet aantrekkelijk'
  if (total >= 8.5) verdict = 'Topexemplaar — vol inzetten'
  else if (total >= 7.5) verdict = 'Zeer interessant — stevig bieden'
  else if (total >= 6.5) verdict = 'Interessant — marktconform bieden'
  else if (total >= 5.0) verdict = 'Gemiddeld — voorzichtig bieden'
  else if (total >= 3.5) verdict = 'Onder gemiddeld — alleen bij scherpe prijs'

  return { total, verdict, grade: total >= 8 ? 'A+' : total >= 7 ? 'A' : total >= 6 ? 'B' : total >= 5 ? 'C' : 'D' }
}

module.exports = { calculateQualityScore, calculateTechniekScore, calculateCourantScore, calculateMargeScore, calculateVergelijkScore, calculateTotalScore }
