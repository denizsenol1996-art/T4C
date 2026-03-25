// T4C Comparable Engine — Step 8: Market Statistics
// Computes median, mean, percentiles, spread from the final comparable set

const { percentile } = require('./outlier-filter')

/**
 * Build market statistics from the final clean comparable set.
 * Operates on normalized prices.
 */
function buildMarketStats(comparables) {
  if (!comparables.length) {
    return {
      median: null,
      mean: null,
      p25: null,
      p75: null,
      spread: null,
    }
  }

  const prices = comparables.map(c => c.normalizedPrice).sort((a, b) => a - b)

  const median = Math.round(percentile(prices, 50))
  const mean = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length)
  const p25 = Math.round(percentile(prices, 25))
  const p75 = Math.round(percentile(prices, 75))
  const spread = p75 - p25

  return { median, mean, p25, p75, spread }
}

module.exports = { buildMarketStats }
