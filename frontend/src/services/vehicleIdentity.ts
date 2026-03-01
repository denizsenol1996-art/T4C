/* ═══════════════════════════════════════════════════════════════════════════
   T4C Vehicle Identity Engine v2.0
   Comprehensive make/model/submodel/engine/transmission detection
   
   Covers ALL major brands sold in NL with:
   - SubModel detection (performance/special variants that change pricing)
   - Engine type naming per brand per era
   - Transmission detection
   - Equipment level detection
   - Power-based fallback identification
   ═══════════════════════════════════════════════════════════════════════════ */

export type VehicleIdentity = {
  engineType: string          // "TSI", "TDI", "PureTech", "SKYACTIV-G", etc.
  engineLabel: string         // "1.5 TSI" or "Cooper S" or "2.0 SKYACTIV-G"
  transmissionType: string    // "Handgeschakeld" | "Automaat" | "DSG" | "CVT" etc.
  transmissionAuto: boolean
  gearCount?: number
  equipmentLevel: string      // "Basis" | "Comfort" | "Sport" | "Luxe"
  modelVariant: string        // "1.5 TSI 150pk DSG FR"
  subModel: string            // "cupra", "gti", "rs", "amg", "gr-sport" etc.
}

type DetectInput = {
  make: string; model: string; trim: string; year: number
  fuel: string; fuelSecondary: string
  engineCapacity: number; powerKw?: number; powerHp?: number
  allText: string  // Combined text from all RDW fields for keyword searching
  catalogPrice?: number    // RDW catalog price — used for price-tier trim detection
  typeCode?: string        // RDW type + uitvoering codes combined
  vin?: string             // VIN for grade decode
  weightKg?: number        // Leeggewicht — used for trim detection
}

// ══════════════════════════════════════════════════════════
// SUBMODEL DATABASE — performance/special variants
// These CHANGE the scraper search: "golf gti" ≠ "golf"
// ══════════════════════════════════════════════════════════

// Text-based patterns (checked first)
const SUB_PATTERNS: [RegExp, string][] = [
  // ── Toyota / Lexus ──
  [/\bgr[\s-]*sport\b/i, "gr-sport"],
  [/\bgazoo\b/i, "gr"],
  [/\bgr\b(?![\s-]*sport)/i, "gr"],
  [/\btrd\b/i, "trd"],
  [/\bf[\s-]*sport\b/i, "f-sport"],  // Lexus F Sport

  // ── Seat / Cupra ──
  [/cupra\s*r\b/i, "cupra r"],
  [/\bcupra\b/i, "cupra"],

  // ── VW ──
  [/\bgti\s*tcr\b/i, "gti tcr"],
  [/\bgti\s*clubsport\b/i, "gti clubsport"],
  [/\bgti\b/i, "gti"],
  [/\bgtd\b/i, "gtd"],
  [/\bgte\b/i, "gte"],
  [/\bgolf\s*r\b/i, "r"],
  [/\br32\b/i, "r32"],
  [/\br36\b/i, "r36"],
  [/\barteon\s*r\b/i, "r"],
  [/\bt[\s-]*roc\s*r\b/i, "r"],
  [/\btouareg\s*r\b/i, "r"],
  [/\btiguan\s*r\b/i, "r"],

  // ── Audi ──
  [/\brs[\s-]*q?\s*\d/i, "rs"],     // RS3, RS4, RS5, RS6, RS7, RSQ3, RSQ8
  [/\brs\b/i, "rs"],
  [/\bs[\s-]?\d(?![\s-]*line)/i, "s"], // S3, S4, S5 but NOT s-line
  [/\be[\s-]*tron\s*gt/i, "e-tron gt"],
  [/\be[\s-]*tron\s*s\b/i, "e-tron s"],
  [/\be[\s-]*tron\b/i, "e-tron"],
  [/\bsq\d/i, "sq"],                // SQ5, SQ7, SQ8

  // ── BMW ──
  [/\bm\s*\d{1}\s*cs\b/i, "m cs"],  // M3 CS, M4 CS
  [/\bm\s*\d{3,}/i, "m"],            // M135i, M240i, M340i, M550i
  [/\bm\d\b/i, "m"],                 // M2, M3, M4, M5, M6, M8
  [/\bm[\s-]*performance/i, "m"],
  [/\balpina\b/i, "alpina"],
  [/\bix\s*m/i, "m"],               // iX M60
  [/\bi\d+\s*m/i, "m"],             // i4 M50

  // ── Mercedes-Benz ──
  [/\bamg\s*gt/i, "amg gt"],
  [/\bamg\b/i, "amg"],
  [/\bmaybach\b/i, "maybach"],
  [/\beq[a-z]*\b/i, "eq"],          // EQA, EQB, EQC, EQE, EQS

  // ── MINI ──
  [/\bjcw\b/i, "jcw"],
  [/john\s*cooper\s*works/i, "jcw"],
  [/cooper\s*se\b/i, "cooper se"],   // Electric Cooper
  [/cooper\s*sd\b/i, "cooper sd"],
  [/cooper\s*s\b/i, "cooper s"],
  [/cooper\s*d\b/i, "cooper d"],

  // ── Ford ──
  [/\bst[\s-]*\d/i, "st"],           // ST-2, ST-3 (trim of ST)
  [/\bst\b(?![\s-]*(?:line|yle))/i, "st"],  // ST but not ST-Line or Style
  [/\brs\b/i, "rs"],                 // Focus RS
  [/\bvignale\b/i, "vignale"],
  [/\braptor\b/i, "raptor"],

  // ── Renault ──
  [/\brs\s*trophy\b/i, "rs trophy"],
  [/\brs\b/i, "rs"],
  [/\btrophy\b(?!\s*rs)/i, "trophy"],
  [/\balpine\b/i, "alpine"],

  // ── Peugeot ──
  [/\bgti\b/i, "gti"],
  [/\bpse\b/i, "pse"],              // Peugeot Sport Engineered

  // ── Citroën / DS ──
  [/\bds\s*performance/i, "performance"],

  // ── Opel / Vauxhall ──
  [/\bopc\b/i, "opc"],              // Opel Performance Center
  [/\bgse\b/i, "gse"],              // Grand Sport Electric
  [/\bgsi\b/i, "gsi"],

  // ── Fiat ──
  [/\babarth\b/i, "abarth"],
  [/\b595\b.*abarth|abarth.*\b595\b/i, "abarth 595"],
  [/\b695\b.*abarth|abarth.*\b695\b/i, "abarth 695"],

  // ── Alfa Romeo ──
  [/\bquadrifoglio\b/i, "quadrifoglio"],
  [/\bqv\b/i, "qv"],
  [/\bveloce\b/i, "veloce"],
  [/\bcompetizione\b/i, "competizione"],

  // ── Honda ──
  [/\btype[\s-]*r\b/i, "type r"],
  [/\bmugen\b/i, "mugen"],
  [/\bvtec\s*turbo/i, "vtec turbo"],

  // ── Nissan ──
  [/\bnismo\b/i, "nismo"],
  [/\bautech\b/i, "autech"],

  // ── Mazda ──
  [/\bmps\b/i, "mps"],              // Mazda Performance Series
  [/\bsport\s*nav/i, "sport nav"],

  // ── Hyundai ──
  [/\bn[\s-]*performance/i, "n"],
  [/\bn[\s-]*line\b/i, "n-line"],   // Not performance but sport-look
  [/\bn\b(?![\s-]*(?:line|avi))/i, "n"],  // N but not N-Line or Navigation

  // ── Kia ──
  [/\bgt[\s-]*line\b/i, "gt-line"],
  [/\bgt\b(?![\s-]*line)/i, "gt"],  // EV6 GT, Stinger GT

  // ── Volvo ──
  [/\bpolestar\s*engineered/i, "polestar"],
  [/\bpolestar\b/i, "polestar"],
  [/\brecharge\b/i, "recharge"],     // PHEV/EV line

  // ── Škoda ──
  [/\bvrs\b/i, "vrs"],
  [/\brs\b/i, "vrs"],               // Škoda uses RS = vRS

  // ── Suzuki ──
  [/\bsport\b/i, "sport"],
  [/\bboosterjet\b/i, "boosterjet"],

  // ── Mitsubishi ──
  [/\bralliart\b/i, "ralliart"],
  [/\bevo\b/i, "evo"],
  [/\boutlander\s*phev/i, "phev"],

  // ── Subaru ──
  [/\bsti\b/i, "sti"],
  [/\bwrx\b/i, "wrx"],
  [/\bspec[\s-]*b\b/i, "spec b"],
  [/\be[\s-]*boxer\b/i, "e-boxer"],

  // ── Jaguar ──
  [/\bsvr\b/i, "svr"],
  [/\bsvo\b/i, "svo"],
  [/\br[\s-]*sport\b/i, "r-sport"],
  [/\br[\s-]*dynamic\b/i, "r-dynamic"],

  // ── Land Rover / Range Rover ──
  [/\bsvr\b/i, "svr"],
  [/\bsvautobiography/i, "sv"],
  [/\bautobiography/i, "autobiography"],
  [/\bhse\b/i, "hse"],
  [/\bdynamic\s*se\b/i, "dynamic se"],

  // ── Porsche ──
  [/\bgts\b/i, "gts"],
  [/\bgt[\s-]*\d/i, "gt"],          // GT2, GT3, GT4
  [/\bturbo\s*s\b/i, "turbo s"],
  [/\bturbo\b(?!\s*s)/i, "turbo"],
  [/\btarga\b/i, "targa"],
  [/\bcarrera\s*s\b/i, "carrera s"],
  [/\bcarrera\s*4s\b/i, "carrera 4s"],
  [/\bcarrera\b/i, "carrera"],
  [/\bcayenne\s*coupe/i, "coupe"],
  [/\bspyder\b/i, "spyder"],
  [/\bweissach/i, "weissach"],

  // ── Maserati ──
  [/\btrofeo\b/i, "trofeo"],
  [/\bmc[\s-]*edition/i, "mc"],
  [/\bgranlusso/i, "granlusso"],
  [/\bgransport/i, "gransport"],

  // ── Aston Martin ──
  [/\bvantage\b/i, "vantage"],
  [/\bvolante\b/i, "volante"],
  [/\bdb\d+/i, "db"],

  // ── Lotus ──
  [/\bsport\s*\d{3}/i, "sport"],    // Sport 220, Sport 350

  // ── Cupra (standalone brand) ──
  [/\bvz\b/i, "vz"],                // VZ = top trim
  [/\be[\s-]*hybrid/i, "e-hybrid"],

  // ── Dacia ──
  [/\bextreme\b/i, "extreme"],      // Top trim
  [/\bjourney\b/i, "journey"],

  // ── MG ──
  [/\bluxury\b/i, "luxury"],
  [/\btrophy\b/i, "trophy"],

  // ── Genesis ──
  [/\bsport\b/i, "sport"],

  // ── Jeep ──
  [/\btrailhawk\b/i, "trailhawk"],
  [/\brubicon\b/i, "rubicon"],
  [/\bsahara\b/i, "sahara"],
  [/\bsrt\b/i, "srt"],
  [/\btrackhawk\b/i, "trackhawk"],

  // ── Dodge / Chrysler ──
  [/\bhellcat\b/i, "hellcat"],
  [/\bsrt\b/i, "srt"],
  [/\bscat\s*pack/i, "scat pack"],
]

