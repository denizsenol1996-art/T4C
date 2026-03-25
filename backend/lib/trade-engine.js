// T4C Trade Engine v3 — gecalibreerd op echte referentieprijzen
const RISKY_ENGINES = ['n47','n57','n55','n20','n63','ea888','ea189','thp','ep6','prince','dsg','dct','puretech','ecoboost 1.0','tce','1.2 tsi','1.4 tsi','cvt']

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
  const isRiskyEngine = RISKY_ENGINES.some(r => engineLabel.includes(r) || motorCode.includes(r) || transDetail.includes(r))

  // STAP 1: Risicopunten (gewogen per ernst)
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

  // STAP 2: Progressieve risico-korting
  // Eerste 5 punten: 1% per punt (licht risico)
  // 5-10 punten: 2% per punt (serieus risico)
  // 10+ punten: 2.5% per punt (gevaarlijk)
  let riskPct = 0
  if (riskPoints <= 5) {
    riskPct = riskPoints * 0.01
  } else if (riskPoints <= 10) {
    riskPct = 5 * 0.01 + (riskPoints - 5) * 0.02
  } else {
    riskPct = 5 * 0.01 + 5 * 0.02 + (riskPoints - 10) * 0.025
  }
  riskPct = Math.min(riskPct, 0.35) // max 35% korting

  // STAP 3: Basis bid ratio per type
  let baseRatio = 0.75
  if (vType === 'A' && sellSpeed === 'snel') baseRatio = 0.77
  else if (vType === 'A') baseRatio = 0.76
  else if (vType === 'B') baseRatio = 0.75
  else if (vType === 'C') baseRatio = 0.70

  const bidRatio = Math.max(baseRatio - riskPct, 0.40)

  // STAP 4: Prijzen
  const maxBid = Math.round(Math.max(retailPrice * bidRatio, 500) / 50) * 50
  const inkoopHigh = maxBid
  const inkoopLow = Math.round(maxBid * 0.90 / 50) * 50
  const hwMarkup = vType === 'A' ? 1.12 : vType === 'B' ? 1.10 : 1.08
  const handelswaarde = Math.round(maxBid * hwMarkup / 50) * 50
  const sellDiscount = sellSpeed === 'snel' ? 0.05 : sellSpeed === 'normaal' ? 0.08 : 0.12
  const expectedSell = Math.round(retailPrice * (1 - sellDiscount))
  const riskLevel = riskPoints >= 8 ? 'hoog' : riskPoints >= 4 ? 'gemiddeld' : 'laag'

  const breakdown = { retailAsk: retailPrice, expectedSell, bidRatio: Math.round(bidRatio * 100), riskPoints: Math.round(riskPoints * 10) / 10, riskPct: Math.round(riskPct * 100), detectedRisks, recon: reconEst, maxBid, riskLevel, vehicleType: vType, sellSpeed }
  console.log('[TRADE-ENGINE] ' + (vehicleData?.make || '?') + ' ' + (vehicleData?.model || '?') + ': Retail ' + retailPrice + ' x ' + Math.round(bidRatio * 100) + '% (risk:' + Math.round(riskPoints*10)/10 + 'pts, -' + Math.round(riskPct*100) + '%) = MaxBid ' + maxBid + ' | Inkoop ' + inkoopLow + '-' + inkoopHigh + ' | HW ' + handelswaarde)

  return { maxBid, inkoopLow, inkoopHigh, handelswaarde, expectedSellPrice: expectedSell, breakdown }
}

module.exports = { calculateTradeBid, RISKY_ENGINES }
