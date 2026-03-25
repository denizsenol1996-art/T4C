// T4C Comparable Engine — Step 7b: Outlier Removal
// IQR-based filtering on normalized prices

/**
 * Remove outliers from a set of comparables based on normalized price.
 * Uses IQR for sets >= 5, median ±20% for smaller sets.
 * Returns { filtered, removedCount, removedIds }
 */
function removeOutliers(comparables) {
  if (comparables.length < 3) {
    return { filtered: comparables, removedCount: 0, removedIds: [] }
  }

  const prices = comparables.map(c => c.normalizedPrice).sort((a, b) => a - b)

  let lower, upper

  if (prices.length >= 5) {
    // IQR method
    const p25 = percentile(prices, 25)
    const p75 = percentile(prices, 75)
    const iqr = p75 - p25

    // Guard: if IQR is 0 (all same price), use 20% of median
    if (iqr === 0) {
      const med = percentile(prices, 50)
      lower = med * 0.80
      upper = med * 1.20
    } else {
      lower = p25 - 1.5 * iqr
      upper = p75 + 1.5 * iqr
    }
  } else {
    // Small set: median ± 20%
    const med = percentile(prices, 50)
    lower = med * 0.80
    upper = med * 1.20
  }

  const removedIds = []
  const filtered = comparables.filter(c => {
    if (c.normalizedPrice >= lower && c.normalizedPrice <= upper) {
      return true
    }
    removedIds.push(c.id || c.title)
    return false
  })

  return {
    filtered,
    removedCount: comparables.length - filtered.length,
    removedIds
  }
}

/**
 * Simple percentile calculation.
 * @param {number[]} sorted - Pre-sorted array
 * @param {number} p - Percentile (0-100)
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

module.exports = { removeOutliers, percentile }