// Power-based fallback detection: make + model + minHP → subModel
// Used when RDW text doesn't contain the submodel name
type PowerRule = { make: RegExp; model: RegExp; minHp: number; maxHp?: number; sub: string; fuel?: string }
const POWER_RULES: PowerRule[] = [
  // ── VW ──
  { make: /volkswagen/i, model: /golf/i, minHp: 200, sub: "gti", fuel: "benzine" },
  { make: /volkswagen/i, model: /golf/i, minHp: 300, sub: "r", fuel: "benzine" },
  { make: /volkswagen/i, model: /golf/i, minHp: 184, maxHp: 199, sub: "gtd", fuel: "diesel" },
  { make: /volkswagen/i, model: /polo/i, minHp: 150, sub: "gti" },
  { make: /volkswagen/i, model: /up/i, minHp: 100, sub: "gti" },
  { make: /volkswagen/i, model: /t-roc/i, minHp: 280, sub: "r" },
  { make: /volkswagen/i, model: /tiguan/i, minHp: 300, sub: "r" },
  { make: /volkswagen/i, model: /arteon/i, minHp: 300, sub: "r" },
  { make: /volkswagen/i, model: /scirocco/i, minHp: 250, sub: "r" },

  // ── Seat / Cupra ──
  { make: /seat|cupra/i, model: /leon/i, minHp: 180, sub: "cupra" },
  { make: /seat|cupra/i, model: /ibiza/i, minHp: 150, sub: "cupra" },
  { make: /seat|cupra/i, model: /ateca/i, minHp: 280, sub: "cupra" },
  { make: /seat|cupra/i, model: /formentor/i, minHp: 245, sub: "vz" },

  // ── Audi ──
  { make: /audi/i, model: /a3|a4|a5|a6|a7|a8/i, minHp: 280, sub: "s" },
  { make: /audi/i, model: /a3|a4|a5|a6|a7|a8/i, minHp: 400, sub: "rs" },
  { make: /audi/i, model: /q3|q5|q7|q8/i, minHp: 350, sub: "sq" },
  { make: /audi/i, model: /tt/i, minHp: 300, sub: "rs" },
  { make: /audi/i, model: /tt/i, minHp: 230, maxHp: 299, sub: "s" },

  // ── BMW ──
  { make: /bmw/i, model: /1|2|3|4|5|6|7|8|x\d|z\d/i, minHp: 340, sub: "m" },
  { make: /bmw/i, model: /m\d/i, minHp: 1, sub: "m" },  // M2, M3, M4, M5 etc always M

  // ── Mercedes ──
  { make: /mercedes/i, model: /a\s*\d|b\s*\d|c\s*\d|e\s*\d|s\s*\d|gl|cl|sl|g\s*\d/i, minHp: 360, sub: "amg" },

  // ── Ford ──
  { make: /ford/i, model: /focus/i, minHp: 225, sub: "st" },
  { make: /ford/i, model: /focus/i, minHp: 330, sub: "rs" },
  { make: /ford/i, model: /fiesta/i, minHp: 140, sub: "st" },
  { make: /ford/i, model: /puma/i, minHp: 186, sub: "st" },
  { make: /ford/i, model: /mustang/i, minHp: 400, sub: "gt" },
  { make: /ford/i, model: /kuga/i, minHp: 220, sub: "st-line" },
  { make: /ford/i, model: /ranger/i, minHp: 250, sub: "raptor" },

  // ── Renault ──
  { make: /renault/i, model: /clio/i, minHp: 200, sub: "rs" },
  { make: /renault/i, model: /megane/i, minHp: 250, sub: "rs" },
  { make: /renault/i, model: /megane/i, minHp: 300, sub: "rs trophy" },

  // ── Peugeot ──
  { make: /peugeot/i, model: /208/i, minHp: 200, sub: "gti" },
  { make: /peugeot/i, model: /308/i, minHp: 250, sub: "gti" },
  { make: /peugeot/i, model: /508/i, minHp: 350, sub: "pse" },

  // ── Opel ──
  { make: /opel/i, model: /corsa/i, minHp: 190, sub: "opc" },
  { make: /opel/i, model: /astra/i, minHp: 250, sub: "opc" },
  { make: /opel/i, model: /insignia/i, minHp: 260, sub: "opc" },

  // ── Honda ──
  { make: /honda/i, model: /civic/i, minHp: 200, sub: "type r" },
  { make: /honda/i, model: /nsx/i, minHp: 1, sub: "nsx" },

  // ── Toyota ──
  { make: /toyota/i, model: /yaris/i, minHp: 200, sub: "gr" },
  { make: /toyota/i, model: /corolla/i, minHp: 260, sub: "gr" },
  { make: /toyota/i, model: /supra/i, minHp: 1, sub: "gr" },
  { make: /toyota/i, model: /86|gt86/i, minHp: 1, sub: "gt86" },

  // ── Hyundai ──
  { make: /hyundai/i, model: /i20/i, minHp: 200, sub: "n" },
  { make: /hyundai/i, model: /i30/i, minHp: 250, sub: "n" },
  { make: /hyundai/i, model: /kona/i, minHp: 250, sub: "n" },
  { make: /hyundai/i, model: /ioniq\s*5/i, minHp: 580, sub: "n" },
  { make: /hyundai/i, model: /tucson/i, minHp: 260, sub: "n-line" },

  // ── Kia ──
  { make: /kia/i, model: /ceed|cee.d/i, minHp: 200, sub: "gt" },
  { make: /kia/i, model: /stinger/i, minHp: 360, sub: "gt" },
  { make: /kia/i, model: /ev6/i, minHp: 577, sub: "gt" },

  // ── Nissan ──
  { make: /nissan/i, model: /juke/i, minHp: 200, sub: "nismo" },
  { make: /nissan/i, model: /370z|350z/i, minHp: 340, sub: "nismo" },
  { make: /nissan/i, model: /gt-r|gtr/i, minHp: 1, sub: "nismo" },

  // ── Mazda ──
  { make: /mazda/i, model: /3|6|cx-5/i, minHp: 250, sub: "mps" },
  { make: /mazda/i, model: /mx-5|miata/i, minHp: 1, sub: "mx-5" },

  // ── Alfa Romeo ──
  { make: /alfa/i, model: /giulia/i, minHp: 500, sub: "quadrifoglio" },
  { make: /alfa/i, model: /stelvio/i, minHp: 500, sub: "quadrifoglio" },
  { make: /alfa/i, model: /giulia|stelvio/i, minHp: 250, maxHp: 499, sub: "veloce" },

  // ── Fiat ──
  { make: /fiat|abarth/i, model: /500|595|695/i, minHp: 140, sub: "abarth" },

  // ── Volvo ──
  { make: /volvo/i, model: /s60|v60|xc60|s90|v90|xc90/i, minHp: 400, sub: "polestar" },

  // ── Škoda ──
  { make: /skoda|škoda/i, model: /octavia/i, minHp: 220, sub: "vrs" },
  { make: /skoda|škoda/i, model: /kodiaq/i, minHp: 220, sub: "vrs" },
  { make: /skoda|škoda/i, model: /superb/i, minHp: 270, sub: "sportline" },
  { make: /skoda|škoda/i, model: /fabia/i, minHp: 180, sub: "vrs" },

  // ── MINI ──
  { make: /mini/i, model: /cooper|one|clubman|countryman/i, minHp: 170, maxHp: 230, sub: "cooper s" },
  { make: /mini/i, model: /cooper|one|clubman|countryman/i, minHp: 231, sub: "jcw" },

  // ── Porsche ──
  { make: /porsche/i, model: /911|992|991|997|996/i, minHp: 1, sub: "carrera" },
  { make: /porsche/i, model: /cayman|boxster|718/i, minHp: 350, sub: "gts" },
  { make: /porsche/i, model: /cayenne|macan/i, minHp: 440, sub: "gts" },
  { make: /porsche/i, model: /taycan/i, minHp: 530, sub: "turbo" },

  // ── Jaguar ──
  { make: /jaguar/i, model: /f-type|f type/i, minHp: 450, sub: "svr" },
  { make: /jaguar/i, model: /xe|xf|f-pace/i, minHp: 380, sub: "svr" },

  // ── Subaru ──
  { make: /subaru/i, model: /impreza|wrx/i, minHp: 230, sub: "wrx" },
  { make: /subaru/i, model: /impreza|wrx/i, minHp: 300, sub: "sti" },

  // ── Suzuki ──
  { make: /suzuki/i, model: /swift/i, minHp: 130, sub: "sport" },

  // ── Mitsubishi ──
  { make: /mitsubishi/i, model: /lancer/i, minHp: 280, sub: "evo" },

  // ── Jeep ──
  { make: /jeep/i, model: /grand\s*cherokee/i, minHp: 700, sub: "trackhawk" },
  { make: /jeep/i, model: /wrangler/i, minHp: 270, sub: "rubicon" },
]

