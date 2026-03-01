/* T4C ENTERPRISE ENGINE v8.3 — B2B/B2C prijswaterval + herberekende ratings
   
   PRIJSMODEL:
   ┌─────────────────────────────────────────────────────┐
   │  Internet Vraagprijs (B2C)  ← advertentieprijs online (met onderhandelingsruimte)
   │  Verkoopadviees (B2C)       ← realistische verkoopprijs aan particulier
   │  Handelswaarde (B2B)        ← dealer-to-dealer handelsprijs
   │  T4C Inkoopbod              ← wat je biedt bij particulier/inruil
   └─────────────────────────────────────────────────────┘
   
   RATINGS:
   ITR = Inkoop Taxatie Rating  — hoe betrouwbaar is deze taxatie? (datakwaliteit)
   ETR = Verhandelbaarheid      — hoe snel/makkelijk verkoopbaar?
   APR = Aantrekkelijkheid      — hoe interessant als dealer-aankoop?
*/

export type DealerInput = {
  make: string; model: string; trim?: string; year: number; km: number
  fuel?: string; weightKg?: number; catalogPrice?: number; bpm?: number; power?: number
  marketAvg?: number; marketMedian?: number; marketCount?: number; marketPrices?: number[]
  marketP10?: number; marketP25?: number; marketP75?: number; marketP90?: number; marketQuality?: string
  finnikAvailable?: boolean; finnikLow?: number; finnikHigh?: number
  importFlag?: boolean; stolenFlag?: boolean
  // Vehicle identity (v8.4)
  transmissionAuto?: boolean; equipmentLevel?: string; engineLabel?: string
  subModel?: string  // "cupra", "gti", "rs", etc.
}

export type DealerResult = {
  verkoopadviees: number; handelswaarde: number; t4cBod: number
  internetPrijs: number; inkoopBruto: number
  inkoopLow: number; inkoopHigh: number
  jpEtr: number; jpFactor: number
  itr: number; etr: number; apr: number
  liquidityScore: number; marketVelocity: number; riskScore: number
  confidence: number; confidenceLabel: string
  profitWholesale: number; profitRetail: number; marginPercent: number
  courantLabel: string; sellSpeed: string; sellDays: number
  sources: string[]; dataNote: string; smartSummary: string[]
  residualValue: number
}

/* ── HELPERS ──────────────────────────── */
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)) }
function round(n: number) { return Math.round(n) }
function safeNum(n: unknown, f = 0) { const x = Number(n); return Number.isFinite(x) ? x : f }
function toLower(s?: string) { return String(s ?? "").toLowerCase().trim() }
function median(a: number[]) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function trimmedMean(a: number[], t = .10) { if (a.length < 5) return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; const s = [...a].sort((x, y) => x - y); const c = Math.floor(s.length * t); const sl = s.slice(c, Math.max(c + 1, s.length - c)); return sl.reduce((x, y) => x + y, 0) / sl.length }
function coeffVar(a: number[]) { if (a.length < 3) return 1; const m = a.reduce((x, y) => x + y, 0) / a.length; if (m <= 0) return 1; const v = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); return v / m }

/* ── SEGMENTERING ────────────────────── */
type Seg = "economy" | "premium" | "luxury" | "utility" | "ev" | "diesel" | "sports"
const PREM = new Set(["bmw", "audi", "mercedes", "mercedes-benz", "lexus", "volvo", "infiniti", "alfa romeo", "mini", "ds"])
const LUX = new Set(["porsche", "jaguar", "land rover", "maserati", "bentley", "rolls-royce", "aston martin", "ferrari", "lamborghini"])
const SPT = ["gti", "gtd", "rs", "amg", "cupra", "nismo", "type r", "vrs", "r-line", "fr"]
const UTL = ["duster", "sandero", "jimny", "outlander", "tucson", "sportage", "rav4", "cr-v", "qashqai", "tiguan", "t-roc", "ateca", "karoq", "3008", "cx-5", "niro"]

