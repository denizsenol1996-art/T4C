// test.js — 30 real-world titles uit market_listings, verwachte parse-outcomes
// Run met: node test.js
const { normalizeListing } = require("./index")

const CASES = [
  // SEAT (5)
  { make: "seat", source: "src_a", title: "SEAT Leon 1.6 STYLANCE", expect: "leon" },
  { make: "seat", source: "src_g", title: "SEAT Cordoba Vario 1.6 Signo", expect: "cordoba" },
  { make: "seat", source: "src_g", title: "SEAT Toledo 2.3 V5 Leder, Elek stoelen NAP", expect: "toledo" },
  { make: "seat", source: "src_g", title: "SEAT Arosa 1.4i Stella", expect: "arosa" },
  { make: "seat", source: "src_a", title: "SEAT Altea XL 1.2 TSI Style", expect: "altea" },
  // BMW (6)
  { make: "bmw", source: "src_a", title: "BMW 114 1-serie 114i EDE Business", expect: "1-serie" },
  { make: "bmw", source: "src_a", title: "BMW 535 5-serie Touring 535D High Exe", expect: "5-serie" },
  { make: "bmw", source: "src_a", title: "BMW X1 xDrive28i 245Pk High Executive", expect: "x1" },
  { make: "bmw", source: "src_a", title: "BMW 316 3-serie 316i Executive LED NL AUTO", expect: "3-serie" },
  { make: "bmw", source: "src_a", title: "BMW i3 Range Extender 124.000 km CLIMA NAVI", expect: "i3" },
  { make: "bmw", source: "src_a", title: "BMW 320i M Sport Pakket", expect: "3-serie" },
  // Audi (3)
  { make: "audi", source: "src_a", title: "Audi A3 Sportback 1.8 TFSI Ambition", expect: "a3" },
  { make: "audi", source: "src_a", title: "Audi A4 Avant 2.0 TDI Pro Line", expect: "a4" },
  { make: "audi", source: "src_a", title: "Audi Q5 2.0 TFSI Quattro S-Line", expect: "q5" },
  // VW (4)
  { make: "volkswagen", source: "src_a", title: "Volkswagen Golf 1.0 TSI Comfortline", expect: "golf" },
  { make: "volkswagen", source: "src_a", title: "Volkswagen Polo 1.2 TSI Comfortline", expect: "polo" },
  { make: "volkswagen", source: "src_a", title: "Volkswagen Passat Variant 2.0 TDI Highline", expect: "passat" },
  { make: "volkswagen", source: "src_a", title: "Volkswagen Tiguan 1.4 TSI Sport&Style", expect: "tiguan" },
  // Mercedes (3)
  { make: "mercedes-benz", source: "src_a", title: "Mercedes-Benz E 350 CGI 4Matic", expect: "e-klasse" },
  { make: "mercedes-benz", source: "src_a", title: "Mercedes-Benz A 180 BlueEFFICIENCY", expect: "a-klasse" },
  { make: "mercedes-benz", source: "src_a", title: "Mercedes-Benz C 220 CDI Avantgarde", expect: "c-klasse" },
  // Toyota (3)
  { make: "toyota", source: "src_a", title: "Toyota Aygo 1.0 VVT-i Now", expect: "aygo" },
  { make: "toyota", source: "src_a", title: "Toyota Prius 1.8 Dynamic", expect: "prius" },
  { make: "toyota", source: "src_a", title: "Toyota Yaris 1.5 Hybrid Active", expect: "yaris" },
  // Ford (2)
  { make: "ford", source: "src_a", title: "Ford Fiesta 1.0 EcoBoost Titanium", expect: "fiesta" },
  { make: "ford", source: "src_a", title: "Ford Focus 1.0 EcoBoost ST-Line", expect: "focus" },
  // Renault (2)
  { make: "renault", source: "src_a", title: "Renault Captur 0.9 TCe Energy Intens", expect: "captur" },
  { make: "renault", source: "src_a", title: "Renault Megane 1.5 dCi Bose", expect: "megane" },
  // Citroen (1)
  { make: "citroen", source: "src_a", title: "Citroen C1 1.0 VTi Selection", expect: "c1" },
  // Native source — model field trusted
  { make: "seat", source: "nlmarket", title: "Seat Altea 1.6 Stylance", expect: "altea_passthrough", rawModel: "altea" }
]

function run() {
  let passed = 0, failed = 0
  console.log("Test cases:", CASES.length)
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    const listing = { make: c.make, source: c.source, title: c.title, model: c.rawModel || "" }
    const result = normalizeListing(listing)
    let expectModel = c.expect
    let ok = false
    if (c.expect === "altea_passthrough") {
      ok = result.normalize_source === "native" && result.normalized_model === "altea"
      expectModel = "altea (native)"
    } else {
      ok = result.normalized_model === c.expect
    }
    const status = ok ? "PASS" : "FAIL"
    if (ok) passed++; else failed++
    if (!ok) {
      console.log(`  [${status}] ${c.make.padEnd(14)} | "${c.title.slice(0,50)}"`)
      console.log(`           expected: ${expectModel}  got: ${JSON.stringify(result)}`)
    }
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

run()