// ══════════════════════════════════════════════════════════
// ENGINE TYPE PER BRAND + ERA
// ══════════════════════════════════════════════════════════

type EngineRule = {
  make: RegExp
  petrol: string | ((year: number, cc: number, sub: string) => string)
  diesel: string
  hybrid?: string
  electric?: string
  yearBreak?: number  // Year where naming changed
  petrolOld?: string | ((cc: number, sub: string) => string)
}

const ENGINE_RULES: EngineRule[] = [
  // ── VAG (VW, Audi, Seat, Cupra, Škoda) ──
  {
    make: /volkswagen|seat|cupra|skoda|škoda/i,
    yearBreak: 2009,
    petrolOld: (cc: number, sub: string) => {
      if (sub === "r32") return "VR6"
      if (cc >= 2700) return "VR6"
      if (cc >= 1750 && cc <= 1850) return "1.8T"
      if (sub === "cupra" || sub === "cupra r" || sub === "gti") return "TFSI"
      // FSI era: 2002-2008 non-turbo direct injection
      if (cc >= 1950) return "FSI"    // 2.0 FSI
      if (cc >= 1550) return "FSI"    // 1.6 FSI
      if (cc >= 1350) return "FSI"    // 1.4 FSI
      return "Benzine"
    },
    petrol: (year: number, cc: number, sub: string) => {
      // TSI started 2007 (1.4 TSI), expanded 2008+
      // Some 2007-2008 models still had FSI
      if (year <= 2008 && cc >= 1950) return "FSI"  // 2.0 FSI lasted until ~2008
      return "TSI"
    },
    diesel: "TDI",
    hybrid: "eHybrid",
  },
  {
    make: /audi/i,
    yearBreak: 2009,
    petrolOld: (cc: number, sub: string) => {
      if (cc >= 2700) return "VR6"
      if (cc >= 1750 && cc <= 1850) return "1.8T"
      if (sub === "s" || sub === "rs") return "Turbo"
      // FSI era for Audi
      if (cc >= 1950) return "FSI"
      if (cc >= 1550) return "FSI"
      return "Benzine"
    },
    petrol: "TFSI",
    diesel: "TDI",
    hybrid: "TFSI e",
  },
  // ── BMW ──
  {
    make: /^bmw$/i,
    yearBreak: 2006,
    petrolOld: (_cc: number, sub: string) => sub === "m" ? "M" : "i",
    petrol: (year: number, _cc: number, sub: string) => sub === "m" ? "M" : "i",
    diesel: "d",
    hybrid: "e",
  },
  // ── MINI ──
  {
    make: /mini/i,
    petrol: (_year: number, _cc: number, sub: string) => {
      if (sub === "jcw") return "JCW"
      if (sub === "cooper s") return "Cooper S"
      if (sub === "cooper se") return "Cooper SE"
      return "Cooper"
    },
    diesel: "Cooper D",
    hybrid: "Cooper SE",
  },
  // ── Mercedes-Benz ──
  {
    make: /mercedes/i,
    yearBreak: 2010,
    petrolOld: (_cc: number, sub: string) => sub === "amg" ? "AMG" : "Kompressor",
    petrol: (_year: number, _cc: number, sub: string) => sub === "amg" ? "AMG" : "CGI",
    diesel: "CDI",
    hybrid: "EQ Power",
    electric: "EQ",
  },
  // ── Peugeot ──
  {
    make: /peugeot/i,
    yearBreak: 2014,
    petrolOld: () => "VTi",
    petrol: "PureTech",
    diesel: "BlueHDi",
    hybrid: "Hybrid",
  },
  // ── Citroën ──
  {
    make: /citro[eë]n/i,
    yearBreak: 2014,
    petrolOld: () => "VTi",
    petrol: "PureTech",
    diesel: "BlueHDi",
    hybrid: "ë-Hybrid",
  },
  // ── DS ──
  { make: /^ds$/i, petrol: "PureTech", diesel: "BlueHDi", hybrid: "E-Tense" },
  // ── Opel ──
  {
    make: /opel/i,
    yearBreak: 2018,
    petrolOld: () => "Turbo",
    petrol: "Turbo",
    diesel: "CDTi",
    hybrid: "Hybrid",
  },
  // ── Fiat / Abarth ──
  {
    make: /fiat|abarth/i,
    petrol: (_y: number, _cc: number, sub: string) => sub?.includes("abarth") ? "Abarth" : "MultiAir",
    diesel: "MultiJet",
    hybrid: "Hybrid",
  },
  // ── Alfa Romeo ──
  {
    make: /alfa\s*romeo/i,
    petrol: (_y: number, _cc: number, sub: string) => {
      if (sub === "quadrifoglio" || sub === "qv") return "QV"
      return "MultiAir"
    },
    diesel: "JTDm",
    hybrid: "Hybrid",
  },
  // ── Renault ──
  {
    make: /renault/i,
    yearBreak: 2012,
    petrolOld: () => "16V",
    petrol: "TCe",
    diesel: "dCi",
    hybrid: "E-Tech",
  },
  // ── Dacia ──
  { make: /dacia/i, petrol: "TCe", diesel: "dCi", hybrid: "Hybrid" },
  // ── Ford ──
  {
    make: /ford/i,
    yearBreak: 2012,
    petrolOld: (_cc: number, sub: string) => sub === "st" || sub === "rs" ? "Turbo" : "Duratec",
    petrol: "EcoBoost",
    diesel: "EcoBlue",
    hybrid: "Hybrid",
  },
  // ── Toyota ──
  {
    make: /toyota/i,
    petrol: (_y: number, _cc: number, sub: string) => {
      if (sub === "gr") return "GR"
      return "VVT-i"
    },
    diesel: "D-4D",
    hybrid: "Hybrid",
  },
  // ── Lexus ──
  { make: /lexus/i, petrol: "V", diesel: "d", hybrid: "Hybrid" },
  // ── Hyundai ──
  {
    make: /hyundai/i,
    petrol: (_y: number, _cc: number, sub: string) => sub === "n" ? "T-GDi N" : "T-GDi",
    diesel: "CRDi",
    hybrid: "HEV",
    electric: "EV",
  },
  // ── Kia ──
  {
    make: /kia/i,
    petrol: (_y: number, _cc: number, sub: string) => sub === "gt" ? "T-GDi GT" : "T-GDi",
    diesel: "CRDi",
    hybrid: "HEV",
    electric: "EV",
  },
  // ── Genesis ──
  { make: /genesis/i, petrol: "T-GDi", diesel: "e-D", hybrid: "Hybrid" },
  // ── Volvo ──
  {
    make: /volvo/i,
    petrol: (_y: number, _cc: number, sub: string) => sub === "polestar" ? "T8 Polestar" : "T",
    diesel: "D",
    hybrid: "Recharge",
    electric: "Recharge Pure Electric",
  },
  // ── Mazda ──
  {
    make: /mazda/i,
    yearBreak: 2012,
    petrolOld: () => "MZR",
    petrol: "SKYACTIV-G",
    diesel: "SKYACTIV-D",
    hybrid: "e-SKYACTIV",
  },
  // ── Nissan ──
  {
    make: /nissan/i,
    petrol: (_y: number, _cc: number, sub: string) => sub === "nismo" ? "NISMO" : "DIG-T",
    diesel: "dCi",
    hybrid: "e-Power",
    electric: "EV",
  },
  // ── Suzuki ──
  { make: /suzuki/i, petrol: "BoosterJet", diesel: "DDiS", hybrid: "Hybrid" },
  // ── Honda ──
  {
    make: /honda/i,
    petrol: (_y: number, _cc: number, sub: string) => sub === "type r" ? "VTEC Turbo" : "i-VTEC",
    diesel: "i-DTEC",
    hybrid: "e:HEV",
    electric: "e",
  },
  // ── Mitsubishi ──
  { make: /mitsubishi/i, petrol: "MIVEC", diesel: "DI-D", hybrid: "PHEV" },
  // ── Subaru ──
  { make: /subaru/i, petrol: "Boxer", diesel: "Boxer D", hybrid: "e-Boxer" },
  // ── Porsche ──
  {
    make: /porsche/i,
    petrol: (_y: number, _cc: number, sub: string) => {
      if (sub?.includes("turbo")) return "Turbo"
      if (sub === "gts") return "GTS"
      return "Benzine"
    },
    diesel: "Diesel",
    hybrid: "E-Hybrid",
    electric: "EV",
  },
  // ── Jaguar ──
  { make: /jaguar/i, petrol: "P", diesel: "D", hybrid: "P400e", electric: "EV400" },
  // ── Land Rover / Range Rover ──
  { make: /land\s*rover|range\s*rover/i, petrol: "P", diesel: "D", hybrid: "P400e" },
  // ── Tesla ──
  { make: /tesla/i, petrol: "EV", diesel: "EV", hybrid: "EV", electric: "EV" },
  // ── Jeep ──
  { make: /jeep/i, petrol: "MultiAir", diesel: "MultiJet", hybrid: "4xe" },
  // ── Maserati ──
  { make: /maserati/i, petrol: "V", diesel: "Diesel", hybrid: "Hybrid" },
  // ── Aston Martin ──
  { make: /aston/i, petrol: "V", diesel: "V", hybrid: "Hybrid" },
  // ── Smart ──
  { make: /smart/i, petrol: "Turbo", diesel: "CDI", electric: "EQ" },
  // ── Polestar ──
  { make: /polestar/i, petrol: "Hybrid", diesel: "EV", hybrid: "Hybrid", electric: "EV" },
  // ── MG ──
  { make: /^mg$/i, petrol: "T", diesel: "D", hybrid: "PHEV", electric: "EV" },
  // ── Cupra (standalone) ──
  { make: /^cupra$/i, petrol: "TSI", diesel: "TDI", hybrid: "e-Hybrid", electric: "EV" },
  // ── BYD ──
  { make: /byd/i, petrol: "DM", diesel: "DM", hybrid: "DM", electric: "EV" },
]