function detectSeg(i: DealerInput): Seg {
  const mk = toLower(i.make), ml = toLower(i.model), fl = toLower(i.fuel), tr = toLower(i.trim)
  if (fl.includes("elektr") || fl.includes("electric")) return "ev"
  if (LUX.has(mk)) return "luxury"; if (PREM.has(mk)) return "premium"
  if (SPT.some(s => tr.includes(s))) return "sports"
  if (UTL.some(m => ml.includes(m)) || safeNum(i.weightKg) >= 1800) return "utility"
  if (fl.includes("diesel")) return "diesel"; return "economy"
}

/* ── TRIM FACTOR ─────────────────────── */
const TF: Record<string, number> = { gti: 1.08, gtd: 1.06, rs: 1.12, amg: 1.15, cupra: 1.10, "m sport": 1.07, "s-line": 1.05, "r-line": 1.04, fr: 1.06, sport: 1.03, premium: 1.05, prestige: 1.07, stepway: 1.04, base: .97, trendline: .98, access: .96, automaat: 1.03, quattro: 1.05, xdrive: 1.04 }
function trimF(t?: string) { const s = toLower(t); if (!s) return 1; for (const [k, v] of Object.entries(TF)) if (s.includes(k)) return v; return 1 }

/* ── RESTWAARDE CURVES ───────────────── 
   Percentage van catalogusprijs per jaar oud. */
const C: Record<Seg, number[]> = {
  economy: [.85, .73, .63, .54, .46, .40, .35, .30, .26, .22, .19, .17, .15, .13, .11, .10, .09, .08, .07, .06, .055],
  premium: [.87, .78, .70, .62, .55, .49, .44, .39, .35, .31, .28, .25, .22, .20, .18, .16, .14, .13, .12, .11, .10],
  luxury:  [.84, .74, .65, .58, .52, .47, .42, .38, .34, .31, .28, .25, .23, .21, .19, .18, .17, .16, .15, .14, .13],
  utility: [.90, .82, .74, .67, .61, .55, .50, .46, .42, .38, .35, .32, .29, .27, .25, .23, .21, .19, .18, .17, .16],
  ev:      [.80, .68, .58, .50, .43, .37, .32, .28, .25, .22, .19, .17, .15, .13, .11, .10, .09, .08, .07, .06, .055],
  diesel:  [.84, .72, .62, .53, .46, .40, .35, .30, .26, .23, .20, .17, .15, .13, .11, .10, .09, .08, .07, .06, .055],
  sports:  [.88, .80, .73, .67, .61, .56, .51, .47, .43, .39, .35, .32, .29, .27, .25, .23, .21, .20, .19, .18, .17],
}
function resPct(age: number, seg: Seg): number {
  const c = C[seg] ?? C.economy
  const i = clamp(Math.floor(age), 0, c.length - 1)
  let pct: number
  if (i < c.length - 1) { const f = age - Math.floor(age); pct = c[i] * (1 - f) + c[i + 1] * f }
  else pct = c[c.length - 1]
  // Minimum residual: a running, APK-approved car is never worth less than 5% of catalog
  // This prevents sub-€1000 estimates for cars that clearly have market value
  return Math.max(pct, 0.05)
}

/* ── KM CORRECTIE ────────────────────── 
   Progressive: lichte overschrijding = milde correctie, extreme = steile afslag.
   227k op 11 jaar auto: d=0.88 → oude factor 0.75, nieuwe factor ~0.65 */
function kmFactor(km: number, age: number): number {
  const ann = age <= 3 ? 17000 : age <= 6 ? 15000 : age <= 10 ? 13000 : 11000
  const exp = ann * Math.max(age, 1)
  const d = (km - exp) / Math.max(exp, 1)
  if (d <= 0) return clamp(1 - d * .10, 1, 1.08)  // minder km dan verwacht: lichte bonus
  // Progressieve penalty: eerste 50% overschrijding = 0.25/unit, daarna steiler
  if (d <= 0.50) return clamp(1 - d * .30, .55, 1)
  // 50-100% overschrijding: steilere curve
  const base = 1 - 0.50 * .30  // = 0.85 bij 50% over
  return clamp(base - (d - 0.50) * .45, .40, base)
}

function isMarketOk(avg: number, catEst: number, cnt: number): boolean {
  if (cnt < 3) return false
  if (catEst <= 0) return cnt >= 5
  const r = avg / catEst
  return r >= .30 && r <= 3.0
}

