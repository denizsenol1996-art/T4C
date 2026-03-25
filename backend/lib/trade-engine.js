// T4C Trade Engine v2 — deterministische biedmachine
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

  let askToSellPct = 0.08
  if (sellSpeed === 'langzaam') askToSellPct = 0.12
  if (sellSpeed === 'specialistisch') askToSellPct = 0.15
  if (vType === 'C') askToSellPct = Math.max(askToSellPct, 0.12)
  const expectedSell = Math.round(retailPrice * (1 - askToSellPct))

  const recon = Math.max(reconEst || 300, 300)
  const salesCosts = Math.max(Math.round(expectedSell * 0.04), 400)

  let marginPct = 0.12
  if (vType === 'A' && sellSpeed === 'snel') marginPct = 0.10
  if (vType === 'C') marginPct = 0.15
  if (sellSpeed === 'specialistisch') marginPct = Math.max(marginPct, 0.18)
  const margin = Math.round(expectedSell * marginPct)

  let riskPct = 0.02
  if (km > 200000) riskPct += 0.03
  if (km > 300000) riskPct += 0.03
  if (isImport) riskPct += 0.03
  if (!napOk) riskPct += 0.04
  if (isRiskyEngine) riskPct += 0.04
  if (isRiskyEngine && km > 200000) riskPct += 0.03
  if (age > 12) riskPct += 0.02
  if (sellSpeed === 'langzaam' || sellSpeed === 'specialistisch') riskPct += 0.02
  if (riskFlags.includes('ex_taxi')) riskPct += 0.05
  if (riskFlags.includes('apk_verlopen')) riskPct += 0.02
  if (riskFlags.includes('structurele_apk_problemen')) riskPct += 0.03
  if (riskFlags.includes('recalls_open')) riskPct += 0.02
  if (riskFlags.includes('niet_verzekerd')) riskPct += 0.03
  if (riskFlags.includes('veel_eigenaren')) riskPct += 0.02
  const riskCount = riskFlags.length
  if (riskCount >= 5) riskPct += 0.05
  else if (riskCount >= 4) riskPct += 0.03
  riskPct = Math.min(riskPct, 0.30)
  const riskBuffer = Math.round(expectedSell * riskPct)

  const totalDeductions = salesCosts + recon + margin + riskBuffer
  const maxBid = Math.round(Math.max(expectedSell - totalDeductions, 500) / 50) * 50
  const inkoopHigh = maxBid
  const inkoopLow = Math.round(maxBid * 0.90 / 50) * 50
  const handelswaarde = Math.round((maxBid + margin * 0.5) / 50) * 50
  const riskLevel = riskPct >= 0.20 ? 'hoog' : riskPct >= 0.10 ? 'gemiddeld' : 'laag'

  const breakdown = { retailAsk: retailPrice, expectedSell, askToSellPct: Math.round(askToSellPct * 100), salesCosts, recon, margin, marginPct: Math.round(marginPct * 100), riskBuffer, riskPct: Math.round(riskPct * 100), riskCount, totalDeductions, maxBid, riskLevel }
  console.log('[TRADE-ENGINE] ' + (vehicleData?.make||'?') + ' ' + (vehicleData?.model||'?') + ': Retail ' + retailPrice + ' -> Sell ' + expectedSell + ' - ' + totalDeductions + ' (sales:' + salesCosts + ' recon:' + recon + ' margin:' + margin + ' risk:' + riskBuffer + '[' + Math.round(riskPct*100) + '%]) = MaxBid ' + maxBid + ' | HW ' + handelswaarde)

  return { maxBid, inkoopLow, inkoopHigh, handelswaarde, expectedSellPrice: expectedSell, breakdown }
}

module.exports = { calculateTradeBid, RISKY_ENGINES }
