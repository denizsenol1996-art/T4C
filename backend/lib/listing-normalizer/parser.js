// parser.js — title text → bestMatch model
// Algoritme:
//   1. Lowercase + normaliseer spaties/hyphens
//   2. Strip merk-naam uit titel (om make-name niet als model te matchen)
//   3. Voor elke (canonical_model, aliases): probeer langste alias matchen
//      met whole-word grenzen
//   4. Bij meerdere matches: kies langste alias (Altea XL > Altea)
//   5. Geen match: return null

const { TAXONOMY } = require("./taxonomy")

function _norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[-_]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

// Cache van pre-gesorteerde aliases per make (langste eerst, voor longest-match)
const _aliasCache = {}
function _getOrderedAliases(makeLower) {
  if (_aliasCache[makeLower]) return _aliasCache[makeLower]
  const taxonomy = TAXONOMY[makeLower]
  if (!taxonomy) return null
  const all = []
  for (const canonical of Object.keys(taxonomy)) {
    for (const alias of taxonomy[canonical]) {
      all.push({ canonical, alias: _norm(alias), len: alias.length })
    }
  }
  // Sorteer op alias-lengte desc — langere matches eerst
  all.sort((a, b) => b.len - a.len)
  _aliasCache[makeLower] = all
  return all
}

// Whole-word match helper — alias staat tussen word-boundaries OF aan begin/eind
function _wholeWordMatch(haystack, alias) {
  if (!alias) return false
  // alias kan al spaties bevatten ("3 serie") — dan letterlijk subtring met boundary check
  // boundary = niet alfanumeriek
  const a = alias
  let idx = haystack.indexOf(a)
  while (idx >= 0) {
    const before = idx === 0 ? "" : haystack[idx - 1]
    const after = idx + a.length === haystack.length ? "" : haystack[idx + a.length]
    const boundaryBefore = !before || !/[a-z0-9]/.test(before)
    const boundaryAfter = !after || !/[a-z0-9]/.test(after)
    if (boundaryBefore && boundaryAfter) return true
    idx = haystack.indexOf(a, idx + 1)
  }
  return false
}

function parseTitle(makeLower, rawTitle) {
  if (!rawTitle) return null
  const make = _norm(makeLower)
  const title = _norm(rawTitle)
  const aliases = _getOrderedAliases(make)
  if (!aliases) return null

  // Strip merk-naam (en gangbare aliases) uit titel om te voorkomen dat make matched op model
  let cleaned = title
  // strip the make first (and common short forms)
  const makeForms = [make, make.replace("-", " "), make.replace(" ", "-"), make.replace("-", "")]
  for (const m of makeForms) {
    cleaned = cleaned.split(m).join(" ")
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim()

  // probeer aliases in lengte-desc volgorde
  for (const { canonical, alias } of aliases) {
    if (_wholeWordMatch(cleaned, alias)) {
      return { normalized_model: canonical, alias_matched: alias }
    }
  }
  return null
}

module.exports = { parseTitle, _norm }