/* ── B2B/B2C MARGE FACTOREN PER SEGMENT ── 
   negotiate  = hoeveel korting geeft dealer bij verkoop (B2C)
   b2bGap     = verschil B2C verkoop → B2B handel (reconditie, garantie, overhead)
   inkoopGap  = verschil B2B → inkoop (dealermarge) */
const SEG_M: Record<Seg, { negotiate: number; b2bGap: number }> = {
  economy:  { negotiate: .04, b2bGap: .12 },
  premium:  { negotiate: .05, b2bGap: .14 },
  luxury:   { negotiate: .06, b2bGap: .16 },
  utility:  { negotiate: .03, b2bGap: .11 },
  ev:       { negotiate: .04, b2bGap: .13 },
  diesel:   { negotiate: .05, b2bGap: .14 },
  sports:   { negotiate: .05, b2bGap: .13 },
}

function scrapValue(w?: number) { return round(200 + clamp(safeNum(w) / 1000, .8, 2.4) * 180) }

/* ══ STAP 1: B2C VRAAGPRIJS — MARKET-FIRST ══
   Filosofie: de markt heeft ALTIJD gelijk.
   Als er 26 auto's te koop staan voor gemiddeld €3.000, dan IS de waarde ~€3.000.
   Catalogus is alleen een vangnet als er geen marktdata is.
   
   HIËRARCHIE:
   1. Veel marktdata (10+ listings, lage spreiding) → marktmediaan = B2C prijs
   2. Redelijke marktdata (5-9 listings) → marktmediaan, gecheckt tegen catalogus
   3. Weinig marktdata (3-4 listings) → voorzichtige blend
   4. Geen marktdata → catalogus-schatting
*/
function b2cVraagprijs(input: DealerInput, seg: Seg, age: number, tF: number, sources: string[]): { b2c: number; mOk: boolean; dataNote: string } {
  const catalog = safeNum(input.catalogPrice), km = safeNum(input.km)
  const prices = (input.marketPrices ?? []).filter(p => Number.isFinite(p) && p > 0)
  const count = safeNum(input.marketCount) || prices.length
  let dataNote = ""

  // Catalogus-schatting (alleen als fallback/sanity check)
  let catEst = 0
  if (catalog > 0) { sources.push("RDW"); catEst = catalog * resPct(age, seg) * kmFactor(km, age) * tF }

  // Marktcijfers
  const sorted = [...prices].sort((a, b) => a - b)
  const mMedian = prices.length >= 3 ? median(prices) : 0
  const mTrimmed = prices.length >= 5 ? trimmedMean(prices) : mMedian
  const mCenter = mMedian > 0 ? (mTrimmed * .4 + mMedian * .6) : 0  // Mediaan-gewogen
  const cv = prices.length >= 3 ? coeffVar(prices) : 1
  const mOk = count >= 3 && mCenter > 0

  // KM-correctie op marktdata
  // Marktprijzen bevatten alle km-standen — correctie moet MILD zijn
  // want de markt zelf bevat al goedkope hoge-km auto's en dure lage-km auto's
  let mAdj = mCenter
  if (mOk && prices.length >= 5) {
    const ann = age <= 3 ? 17000 : age <= 6 ? 15000 : age <= 10 ? 13000 : 11000
    const exp = ann * Math.max(age, 1)
    const kmRatio = km / Math.max(exp, 1)
    
    // MILDE correctie: max ±15% op basis van km
    if (kmRatio > 1.5) {
      // Veel km: trek 10-15% naar beneden
      const factor = clamp(1 - (kmRatio - 1) * 0.12, 0.85, 1)
      mAdj = mCenter * factor
    } else if (kmRatio < 0.6) {
      // Weinig km: trek 5-10% naar boven
      const factor = clamp(1 + (1 - kmRatio) * 0.08, 1, 1.12)
      mAdj = mCenter * factor
    }
  }

  let b2c: number

  if (mOk && prices.length >= 10 && cv < 0.40) {
    // ══ BESTE GEVAL: Veel data, lage spreiding ══
    // De markt IS de waarheid. Vertrouw de mediaan.
    b2c = mAdj
    sources.push("Markt")
    dataNote = `${count} listings — sterke marktdata`
    
    // Catalog alleen als sanity check: als catEst veel hoger is, neem het gemiddelde
    if (catEst > 0 && catEst > b2c * 1.5) {
      b2c = b2c * 0.70 + catEst * 0.30  // Markt weegt zwaarder, maar catalog trekt omhoog
      dataNote = `${count} listings — catalogus-correctie omhoog`
    }
  }
  else if (mOk && prices.length >= 5) {
    // ══ GOED GEVAL: Redelijke data ══
    b2c = mAdj
    sources.push("Markt")
    dataNote = `${count} listings (B2C vraagprijzen)`
    
    // Catalog sanity: als catEst significant verschilt, blend
    if (catEst > 0) {
      if (catEst > b2c * 1.3) {
        b2c = b2c * 0.60 + catEst * 0.40
        dataNote = `${count} listings — gecorrigeerd met catalogus`
      } else if (catEst < b2c * 0.5) {
        // Catalog veel lager? Markt wint, maar verlaag iets
        b2c = b2c * 0.85 + catEst * 0.15
      }
    }
  }
  else if (mOk && prices.length >= 3) {
    // ══ BEPERKT GEVAL: Weinig data ══
    if (catEst > 0) {
      b2c = mAdj * 0.55 + catEst * 0.45
      sources.push("Markt+RDW")
    } else {
      b2c = mAdj
      sources.push("Markt")
    }
    dataNote = `${count} listings — beperkte data`
  }
  else if (catEst > 0) {
    // ══ GEEN MARKTDATA: Catalogus ══
    b2c = catEst
    dataNote = "Catalogusbasis (geen marktdata)"
  }
  else {
    // ══ NIKS: Schatting ══
    const est = seg === "luxury" ? 80000 : seg === "premium" ? 42000 : seg === "utility" ? 28000 : 22000
    b2c = est * resPct(age, seg) * kmFactor(km, age) * tF
    dataNote = "Geschat (geen data)"
  }

  // Finnik integratie
  const hasFin = input.finnikAvailable === true
  const finAvg = hasFin ? ((safeNum(input.finnikLow) + safeNum(input.finnikHigh)) / 2) : 0
  if (hasFin && finAvg > 0) { sources.push("Finnik"); b2c = b2c * .40 + finAvg * .60 }

  // ═══ ABSOLUTE VLOERPRIJZEN ═══
  // Een rijdende auto met APK is ALTIJD meer waard dan sloop
  const scrapFloor = scrapValue(input.weightKg) * 2.5
  b2c = Math.max(b2c, scrapFloor)
  
  // Catalogus-vloer: een werkende auto is minimaal X% van nieuwprijs waard
  if (catalog > 0) {
    const minPct = age <= 5 ? 0.20 : age <= 10 ? 0.08 : age <= 15 ? 0.05 : 0.035
    b2c = Math.max(b2c, catalog * minPct)
  }

  // Absolute minimum: €1.200 voor elke rijdende auto
  b2c = Math.max(b2c, 1200)

  return { b2c: round(b2c), mOk, dataNote }
}

