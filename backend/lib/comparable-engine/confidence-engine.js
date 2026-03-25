// T4C Confidence Engine — Laag 4
function calculateConfidence(compResult, pricingResult, vehicle, crossChecks) {
  crossChecks = crossChecks || {}
  const scores = [], factors = []
  let total = 0
  const compClean = compResult?.cleanCount || 0
  const compStrong = compResult?.strongCount || 0
  const compSpread = compResult?.marketSpread || 99999
  let compScore = 0
  if (compClean >= 15) compScore += 35; else if (compClean >= 8) compScore += 28; else if (compClean >= 5) compScore += 20; else if (compClean >= 3) compScore += 12; else compScore += 5
  if (compStrong >= 5) compScore += 30; else if (compStrong >= 3) compScore += 22; else if (compStrong >= 1) compScore += 15; else compScore += 5
  if (compSpread < 1000) compScore += 25; else if (compSpread < 2000) compScore += 18; else if (compSpread < 3500) compScore += 10; else compScore += 3
  if (compResult?.status === 'ok') compScore += 10
  compScore = Math.min(100, compScore)
  scores.push({ factor: 'comparable_engine', score: compScore, weight: 40 })
  factors.push(compClean + ' comparables (' + compStrong + ' strong), spread EUR' + compSpread)
  total += compScore * 0.40
  let sourceScore = 0
  const source = pricingResult?.source || 'no_data'
  if (source === 'comp_engine') sourceScore = 85; else if (source === 'comp_engine_weak') sourceScore = 55; else if (source === 'ai_fallback') sourceScore = 35; else sourceScore = 0
  scores.push({ factor: 'pricing_source', score: sourceScore, weight: 25 })
  total += sourceScore * 0.25
  let crossScore = 0, crossCount = 0, crossAgree = 0
  const retailVP = pricingResult?.retailVerkoop || 0
  if (retailVP > 0) {
    if (crossChecks.aiPrice && crossChecks.aiPrice > 0) {
      crossCount++; const d = Math.abs(retailVP - crossChecks.aiPrice) / retailVP
      if (d < 0.08) { crossAgree++; crossScore += 30 } else if (d < 0.15) { crossAgree++; crossScore += 20 } else if (d < 0.25) crossScore += 10
    }
    if (crossChecks.finnikLow && crossChecks.finnikHigh) {
      crossCount++; const m = (crossChecks.finnikLow + crossChecks.finnikHigh) / 2; const d = Math.abs(retailVP - m) / retailVP
      if (d < 0.10) { crossAgree++; crossScore += 25 } else if (d < 0.20) { crossAgree++; crossScore += 15 } else crossScore += 5
    }
    if (crossChecks.as24Low) {
      crossCount++; const m = ((crossChecks.as24Low||0) + (crossChecks.as24High||crossChecks.as24Low)) / 2; const d = Math.abs(retailVP - m) / retailVP
      if (d < 0.10) { crossAgree++; crossScore += 25 } else if (d < 0.20) { crossAgree++; crossScore += 15 } else crossScore += 5
    }
    if (crossChecks.anwbWaarde && crossChecks.anwbWaarde > 0) {
      crossCount++; const d = Math.abs(retailVP - crossChecks.anwbWaarde) / retailVP
      if (d < 0.10) { crossAgree++; crossScore += 20 } else if (d < 0.20) { crossAgree++; crossScore += 10 }
    }
  }
  if (crossCount === 0) { crossScore = 40; factors.push('Geen externe bronnen') } else { crossScore = Math.min(100, Math.round(crossScore / crossCount * (crossCount > 1 ? 1.2 : 1))); factors.push(crossAgree + '/' + crossCount + ' bronnen bevestigen prijs') }
  scores.push({ factor: 'cross_checks', score: crossScore, weight: 20 })
  total += crossScore * 0.20
  let dataScore = 0
  if (vehicle.make) dataScore += 10; if (vehicle.model) dataScore += 10; if (vehicle.year) dataScore += 15
  if (vehicle.km && vehicle.km > 0) dataScore += 20; if (vehicle.fuel) dataScore += 10
  if (vehicle.transmission || vehicle.transmissionType) dataScore += 10
  if (vehicle.body || vehicle.bodyType) dataScore += 5; if (vehicle.generation) dataScore += 10
  if (vehicle.trimLevel || vehicle.trim) dataScore += 5; if (vehicle.powerKw || vehicle.powerHp) dataScore += 5
  dataScore = Math.min(100, dataScore)
  scores.push({ factor: 'data_completeness', score: dataScore, weight: 15 })
  total += dataScore * 0.15
  total = Math.max(0, Math.min(95, Math.round(total)))
  let label, color
  if (total >= 80) { label = 'Zeer betrouwbaar'; color = 'green' }
  else if (total >= 65) { label = 'Betrouwbaar'; color = 'green' }
  else if (total >= 50) { label = 'Redelijke indicatie'; color = 'orange' }
  else if (total >= 35) { label = 'Ruwe schatting'; color = 'orange' }
  else { label = 'Onvoldoende data'; color = 'red' }
  return { confidence: total, label, color, scores, factors, crossCheckCount: crossCount, crossCheckAgree: crossAgree }
}
module.exports = { calculateConfidence }