// ══════════════════════════════════════════════════════════
// EQUIPMENT LEVEL DATABASE
// ══════════════════════════════════════════════════════════

const SPORT_TRIMS = new Set([
  "gti", "gtd", "gte", "rs", "amg", "m sport", "m-sport", "m pakket", "m-pakket",
  "jcw", "john cooper works", "cupra", "nismo", "type r", "type-r", "vrs",
  "r-design", "polestar", "abt", "st-line", "st line", "st-line x",
  "n line", "n-line", "gt-line", "gt line", "gt-line s", "f sport", "f-sport",
  "sport+", "gr-sport", "gr sport", "gazoo", "black edition", "black line",
  "shadow edition", "shadow line", "opc", "gsi", "gse", "abarth",
  "r-dynamic", "r dynamic", "r-sport", "r sport", "s-design", "veloce",
  "competition", "first edition sport", "trd", "n performance",
  "gransport", "mc edition", "spyder", "sport nav", "sr", "tekna+",
  "quadrifoglio", "weissach", "pse", "abt", "brabus", "mansory",
  "sport design", "sport chrono", "sport classic", "sport plus",
])

const LUXURY_TRIMS = new Set([
  "prestige", "inscription", "avantgarde", "highline", "xcellence",
  "first edition", "launch edition", "lounge", "allure", "tekna",
  "topline", "platinum", "ultimate", "vignale", "titanium x",
  "autobiography", "svautobiography", "hse", "se l", "signature",
  "luxury", "luxury line", "exclusive", "individual", "long",
  "maybach", "granlusso", "elegance", "initiale paris", "initiale",
  "bose edition", "harman kardon", "premium plus", "premium pro",
  "executive", "inscription expression", "denali",
])