/* ══ STAP 2: RISICO ══ */
function calcRisk(input: DealerInput, age: number, count: number, liq: number, prices: number[]): number {
  let r = 10
  if (age >= 18) r += 22; else if (age >= 15) r += 16; else if (age >= 12) r += 10; else if (age >= 8) r += 6; else if (age >= 5) r += 3
  const km = safeNum(input.km)
  if (km >= 300000) r += 20; else if (km >= 250000) r += 14; else if (km >= 200000) r += 8; else if (km >= 150000) r += 4
  if (count < 3) r += 14; else if (count < 8) r += 6
  if (prices.length >= 5 && coeffVar(prices) > .40) r += 10; else if (prices.length >= 5 && coeffVar(prices) > .25) r += 5
  if (liq < 25) r += 10; else if (liq < 40) r += 4
  if (input.importFlag) r += 5; if (input.stolenFlag) r += 30
  if (toLower(input.fuel).includes("diesel") && age <= 8) r += 4
  return clamp(r, 5, 96)
}

/* ══ STAP 3: ITR — DATAKWALITEIT ══
   Hoe betrouwbaar is de taxatie? Gebaseerd op bronnen, volume, consistentie. */
function calcITR(input: DealerInput, prices: number[], count: number, mOk: boolean): number {
  let s = 0
  // Databronnen (max 3)
  if (safeNum(input.catalogPrice) > 0) s += 1
  if (mOk && count >= 3) s += 1
  if (input.finnikAvailable) s += 1
  // Listings volume (max 3)
  if (count >= 30) s += 3; else if (count >= 15) s += 2.5; else if (count >= 8) s += 2; else if (count >= 5) s += 1.5; else if (count >= 3) s += 1
  // Prijsconsistentie (max 2.5)
  if (prices.length >= 5) { const cv = coeffVar(prices); if (cv <= .12) s += 2.5; else if (cv <= .20) s += 2; else if (cv <= .30) s += 1.5; else if (cv <= .40) s += 1; else s += 0.5 }
  else if (prices.length >= 3) s += 1
  // Markt-catalogus alignment (max 1.5)
  const cat = safeNum(input.catalogPrice)
  if (cat > 0 && mOk && prices.length >= 5) {
    const mC = trimmedMean(prices), age = new Date().getFullYear() - safeNum(input.year)
    const catE = cat * resPct(age, detectSeg(input))
    const ratio = catE > 0 ? mC / catE : 0
    if (ratio >= .75 && ratio <= 1.30) s += 1.5; else if (ratio >= .50 && ratio <= 1.60) s += 0.75
  }
  return clamp(Math.round(s), 1, 10)
}

