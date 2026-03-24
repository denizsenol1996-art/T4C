// T4C Twin Car Mapping — platform-equivalenten
// Dezelfde auto, ander badge. Data delen = 2-3x meer datapunten.

const TWIN_GROUPS = [
  // PSA Small
  ['TOYOTA AYGO', 'CITROEN C1', 'PEUGEOT 107'],
  ['TOYOTA AYGO', 'CITROEN C1', 'PEUGEOT 108'], // 2014+
  // PSA/Toyota new
  ['TOYOTA YARIS CROSS', 'LEXUS LBX'],
  // VW Group A0
  ['VOLKSWAGEN POLO', 'SEAT IBIZA', 'SKODA FABIA', 'AUDI A1'],
  ['VOLKSWAGEN UP', 'SEAT MII', 'SKODA CITIGO'],
  // VW Group Compact
  ['VOLKSWAGEN GOLF', 'SEAT LEON', 'SKODA OCTAVIA', 'AUDI A3'],
  ['VOLKSWAGEN TIGUAN', 'SEAT ATECA', 'SKODA KAROQ'],
  ['VOLKSWAGEN T-ROC', 'SEAT ARONA', 'SKODA KAMIQ'],
  ['VOLKSWAGEN PASSAT', 'SKODA SUPERB'],
  ['VOLKSWAGEN TOURAN', 'SEAT ALHAMBRA'],
  ['VOLKSWAGEN CADDY', 'SEAT INCA'],
  // VW Group SUV
  ['VOLKSWAGEN TOUAREG', 'AUDI Q7', 'PORSCHE CAYENNE'],
  ['VOLKSWAGEN TIGUAN', 'AUDI Q3'],
  // Renault-Nissan-Dacia
  ['RENAULT CLIO', 'NISSAN MICRA'],
  ['DACIA SANDERO', 'RENAULT SYMBOL'],
  ['RENAULT CAPTUR', 'NISSAN JUKE'],
  ['RENAULT KANGOO', 'MERCEDES CITAN'],
  ['RENAULT MASTER', 'OPEL MOVANO', 'NISSAN INTERSTAR'],
  ['RENAULT TRAFIC', 'OPEL VIVARO', 'NISSAN PRIMASTAR', 'FIAT TALENTO'],
  // PSA
  ['PEUGEOT 208', 'OPEL CORSA', 'CITROEN C3'], // 2019+ platform
  ['PEUGEOT 308', 'OPEL ASTRA', 'CITROEN C4'],
  ['PEUGEOT 3008', 'OPEL GRANDLAND', 'CITROEN C5 AIRCROSS'],
  ['PEUGEOT 2008', 'OPEL MOKKA', 'CITROEN C3 AIRCROSS'],
  ['PEUGEOT EXPERT', 'CITROEN JUMPY', 'OPEL VIVARO', 'TOYOTA PROACE'],
  ['PEUGEOT BOXER', 'CITROEN JUMPER', 'FIAT DUCATO'],
  ['PEUGEOT PARTNER', 'CITROEN BERLINGO', 'OPEL COMBO', 'TOYOTA PROACE CITY'],
  // Ford-VW LCV
  ['FORD TRANSIT CUSTOM', 'VOLKSWAGEN TRANSPORTER'],
  // Toyota-Suzuki
  ['TOYOTA YARIS', 'MAZDA 2'],
  ['SUZUKI SWIFT', 'SUBARU JUSTY'],
  ['SUZUKI SX4 S-CROSS', 'FIAT SEDICI'],
  ['SUZUKI VITARA', 'TOYOTA RAV4'], // loosely comparable
  // Hyundai-Kia
  ['HYUNDAI I10', 'KIA PICANTO'],
  ['HYUNDAI I20', 'KIA RIO'],
  ['HYUNDAI I30', 'KIA CEED'],
  ['HYUNDAI TUCSON', 'KIA SPORTAGE'],
  ['HYUNDAI KONA', 'KIA STONIC'],
  ['HYUNDAI SANTA FE', 'KIA SORENTO'],
  ['HYUNDAI IONIQ 5', 'KIA EV6'],
  // Mercedes-BMW-Audi segments (loose, price-class equivalent)
  ['BMW 1 SERIE', 'AUDI A3', 'MERCEDES A-KLASSE'],
  ['BMW 3 SERIE', 'AUDI A4', 'MERCEDES C-KLASSE'],
  ['BMW 5 SERIE', 'AUDI A6', 'MERCEDES E-KLASSE'],
  ['BMW X1', 'AUDI Q3', 'MERCEDES GLA'],
  ['BMW X3', 'AUDI Q5', 'MERCEDES GLC'],
  // Fiat
  ['FIAT 500', 'FIAT PANDA'],
  ['FIAT TIPO', 'FIAT EGEA'],
  // EV
  ['VOLKSWAGEN ID.3', 'CUPRA BORN'],
  ['VOLKSWAGEN ID.4', 'SKODA ENYAQ'],
]

// Build lookup: "TOYOTA AYGO" → ["CITROEN C1", "PEUGEOT 107"]
const _twinMap = new Map()
for (const group of TWIN_GROUPS) {
  for (const car of group) {
    const others = group.filter(c => c !== car)
    const existing = _twinMap.get(car) || []
    _twinMap.set(car, [...new Set([...existing, ...others])])
  }
}

/**
 * Get twin models for a given make+model
 * @param {string} make - e.g. "TOYOTA"
 * @param {string} model - e.g. "AYGO"
 * @returns {Array<{make:string, model:string}>} twin cars
 */
function getTwins(make, model) {
  const key = (make + ' ' + model).toUpperCase().trim()
  const twins = _twinMap.get(key)
  if (!twins) return []
  return twins.map(t => {
    const parts = t.split(' ')
    return { make: parts[0], model: parts.slice(1).join(' ') }
  })
}

/**
 * Query twin listings from DB and merge with primary
 * @param {Function} queryAll - db.queryAll
 * @param {string} make
 * @param {string} model
 * @param {number} year - ±1 year tolerance
 * @returns {Array} combined listings
 */
function getTwinListings(queryAll, make, model, year) {
  const twins = getTwins(make, model)
  if (!twins.length) return []

  let allTwinListings = []
  for (const tw of twins) {
    try {
      const listings = queryAll(
        `SELECT *, '${tw.make} ${tw.model}' as twin_source FROM market_listings
         WHERE UPPER(make)=? AND UPPER(model) LIKE ? AND year BETWEEN ? AND ? AND status='active' AND price > 0`,
        [tw.make.toUpperCase(), '%' + tw.model.toUpperCase() + '%', year - 1, year + 1]
      )
      allTwinListings = allTwinListings.concat(listings)
    } catch (e) { /* skip failed twin query */ }
  }
  return allTwinListings
}

module.exports = { getTwins, getTwinListings, TWIN_GROUPS }
