// T4C Comparable Engine — Step 6: Comparable Scoring v3
// Scores 0-100, normalized to what's KNOWABLE per listing

function scoreComparable(target, listing) {
  let score = 0
  let maxPossible = 0
  const reasons = []
  const tf = target._features || {}
  const lf = listing._features || {}

  // Base: make/model match (always)
  score += 20; maxPossible += 20
  reasons.push('make_model_match')

  // Generation match
  if (target.generation) {
    maxPossible += 15
    if (listing.title && listing.title.toLowerCase().includes(target.generation.toLowerCase())) {
      score += 15; reasons.push('generation_match')
    }
  }

  // Fuel — only count in maxPossible if listing has fuel detected
  if (tf.fuel && lf.fuel) {
    maxPossible += 10
    if (tf.fuel === lf.fuel) { score += 10; reasons.push('fuel_match') }
    else { score = Math.min(score, 40); reasons.push('fuel_mismatch') }
  }

  // Transmission — only count if listing has it
  if (tf.transmission && lf.transmission) {
    maxPossible += 10
    if (tf.transmission === lf.transmission) { score += 10; reasons.push('transmission_match') }
  }

  // Body type — only count if listing has it
  if (tf.bodyType && lf.bodyType) {
    maxPossible += 8
    if (tf.bodyType === lf.bodyType) { score += 8; reasons.push('bodytype_match') }
  }

  // Trim — only count if both have it
  if (tf.trimCore && lf.trimCore) {
    maxPossible += 12
    if (tf.trimCore === lf.trimCore) { score += 12; reasons.push('trim_exact') }
    else if (tf.trimLevel === lf.trimLevel) { score += 6; reasons.push('trim_level_match') }
  }

  // Year — always relevant
  maxPossible += 8
  if (target.year && listing.year) {
    const yd = Math.abs(target.year - listing.year)
    if (yd <= 1) { score += 8; reasons.push('year_close') }
    else if (yd === 2) { score += 5; reasons.push('year_near') }
    else if (yd <= 4) { score += 2; reasons.push('year_wider') }
  }

  // KM — always relevant
  maxPossible += 8
  if (target.km && listing.km) {
    const kd = Math.abs(target.km - listing.km)
    if (kd <= 20000) { score += 8; reasons.push('km_close') }
    else if (kd <= 40000) { score += 5; reasons.push('km_near') }
    else if (kd <= 80000) { score += 2; reasons.push('km_wider') }
  }

  // Power — only if both known
  if (target.powerHp && target.powerHp > 0 && lf.powerHp) {
    maxPossible += 5
    const hd = Math.abs(target.powerHp - lf.powerHp)
    if (hd <= 15) { score += 5; reasons.push('power_match') }
    else if (hd <= 40) { score += 2; reasons.push('power_near') }
  }

  // Seller type
  maxPossible += 2
  if (listing.sellerType === 'dealer') { score += 2; reasons.push('dealer_listing') }

  // Soft penalties
  if (listing._softPenalties && listing._softPenalties.length > 0) {
    const tp = listing._softPenalties.reduce((s, p) => s + p.penalty, 0)
    score = Math.max(0, score - tp)
    if (tp > 0) reasons.push('soft_penalties_applied')
  }

  const ns = maxPossible > 0 ? Math.round((score / maxPossible) * 100) : 0

  let band
  if (ns >= 70) band = 'strong'
  else if (ns >= 60) band = 'usable'
  else if (ns >= 50) band = 'secondary'
  else band = 'ignore'

  return { score: ns, band, reasons }
}

module.exports = { scoreComparable }