const COMFORT_TRIMS = new Set([
  "comfort", "comfortline", "style", "ambition", "business",
  "business line", "edition", "salt", "pepper", "chili", "trend",
  "life", "active", "design", "essence", "feel", "shine",
  "momentum", "momentum pro", "zen", "intens", "n-connecta",
  "titanium", "trend+", "cool", "expression", "expression+",
  "dynamic", "se dynamic", "se l", "tekna", "advance", "desire",
  "spirit", "exceed", "xline", "x-line", "adventure",
  "business class", "business edition", "business sport",
  "black star", "limited edition", "select", "collection",
])

const BASE_TRIMS = new Set([
  "trendline", "base", "access", "reference", "pure",
  "entry", "one", "pop", "easy", "like", "action",
  "visia", "acenta", "live", "startline", "origin",
  "attraction", "clever", "ambition+", "s", "se",
  "urban", "city", "basic", "active+",
])

// ══════════════════════════════════════════════════════════
// CATALOG PRICE TIER DETECTION
// RDW doesn't store trim names — but catalog price reveals the tier.
// GR-Sport costs €3-5k more than base Yaris, GTI costs €5-10k more than base Golf, etc.
// ══════════════════════════════════════════════════════════

type PriceTier = { maxPrice: number; trim: string }
type ModelPriceProfile = {
  make: RegExp; model: RegExp
  yearMin: number; yearMax: number
  hybrid?: boolean; diesel?: boolean; ev?: boolean
  tiers: PriceTier[]  // MUST be sorted low→high. Last match wins.
}

