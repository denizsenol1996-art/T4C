// T4C Trade Engine v4 — met EV risico's, Chinese merk correctie, battery degradatie
const RISKY_ENGINES = ['n47','n57','n55','n20','n63','ea888','ea189','thp','ep6','prince','dsg','dct','puretech','ecoboost 1.0','tce','1.2 tsi','1.4 tsi','cvt']
const FAST_DEPRECIATION_EV = ['mg','byd','aiways','xpeng','nio','ora','seres','dfsk','maxus','jac']

function calculateTradeBid(retailPrice, aiData, vehicleData, marketData) {
  if (!retailPrice || retailPrice < 500) return null
  const vType = (aiData?.vehicleType || 'A').toUpperCase()
  const sellSpeed = (aiData?.sellSpeed || 'normaal').toLowerCase()
  const riskFlags = aiData?.riskFlags || []
  const reconEst = aiData?.reconEstimate || 0
  const km = vehicleData?.km || 0
  const age = new Date().getFullYear() - (vehicleData?.year || 2015)
  const isImport = !!vehicleData?.importFlag
  const napOk = vehicleData?.napOk !== false
  const engineLabel = (vehicleData?.engineLabel || '').toLowerCase()
  const motorCode = (vehicleData?.motorCode || '').toLowerCase()
  const transDetail = (vehicleData?.transmissionDetail || '').toLowerCase()
  const fuel = (vehicleData?.fuel || '').toLowerCase()
  const make = (vehicleData?.make || '').toLowerCase()
  const isRiskyEngine = RISKY_ENGINES.some(r => engineLabel.includes(r) || motorCode.includes(r) || transDetail.includes(r))
  const isEV = fuel.includes('elektr') || fuel.includes('electric') || engineLabel.includes('ev') || engineLabel.includes('kwh')
  const isFastDeprecEV = isEV && FAST_DEPRECIATION_EV.includes(make)

  // STAP 1: Risicopunten
  let riskPoints = 0
  const detectedRisks = []
  if (km > 300000) { riskPoints += 3; detectedRisks.push('zeer_hoge_km') }
  else if (km > 200000) { riskPoints += 1.5; detectedRisks.push('hoge_km') }
  if (isImport) { riskPoints += 1; detectedRisks.push('import') }
  if (!napOk) { riskPoints += 3; detectedRisks.push('geen_nap') }
  if (isRiskyEngine) { riskPoints += 2; detectedRisks.push('risicomotor') }
  if (isRiskyEngine && km > 200000) { riskPoints += 3; detectedRisks.push('risicomotor+hoge_km') }
  if (age > 15) { riskPoints += 1.5; detectedRisks.push('oud') }
  else if (age > 12) { riskPoints += 1; detectedRisks.push('ouder') }
  if (sellSpeed === 'langzaam') riskPoints += 1
  if (sellSpeed === 'specialistisch') riskPoints += 2
  if (riskFlags.includes('ex_taxi')) { riskPoints += 3; detectedRisks.push('ex_taxi') }
  if (riskFlags.includes('niet_verzekerd')) { riskPoints += 2; detectedRisks.push('niet_verzekerd') }
  if (riskFlags.includes('veel_eigenaren')) { riskPoints += 1; detectedRisks.push('veel_eigenaren') }
  if (riskFlags.includes('structurele_apk_problemen')) { riskPoints += 1.5; detectedRisks.push('apk_structureel') }
  if (riskFlags.includes('apk_verlopen')) { riskPoints += 1; detectedRisks.push('apk_verlopen') }

  // EV-specifieke risico's
  if (isEV && age >= 4) { riskPoints += 4; detectedRisks.push('ev_batterij_oud') }
  else if (isEV && age >= 2) { riskPoints += 1.5; detectedRisks.push('ev_batterij_verouderd') }
  if (isFastDeprecEV) { riskPoints += 3.5; detectedRisks.push('chinese_ev_snelle_waardedaling') }
  if (isEV && riskFlags.some(f => f.includes('batterij') || f.includes('soh') || f.includes('kWh'))) { riskPoints += 1.5; detectedRisks.push('ev_batterij_onbekend') }

  // STAP 2: Progressieve risico-korting
  let riskPct = 0
  if (riskPoints <= 5) {
    riskPct = riskPoints * 0.01
  } else if (riskPoints <= 10) {
    riskPct = 5 * 0.01 + (riskPoints - 5) * 0.02
  } else {
    riskPct = 5 * 0.01 + 5 * 0.02 + (riskPoints - 10) * 0.025
  }
  riskPct = Math.min(riskPct, 0.35)

  // STAP 3: Basis bid ratio per segment + type
  // Budget auto's hebben lagere inkoop ratio (meer marge nodig)
  // Premium auto's hebben hogere ratio (duurdere auto, minder relatieve marge)
  const seg = (vehicleData?.segment || 'C').toUpperCase()
  let baseRatio = 0.70
  if (seg === 'P' || seg === 'L') {
    baseRatio = vType === 'A' ? 0.78 : vType === 'B' ? 0.75 : 0.70
  } else if (seg === 'B') {
    baseRatio = vType === 'A' ? 0.76 : vType === 'B' ? 0.72 : 0.66
  } else {
    baseRatio = vType === 'A' ? 0.75 : vType === 'B' ? 0.72 : 0.65
  }
  // Hoge km korting — mild, GPT verkoopadviees is al km-gecorrigeerd
  if (km > 300000) baseRatio -= 0.05
  else if (km > 250000) baseRatio -= 0.04
  else if (km > 200000) baseRatio -= 0.03
  else if (km > 150000) baseRatio -= 0.01
  // Lage km bonus
  if (km < 30000) baseRatio += 0.12
  else if (km < 50000) baseRatio += 0.07
  // Sell speed
  if (sellSpeed === 'snel') baseRatio += 0.03
  else if (sellSpeed === 'langzaam') baseRatio -= 0.03

  // EV correctie: oude EV's verkopen structureel onder vraagprijs
  if (isEV && age >= 3) baseRatio -= 0.05
  if (isFastDeprecEV) baseRatio -= 0.05

  const bidRatio = Math.max(baseRatio - riskPct, 0.35)

  // STAP 4: Prijzen
  const maxBid = Math.round(Math.max(retailPrice * bidRatio, 500) / 50) * 50
  const inkoopHigh = maxBid
  const inkoopLow = Math.round(maxBid * 0.90 / 50) * 50
  // Handelswaarde = retail met korting (B2B doorverkoop)
  const hwRatio = vType === 'A' ? 0.88 : vType === 'B' ? 0.85 : 0.82
  const handelswaarde = Math.round(retailPrice * hwRatio / 50) * 50
  const sellDiscount = sellSpeed === 'snel' ? 0.05 : sellSpeed === 'normaal' ? 0.08 : 0.12
  const expectedSell = Math.round(retailPrice * (1 - sellDiscount))
  const riskLevel = riskPoints >= 8 ? 'hoog' : riskPoints >= 4 ? 'gemiddeld' : 'laag'

  const breakdown = { retailAsk: retailPrice, expectedSell, bidRatio: Math.round(bidRatio * 100), riskPoints: Math.round(riskPoints * 10) / 10, riskPct: Math.round(riskPct * 100), detectedRisks, recon: reconEst, maxBid, riskLevel, vehicleType: vType, sellSpeed, isEV, isFastDeprecEV }
  console.log('[TRADE-ENGINE] ' + (vehicleData?.make || '?') + ' ' + (vehicleData?.model || '?') + ': Retail ' + retailPrice + ' x ' + Math.round(bidRatio * 100) + '% (risk:' + Math.round(riskPoints*10)/10 + 'pts, -' + Math.round(riskPct*100) + '%' + (isEV ? ' [EV]' : '') + ') = MaxBid ' + maxBid + ' | Inkoop ' + inkoopLow + '-' + inkoopHigh + ' | HW ' + handelswaarde)

  return { maxBid, inkoopLow, inkoopHigh, handelswaarde, expectedSellPrice: expectedSell, breakdown }
}

module.exports = { calculateTradeBid, RISKY_ENGINES }
