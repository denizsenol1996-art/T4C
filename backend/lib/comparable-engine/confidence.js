// T4C Comparable Engine — Confidence Calculator
// Produces a 0-100 confidence score for the comparable set

/**
 * Calculate confidence for the comparable set.
 * Based on: count, match quality, spread, data completeness.
 */
function buildComparableConfidence(target, comparables, stats) {
  let score = 0

  // ── Comparable count score (max 40) ──
  const count = comparables.length
  if (count === 0) score += 0
  else if (count <= 2) score += 10
  else if (count <= 4) score += 20
  else if (count <= 7) score += 30
  else score += 40

  // ── Match quality score (max 25) ──
  if (comparables.length > 0) {
    const avgScore = comparables.reduce((s, c) => s + (c.scoreResult?.score || 0), 0) / comparables.length
    if (avgScore >= 85) score += 25
    else if (avgScore >= 75) score += 18
    else if (avgScore >= 65) score += 10
    else score += 5
  }

  // ── Spread penalty (max -20) ──
  if (stats.spread !== null) {
    if (stats.spread < 1000) score += 0       // tight = good
    else if (stats.spread < 2000) score -= 5
    else if (stats.spread < 3500) score -= 12
    else score -= 20
  }

  // ── Missing data penalty ──
  if (!target.km || target.km === 0) score -= 20
  if (!target.year || target.year === 0) score -= 10
  if (!target._features?.trimCore) score -= 8

  // ── Secondary usage penalty ──
  if (comparables.length > 0) {
    const secondaryCount = comparables.filter(c => c.scoreResult?.band === 'secondary').length
    const secondaryRatio = secondaryCount / comparables.length
    if (secondaryRatio > 0.4) score -= 10
  }

  // ── Strong comparable bonus ──
  const strongCount = comparables.filter(c => c.scoreResult?.band === 'strong').length
  if (strongCount >= 3) score += 5

  // Clamp 0-100
  return Math.max(0, Math.min(100, score))
}

module.exports = { buildComparableConfidence }
