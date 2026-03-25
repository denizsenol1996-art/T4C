// T4C Comparable Engine — Step 4: Deduplication
// Removes duplicate listings across platforms and re-listings

/**
 * Generate a fingerprint for deduplication.
 * Based on normalized title tokens, price bucket, km bucket, year.
 */
function makeDuplicateKey(listing) {
  const title = normalizeTitle(listing.title || '')
  const priceBucket = bucket(listing.parsedPrice || 0, 250)
  const kmBucket = bucket(listing.km || 0, 5000)
  const year = listing.year || 0

  return `${title}|${year}|${kmBucket}|${priceBucket}`
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')     // strip punctuation
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .split(' ')
    .filter(w => w.length > 1)        // drop single chars
    .sort()                            // order-independent
    .slice(0, 6)                       // take first 6 tokens
    .join('_')
}

function bucket(value, size) {
  return Math.round(value / size) * size
}

/**
 * Compute a completeness score for selecting the best duplicate.
 */
function completenessScore(listing) {
  let score = 0
  if (listing.title && listing.title.length > 20) score += 2
  if (listing.km && listing.km > 0) score += 3
  if (listing.year && listing.year > 0) score += 2
  if (listing.url) score += 1
  if (listing.dealer) score += 1
  if (listing.priceConfidence) score += listing.priceConfidence / 50
  if (listing.source) score += 1
  return score
}

/**
 * Deduplicate listings. Keep the most complete record per duplicate key.
 * Returns { deduped, removedCount }
 */
function dedupeListings(listings) {
  const groups = new Map()

  for (const listing of listings) {
    const key = makeDuplicateKey(listing)
    listing.duplicateKey = key

    if (!groups.has(key)) {
      groups.set(key, listing)
    } else {
      const existing = groups.get(key)
      if (completenessScore(listing) > completenessScore(existing)) {
        groups.set(key, listing)
      }
    }
  }

  const deduped = Array.from(groups.values())
  return {
    deduped,
    removedCount: listings.length - deduped.length
  }
}

module.exports = { dedupeListings, makeDuplicateKey, normalizeTitle, completenessScore }
