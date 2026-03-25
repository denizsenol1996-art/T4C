// T4C Comparable Engine — Step 6: Comparable Scoring
// Scores each listing 0-100 based on how closely it matches the target vehicle

function scoreComparable(target, listing) {
  let score = 0
  let maxPossible = 0
  const reasons = []
  const targetFeatures = target._features || {}
  const listingFeatures = listing._features || {}

  // ── Base: make/model match (always awarded) ──
  score += 20; maxPossible += 20
  reasons.push('make_model_match')

  // ── Generation match (+15) ──
  if (target.generation) {
    maxPossible += 15
    if (listing.title && listing.title.toLowerCase().includes(target.generation.toLowerCase())) {
      score += 15; reasons.push('generation_match')
    }
  }

  // ── Fuel match (+10) ──
  if (targetFeatures.fuel) {
    maxPossible += 10
    if (listingFeatures.fuel) {
      if (targetFeatures.fuel === listingFeatures.fuel) {
        score += 10; reasons.push('fuel_match')
      } else {
        score = Math.min(score, 40); reasons.push('fuel_mismatch')
      }
    }
  }

  // ── Transmission match (+10) ──
  if (targetFeatures.transmission) {
    maxPossible += 10
    if (listingFeatures.transmission) {
      if (targetFeatures.transmission === listingFeatures.transmission) {
        score += 10; reasons.push('transmission_match')
      }
    }
  }

  // ── Body type match (+8) ──
  if (targetFeatures.bodyType) {
    maxPossible += 8
    if (listingFeatures.bodyType) {
      if (targetFeatures.bodyType === listingFeatures.bodyType) {
        score += 8; reasons.push('bodytype_match')
      }
    }
  }

  // ── Trim core match (+12) ──
  if (targetFeatures.trimCore) {
    maxPossible += 12
    if (listingFeatures.trimCore) {
      if (targetFeatures.trimCore === listingFeatures.trimCore) {
        score += 12; reasons.push('trim_exact')
      } else if (targetFeatures.trimLevel === listingFeatures.trimLevel) {
        score += 6; reasons.push('trim_level_match')
      }
    }
  }

  // ── Year proximity (+8) ──
  maxPossible += 8
  if (target.year && listing.year) {
    const yearDiff = Math.abs(target.year - listing.year)
    if (yearDiff <= 1) { score += 8; reasons.push('year_close') }
    else if (yearDiff === 2) { score += 5; reasons.push('year_near') }
    else if (yearDiff <= 4) { score += 2; reasons.push('year_wider') }
  }

  // ── KM proximity (+8) ──
  maxPossible += 8
  if (target.km && listing.km) {
    const kmDiff = Math.abs(target.km - listing.km)
    if (kmDiff <= 20000) { score += 8; reasons.push('km_close') }
    else if (kmDiff <= 40000) { score += 5; reasons.push('km_near') }
    else if (kmDiff <= 80000) { score += 2; reasons.push('km_wider') }
  }

  // ── Power proximity (+5) ──
  if (target.powerHp && target.powerHp > 0) {
    maxPossible += 5
    if (listingFeatures.powerHp) {
      const hpDiff = Math.abs(target.powerHp - listingFeatures.powerHp)
      if (hpDiff <= 15) { score += 5; reasons.push('power_match') }
      else if (hpDiff <= 40) { score += 2; reasons.push('power_near') }
    }
  }

  // ── Seller type bonus (+2) ──
  maxPossible += 2
  if (listing.sellerType === 'dealer') {
    score += 2; reasons.push('dealer_listing')
  }

  // ── Soft penalties ──
  if (listing._softPenalties && listing._softPenalties.length > 0) {
    const totalPenalty = listing._softPenalties.reduce((sum, p) => sum + p.penalty, 0)
    score = Math.max(0, score - totalPenalty)
    if (totalPenalty > 0) reasons.push('soft_penalties_applied')
  }

  // ── Normalize to 0-100 based on what was possible ──
  const normalizedScore = maxPossible > 0 ? Math.round((score / maxPossible) * 100) : 0

  let band
  if (normalizedScore >= 75) band = 'strong'
  else if (normalizedScore >= 60) band = 'usable'
  else if (normalizedScore >= 50) band = 'secondary'
  else band = 'ignore'

  return { score: normalizedScore, band, reasons }
}

module.exports = { scoreComparable }
