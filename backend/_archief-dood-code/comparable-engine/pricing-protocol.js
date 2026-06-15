// T4C Pricing Protocol — Laag 3 v4 — AI PRIMARY, comp validates
const { detectSegment } = require('./normalize-comparable')
function roundTo50(v) { return Math.round(v / 50) * 50 }
function getBaseMargin(retailVP) {
  if (retailVP >= 40000) return 0.12
  if (retailVP >= 25000) return 0.15
  if (retailVP >= 15000) return 0.20
  if (retailVP >= 8000) return 0.25
  if (retailVP >= 4000) return 0.28
  return 0.32
}
function getKmMargin(km) {
  if (!km || km <= 0) return 0.03
  if (km < 50000) return -0.05
  if (km < 100000) return -0.02
  if (km < 150000) return 0.02
  if (km < 200000) return 0.05
  if (km < 300000) return 0.08
  return 0.12
}
function getAgeMargin(age) {
  if (age < 3) return -0.04
  if (age < 7) return -0.01
  if (age < 10) return 0.02
  if (age < 13) return 0.05
  return 0.07
}
const EV_MARGIN = {
  under2yr:0, range2_4yr:0.04, range4_6yr:0.08, over6yr:0.12,
  chineseBrand:0.05,
  fastDeprecBrands:['mg','byd','aiways','xpeng','nio','ora','seres','dfsk','maxus','jac'],
}
function calculatePricing(compResult, vehicle, aiClass, opts) {
  aiClass = aiClass || {}
  opts = opts || {}
  const make = (vehicle.make || '').toLowerCase()
  const segment = detectSegment(vehicle)
  const age = new Date().getFullYear() - (vehicle.year || 2015)
  const km = vehicle.km || 0
  const isEV = vehicle.isEV || /elektr|electric/i.test(vehicle.fuel || '')
  const isChinese = isEV && EV_MARGIN.fastDeprecBrands.includes(make)
  const vraagToRetail = segment === 'budget' ? 0.92 : 0.93
  const result = { source:null, confidence:0, segment, retailVraag:null, retailVerkoop:null, handelswaarde:null, inkoopLow:null, inkoopHigh:null, internetPrijs:null, dealerMargin:null, corrections:[], breakdown:{} }
  var retailBase = null
  var compMedian = (compResult && compResult.marketMedian > 0) ? compResult.marketMedian : 0
  var compStrong = compResult && compResult.status === 'ok' && compResult.strongCount >= 5
  var compConf = compResult ? (compResult.confidenceComparable || 0) : 0
  if (opts.aiPrice && opts.aiPrice > 500) {
    retailBase = opts.aiPrice
    result.source = 'ai_primary'
    result.confidence = 55
    if (compMedian > 0 && compStrong) {
      retailBase = Math.round(opts.aiPrice * 0.60 + compMedian * 0.40)
      result.source = 'ai_comp_blend'
      result.confidence = Math.min(90, 55 + compConf * 0.3)
      result.corrections.push({ type:'comp_blend', pct:40 })
    } else if (compMedian > 0) {
      var ratio = compMedian / opts.aiPrice
      if (ratio > 0.5 && ratio < 2.0) {
        retailBase = Math.round(opts.aiPrice * 0.80 + compMedian * 0.20)
        result.source = 'ai_comp_light'
        result.confidence += 10
        result.corrections.push({ type:'comp_light', pct:20 })
      }
    }
  } else if (compMedian > 0 && compStrong) {
    retailBase = compMedian
    result.source = 'comp_engine'
    result.confidence = Math.min(85, 40 + compConf * 0.5)
  } else if (compMedian > 0) {
    retailBase = compMedian
    result.source = 'comp_engine_weak'
    result.confidence = 30 + compConf * 0.3
  } else {
    result.source = 'no_data'
    return result
  }
  result.retailVraag = roundTo50(retailBase)
  var retailVP = retailBase * vraagToRetail
  result.retailVerkoop = roundTo50(retailVP)
  var margin = getBaseMargin(retailVP)
  var _kmM = getKmMargin(km)
  var _ageM = getAgeMargin(age)
  // Als AI primair is, heeft GPT km+leeftijd al meegewogen in zijn prijs
  // Dan alleen basis margin + lichte age correctie, geen km margin
  if (result.source === 'ai_primary' || result.source === 'ai_comp_light') {
    margin += _ageM * 0.3
  } else if (result.source === 'ai_comp_blend') {
    margin += _kmM * 0.4 + _ageM * 0.5
  } else {
    margin += _kmM + _ageM * (1 - Math.abs(_kmM))
  }
  var sellSpeed = (aiClass.sellSpeed || 'normaal').toLowerCase()
  if (sellSpeed === 'snel') margin -= 0.03
  else if (sellSpeed === 'langzaam') margin += 0.04
  else if (sellSpeed === 'specialistisch') margin += 0.06
  var vType = (aiClass.vehicleType || 'B').toUpperCase()
  if (vType === 'A') margin -= 0.02
  else if (vType === 'C') margin += 0.04
  var riskFlags = aiClass.riskFlags || []
  if (riskFlags.includes('ex_taxi')) margin += 0.05
  if (riskFlags.includes('veel_eigenaren')) margin += 0.02
  if (riskFlags.includes('niet_verzekerd')) margin += 0.03
  if (riskFlags.includes('apk_verlopen')) margin += 0.02
  if (isEV) {
    if (age <= 2) margin += EV_MARGIN.under2yr
    else if (age <= 4) margin += EV_MARGIN.range2_4yr
    else if (age <= 6) margin += EV_MARGIN.range4_6yr
    else margin += EV_MARGIN.over6yr
    if (isChinese) margin += EV_MARGIN.chineseBrand
  }
  margin = Math.max(0.20, Math.min(0.55, margin))
  result.dealerMargin = Math.round(margin * 100)
  result.inkoopHigh = roundTo50(retailVP * (1 - margin))
  result.inkoopLow = roundTo50(result.inkoopHigh * 0.87)
  var reconEst = aiClass.reconEstimate || 0
  if (reconEst > 0) {
    result.inkoopHigh = roundTo50(result.inkoopHigh - reconEst * 0.5)
    result.inkoopLow = roundTo50(result.inkoopLow - reconEst * 0.7)
    result.corrections.push({ type:'reconditie', amount:-reconEst })
  }
  result.inkoopHigh = Math.max(500, result.inkoopHigh)
  result.inkoopLow = Math.max(300, result.inkoopLow)
  if (result.inkoopLow > result.inkoopHigh) result.inkoopLow = roundTo50(result.inkoopHigh * 0.87)
  result.handelswaarde = roundTo50(retailVP * (1 - margin * 0.55))
  result.internetPrijs = roundTo50(retailVP * 1.06)
  result.confidence = Math.max(0, Math.min(95, Math.round(result.confidence)))
  result.breakdown = { compMedian:compResult?.marketMedian||null, compClean:compResult?.cleanCount||0, compStrong:compResult?.strongCount||0, compSpread:compResult?.marketSpread||null, aiPrice:opts.aiPrice||null, segment, vType, sellSpeed, baseMargin:Math.round(getBaseMargin(retailVP)*100), kmMargin:Math.round(getKmMargin(km)*100), ageMargin:Math.round(getAgeMargin(age)*100), totalMargin:Math.round(margin*100), reconEst, isEV, isChinese }
  console.log('[PRICING-L3] ' + vehicle.make + ' ' + vehicle.model + ': VP EUR' + result.retailVerkoop + ' | HW EUR' + result.handelswaarde + ' | Inkoop EUR' + result.inkoopLow + '-EUR' + result.inkoopHigh + ' | margin=' + result.dealerMargin + '% | conf=' + result.confidence + ' [' + result.source + ']')
  return result
}
module.exports = { calculatePricing, EV_MARGIN }