// Database of known base prices and trim tiers per model/year
// Prices are catalog prices (nieuwprijs) in EUR
const PRICE_PROFILES: ModelPriceProfile[] = [
  // ── TOYOTA ──
  { make: /toyota/i, model: /yaris/i, yearMin: 2017, yearMax: 2020, hybrid: true, tiers: [
    { maxPrice: 21500, trim: "Active" },        // basis ~€19,950-21,000
    { maxPrice: 23000, trim: "Comfort" },        // comfort ~€21,500-22,500
    { maxPrice: 24000, trim: "Style" },           // style ~€22,500-23,500
    { maxPrice: 27000, trim: "GR-Sport" },        // gr-sport ~€23,500-25,500
  ]},
  { make: /toyota/i, model: /yaris/i, yearMin: 2020, yearMax: 2026, hybrid: true, tiers: [
    { maxPrice: 24000, trim: "Active" },
    { maxPrice: 26500, trim: "Comfort" },
    { maxPrice: 29000, trim: "Style" },
    { maxPrice: 33000, trim: "GR-Sport" },
    { maxPrice: 50000, trim: "GR" },             // GR Yaris = performance
  ]},
  { make: /toyota/i, model: /corolla/i, yearMin: 2019, yearMax: 2026, hybrid: true, tiers: [
    { maxPrice: 30000, trim: "Active" },
    { maxPrice: 33000, trim: "Comfort" },
    { maxPrice: 36000, trim: "Style" },
    { maxPrice: 42000, trim: "GR-Sport" },
  ]},
  { make: /toyota/i, model: /c-?hr/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 30000, trim: "Active" },
    { maxPrice: 34000, trim: "Style" },
    { maxPrice: 38000, trim: "Premium" },
    { maxPrice: 45000, trim: "GR-Sport" },
  ]},
  { make: /toyota/i, model: /rav4|rav 4/i, yearMin: 2019, yearMax: 2026, tiers: [
    { maxPrice: 40000, trim: "Active" },
    { maxPrice: 44000, trim: "Style" },
    { maxPrice: 50000, trim: "Premium" },
    { maxPrice: 58000, trim: "GR-Sport" },
  ]},
  { make: /toyota/i, model: /camry/i, yearMin: 2019, yearMax: 2026, hybrid: true, tiers: [
    { maxPrice: 40000, trim: "Active" },
    { maxPrice: 44000, trim: "Style" },
    { maxPrice: 50000, trim: "Premium" },
  ]},
  // ── VOLKSWAGEN ──
  { make: /volkswagen/i, model: /golf/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 27000, trim: "Trendline" },
    { maxPrice: 31000, trim: "Comfortline" },
    { maxPrice: 36000, trim: "Highline" },
    { maxPrice: 40000, trim: "R-Line" },
    { maxPrice: 48000, trim: "GTI" },
    { maxPrice: 60000, trim: "R" },
  ]},
  { make: /volkswagen/i, model: /polo/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 20000, trim: "Trendline" },
    { maxPrice: 23000, trim: "Comfortline" },
    { maxPrice: 27000, trim: "Highline" },
    { maxPrice: 30000, trim: "R-Line" },
    { maxPrice: 38000, trim: "GTI" },
  ]},
  { make: /volkswagen/i, model: /t-roc/i, yearMin: 2018, yearMax: 2026, tiers: [
    { maxPrice: 30000, trim: "Life" },
    { maxPrice: 35000, trim: "Style" },
    { maxPrice: 40000, trim: "R-Line" },
    { maxPrice: 55000, trim: "R" },
  ]},
  { make: /volkswagen/i, model: /tiguan/i, yearMin: 2016, yearMax: 2026, tiers: [
    { maxPrice: 35000, trim: "Trendline" },
    { maxPrice: 40000, trim: "Comfortline" },
    { maxPrice: 47000, trim: "Highline" },
    { maxPrice: 55000, trim: "R-Line" },
    { maxPrice: 70000, trim: "R" },
  ]},
  // ── SEAT / CUPRA ──
  { make: /seat/i, model: /leon/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 24000, trim: "Reference" },
    { maxPrice: 28000, trim: "Style" },
    { maxPrice: 32000, trim: "Xcellence" },
    { maxPrice: 36000, trim: "FR" },
    { maxPrice: 45000, trim: "Cupra" },
  ]},
  { make: /seat/i, model: /ibiza/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 20000, trim: "Reference" },
    { maxPrice: 23000, trim: "Style" },
    { maxPrice: 27000, trim: "FR" },
    { maxPrice: 30000, trim: "Xcellence" },
  ]},
  // ── HYUNDAI ──
  { make: /hyundai/i, model: /i20/i, yearMin: 2020, yearMax: 2026, tiers: [
    { maxPrice: 21000, trim: "i-Motion" },
    { maxPrice: 24000, trim: "Comfort" },
    { maxPrice: 28000, trim: "Premium" },
    { maxPrice: 32000, trim: "N-Line" },
    { maxPrice: 42000, trim: "N" },
  ]},
  { make: /hyundai/i, model: /i30/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 27000, trim: "i-Motion" },
    { maxPrice: 31000, trim: "Comfort" },
    { maxPrice: 35000, trim: "Premium" },
    { maxPrice: 40000, trim: "N-Line" },
    { maxPrice: 50000, trim: "N" },
  ]},
  { make: /hyundai/i, model: /tucson/i, yearMin: 2021, yearMax: 2026, tiers: [
    { maxPrice: 35000, trim: "i-Motion" },
    { maxPrice: 40000, trim: "Comfort" },
    { maxPrice: 44000, trim: "Premium" },
    { maxPrice: 50000, trim: "N-Line" },
  ]},
  // ── KIA ──
  { make: /kia/i, model: /ceed|cee.d/i, yearMin: 2018, yearMax: 2026, tiers: [
    { maxPrice: 27000, trim: "ComfortLine" },
    { maxPrice: 32000, trim: "ExecutiveLine" },
    { maxPrice: 36000, trim: "GT-Line" },
    { maxPrice: 45000, trim: "GT" },
  ]},
  // ── PEUGEOT ──
  { make: /peugeot/i, model: /208/i, yearMin: 2019, yearMax: 2026, tiers: [
    { maxPrice: 23000, trim: "Like" },
    { maxPrice: 26000, trim: "Active" },
    { maxPrice: 30000, trim: "Allure" },
    { maxPrice: 35000, trim: "GT" },
    { maxPrice: 42000, trim: "GT Pack" },
  ]},
  { make: /peugeot/i, model: /2008/i, yearMin: 2020, yearMax: 2026, tiers: [
    { maxPrice: 28000, trim: "Active" },
    { maxPrice: 32000, trim: "Allure" },
    { maxPrice: 37000, trim: "GT" },
    { maxPrice: 44000, trim: "GT Pack" },
  ]},
  // ── RENAULT ──
  { make: /renault/i, model: /clio/i, yearMin: 2019, yearMax: 2026, tiers: [
    { maxPrice: 20000, trim: "Life" },
    { maxPrice: 23000, trim: "Zen" },
    { maxPrice: 27000, trim: "Intens" },
    { maxPrice: 32000, trim: "R.S. Line" },
    { maxPrice: 40000, trim: "E-Tech Engineered" },
  ]},
  // ── FORD ──
  { make: /ford/i, model: /focus/i, yearMin: 2018, yearMax: 2026, tiers: [
    { maxPrice: 26000, trim: "Trend" },
    { maxPrice: 30000, trim: "Titanium" },
    { maxPrice: 34000, trim: "ST-Line" },
    { maxPrice: 42000, trim: "ST" },
    { maxPrice: 55000, trim: "RS" },
  ]},
  { make: /ford/i, model: /fiesta/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 19000, trim: "Trend" },
    { maxPrice: 23000, trim: "Titanium" },
    { maxPrice: 26000, trim: "ST-Line" },
    { maxPrice: 32000, trim: "ST" },
  ]},
  // ── OPEL ──
  { make: /opel/i, model: /corsa/i, yearMin: 2019, yearMax: 2026, tiers: [
    { maxPrice: 21000, trim: "Edition" },
    { maxPrice: 25000, trim: "Elegance" },
    { maxPrice: 30000, trim: "GS Line" },
    { maxPrice: 38000, trim: "Ultimate" },
  ]},
  // ── SKODA ──
  { make: /skoda|škoda/i, model: /octavia/i, yearMin: 2020, yearMax: 2026, tiers: [
    { maxPrice: 30000, trim: "Active" },
    { maxPrice: 35000, trim: "Ambition" },
    { maxPrice: 40000, trim: "Style" },
    { maxPrice: 45000, trim: "Sportline" },
    { maxPrice: 55000, trim: "RS" },
  ]},
  // ── MAZDA ──
  { make: /mazda/i, model: /3/i, yearMin: 2019, yearMax: 2026, tiers: [
    { maxPrice: 28000, trim: "Active" },
    { maxPrice: 32000, trim: "Comfort" },
    { maxPrice: 36000, trim: "Luxury" },
    { maxPrice: 42000, trim: "Sport" },
  ]},
  // ── HONDA ──
  { make: /honda/i, model: /civic/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 28000, trim: "Comfort" },
    { maxPrice: 32000, trim: "Elegance" },
    { maxPrice: 37000, trim: "Executive" },
    { maxPrice: 42000, trim: "Sport" },
    { maxPrice: 55000, trim: "Type R" },
  ]},
  // ── SUZUKI ──
  { make: /suzuki/i, model: /swift/i, yearMin: 2017, yearMax: 2026, tiers: [
    { maxPrice: 18000, trim: "Comfort" },
    { maxPrice: 22000, trim: "Style" },
    { maxPrice: 26000, trim: "Sport" },
    { maxPrice: 35000, trim: "Sport" },
  ]},
  // ── FIAT ──
  { make: /fiat/i, model: /500/i, yearMin: 2016, yearMax: 2026, tiers: [
    { maxPrice: 17000, trim: "Pop" },
    { maxPrice: 20000, trim: "Lounge" },
    { maxPrice: 24000, trim: "Sport" },
    { maxPrice: 28000, trim: "Rockstar" },
  ]},
  // ── DACIA ──
  { make: /dacia/i, model: /sandero/i, yearMin: 2021, yearMax: 2026, tiers: [
    { maxPrice: 14000, trim: "Essential" },
    { maxPrice: 17000, trim: "Comfort" },
    { maxPrice: 20000, trim: "Stepway" },
    { maxPrice: 23000, trim: "Extreme" },
  ]},
  { make: /dacia/i, model: /duster/i, yearMin: 2018, yearMax: 2026, tiers: [
    { maxPrice: 19000, trim: "Essential" },
    { maxPrice: 23000, trim: "Comfort" },
    { maxPrice: 27000, trim: "Prestige" },
    { maxPrice: 32000, trim: "Extreme" },
  ]},
  // ── VOLVO ──
  { make: /volvo/i, model: /xc40/i, yearMin: 2018, yearMax: 2026, tiers: [
    { maxPrice: 38000, trim: "Momentum" },
    { maxPrice: 44000, trim: "Inscription" },
    { maxPrice: 50000, trim: "R-Design" },
    { maxPrice: 60000, trim: "Polestar" },
  ]},
]

function detectTrimFromCatalogPrice(
  make: string, model: string, year: number, catalogPrice: number,
  isHybrid: boolean, isDiesel: boolean, isPureEV: boolean
): string {
  for (const profile of PRICE_PROFILES) {
    if (!profile.make.test(make)) continue
    if (!profile.model.test(model)) continue
    if (year < profile.yearMin || year > profile.yearMax) continue
    // If profile is hybrid-specific, only match hybrids
    if (profile.hybrid && !isHybrid) continue
    // Find matching tier (last one that catalog price exceeds)
    let matched = ""
    for (const tier of profile.tiers) {
      if (catalogPrice <= tier.maxPrice) { matched = tier.trim; break }
    }
    // If price exceeds all tiers, use the highest
    if (!matched && profile.tiers.length) matched = profile.tiers[profile.tiers.length - 1].trim
    return matched
  }
  return ""
}

