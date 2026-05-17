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

// ───────────────────────────────────────────────────────────────────────────
// MODEL-MATCH FILTER
// model-bucket in DB is contaminated: src_g (autowereld.nl) dumps most
// listings with wrong `model` field (Cordoba/Toledo stored as model='leon').
// Other sources also mix sibling-series (BMW 320 in model='5-serie' bucket,
// MB B-class in 'e-klasse' bucket). Verify title plausibly mentions model.
// ───────────────────────────────────────────────────────────────────────────

function _normalize(s) {
  if (s == null) return ''
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')
}

function _words(s) {
  if (s == null) return []
  return String(s).toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const MAKE_ALIASES = {
  mercedes: 'mercedesbenz',
  mb: 'mercedesbenz',
  vw: 'volkswagen',
}

// Power/torque unit suffixes — these are NOT model designators, even when the
// preceding digits look like a sibling-series number (e.g. "306pk" ≠ 3-series).
const _UNIT_SUFFIX_RE = /(?:pk|ps|kw|hp|nm|cc|km)$/

// Build a negative regex for MB excluding our target letter (e.g., 'e' for E-Klasse).
function _mbSiblingRe(except) {
  const letters = ['a','b','c','e','s'].filter(l => l !== except)
  const pat = '^(' + letters.map(l => `${l}\\d{2,3}`).join('|') +
    '|cla\\d*|cls\\d*|gla\\d*|glb\\d*|glc\\d*|gle\\d*|gls\\d*|glk\\d*|gl\\d{2,3}|slk?\\d*|sl\\d{2,3}|sprinter|vito|viano|citan|vaneo|metris)$'
  return new RegExp(pat)
}

const _BMW_NEG_BASE = (excludeFirstDigit) => {
  const otherDigits = ['1','2','3','4','5','6','7','8'].filter(d => d !== excludeFirstDigit)
  // Cover sibling number-series + X-models + Z-roadsters + i-electric
  const numAlt = otherDigits.map(d => `${d}\\d\\d`).join('|')
  return new RegExp(`^(${numAlt}|x[1-7]|z[34]|i[1-9])[a-z]{0,2}$`)
}

// Rule schema:
//   pos_substr   — strong positive: long-form names safe as substrings on normalized title
//   pos_word     — strong positive: chassis codes that must appear as standalone words
//   pos_substr_re — softer positive: regex on normalized title (number prefix like 5\d{2})
//   neg_word_re  — sibling rejection: regex against word-split tokens
// Logic: strong if pos_substr or pos_word matches; weak if only pos_substr_re matches.
// If neg_word_re matches AND only weak positive, reject.
const MODEL_RULES = {
  // ── BMW number-series ───────────────────────────────────────
  'bmw|5series': {
    pos_substr: ['5serie','5series','5erreihe','5reeks'],
    pos_word: new Set(['5er','f10','f11','e60','e61','g30','g31','e39','e34']),
    pos_substr_re: /5\d{2}/,
    neg_word_re: _BMW_NEG_BASE('5'),
  },
  'bmw|3series': {
    pos_substr: ['3serie','3series','3erreihe','3reeks'],
    pos_word: new Set(['3er','f30','f31','f34','e90','e91','e92','e93','e46','g20','g21','g28']),
    pos_substr_re: /3\d{2}/,
    neg_word_re: _BMW_NEG_BASE('3'),
  },
  'bmw|1series': {
    pos_substr: ['1serie','1series','1erreihe','1reeks'],
    pos_word: new Set(['1er','f20','f21','f40','e87','e81','e82','e88']),
    pos_substr_re: /1\d{2}/,
    neg_word_re: _BMW_NEG_BASE('1'),
  },
  'bmw|2series': {
    pos_substr: ['2serie','2series','2erreihe','2reeks'],
    pos_word: new Set(['2er','f22','f23','f44','f45','f46','g42']),
    pos_substr_re: /2\d{2}/,
    neg_word_re: _BMW_NEG_BASE('2'),
  },
  'bmw|4series': {
    pos_substr: ['4serie','4series','4erreihe','4reeks'],
    pos_word: new Set(['4er','f32','f33','f36','g22','g23','g26']),
    pos_substr_re: /4\d{2}/,
    neg_word_re: _BMW_NEG_BASE('4'),
  },
  'bmw|6series': {
    pos_substr: ['6serie','6series','6erreihe','6reeks'],
    pos_word: new Set(['6er','f12','f13','f06','e63','e64','g32']),
    pos_substr_re: /6\d{2}/,
    neg_word_re: _BMW_NEG_BASE('6'),
  },
  'bmw|7series': {
    pos_substr: ['7serie','7series','7erreihe','7reeks'],
    pos_word: new Set(['7er','f01','f02','g11','g12','e65','e66']),
    pos_substr_re: /7\d{2}/,
    neg_word_re: _BMW_NEG_BASE('7'),
  },
  // BMW X-models — chassis-code-only positive
  'bmw|x1': { pos_word: new Set(['x1','e84','f48','u11']), neg_word_re: /^(1\d\d|2\d\d|3\d\d|4\d\d|5\d\d|6\d\d|7\d\d|8\d\d|x[23-7]|z[34]|i[1-9])[a-z]{0,2}$/ },
  'bmw|x3': { pos_word: new Set(['x3','f25','g01']),       neg_word_re: /^(1\d\d|2\d\d|3\d\d|4\d\d|5\d\d|6\d\d|7\d\d|8\d\d|x[12]|x[4-7]|z[34]|i[1-9])[a-z]{0,2}$/ },
  'bmw|x5': { pos_word: new Set(['x5','e70','f15','g05']), neg_word_re: /^(1\d\d|2\d\d|3\d\d|4\d\d|5\d\d|6\d\d|7\d\d|8\d\d|x[1-4]|x[67]|z[34]|i[1-9])[a-z]{0,2}$/ },

  // ── Mercedes-Benz Klasse ────────────────────────────────────
  'mercedesbenz|eklasse': {
    pos_substr: ['eklasse','eclass','eclasse'],
    pos_word: new Set(['w210','w211','w212','w213','w214','s210','s211','s212','s213','c207','a207','c238','a238']),
    pos_substr_re: /e\d{3}/,
    neg_word_re: _mbSiblingRe('e'),
  },
  'mercedesbenz|cklasse': {
    pos_substr: ['cklasse','cclass','cclasse'],
    pos_word: new Set(['w203','w204','w205','w206','s203','s204','s205','s206','c204','c205','c206','a204','a205','a206']),
    pos_substr_re: /c\d{3}/,
    neg_word_re: _mbSiblingRe('c'),
  },
  'mercedesbenz|aklasse': {
    pos_substr: ['aklasse','aclass','aclasse'],
    pos_word: new Set(['w168','w169','w176','w177']),
    pos_substr_re: /a\d{3}/,
    neg_word_re: _mbSiblingRe('a'),
  },
  'mercedesbenz|sklasse': {
    pos_substr: ['sklasse','sclass','sclasse'],
    pos_word: new Set(['w220','w221','w222','w223']),
    pos_substr_re: /s\d{3}/,
    neg_word_re: _mbSiblingRe('s'),
  },
  'mercedesbenz|bklasse': {
    pos_substr: ['bklasse','bclass','bclasse'],
    pos_word: new Set(['w245','w246','w247']),
    pos_substr_re: /b\d{3}/,
    neg_word_re: _mbSiblingRe('b'),
  },

  // ── MG ZS EV — multiple spellings: "ZS EV", "ZS-EV", "e-ZS", "ZS MG EV",
  // "ZS AUT. EV". Match if both 'zs' AND ('ev'|'electric') words appear.
  'mg|zsev': {
    pos_substr: ['zsev','ezs','zselectric'],
    pos_word_all: [new Set(['zs']), new Set(['ev','electric','kwh'])],  // EV-indicator
  },
}

// Aliases — multiple normalized model names map to one rule key.
const MODEL_KEY_ALIASES = {
  'bmw|5serie': 'bmw|5series', 'bmw|5er': 'bmw|5series', 'bmw|5erreihe': 'bmw|5series', 'bmw|5reeks': 'bmw|5series',
  'bmw|3serie': 'bmw|3series', 'bmw|3er': 'bmw|3series', 'bmw|3erreihe': 'bmw|3series', 'bmw|3reeks': 'bmw|3series',
  'bmw|1serie': 'bmw|1series', 'bmw|1er': 'bmw|1series', 'bmw|1erreihe': 'bmw|1series', 'bmw|1reeks': 'bmw|1series',
  'bmw|2serie': 'bmw|2series', 'bmw|2er': 'bmw|2series', 'bmw|2erreihe': 'bmw|2series', 'bmw|2reeks': 'bmw|2series',
  'bmw|4serie': 'bmw|4series', 'bmw|4er': 'bmw|4series', 'bmw|4erreihe': 'bmw|4series', 'bmw|4reeks': 'bmw|4series',
  'bmw|6serie': 'bmw|6series', 'bmw|6er': 'bmw|6series', 'bmw|6erreihe': 'bmw|6series', 'bmw|6reeks': 'bmw|6series',
  'bmw|7serie': 'bmw|7series', 'bmw|7er': 'bmw|7series', 'bmw|7erreihe': 'bmw|7series', 'bmw|7reeks': 'bmw|7series',
  'mercedesbenz|eclass':  'mercedesbenz|eklasse', 'mercedesbenz|eclasse': 'mercedesbenz|eklasse',
  'mercedesbenz|cclass':  'mercedesbenz|cklasse', 'mercedesbenz|cclasse': 'mercedesbenz|cklasse',
  'mercedesbenz|aclass':  'mercedesbenz|aklasse', 'mercedesbenz|aclasse': 'mercedesbenz|aklasse',
  'mercedesbenz|sclass':  'mercedesbenz|sklasse', 'mercedesbenz|sclasse': 'mercedesbenz|sklasse',
  'mercedesbenz|bclass':  'mercedesbenz|bklasse', 'mercedesbenz|bclasse': 'mercedesbenz|bklasse',
}

function _getModelRule(target) {
  if (!target || !target.make || !target.model) return null
  let nm = _normalize(target.make)
  nm = MAKE_ALIASES[nm] || nm
  const key = nm + '|' + _normalize(target.model)
  const aliased = MODEL_KEY_ALIASES[key] || key
  return MODEL_RULES[aliased] || null
}

/**
 * Returns true if listing.title plausibly matches target.model.
 * Fail-open when target/listing fields are missing.
 */
function matchesModel(target, listing) {
  if (!target || !target.model || !listing || !listing.title) return true
  const normTitle = _normalize(listing.title)
  if (!normTitle) return true

  const rule = _getModelRule(target)
  if (rule) {
    const words = _words(listing.title)
    const posSubstr = (rule.pos_substr || []).some(t => t && normTitle.includes(t))
    const posWord = rule.pos_word ? words.some(w => rule.pos_word.has(w)) : false
    const posSubstrRe = rule.pos_substr_re ? rule.pos_substr_re.test(normTitle) : false
    // Combo: every word-set in pos_word_all must have at least one matching word.
    const posCombo = rule.pos_word_all
      ? rule.pos_word_all.every(s => words.some(w => s.has(w)))
      : false
    if (!posSubstr && !posWord && !posSubstrRe && !posCombo) return false

    if (rule.neg_word_re) {
      // Sibling-series number detected (e.g. "320d" when target is 5-serie).
      // Exclude unit-suffixed numbers — "306pk" is horsepower, not a model.
      const negHit = words.some(w => rule.neg_word_re.test(w) && !_UNIT_SUFFIX_RE.test(w))
      // Strong positive = pos_substr (long name) OR pos_word (explicit chassis code).
      // If only weak (number-prefix regex) positive and a sibling is mentioned, reject.
      if (negHit && !posSubstr && !posWord) {
        return false
      }
    }
    return true
  }

  // Generic: full normalized model name must be substring of normalized title.
  const normModel = _normalize(target.model)
  if (normModel.length >= 2 && normTitle.includes(normModel)) return true

  // First-word fallback (only when first word is ≥3 chars).
  const firstWord = String(target.model).split(/[\s\-_/.,]+/).filter(Boolean)[0]
  if (firstWord) {
    const nFirst = _normalize(firstWord)
    if (nFirst.length >= 3 && normTitle.includes(nFirst)) return true
  }

  return false
}

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

  // Model-mismatch — defends against contaminated model bucket (src_g) and
  // sibling-series mixing (BMW 320 in 5-serie bucket; MB B-class in e-klasse).
  if (target && target.model && listing.title && !matchesModel(target, listing)) {
    junkFlags.push('model_mismatch')
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

module.exports = { filterJunk, matchesModel, HARD_REJECT_TERMS, SOFT_PENALTY_TERMS, MODEL_RULES, MODEL_KEY_ALIASES, MAKE_ALIASES }
