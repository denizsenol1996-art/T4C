// T4C Comparable Engine — Test Suite
// Run: node test.js

const { parseListingPrice } = require('./parse-price')
const { filterJunk } = require('./junk-filter')
const { dedupeListings } = require('./dedupe')
const { extractFeatures } = require('./extract-features')
const { scoreComparable } = require('./score-comparable')
const { normalizeComparable } = require('./normalize-comparable')
const { removeOutliers } = require('./outlier-filter')
const { buildMarketStats } = require('./build-market-stats')
const { buildComparableConfidence } = require('./confidence')
const { buildComparableSet } = require('./index')

let passed = 0, failed = 0
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`) }
  else { failed++; console.log(`  ✗ FAIL: ${msg}`) }
}

// ════════════════════════════════════════
// 1. PRICE PARSER TESTS
// ════════════════════════════════════════
console.log('\n═══ PRICE PARSER ═══')

// Must reject
;[
  ['€ 201', 'too low €201'],
  ['€ 99 p/m', 'monthly price'],
  ['Vanaf € 299 per maand', 'monthly from'],
  ['Bieden', 'bidding'],
  ['Prijs op aanvraag', 'price on request'],
  ['€ 3.950 aanbetaling', 'deposit'],
  [null, 'null input'],
  ['', 'empty string'],
  ['n.o.t.k.', 'notk'],
  ['Verkocht', 'sold'],
  ['€ 150', 'below 500'],
  ['Gereserveerd', 'reserved'],
  ['Financial lease € 450 p/m', 'financial lease'],
].forEach(([input, label]) => {
  const r = parseListingPrice(input)
  assert(r.parsedPrice === null, `Reject: ${label} → ${JSON.stringify(r.priceFlags)}`)
})

// Must accept
;[
  ['€ 8.950', 8950, 'standard NL price'],
  ['8950', 8950, 'plain number'],
  ['8.950,-', 8950, 'trailing comma-dash'],
  ['EUR 14.450', 14450, 'EUR prefix'],
  [8950, 8950, 'numeric input'],
  ['€ 1.250', 1250, 'low but valid'],
  ['€24.995', 24995, 'no space'],
  ['€ 45.000', 45000, 'round number'],
].forEach(([input, expected, label]) => {
  const r = parseListingPrice(input)
  assert(r.parsedPrice === expected, `Accept: ${label} → ${r.parsedPrice} (expected ${expected})`)
})

// ════════════════════════════════════════
// 2. JUNK FILTER TESTS
// ════════════════════════════════════════
console.log('\n═══ JUNK FILTER ═══')

const target = { make: 'Mercedes-Benz', model: 'E-Klasse', year: 2011, km: 269000 }

// Must reject
;[
  [{ title: 'Mercedes E350 schade auto diesel' }, 'schade auto'],
  [{ title: 'Mercedes E-klasse onderdelen' }, 'onderdelen'],
  [{ title: 'Export only Mercedes E350' }, 'export only'],
  [{ title: 'Mercedes E350 motor defect' }, 'motor defect'],
  [{ title: 'Total loss Mercedes E350' }, 'total loss'],
  [{ title: 'Mercedes E350 sloop' }, 'sloop'],
  [{ title: 'Ab', km: null, year: null }, 'no title + no km/year'],
  [{ title: 'BMW 320d Sedan diesel automaat', km: 150000, year: 2012 }, 'make mismatch (BMW vs Mercedes)'],
].forEach(([listing, label]) => {
  const r = filterJunk({ parsedPrice: 8000, ...listing }, target)
  assert(r.isRejected === true, `Reject junk: ${label}`)
})

// Must accept
;[
  [{ title: 'Mercedes E350 CDI Avantgarde automaat', km: 274000, year: 2011 }, 'exact match'],
  [{ title: 'Mercedes E-Klasse 350 diesel', km: 200000, year: 2012 }, 'close match'],
  [{ title: 'Mercedes E250 CDI automaat', km: 180000, year: 2013 }, 'trim variant'],
].forEach(([listing, label]) => {
  const r = filterJunk({ parsedPrice: 8000, ...listing }, target)
  assert(r.isRejected === false, `Accept: ${label}`)
})

// Soft penalties
const softResult = filterJunk({ title: 'Mercedes E350 import geen nap', km: 200000, year: 2011, parsedPrice: 8000 }, target)
assert(softResult.isRejected === false, 'Soft penalty: import+geen nap not rejected')
assert(softResult.softPenalties.length >= 2, `Soft penalty: ${softResult.softPenalties.length} penalties applied`)

// ════════════════════════════════════════
// 3. DEDUPLICATION TESTS
// ════════════════════════════════════════
console.log('\n═══ DEDUPLICATION ═══')

const dupeListings = [
  { title: 'Mercedes E350 CDI Automaat', parsedPrice: 8950, km: 270000, year: 2011, source: 'Marktplaats', url: 'http://mp.nl/1' },
  { title: 'Mercedes E350 CDI automaat', parsedPrice: 8950, km: 272000, year: 2011, source: 'AutoScout24', url: 'http://as.nl/1' },  // dupe
  { title: 'Mercedes E250 CDI Business', parsedPrice: 7500, km: 200000, year: 2012, source: 'Marktplaats', url: 'http://mp.nl/2' },   // different
  { title: 'Mercedes E350 CDI Automaat', parsedPrice: 9100, km: 268000, year: 2011, source: 'Gaspedaal', url: null },  // dupe (close price bucket)
]
const { deduped, removedCount } = dedupeListings(dupeListings)
assert(removedCount >= 1, `Dedup: removed ${removedCount} duplicates`)
assert(deduped.length <= 3, `Dedup: ${deduped.length} remaining (expected ≤3)`)

// ════════════════════════════════════════
// 4. FEATURE EXTRACTION TESTS
// ════════════════════════════════════════
console.log('\n═══ FEATURE EXTRACTION ═══')

const feat1 = extractFeatures({ title: 'Mercedes E350 CDI Avantgarde automaat diesel 231pk' })
assert(feat1.transmission === 'automaat', `Feature: transmission=${feat1.transmission}`)
assert(feat1.fuel === 'diesel', `Feature: fuel=${feat1.fuel}`)
assert(feat1.trimCore === 'avantgarde', `Feature: trim=${feat1.trimCore}`)
assert(feat1.trimLevel === 'executive', `Feature: trimLevel=${feat1.trimLevel}`)
assert(feat1.powerHp === 231, `Feature: power=${feat1.powerHp}`)

const feat2 = extractFeatures({ title: 'BMW 535i M-Sport xDrive automaat' })
assert(feat2.trimLevel === 'premium', `Feature: BMW M-Sport → premium`)
assert(feat2.drive === 'awd', `Feature: xDrive → awd`)
assert(feat2.transmission === 'automaat', `Feature: automaat`)

const feat3 = extractFeatures({ title: 'Seat Leon 1.6 TDI Style handgeschakeld' })
assert(feat3.fuel === 'diesel', `Feature: TDI → diesel`)
assert(feat3.transmission === 'handgeschakeld', `Feature: handgeschakeld`)
assert(feat3.trimLevel === 'mid', `Feature: Style → mid`)

// ════════════════════════════════════════
// 5. COMPARABLE SCORING TESTS
// ════════════════════════════════════════
console.log('\n═══ COMPARABLE SCORING ═══')

const scoringTarget = {
  make: 'Mercedes-Benz',
  model: 'E-Klasse',
  generation: 'W212',
  year: 2011,
  km: 269000,
  powerHp: 231,
  fuel: 'Diesel',
  transmission: 'Automaat',
  _features: { fuel: 'diesel', transmission: 'automaat', trimCore: 'avantgarde', trimLevel: 'executive', powerHp: 231, bodyType: 'sedan' }
}

// Exact match → should score 80+
const exactComp = {
  title: 'Mercedes E350 CDI Avantgarde automaat W212',
  year: 2011, km: 274000,
  _features: { fuel: 'diesel', transmission: 'automaat', trimCore: 'avantgarde', trimLevel: 'executive', powerHp: 231, bodyType: 'sedan' },
  _softPenalties: [],
}
const s1 = scoreComparable(scoringTarget, exactComp)
assert(s1.score >= 80, `Score exact match: ${s1.score} (expect 80+) — band=${s1.band}`)
assert(s1.band === 'strong', `Band: strong`)

// Benzine handgeschakeld 2008 → should NOT be strong
const weakComp = {
  title: 'Mercedes E200 benzine handgeschakeld',
  year: 2008, km: 180000,
  _features: { fuel: 'benzine', transmission: 'handgeschakeld', trimCore: null, trimLevel: null, powerHp: 184, bodyType: 'sedan' },
  _softPenalties: [],
}
const s2 = scoreComparable(scoringTarget, weakComp)
assert(s2.band !== 'strong', `Score weak match: ${s2.score} band=${s2.band} (expect NOT strong)`)

// C-Klasse → would need make mismatch detection (but our scrapers search by model)
// So we test a totally different trim/fuel
const veryWeak = {
  title: 'Mercedes E200 CGI Elegance handgeschakeld benzine',
  year: 2014, km: 120000,
  _features: { fuel: 'benzine', transmission: 'handgeschakeld', trimCore: 'elegance', trimLevel: 'executive', powerHp: 184 },
  _softPenalties: [],
}
const s3 = scoreComparable(scoringTarget, veryWeak)
assert(s3.score < 65, `Score very different: ${s3.score} (expect <65)`)

// ════════════════════════════════════════
// 6. NORMALIZATION TESTS
// ════════════════════════════════════════
console.log('\n═══ NORMALIZATION ═══')

const normTarget = { make: 'Mercedes-Benz', model: 'E-Klasse', year: 2011, km: 269000, _features: { transmission: 'automaat', trimLevel: 'executive' } }

// Listing with less km → should normalize DOWN (target has more km = less valuable)
const normListing1 = { parsedPrice: 9500, km: 200000, year: 2011, _features: { transmission: 'automaat', trimLevel: 'executive' } }
const np1 = normalizeComparable(normTarget, normListing1)
assert(np1 < 9500, `Normalize: less km (200k vs 269k) → price down from 9500 to ${np1}`)

// Listing with more km → should normalize UP
const normListing2 = { parsedPrice: 7500, km: 320000, year: 2011, _features: { transmission: 'automaat', trimLevel: 'executive' } }
const np2 = normalizeComparable(normTarget, normListing2)
assert(np2 > 7500, `Normalize: more km (320k vs 269k) → price up from 7500 to ${np2}`)

// Listing from 2013 → should normalize DOWN (target is older = less valuable)
const normListing3 = { parsedPrice: 11000, km: 269000, year: 2013, _features: { transmission: 'automaat', trimLevel: 'executive' } }
const np3 = normalizeComparable(normTarget, normListing3)
assert(np3 < 11000, `Normalize: newer comp (2013 vs 2011) → price down from 11000 to ${np3}`)

// ════════════════════════════════════════
// 7. OUTLIER REMOVAL TESTS
// ════════════════════════════════════════
console.log('\n═══ OUTLIER REMOVAL ═══')

const outlierSet = [
  { normalizedPrice: 8450, title: 'a' },
  { normalizedPrice: 8750, title: 'b' },
  { normalizedPrice: 8950, title: 'c' },
  { normalizedPrice: 9150, title: 'd' },
  { normalizedPrice: 9300, title: 'e' },
  { normalizedPrice: 201, title: 'outlier_low' },
  { normalizedPrice: 18950, title: 'outlier_high' },
]
const { filtered, removedCount: outlierRm } = removeOutliers(outlierSet)
assert(outlierRm >= 2, `Outliers removed: ${outlierRm} (expect ≥2)`)
assert(!filtered.some(c => c.normalizedPrice === 201), 'Outlier 201 removed')
assert(!filtered.some(c => c.normalizedPrice === 18950), 'Outlier 18950 removed')
assert(filtered.some(c => c.normalizedPrice === 8950), 'Normal price 8950 kept')

// ════════════════════════════════════════
// 8. FULL PIPELINE TEST — E350 CDI
// ════════════════════════════════════════
console.log('\n═══ FULL PIPELINE — Mercedes E350 CDI ═══')

const fullTarget = {
  make: 'Mercedes-Benz',
  model: 'E-Klasse',
  generation: 'W212',
  trim: 'E 350 CDI Avantgarde',
  bodyType: 'Sedan',
  fuel: 'Diesel',
  transmission: 'Automaat',
  year: 2011,
  km: 269000,
  powerHp: 231,
}

const fullListings = [
  // Good matches
  { title: 'Mercedes E350 CDI Avantgarde automaat W212 diesel', price: 8950, km: 274000, year: 2011, source: 'Marktplaats', dealer: 'AutoDealer BV' },
  { title: 'Mercedes E350 CDI Avantgarde automaat diesel', price: 9200, km: 250000, year: 2011, source: 'AutoScout24', dealer: 'Cars4You' },
  { title: 'Mercedes E350 CDI Elegance automaat', price: 8500, km: 290000, year: 2011, source: 'AutoTrack', dealer: 'EuroCars' },
  { title: 'Mercedes E350 CDI automaat', price: 9500, km: 230000, year: 2012, source: 'Gaspedaal', dealer: '' },
  { title: 'Mercedes E350 CDI Business automaat diesel', price: 8200, km: 310000, year: 2010, source: 'Autowereld', dealer: 'Fleet Direct' },
  { title: 'Mercedes E350 CDI Avantgarde automaat', price: 9800, km: 220000, year: 2012, source: 'ViaBovag', dealer: 'MB Select' },
  { title: 'Mercedes E250 CDI Avantgarde automaat', price: 7800, km: 260000, year: 2011, source: 'Marktplaats', dealer: '' },
  // Weak matches
  { title: 'Mercedes E200 CDI handgeschakeld', price: 6500, km: 200000, year: 2013, source: 'Marktplaats', dealer: '' },
  { title: 'Mercedes E350 benzine automaat', price: 7500, km: 180000, year: 2011, source: 'AutoScout24', dealer: '' },
  // Junk — should be filtered
  { title: 'Mercedes E350 CDI schade auto', price: 3500, km: 300000, year: 2011, source: 'Marktplaats', dealer: '' },
  { title: 'Mercedes E-Klasse onderdelen W212', price: 1200, km: null, year: null, source: 'Marktplaats', dealer: '' },
  // Bad prices — should be filtered
  { title: 'Mercedes E350 CDI automaat', price: '€ 299 p/m', km: 260000, year: 2011, source: 'AutoScout24', dealer: '' },
  { title: 'Mercedes E350 CDI', price: 201, km: 270000, year: 2011, source: 'Gaspedaal', dealer: '' },
  // Duplicate
  { title: 'Mercedes E350 CDI Avantgarde automaat', price: 8950, km: 275000, year: 2011, source: 'Gaspedaal', dealer: '' },
]

const result = buildComparableSet(fullTarget, fullListings)

console.log('\nResult:')
console.log(`  status: ${result.status}`)
console.log(`  rawCount: ${result.rawCount}`)
console.log(`  cleanCount: ${result.cleanCount}`)
console.log(`  strongCount: ${result.strongCount}`)
console.log(`  secondaryCount: ${result.secondaryCount}`)
console.log(`  marketMedian: €${result.marketMedian}`)
console.log(`  marketP25: €${result.marketP25}`)
console.log(`  marketP75: €${result.marketP75}`)
console.log(`  marketSpread: €${result.marketSpread}`)
console.log(`  confidence: ${result.confidenceComparable}`)
if (result._debug) {
  console.log(`  _debug: priceReject=${result._debug.priceRejectCount} junkReject=${result._debug.junkRejectCount} dedupeRm=${result._debug.dedupeRemoved} outlierRm=${result._debug.outlierRemoved}`)
}

console.log('\nComparables:')
for (const c of (result.comparables || [])) {
  console.log(`  [${c.scoreBand}] ${c.score}pts | €${c.parsedPrice} → €${c.normalizedPrice} | ${c.km ? c.km + 'km' : 'no km'} | ${c.title.slice(0, 50)}`)
}

assert(result.status === 'ok', `Pipeline status: ${result.status}`)
assert(result.rawCount === fullListings.length, `Raw count: ${result.rawCount}`)
assert(result.cleanCount >= 5, `Clean count: ${result.cleanCount} (expect ≥5)`)
assert(result.strongCount >= 1, `Strong count: ${result.strongCount} (expect ≥1)`)
assert(result.marketMedian > 7000 && result.marketMedian < 12000, `Median: €${result.marketMedian} (expect 7000-12000)`)
assert(result.confidenceComparable >= 30, `Confidence: ${result.confidenceComparable} (expect ≥30)`)
assert(!result.comparables.some(c => c.parsedPrice === 201), 'No €201 in results')
assert(!result.comparables.some(c => c.title.includes('schade')), 'No schade listings in results')
assert(!result.comparables.some(c => c.title.includes('onderdelen')), 'No onderdelen in results')

// ════════════════════════════════════════
// 9. FULL PIPELINE TEST — Referentieprijzen
// ════════════════════════════════════════
console.log('\n═══ REFERENCE PRICE CHECK ═══')

// The E350 CDI 269k should give a market median in the ballpark of inkoop 4700-5350 (= retail ~8000-10000 range)
assert(
  result.marketMedian >= 7500 && result.marketMedian <= 11000,
  `E350 CDI median €${result.marketMedian} in expected retail range (7500-11000)`
)

// ════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`)
console.log(`TESTS: ${passed} passed, ${failed} failed, ${passed + failed} total`)
console.log(`${'═'.repeat(50)}`)
process.exit(failed > 0 ? 1 : 0)
