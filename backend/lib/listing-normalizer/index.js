// listing-normalizer — entry point
//
// normalizeListing(rawListing) — returns { normalized_model, normalize_source, confidence }
//   rawListing: { make, model, title, source }
//   - source='nlmarket' → trust existing model (native)
//   - other sources → parse title text
//   - geen match → fallback to raw model met source='unmatched'

const { parseTitle } = require("./parser")

function normalizeListing(rawListing) {
  const make = String(rawListing.make || "").toLowerCase().trim()
  const source = String(rawListing.source || "").toLowerCase().trim()
  const rawModel = String(rawListing.model || "").toLowerCase().trim()
  const title = rawListing.title || ""

  // nlmarket source is correct — geen parse nodig
  if (source === "nlmarket" || source === "nlretail") {
    return {
      normalized_model: rawModel || null,
      normalize_source: "native",
      confidence: 1.0
    }
  }

  // Andere bronnen — parse title
  const parsed = parseTitle(make, title)
  if (parsed) {
    return {
      normalized_model: parsed.normalized_model,
      normalize_source: "title_parse",
      confidence: 0.85,
      _alias: parsed.alias_matched
    }
  }

  // Geen match — fallback naar raw model
  return {
    normalized_model: rawModel || null,
    normalize_source: "unmatched",
    confidence: 0.3
  }
}

module.exports = { normalizeListing }
