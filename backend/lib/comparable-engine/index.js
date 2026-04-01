// T4C Comparable Engine — Main Pipeline
// Orchestrates the 8-step comparable analysis pipeline
//
// Usage:
//   const { buildComparableSet } = require('./comparable-engine')
//   const result = buildComparableSet(targetVehicle, rawListings)
//
// Input:
//   targetVehicle: { make, model, generation?, trim?, bodyType?, fuel?, transmission?, year, km, powerHp?, isEV? }
//   rawListings:   Array from extractListings() — { title, price, km, year, url, source, dealer }

const { parseListingPrice } = require('./parse-price')
const { filterJunk } = require('./junk-filter')
const { dedupeListings } = require('./dedupe')
const { extractFeatures } = require('./extract-features')
const { scoreComparable } = require('./score-comparable')
const { normalizeComparable } = require('./normalize-comparable')
const { removeOutliers } = require('./outlier-filter')
const { buildMarketStats } = require('./build-market-stats')
const { buildComparableConfidence } = require('./confidence')

const LOG_PREFIX = '[COMP-ENGINE]'

/**
 * Build a comparable set for a target vehicle from raw scraped listings.
 *
 * @param {object} target - Target vehicle identity (from layer 1)
 * @param {object[]} rawListings - Raw listings from extractListings()
 * @param {object} [options] - Optional config
 * @param {boolean} [options.silent] - Suppress console logs
 * @returns {ComparableSetResult}
 */