/* ══ STAP 4: ETR — VERHANDELBAARHEID ══
   Hoe snel/makkelijk verkoopbaar? Liquiditeit, segment, leeftijd, km, brandstof. */
function calcETR(input: DealerInput, seg: Seg, age: number, count: number, liq: number): number {
  let s = 0
  // Liquiditeit (max 3)
  if (liq >= 80) s += 3; else if (liq >= 60) s += 2.5; else if (liq >= 40) s += 2; else if (liq >= 25) s += 1.5; else s += 0.5
  // Segment populariteit (max 2)
  const pop: Record<Seg, number> = { utility: 2.0, premium: 1.7, sports: 1.5, economy: 1.3, ev: 1.2, luxury: 1.0, diesel: 0.8 }
  s += pop[seg] ?? 1.3
  // Leeftijd sweet spot (max 2.5)
  if (age >= 3 && age <= 6) s += 2.5; else if (age >= 1 && age <= 2) s += 2.0; else if (age >= 7 && age <= 10) s += 1.8; else if (age >= 11 && age <= 14) s += 1.0; else if (age < 1) s += 1.5; else s += 0.5
  // KM (max 1.5)
  const ann = safeNum(input.km) / Math.max(age, 1)
  if (ann >= 10000 && ann <= 20000) s += 1.5; else if (ann >= 5000 && ann <= 25000) s += 1.0; else if (ann < 5000) s += 0.8; else s += 0.3
  // Brandstof trend (max 1)
  const fl = toLower(input.fuel)
  if (fl.includes("hybr")) s += 1.0; else if (fl.includes("elektr")) s += 0.8; else if (fl.includes("benzine") || fl.includes("petrol")) s += 0.6; else if (fl.includes("lpg")) s += 0.3; else if (fl.includes("diesel")) s += age <= 5 ? 0.3 : 0.1
  return clamp(Math.round(s), 1, 10)
}

/* ══ STAP 5: APR — AANTREKKELIJKHEID ══
   Combineert verhandelbaarheid, datakwaliteit, risico, marge. */
function calcAPR(itr: number, etr: number, risk: number, marginPct: number): number {
  let s = etr * 0.40 + itr * 0.25 + (1 - risk / 100) * 10 * 0.20
  if (marginPct >= 40) s += 1.5; else if (marginPct >= 25) s += 1.0; else if (marginPct >= 15) s += 0.5
  return clamp(Math.round(s), 1, 10)
}

/* ── LIQUIDITEIT & VELOCITY ──────────── */
function liqScore(c: number) { if (!c) return 20; if (c >= 80) return 97; if (c >= 50) return 90; if (c >= 30) return 80; if (c >= 18) return 68; if (c >= 10) return 55; if (c >= 5) return 40; return 25 }
function velScore(cnt: number, prices: number[]) { if (!cnt || !prices.length) return 25; const m = median(prices); let ib = 0; for (const p of prices) if (m > 0 && Math.abs(p - m) / m <= .15) ib++; return clamp(Math.round(cnt * 1.0 + (ib / Math.max(prices.length, 1)) * 30 + 12), 12, 98) }

