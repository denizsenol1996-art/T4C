// T4C Comparable Engine — Step 7: Normalization
// Adjusts each comparable's price to match the target vehicle's specs

const SEGMENT_CONFIG = {
  premium: { kmRate: 0.035, yearRate: 600, transAdj: 1500 },
  mid:     { kmRate: 0.030, yearRate: 500, transAdj: 1000 },
  budget:  { kmRate: 0.025, yearRate: 400, transAdj: 500 },
}

/**
 * Determine segment from target vehicle data.
 */
function detectSegment(target) {
  const make = (target.make || '').toLowerCase()
  const premium = ['mercedes','bmw','audi','porsche','lexus','jaguar','land rover','volvo','alfa romeo','maserati','tesla','mini']
  const budget = ['dacia','suzuki','fiat','seat','skoda','kia','hyundai','mg','byd','citroen','peugeot','renault','opel','ford']

  if (premium.some(m => make.includes(m))) return 'premium'
  if (budget.some(m => make.includes(m))) return 'budget'
  return 'mid'
}

function roundTo50(v) {
  return Math.round(v / 50) * 50
}

/**
 * Normalize a comparable's price to match the target vehicle.
 * Returns the normalized price.
 */
function normalizeComparable(target, listing) {
  const segment = detectSegment(target)
  const cfg = SEGMENT_CONFIG[segment]
  let adjustments = 0

  // ── KM adjustment ──
  if (target.km && listing.km && target.km > 0 && listing.km > 0) {
    // If target has MORE km than comp, target is worth LESS → normalize price DOWN
    // If target has LESS km than comp, target is worth MORE → normalize price UP
    const delta = listing.km - target.km  // positive = comp has more km = comp is worth less
    let kmAdj = delta * cfg.kmRate
    // Cap at ±2500
    kmAdj = Math.max(-2500, Math.min(2500, kmAdj))
    adjustments += roundTo50(kmAdj)
  }

  // ── Year adjustment ──
  if (target.year && listing.year) {
    // delta = target year - comparable year
    // positive delta = target is NEWER = comparable is worth less = adjust up
    const delta = target.year - listing.year
    let yearAdj = delta * cfg.yearRate
    // Cap at ±3000
    yearAdj = Math.max(-3000, Math.min(3000, yearAdj))
    adjustments += roundTo50(yearAdj)
  }

  // ── Trim adjustment ──
  const targetTrim = target._features?.trimLevel || null
  const listingTrim = listing._features?.trimLevel || null
  if (targetTrim && listingTrim && targetTrim !== listingTrim) {
    const levels = { premium: 4, executive: 3, mid: 2, base: 1 }
    const diff = (levels[targetTrim] || 2) - (levels[listingTrim] || 2)
    // Each level diff = ~€400
    let trimAdj = diff * 400
    trimAdj = Math.max(-750, Math.min(750, trimAdj))
    adjustments += roundTo50(trimAdj)
  }

  // ── Transmission adjustment ──
  const targetTrans = target._features?.transmission || (target.transmission || '').toLowerCase()
  const listingTrans = listing._features?.transmission || null
  if (targetTrans && listingTrans && targetTrans !== listingTrans) {
    // automaat > handgeschakeld in most segments
    if (targetTrans.includes('automaat') && listingTrans === 'handgeschakeld') {
      adjustments += roundTo50(cfg.transAdj)   // listing is manual, target auto → listing would be cheaper
    } else if (targetTrans.includes('handgeschakeld') && listingTrans === 'automaat') {
      adjustments -= roundTo50(cfg.transAdj)   // listing is auto, target manual → listing would be more expensive
    }
  }

  const normalizedPrice = listing.parsedPrice + adjustments
  return Math.max(500, normalizedPrice)  // Floor at 500
}

module.exports = { normalizeComparable, detectSegment, SEGMENT_CONFIG }