function buildComparableSet(target, rawListings, options = {}) {
  const log = options.silent ? () => {} : (...args) => console.log(LOG_PREFIX, ...args)
  const mk = target.make || '?'
  const ml = target.model || '?'
  const gen = target.generation || ''

  // ── Fail-closed: need at least make/model ──
  if (!target.make || !target.model) {
    return failResult('missing_make_model', 0, 0)
  }

  // Extract target features
  const targetText = `${mk} ${ml} ${gen} ${target.trim || ''} ${target.fuel || ''} ${target.transmission || ''} ${target.bodyType || ''}`
  target._features = extractFeatures({ title: targetText, subtitle: target.trim || '' })
  // Override with explicit target data if available
  if (target.fuel) {
    const fl = target.fuel.toLowerCase()
    if (fl.includes('diesel')) target._features.fuel = 'diesel'
    else if (fl.includes('benzine') || fl.includes('petrol')) target._features.fuel = 'benzine'
    else if (fl.includes('elektr') || fl.includes('electric')) target._features.fuel = 'elektrisch'
    else if (fl.includes('hybri')) target._features.fuel = 'hybride'
  }
  if (target.transmission) {
    const tl = target.transmission.toLowerCase()
    if (tl.includes('automaat') || tl.includes('automatic')) target._features.transmission = 'automaat'
    else if (tl.includes('handgeschakeld') || tl.includes('manual')) target._features.transmission = 'handgeschakeld'
  }
  if (target.bodyType) {
    target._features.bodyType = target.bodyType.toLowerCase()
  }
  if (target.powerHp) {
    target._features.powerHp = target.powerHp
  }

  const rawCount = rawListings.length
  log(`${mk} ${ml} ${gen} | raw=${rawCount}`)

  if (rawCount === 0) {
    return failResult('no_listings', 0, 0)
  }

  // ── Step 1: Already done — rawListings come from scrapers ──

  // ── Step 2: Price parsing ──
  let priceRejectCount = 0
  const parsed = rawListings.map((listing, i) => {
    const priceResult = parseListingPrice(listing.price, listing.title)
    if (!priceResult.parsedPrice) priceRejectCount++
    return {
      ...listing,
      id: listing.id || `listing_${i}`,
      rawPriceText: String(listing.price || ''),
      parsedPrice: priceResult.parsedPrice,
      priceFlags: priceResult.priceFlags,
      priceConfidence: priceResult.priceConfidence,
    }
  })

  const priceClean = parsed.filter(x => x.parsedPrice && !x.priceFlags.includes('reject'))
  log(`price_parse rejected=${priceRejectCount}`)

  // ── Step 3: Junk filtering ──
  let junkRejectCount = 0
  const noJunk = priceClean.filter(listing => {
    const result = filterJunk(listing, target)
    listing._softPenalties = result.softPenalties
    if (result.isRejected) {
      listing.junkFlags = result.junkFlags
      junkRejectCount++
      return false
    }
    listing.junkFlags = []
    return true
  })
  log(`junk rejected=${junkRejectCount}`)

  // ── Step 4: Deduplication ──
  const { deduped, removedCount: dedupeRemoved } = dedupeListings(noJunk)
  log(`dedupe removed=${dedupeRemoved}`)

  // ── Step 5: Feature extraction ──
  for (const listing of deduped) {
    listing._features = extractFeatures(listing)
  }

  // ── Step 6: Comparable scoring ──
  for (const listing of deduped) {
    listing.scoreResult = scoreComparable(target, listing)
  }

  // Filter: only usable comparables (score >= 50)
  const usable = deduped.filter(x => x.scoreResult.score >= 50)
  log(`scored: strong=${usable.filter(x => x.scoreResult.band === 'strong').length} usable=${usable.filter(x => x.scoreResult.band === 'usable').length} secondary=${usable.filter(x => x.scoreResult.band === 'secondary').length} ignored=${deduped.length - usable.length}`)

  // ── Step 7: Normalization ──
  for (const listing of usable) {
    listing.normalizedPrice = normalizeComparable(target, listing)
  }

  // ── Step 7b: Outlier removal ──
  const { filtered: finalSet, removedCount: outlierRemoved } = removeOutliers(usable)
  if (outlierRemoved > 0) log(`outliers removed=${outlierRemoved}`)

  // ── Step 8: Market stats ──
  const stats = buildMarketStats(finalSet)
  const confidenceComparable = buildComparableConfidence(target, finalSet, stats)

  const strongCount = finalSet.filter(x => x.scoreResult.band === 'strong').length
  const secondaryCount = finalSet.filter(x => x.scoreResult.band === 'secondary').length

  log(`normalized median=${stats.median} p25=${stats.p25} p75=${stats.p75} spread=${stats.spread} conf=${confidenceComparable}`)

  // ── Fail-closed checks ──
  if (finalSet.length < 3) {
    return {
      status: 'insufficient_data',
      reason: finalSet.length === 0 ? 'no_clean_comparables' : 'not_enough_clean_comparables',
      rawCount,
      cleanCount: finalSet.length,
      strongCount,
      secondaryCount,
      marketMedian: stats.median,
      marketMean: stats.mean,
      marketP25: stats.p25,
      marketP75: stats.p75,
      marketSpread: stats.spread,
      anchorPrice: stats.median,
      confidenceComparable,
      comparables: formatComparables(finalSet),
      _debug: {
        priceRejectCount,
        junkRejectCount,
        dedupeRemoved,
        outlierRemoved,
        totalScored: deduped.length,
        usableCount: usable.length,
      }
    }
  }

  if (strongCount === 0 && finalSet.length < 5) {
    return {
      status: 'insufficient_data',
      reason: 'no_strong_matches',
      rawCount,
      cleanCount: finalSet.length,
      strongCount,
      secondaryCount,
      marketMedian: stats.median,
      confidenceComparable,
      comparables: formatComparables(finalSet),
    }
  }

  // ── Success ──
  return {
    status: 'ok',
    rawCount,
    cleanCount: finalSet.length,
    strongCount,
    secondaryCount,
    marketMedian: stats.median,
    marketMean: stats.mean,
    marketP25: stats.p25,
    marketP75: stats.p75,
    marketSpread: stats.spread,
    anchorPrice: stats.median,
    confidenceComparable,
    comparables: formatComparables(finalSet),
    _debug: {
      priceRejectCount,
      junkRejectCount,
      dedupeRemoved,
      outlierRemoved,
      totalScored: deduped.length,
      usableCount: usable.length,
    }
  }
}

function formatComparables(comparables) {
  return comparables
    .sort((a, b) => (b.scoreResult?.score || 0) - (a.scoreResult?.score || 0))
    .map(c => ({
      id: c.id,
      source: c.source || 'unknown',
      title: c.title || '',
      url: c.url || null,
      rawPrice: c.rawPriceText,
      parsedPrice: c.parsedPrice,
      normalizedPrice: c.normalizedPrice,
      km: c.km || null,
      year: c.year || null,
      score: c.scoreResult?.score || 0,
      scoreBand: c.scoreResult?.band || 'ignore',
      reasons: c.scoreResult?.reasons || [],
      dealer: c.dealer || null,
      options: c.options || null,
      transmission: c.transmission || null,
      fuel: c.fuel || null,
    }))
}

function failResult(reason, rawCount, confidenceComparable) {
  return {
    status: 'insufficient_data',
    reason,
    rawCount,
    cleanCount: 0,
    strongCount: 0,
    secondaryCount: 0,
    confidenceComparable,
    comparables: [],
  }
}

module.exports = { buildComparableSet }