/* ── SMART SUMMARY ───────────────────── */
function tips(i: DealerInput, seg: Seg, age: number, liq: number, mOk: boolean, risk: number, count: number): string[] {
  const t: string[] = []
  const sub = toLower(i.subModel)
  const isPerformance = !!sub && ["cupra", "cupra r", "gti", "gtd", "rs", "amg", "st", "type r", "jcw", "nismo", "vrs", "n", "quadrifoglio", "polestar", "gr", "gr-sport"].includes(sub)
  const isYoungtimer = age >= 18 && isPerformance
  const fl = toLower(i.fuel)

  // ── DATA QUALITY WARNING (most important — show first) ──
  if (count < 5) t.push("⚠ Zeer weinig vergelijkbare listings — taxatie indicatief")
  else if (count < 10 && !mOk) t.push("Beperkte marktdata — taxatie minder nauwkeurig")
  else if (!mOk) t.push("Beperkte marktdata — catalogusbasis")

  // ── SUBMODEL / PERFORMANCE ──
  if (isYoungtimer) {
    t.push(`Youngtimer ${sub.toUpperCase()} — verzamelaarsmarkt, prijs kan hoger liggen`)
  } else if (isPerformance) {
    t.push(`${sub.toUpperCase()} uitvoering — nichemarkt, vergelijk specifiek`)
  }

  // ── MARKET / LIQUIDITY ──
  if (!isPerformance) {
    if (liq >= 70) t.push("Populair model, snel verkoopbaar")
    else if (liq >= 45) t.push("Gemiddeld populair model")
    else t.push("Minder gangbaar model — langere standtijd")
  } else if (count < 10) {
    t.push("Zeldzaam model — beperkt aanbod, langere verkooptijd maar vaste klantenkring")
  }

  // ── TRANSMISSIE ──
  if (i.transmissionAuto === true) t.push("Automaat — hogere vraag, premie verrekend (+4-8%)")
  else if (i.transmissionAuto === false && age <= 5) t.push("Handgeschakeld — lagere vraag bij nieuwere auto's (-2-4%)")

  // ── UITRUSTINGSNIVEAU ──
  const eqLvl = toLower(i.equipmentLevel)
  if (!isPerformance) {
    if (eqLvl === "sport" || eqLvl === "luxe") t.push(`${i.equipmentLevel} uitvoering — premium verrekend (+5%)`)
    else if (eqLvl === "basis") t.push("Basis uitvoering — minder opties, lagere waarde (-5%)")
  }

  // ── BRANDSTOF ──
  const engL = toLower(i.engineLabel)
  const isEV = engL === "ev"
  const isHybridCar = engL.includes("hybrid") || engL.includes("hev") || engL.includes("phev") || engL.includes("gte")
  if (fl.includes("diesel") && age <= 8) t.push("Diesel — let op milieuzone-beperkingen")
  if (isEV) t.push("Elektrisch — check batterijstatus en garantierest")
  else if (isHybridCar) t.push("Hybride — aantrekkelijk voor zakelijke rijders, check hybride-accu")

  // ── KM-ANALYSE (context-aware) ──
  const ann = i.km / Math.max(age, 1)
  if (ann > 25000) t.push("Hoog km-verloop — extra afslag")
  else if (ann < 5000 && age >= 10 && isPerformance) t.push("Zeer laag km — positief voor waardebehoud")
  else if (ann < 8000 && age >= 10) t.push("Laag km-verloop voor leeftijd — positief")
  else if (ann < 8000 && age >= 3 && age < 10) t.push("Opvallend laag km — verifieer tellerstand")
  else if (ann < 15000) t.push("Laag km-verloop, positief voor waarde")

  // ── LEEFTIJD (context-aware) ──
  if (isYoungtimer) { /* al gemeld als youngtimer */ }
  else if (age >= 20) t.push("Zeer oude auto — scherp bieden")
  else if (age >= 15) t.push("Oudere auto — beperkte marge")
  else if (age <= 3) t.push("Jong voertuig — sterke vraag, krappe marge")

  // ── FLAGS ──
  if (i.importFlag) t.push("Importauto — RDW geregistreerd als import")
  if (i.stolenFlag) t.push("⚠ GESTOLEN GEREGISTREERD — NIET INKOPEN")
  if (risk >= 50 && !isPerformance) t.push("Hoog risicoprofiel — voorzichtig bieden")

  return t.slice(0, 7)
}

