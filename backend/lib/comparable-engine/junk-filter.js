// T4C Comparable Engine — Step 3: Junk Filter
// Removes listings that are clearly not comparable (damaged, export, parts, etc.)

const HARD_REJECT_TERMS = [
  { re: /\bschade\s*auto\b/i, reason: 'damage_term' },
  { re: /\bschade\s*voertuig\b/i, reason: 'damage_term' },
  { re: /\btotal\s*loss\b/i, reason: 'total_loss' },
  { re: /\bonderdelen\b/i, reason: 'parts' },
  { re: /\bparts\b/i, reason: 'parts' },
  { re: /\bdonor\b/i, reason: 'parts' },
  { re: /\bsloop\b/i, reason: 'parts' },
  { re: /\bexport\s*only\b/i, reason: 'export_only' },
  { re: /\bmotor\s*defect\b/i, reason: 'engine_defect' },
  { re: /\bmotor\s*kapot\b/i, reason: 'engine_defect' },
  { re: /\bversnellingsbak\s*defect\b/i, reason: 'transmission_defect' },
  { re: /\btransmission\s*fault\b/i, reason: 'transmission_defect' },
  { re: /\bniet\s*rijdend\b/i, reason: 'not_running' },
  { re: /\bnon\s*runner\b/i, reason: 'not_running' },
  { re: /\bwrak\b/i, reason: 'wreck' },
  { re: /\bsalvage\b/i, reason: 'salvage' },
  { re: /\baccident\s*damaged\b/i, reason: 'damage_term' },
  { re: /\bunfall\b/i, reason: 'damage_term' },      // German
  { re: /\bdefect\b/i, reason: 'defect' },
  { re: /\bvoor\s*onderdelen\b/i, reason: 'parts' },
]

const SOFT_PENALTY_TERMS = [
  { re: /\bimport\b/i, reason: 'import', penalty: 5 },
  { re: /\bgeen\s*nap\b/i, reason: 'no_nap', penalty: 8 },
  { re: /\bno\s*history\b/i, reason: 'no_history', penalty: 5 },
  { re: /\bschade\b/i, reason: 'damage_mention', penalty: 10 },  // generic "schade" without "auto"
  { re: /\bex\s*taxi\b/i, reason: 'ex_taxi', penalty: 5 },
  { re: /\bex\s*lease\b/i, reason: 'ex_lease', penalty: 3 },
  { re: /\bmeerdere\s*eigenaren\b/i, reason: 'multiple_owners', penalty: 3 },
  { re: /\bexport\b/i, reason: 'export_mention', penalty: 8 },
  { re: /\bex\s*btw\b/i, reason: 'ex_btw', penalty: 10 },
  { re: /\bexcl\b.*\bbtw\b/i, reason: 'ex_btw', penalty: 10 },
]

/**
 * Check if listing is junk. Returns { isRejected, junkFlags, softPenalties }
 */
function filterJunk(listing, target) {
  const text = `${listing.title || ''} ${listing.subtitle || ''} ${listing.description || ''}`.toLowerCase()
  const junkFlags = []
  const softPenalties = []

  // Hard reject checks
  for (const { re, reason } of HARD_REJECT_TERMS) {
    if (re.test(text)) {
      junkFlags.push(reason)
    }
  }

  // No title at all
  if (!listing.title || listing.title.trim().length < 5) {
    junkFlags.push('no_title')
  }

  // No km AND no year — too little info
  if (!listing.km && !listing.year) {
    junkFlags.push('missing_km_and_year')
  }

  // Make/model mismatch (if we can detect it)
  if (target && target.make && listing.title) {
    const titleLower = listing.title.toLowerCase()
    const makeLower = target.make.toLowerCase()
    // Only reject if title clearly contains a DIFFERENT make
    const otherMakes = ['audi','bmw','mercedes','volkswagen','opel','ford','toyota','peugeot','renault','citroen','fiat','seat','skoda','volvo','kia','hyundai','mazda','nissan','honda','suzuki','dacia','mini','porsche','alfa','mg','byd','tesla']
    const foundMake = otherMakes.find(m => titleLower.includes(m) && m !== makeLower && !makeLower.includes(m))
    if (foundMake && !titleLower.includes(makeLower)) {
      junkFlags.push('make_mismatch')
    }
  }

  // Lease price that got through parser (very low price + lease in title)
  if (listing.parsedPrice && listing.parsedPrice < 1000 && /lease/i.test(text)) {
    junkFlags.push('lease_price')
  }

  if (junkFlags.length > 0) {
    return { isRejected: true, junkFlags, softPenalties: [] }
  }

  // Soft penalties (don't reject, but lower score/confidence)
  for (const { re, reason, penalty } of SOFT_PENALTY_TERMS) {
    if (re.test(text)) {
      softPenalties.push({ reason, penalty })
    }
  }

  return { isRejected: false, junkFlags: [], softPenalties }
}

module.exports = { filterJunk, HARD_REJECT_TERMS, SOFT_PENALTY_TERMS }