// ══════════════════════════════════════════════════════════
// RDW TYPE CODE MAPPING
// Toyota NHP130L-CHXNBW = specific variant code
// These are manufacturer-internal but we can map known ones
// ══════════════════════════════════════════════════════════

type TypeCodeRule = { make: RegExp; model: RegExp; pattern: RegExp; trim: string }

const TYPE_CODE_RULES: TypeCodeRule[] = [
  // Toyota Yaris Hybrid (XP130/NHP130) — GR-Sport type codes
  // The variant suffix after the dash encodes trim level
  // W suffix = GR-Sport/Sport package (higher spec)
  { make: /toyota/i, model: /yaris/i, pattern: /nhp130.*chx[a-z]*w/i, trim: "GR-Sport" },
  { make: /toyota/i, model: /yaris/i, pattern: /nhp130.*chx[a-z]*b(?!\w*w)/i, trim: "Comfort" },
  
  // Toyota Yaris new gen (MXPH)
  { make: /toyota/i, model: /yaris/i, pattern: /mxph.*w/i, trim: "GR-Sport" },
  
  // Toyota Corolla
  { make: /toyota/i, model: /corolla/i, pattern: /zwe21.*w/i, trim: "GR-Sport" },
  
  // Toyota C-HR
  { make: /toyota/i, model: /c-?hr/i, pattern: /zyx1.*w/i, trim: "GR-Sport" },
]

function detectTrimFromTypeCode(make: string, model: string, typeCode: string): string {
  for (const rule of TYPE_CODE_RULES) {
    if (!rule.make.test(make)) continue
    if (!rule.model.test(model)) continue
    if (rule.pattern.test(typeCode)) return rule.trim
  }
  return ""
}

// ══════════════════════════════════════════════════════════
// MAIN DETECTION FUNCTION
// ══════════════════════════════════════════════════════════