/* ══════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════ */
export function calculateDealerPrice(input: DealerInput): DealerResult {
  const year = safeNum(input.year), km = safeNum(input.km), age = new Date().getFullYear() - year
  const seg = detectSeg(input), tF = trimF(input.trim), sources: string[] = []
  const prices = (input.marketPrices ?? []).filter(p => Number.isFinite(p) && p > 0)
  const count = safeNum(input.marketCount) || prices.length
  const scrap = scrapValue(input.weightKg)
  const margins = SEG_M[seg] ?? SEG_M.economy

  // 1. B2C vraagprijs (marktgebaseerd)
  const { b2c, mOk, dataNote } = b2cVraagprijs(input, seg, age, tF, sources)

  // 1b. Transmissie & uitrustingscorrectie
  //     Automaat is gemiddeld 5-12% duurder dan schakel (leeftijdsafhankelijk)
  //     Sport/Luxe uitvoering voegt waarde toe, Basis trekt af
  let specCorr = 1.0
  if (input.transmissionAuto === true) {
    // Automaat premium neemt af met leeftijd (nieuwer = groter verschil)
    specCorr *= age <= 3 ? 1.08 : age <= 7 ? 1.06 : age <= 12 ? 1.04 : 1.02
  } else if (input.transmissionAuto === false) {
    // Handgeschakeld: lichte korting (markt prefereert automaat bij nieuwere autos)
    specCorr *= age <= 5 ? 0.96 : 0.98
  }
  // Uitrustingsniveau correctie
  const eqLvl = toLower(input.equipmentLevel)
  if (eqLvl === "sport" || eqLvl === "luxe") specCorr *= 1.05
  else if (eqLvl === "basis") specCorr *= 0.95
  // else "comfort" = neutral, no correction

  // 2. Prijswaterval (met spec-correctie)
  let verkoopadviees = round(b2c * specCorr * (1 - margins.negotiate))
  const internetPrijs = round(b2c * specCorr)

  // Verkoopadviees vloer: minimaal 90% van B2C
  verkoopadviees = Math.max(verkoopadviees, round(b2c * 0.90))
  // Absolute minimum
  verkoopadviees = Math.max(verkoopadviees, scrap + 500)
  if (safeNum(input.catalogPrice) > 0) {
    verkoopadviees = Math.max(verkoopadviees, 1000)
  }

  const handelswaarde = Math.max(round(verkoopadviees * (1 - margins.b2bGap)), scrap + 200)

  // 3. Risico
  const liq = liqScore(count), vel = velScore(count, prices)
  const risk = calcRisk(input, age, count, liq, prices)

  // 4. Ratings (calculate ETR first — it drives the inkoop!)
  const itr = calcITR(input, prices, count, mOk)
  const etr = calcETR(input, seg, age, count, liq)

  // 5. T4C Inkoop Advies — MARKTGEBASEERD
  //    Simpel en realistisch: inkoop = verkoopadviees × (1 - dealerMarge)
  //    Dealermarge hangt af van: courantheid, prijsniveau, risico
  const jpEtr = clamp(Math.round((etr / 10) * 5), 0, 5)
  
  // Basismarge: hoe courant, hoe minder marge nodig
  const BASE_MARGINS: Record<number, number> = {
    0: 0.40,   // Incourant: 40% marge nodig
    1: 0.35,   // Matig courant
    2: 0.30,   // Redelijk
    3: 0.25,   // Normaal
    4: 0.22,   // Goed courant
    5: 0.18,   // Zeer courant: 18% marge
  }
  let jpFactor = BASE_MARGINS[jpEtr] ?? 0.25

  // Prijsniveau-correctie: bij goedkope auto's LAGERE marge (anders blijft er niks over)
  // €2.000 auto met 30% marge = €600 marge → inkoop €1.400 ✓
  // €2.000 auto met 40% marge = €800 marge → inkoop €1.200 (te laag)
  if (verkoopadviees < 5000) {
    jpFactor = Math.min(jpFactor, 0.28) // Max 28% marge bij <€5k
  } else if (verkoopadviees < 10000) {
    jpFactor = Math.min(jpFactor, 0.32) // Max 32% marge bij <€10k
  }

  // Risico-opslag: hoog risico = iets meer marge
  if (risk >= 50) jpFactor = Math.min(jpFactor + 0.05, 0.45)

  let t4cBod = round(verkoopadviees * (1 - jpFactor))

  // ═══ SANITY CHECKS ═══
  // 1. Inkoop moet altijd minstens 55% van verkoopadviees zijn
  t4cBod = Math.max(t4cBod, round(verkoopadviees * 0.55))
  
  // 2. Inkoop moet altijd minstens 40% van marktmediaan zijn (als we data hebben)
  if (mOk && prices.length >= 5) {
    const mMed = safeNum(input.marketMedian) || median(prices)
    t4cBod = Math.max(t4cBod, round(mMed * 0.40))
  }
  
  // 3. Inkoop mag niet hoger zijn dan 85% van verkoopadviees
  t4cBod = Math.min(t4cBod, round(verkoopadviees * 0.85))
  
  // 4. Absolute minimum: sloopwaarde
  t4cBod = Math.max(t4cBod, scrap)

  // 6. Profit & APR
  const profitW = Math.max(handelswaarde - t4cBod, 0), profitR = Math.max(verkoopadviees - t4cBod, 0)
  const marginPct = t4cBod > 0 ? Math.round(profitR / t4cBod * 100) : 0
  const apr = calcAPR(itr, etr, risk, marginPct)

  // 6. Confidence
  let confS = liq * .20 + vel * .15 + clamp(count, 0, 40) * .20
  if (safeNum(input.catalogPrice) > 0) confS += 12; if (input.finnikAvailable) confS += 8; if (mOk) confS += 8; if (prices.length >= 10) confS += 5
  const conf = clamp(Math.round(confS), 10, 99)
  const confL = conf >= 85 ? "Uitstekend" : conf >= 72 ? "Zeer hoog" : conf >= 58 ? "Hoog" : conf >= 42 ? "Goed" : conf >= 28 ? "Matig" : "Laag"

  // 7. Verkoopsnelheid
  const sellDays = vel >= 75 ? 5 : vel >= 55 ? 14 : vel >= 35 ? 30 : vel >= 20 ? 60 : 90
  const sellSpeed = sellDays <= 7 ? "Zeer snel" : sellDays <= 14 ? "Snel" : sellDays <= 30 ? "Normaal" : sellDays <= 60 ? "Langzaam" : "Zeer langzaam"
  const courant = (liq + vel) / 2 >= 72 ? "Zeer courant" : (liq + vel) / 2 >= 52 ? "Courant" : (liq + vel) / 2 >= 36 ? "Redelijk courant" : (liq + vel) / 2 >= 22 ? "Matig courant" : "Incourant"

  // 8. Inkoop advies range — breedte afhankelijk van zekerheid
  // Hoge confidence + laag risico = smalle range, lage confidence + hoog risico = brede range
  const spreadPct = clamp(0.04 + (1 - conf / 100) * 0.08 + (risk / 100) * 0.06, 0.04, 0.15)
  const inkoopLow = Math.max(round(t4cBod * (1 - spreadPct)), scrap)
  const inkoopHigh = round(t4cBod * (1 + spreadPct))

  return {
    verkoopadviees, handelswaarde, t4cBod, internetPrijs, inkoopBruto: t4cBod,
    inkoopLow, inkoopHigh, jpEtr, jpFactor,
    itr, etr, apr, liquidityScore: liq, marketVelocity: vel, riskScore: risk, confidence: conf, confidenceLabel: confL,
    profitWholesale: profitW, profitRetail: profitR, marginPercent: marginPct,
    courantLabel: courant, sellSpeed, sellDays, sources, dataNote, smartSummary: tips(input, seg, age, liq, mOk, risk, count),
    residualValue: verkoopadviees
  }
}
