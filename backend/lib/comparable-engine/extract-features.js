// T4C Comparable Engine — Step 5: Feature Extraction
// Extracts structured features from listing title/description for scoring

const TRIM_CORES = {
  premium: ['amg','m-sport','m sport','m-pakket','s-line','s line','r-line','r line','gt','gt-line','rs','competition','performance','individual','designo','n-line','n line','gr','trd','nismo','sti','vrs','cupra','abt'],
  executive: ['avantgarde','elegance','executive','business','luxury','inscription','momentum','xcellence','prestige','tekna','lauréate','laurin','klement'],
  mid: ['highline','comfortline','style','edition','active','design','intense','intens','allure','shine','feel','zen','lounge','life','comfort','trend','select','limited'],
  base: ['trendline','basis','base','access','expression','like','pure','essential','reference','startline'],
}

const TRANSMISSIONS = {
  automaat: ['automaat','automatic','dsg','dct','tiptronic','s-tronic','s tronic','pdk','cvt','steptronic','speedshift','multitronic','edc','eat6','eat8','powershift','robotised'],
  handgeschakeld: ['handgeschakeld','handmatig','manual','schakelbak','5-bak','6-bak','5 versnelling','6 versnelling'],
}

const FUELS = {
  benzine: ['benzine','petrol','gasoline','tsi','tfsi','turbo','vtec','vvti','mpi','fsi'],
  diesel: ['diesel','tdi','cdi','hdi','dci','d4d','crdi','jtd','blue hdi','bluehdi','ecoblue'],
  hybride: ['hybride','hybrid','phev','plug-in','e-hybrid','e hybrid'],
  elektrisch: ['elektrisch','electric','ev','bev','kwh'],
  lpg: ['lpg','gas','autogas'],
}

const BODY_TYPES = {
  sedan: ['sedan','limousine','saloon','berline'],
  hatchback: ['hatchback','hatch','5-deurs','3-deurs','5drs','3drs'],
  stationwagon: ['station','wagon','stationwagon','touring','avant','variant','break','combi','estate','sportwagen','sw','st'],
  suv: ['suv','crossover','4x4'],
  mpv: ['mpv','van','bus','multi'],
  coupe: ['coupe','coupé'],
  cabrio: ['cabrio','cabriolet','roadster','spider','spyder','convertible','targa'],
}

/**
 * Extract features from a listing's title and description.
 */
function extractFeatures(listing) {
  const text = `${listing.title || ''} ${listing.subtitle || ''} ${listing.description || ''}`.toLowerCase()

  const features = {
    trimCore: null,
    trimLevel: null,       // 'premium', 'executive', 'mid', 'base'
    trimTokens: [],
    transmission: null,
    fuel: null,
    bodyType: null,
    powerHp: null,
    drive: null,           // 'fwd', 'rwd', 'awd'
  }

  // Trim extraction
  for (const [level, terms] of Object.entries(TRIM_CORES)) {
    for (const term of terms) {
      if (text.includes(term)) {
        features.trimTokens.push(term)
        if (!features.trimCore) {
          features.trimCore = term
          features.trimLevel = level
        }
        // Prefer premium/executive over mid/base
        if ((level === 'premium' || level === 'executive') && features.trimLevel !== 'premium') {
          features.trimCore = term
          features.trimLevel = level
        }
      }
    }
  }

  // Transmission
  for (const [type, terms] of Object.entries(TRANSMISSIONS)) {
    if (terms.some(t => text.includes(t))) {
      features.transmission = type
      break
    }
  }

  // Fuel
  for (const [type, terms] of Object.entries(FUELS)) {
    if (terms.some(t => text.includes(t))) {
      features.fuel = type
      break
    }
  }

  // Body type
  for (const [type, terms] of Object.entries(BODY_TYPES)) {
    if (terms.some(t => text.includes(t))) {
      features.bodyType = type
      break
    }
  }

  // Power (HP/PK)
  const hpMatch = text.match(/(\d{2,4})\s*(?:pk|hp|ps|bhp|ch)\b/)
  if (hpMatch) {
    const hp = parseInt(hpMatch[1], 10)
    if (hp >= 50 && hp <= 1500) features.powerHp = hp
  }

  // Drive
  if (/\b(?:4x4|4wd|awd|4motion|xdrive|quattro|4matic|allgrip|alltrack|e-4motion)\b/i.test(text)) {
    features.drive = 'awd'
  }

  return features
}

module.exports = { extractFeatures, TRIM_CORES, TRANSMISSIONS, FUELS, BODY_TYPES }