export function detectVehicleIdentity(input: DetectInput): VehicleIdentity {
  const { make = "", model = "", trim = "", year = 0, fuel = "", fuelSecondary = "",
    engineCapacity = 0, powerHp, allText = "",
    catalogPrice, typeCode, vin, weightKg } = input || {}
  const mkL = (make || "").toLowerCase()
  const modelL = (model || "").toLowerCase()
  const trimL = (trim || "").toLowerCase()
  const fuelL = (fuel || "").toLowerCase()
  const cc = engineCapacity || 0
  const ccL = cc > 0 ? (cc / 1000).toFixed(1) : ""
  const searchText = `${modelL} ${trimL} ${allText || ""}`.toLowerCase()
  const typeCodeL = (typeCode || "").toLowerCase()

  const isHybrid = /hybr/i.test(fuel) || /hybr/i.test(fuelSecondary) || (!!fuelSecondary && /elektr/i.test(fuelSecondary))
  const isPureEV = /elektr/i.test(fuel) && !isHybrid
  const isDiesel = /diesel/i.test(fuel)

  // ── 1. SUBMODEL DETECTION ──
  let subModel = ""

  // 1a. Text-based patterns (checks model, trim, allText from RDW)
  for (const [re, label] of SUB_PATTERNS) {
    if (re.test(searchText)) { subModel = label; break }
  }

  // 1b. Power-based fallback
  if (!subModel && powerHp && powerHp > 0) {
    for (const rule of POWER_RULES) {
      if (!rule.make.test(make)) continue
      if (!rule.model.test(model)) continue
      if (powerHp < rule.minHp) continue
      if (rule.maxHp && powerHp > rule.maxHp) continue
      if (rule.fuel && !fuelL.includes(rule.fuel)) continue
      subModel = rule.sub
      break
    }
  }

  // 1c. CATALOG PRICE TIER detection — RDW doesn't store trim names (GR-Sport, FR, etc.)
  //     but the catalog price DOES reveal the trim level. A GR-Sport Yaris costs €3-5k more
  //     than a base Yaris. We compare against known base prices per model.
  let priceDetectedTrim = ""
  if (!subModel && catalogPrice && catalogPrice > 5000) {
    priceDetectedTrim = detectTrimFromCatalogPrice(mkL, modelL, year, catalogPrice, isHybrid, isDiesel, isPureEV)
    if (priceDetectedTrim) {
      // Some price tiers are submodels (affect scraper search), others are just equipment levels
      const subModelTiers = ["gr-sport", "gr", "gti", "gtd", "gte", "cupra", "rs", "st", "n", "n-line",
        "amg", "m-sport", "cooper s", "jcw", "vrs", "opc", "abarth", "f-sport", "r-design", "polestar"]
      if (subModelTiers.includes(priceDetectedTrim.toLowerCase())) {
        subModel = priceDetectedTrim.toLowerCase()
      }
    }
  }

  // 1d. RDW type code mapping — manufacturer codes that map to known trims
  if (!subModel && typeCodeL) {
    const tcTrim = detectTrimFromTypeCode(mkL, modelL, typeCodeL)
    if (tcTrim) {
      const subModelTiers = ["gr-sport", "gr", "gti", "gtd", "gte", "cupra", "rs", "st", "n",
        "amg", "m-sport", "cooper s", "jcw", "vrs", "opc", "abarth", "f-sport"]
      if (subModelTiers.includes(tcTrim.toLowerCase())) subModel = tcTrim.toLowerCase()
      else if (!priceDetectedTrim) priceDetectedTrim = tcTrim
    }
  }

  // ── 2. ENGINE TYPE ──
  let engineType = ""

  if (isPureEV) {
    // Find make-specific EV name
    const rule = ENGINE_RULES.find(r => r.make.test(make))
    engineType = rule?.electric || "EV"
  } else {
    const rule = ENGINE_RULES.find(r => r.make.test(make))
    if (rule) {
      if (isHybrid) {
        engineType = rule.hybrid || "Hybrid"
      } else if (isDiesel) {
        engineType = rule.diesel
      } else {
        // Petrol — check era
        if (rule.yearBreak && year <= rule.yearBreak && rule.petrolOld) {
          engineType = typeof rule.petrolOld === "function"
            ? rule.petrolOld(cc, subModel)
            : rule.petrolOld
        } else {
          engineType = typeof rule.petrol === "function"
            ? rule.petrol(year, cc, subModel)
            : rule.petrol
        }
      }
    } else {
      // Fallback for unknown makes
      if (isHybrid) engineType = "Hybrid"
      else if (isDiesel) engineType = "Diesel"
      else engineType = "Benzine"
    }
  }

  // ── Explicit text overrides (RDW data takes priority) ──
  if (searchText.includes("tsi") && !isPureEV) engineType = "TSI"
  if (searchText.includes("tdi")) engineType = "TDI"
  if (searchText.includes("tfsi")) engineType = "TFSI"
  if (searchText.includes("fsi") && !searchText.includes("tfsi")) engineType = "FSI"
  if (searchText.includes("mpi")) engineType = "MPI"
  if (searchText.includes("bluehdi")) engineType = "BlueHDi"
  if (searchText.includes("puretech")) engineType = "PureTech"
  if (searchText.includes("ecoboost")) engineType = "EcoBoost"
  if (searchText.includes("ecoblue")) engineType = "EcoBlue"
  if (searchText.includes("skyactiv-g")) engineType = "SKYACTIV-G"
  if (searchText.includes("skyactiv-d")) engineType = "SKYACTIV-D"
  if (searchText.includes("vtec")) engineType = "VTEC"
  if (searchText.includes("boosterjet")) engineType = "BoosterJet"
  if (searchText.includes("crdi")) engineType = "CRDi"
  if (searchText.includes("multiair")) engineType = "MultiAir"
  if (searchText.includes("multijet")) engineType = "MultiJet"

  // ── 3. ENGINE LABEL ──
  let engineLabel = ""
  const isMini = /mini/i.test(make)
  if (isMini) {
    engineLabel = engineType
  } else if (/^\d/.test(engineType)) {
    // Already starts with displacement (e.g. "1.8T")
    engineLabel = engineType
  } else if (ccL && engineType && engineType !== "EV" && engineType !== "Hybrid" && engineType !== "PHEV") {
    engineLabel = `${ccL} ${engineType}`
  } else {
    engineLabel = engineType
  }

  // ── 4. TRANSMISSION ──
  let transmissionType = "Onbekend"
  let transmissionAuto = false
  let gearCount: number | undefined

  const autoKw = ["dsg", "s-tronic", "s tronic", "stronic", "tiptronic", "multitronic",
    "pdk", "steptronic", "automaat", "automatic", "cvt", "dct", "e-cvt",
    "aut.", "speedshift", "powershift", "edc", "eat6", "eat8", "eat",
    "aisin", "xtronic", "lineartronic", "direct shift", "multidrive",
    "9g-tronic", "7g-tronic", "geartronic", "sensotronic"]
  const manualKw = ["handgeschakeld", "manual", "schakel"]

  if (isPureEV) {
    transmissionType = "Automaat"
    transmissionAuto = true
    gearCount = 1
  } else if (autoKw.some(k => searchText.includes(k))) {
    transmissionAuto = true
    if (searchText.includes("dsg")) transmissionType = "DSG"
    else if (/s[\s-]*tronic/i.test(searchText)) transmissionType = "S-Tronic"
    else if (searchText.includes("tiptronic")) transmissionType = "Tiptronic"
    else if (searchText.includes("pdk")) transmissionType = "PDK"
    else if (searchText.includes("steptronic")) transmissionType = "Steptronic"
    else if (searchText.includes("cvt") || searchText.includes("e-cvt") || searchText.includes("xtronic") || searchText.includes("multidrive")) transmissionType = "CVT"
    else if (searchText.includes("powershift")) transmissionType = "PowerShift"
    else if (/eat[68]?/i.test(searchText)) transmissionType = "EAT"
    else if (/9g[\s-]*tronic/i.test(searchText)) transmissionType = "9G-Tronic"
    else if (/7g[\s-]*tronic/i.test(searchText)) transmissionType = "7G-Tronic"
    else if (searchText.includes("geartronic")) transmissionType = "Geartronic"
    else if (searchText.includes("lineartronic")) transmissionType = "Lineartronic"
    else transmissionType = "Automaat"
  } else if (manualKw.some(k => searchText.includes(k))) {
    transmissionType = "Handgeschakeld"
    transmissionAuto = false
  }

  // ── 5. EQUIPMENT LEVEL ──
  let equipmentLevel = ""
  const eqText = `${modelL} ${trimL} ${searchText}`
  const eqWords = eqText.split(/[\s,;/()]+/).filter(Boolean)

  // Check multi-word trims first, then single words
  for (const t of SPORT_TRIMS) {
    if (eqText.includes(t)) { equipmentLevel = "Sport"; break }
  }
  if (!equipmentLevel) for (const t of LUXURY_TRIMS) {
    if (eqText.includes(t)) { equipmentLevel = "Luxe"; break }
  }
  if (!equipmentLevel) for (const t of COMFORT_TRIMS) {
    if (eqText.includes(t)) { equipmentLevel = "Comfort"; break }
  }
  if (!equipmentLevel) for (const t of BASE_TRIMS) {
    if (eqText.includes(t)) { equipmentLevel = "Basis"; break }
  }

  // SubModel implies sport
  if (!equipmentLevel && subModel) {
    const sportSubs = ["gti", "gtd", "rs", "amg", "m", "st", "type r", "jcw", "cooper s",
      "nismo", "vrs", "opc", "gsi", "abarth", "quadrifoglio", "veloce", "n",
      "gr", "gr-sport", "cupra", "cupra r", "gts", "turbo", "turbo s",
      "carrera s", "trofeo", "svr", "sti", "wrx", "evo", "trackhawk",
      "hellcat", "raptor", "pse", "trophy", "rs trophy", "mps", "sport",
      "polestar", "alpina", "brabus"]
    if (sportSubs.includes(subModel)) equipmentLevel = "Sport"
  }

  // Price-detected trim as final fallback for equipment level
  if (!equipmentLevel && priceDetectedTrim) {
    const sportTrims = ["gr-sport", "gr sport", "st-line", "r-line", "s-line", "m-sport",
      "fr", "sport", "n-line", "gt-line", "f-sport", "r-design", "r-dynamic",
      "sportline", "dynamic", "active sport", "veloce"]
    const luxTrims = ["inscription", "prestige", "platinum", "autobiography",
      "premium plus", "exclusive", "maybach", "vignale", "initiale"]
    const priceTrimL = priceDetectedTrim.toLowerCase()
    if (sportTrims.some(t => priceTrimL.includes(t))) equipmentLevel = "Sport"
    else if (luxTrims.some(t => priceTrimL.includes(t))) equipmentLevel = "Luxe"
    else if (priceTrimL !== "basis" && priceTrimL !== "base") equipmentLevel = "Comfort"
  }

  // ── 6. MODEL VARIANT STRING ──
  const parts: string[] = []
  if (engineLabel) parts.push(engineLabel)
  if (powerHp && !/pk/.test(engineLabel) && !isMini) parts.push(`${powerHp}pk`)
  if (transmissionAuto && transmissionType !== "Onbekend") parts.push(transmissionType)
  else if (!transmissionAuto && transmissionType === "Handgeschakeld") parts.push("Schakel")
  if (subModel) {
    parts.push(subModel.split(/[\s-]+/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(" "))
  } else if (equipmentLevel && equipmentLevel !== "Comfort") {
    // Try to find the actual trim name
    const foundTrim = findSpecificTrim(eqText)
    if (foundTrim) parts.push(foundTrim)
    else parts.push(equipmentLevel)
  }

  return {
    engineType,
    engineLabel,
    transmissionType,
    transmissionAuto,
    gearCount,
    equipmentLevel,
    modelVariant: parts.join(" ") || "",
    subModel,
  }
}

function findSpecificTrim(text: string): string {
  const trims = [
    "FR", "R-Line", "S-Line", "M-Sport", "AMG", "GTI", "GTD", "GTE",
    "Cupra", "JCW", "Comfortline", "Highline", "Trendline", "Style",
    "Xcellence", "Reference", "Business", "Chili", "Salt", "Pepper",
    "Inscription", "R-Design", "Momentum", "Tekna", "N-Connecta",
    "Allure", "GT-Line", "Active", "Design", "Life", "Edition",
    "Lounge", "Intens", "Zen", "Initiale", "Visia", "Acenta",
    "GR-Sport", "GR Sport", "Vignale", "Titanium", "ST-Line",
    "N-Line", "GT-Line", "F-Sport", "R-Dynamic", "HSE",
    "Sportline", "Ambition", "Black Edition", "First Edition",
    "Launch Edition", "Prestige", "Premium", "Platinum",
    "Autobiography", "Dynamic SE", "Trailhawk", "Rubicon",
  ]
  const lower = text.toLowerCase()
  for (const t of trims) {
    if (lower.includes(t.toLowerCase())) return t
  }
  return ""
}
