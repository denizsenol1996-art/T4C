// T4C Comparable Engine — Step 2: Price Parser
// Fixes: €201, €99 p/m, aanbetaling, lease, bieden, etc.

const REJECT_PRICE_TERMS = [
  /p\/m/i,
  /per\s*maand/i,
  /\blease\b/i,
  /financial\s*lease/i,
  /operationele?\s*lease/i,
  /aanbetaling/i,
  /\bvanaf\b/i,
  /\bbieden\b/i,
  /\bbod\b/i,
  /op\s*aanvraag/i,
  /n\.?o\.?t\.?k\.?/i,
  /verkocht/i,
  /gereserveerd/i,
  /reserved/i,
  /\bsold\b/i,
  /prijs\s*n\.?t\.?b/i,
  /price\s*on\s*request/i,
]

const FLAGGED_TERMS = [
  { re: /ex\.?\s*btw/i, flag: 'ex_btw' },
  { re: /excl\.?\s*btw/i, flag: 'ex_btw' },
  { re: /marge/i, flag: 'marge' },
  { re: /export/i, flag: 'export_price' },
  { re: /netto/i, flag: 'netto_price' },
]

/**
 * Parse a raw price text into a validated integer euro amount.
 * Returns { parsedPrice, priceFlags, priceConfidence }
 */
function parseListingPrice(rawText, titleText) {
  const combined = `${rawText || ''} ${titleText || ''}`

  if (!rawText && typeof rawText !== 'number') {
    return { parsedPrice: null, priceFlags: ['missing_price'], priceConfidence: 0 }
  }

  const s = String(rawText).trim()

  // Check reject terms in both price text and title
  for (const re of REJECT_PRICE_TERMS) {
    if (re.test(s) || re.test(titleText || '')) {
      return { parsedPrice: null, priceFlags: ['non_total_price'], priceConfidence: 0 }
    }
  }

  // If input is already a number (from extractListings)
  if (typeof rawText === 'number' && Number.isFinite(rawText)) {
    return validateParsedPrice(rawText, combined)
  }

  // Parse string to number
  let numeric = s
    .replace(/eur|€|\$/ig, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')       // 8.950 → 8950
    .replace(/,-$/g, '')      // 8950,- → 8950
    .replace(/,(\d{2})$/, '') // 8950,00 → 8950 (cents)
    .replace(/,/g, '.')       // remaining commas to dots

  const match = numeric.match(/(\d{3,6})/)
  if (!match) {
    return { parsedPrice: null, priceFlags: ['no_numeric_price'], priceConfidence: 0 }
  }

  const value = parseInt(match[1], 10)
  if (!Number.isFinite(value)) {
    return { parsedPrice: null, priceFlags: ['invalid_numeric_price'], priceConfidence: 0 }
  }

  return validateParsedPrice(value, combined)
}

function validateParsedPrice(value, combinedText) {
  const flags = []

  // Collect non-reject flags
  for (const { re, flag } of FLAGGED_TERMS) {
    if (re.test(combinedText)) flags.push(flag)
  }

  // Hard bounds
  if (value < 500) {
    return { parsedPrice: null, priceFlags: ['too_low', ...flags], priceConfidence: 0 }
  }
  if (value > 250000) {
    return { parsedPrice: null, priceFlags: ['too_high', ...flags], priceConfidence: 0 }
  }

  // Suspicious range — might be monthly payment that slipped through
  let confidence = 95
  if (value < 1000) {
    confidence = 60
    flags.push('suspicious_low')
  }
  if (value > 150000) {
    confidence = 70
    flags.push('high_value')
  }

  return { parsedPrice: value, priceFlags: flags, priceConfidence: confidence }
}

module.exports = { parseListingPrice, REJECT_PRICE_TERMS, FLAGGED_TERMS }
