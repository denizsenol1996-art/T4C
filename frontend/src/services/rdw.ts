/* T4C ENTERPRISE RDW SERVICE v8.6
   ALL RDW endpoints: main, catalog, body, fuel-extended, APK, recalls
   Fixes: hybrid/EV detection, power detection, VIN display */

import { detectVehicleIdentity } from "./vehicleIdentity"

export type ApkRecord = {
  date: string
  result: string
  km?: number
  defects?: string[]
}

export type VehicleRDW = {
  plate: string; make: string; model: string; trim: string; year: number; vin?: string
  fuel?: string; fuelSecondary?: string; engineCapacity?: number; engineCode?: string
  cylinders?: number; powerKw?: number; powerHp?: number
  isHybrid?: boolean; isPureEV?: boolean
  body?: string; bodyCode?: string; color?: string; colorSecondary?: string
  doors?: number; seats?: number; maxMass?: number; weightKg?: number
  vehicleType?: string; typeApproval?: string
  lengthMm?: number; widthMm?: number; heightMm?: number
  catalogPrice?: number; bpm?: number; bpmExempt?: boolean
  taxQuarterMin?: number; taxQuarterMax?: number
  co2?: number; co2Wltp?: number; emissionClass?: string; energyLabel?: string
  fuelConsumptionCity?: number; fuelConsumptionHighway?: number; fuelConsumptionCombined?: number
  electricRange?: number; electricConsumption?: number
  firstAdmission?: string; firstAdmissionNL?: string; apkUntil?: string
  importFlag?: boolean; exportFlag?: boolean; stolenFlag?: boolean; wamInsured?: boolean
  topSpeed?: number; towCapacityBraked?: number; towCapacityUnbraked?: number; wheelbase?: number
  apkHistory: ApkRecord[]; kmHistory: { date: string; km: number }[]; recalls: { description: string; status: string }[]
  defects: { date: string; code: string; description: string }[]
  installedObjects: string[]
  inspectionCount?: number
  transmission?: string
  kmAnalysis?: { avgPerYear?: number; estimatedCurrent?: number; anomaly?: string; totalRegistrations?: number }
  // ── Finnik-level extra fields ──
  weightReady?: number          // Massa rijklaar
  taxiIndicator?: boolean       // Taxi geweest?
  wokStatus?: boolean           // Wacht Op Keuren
  sloopIndicator?: boolean      // Gesloopt?
  parallelImport?: boolean      // Parallel geimporteerd
  registrationDate?: string     // Datum tenaamstelling (huidig)
  liabilityDate?: string        // Datum aansprakelijkheid
  plateStatus?: string          // Status kenteken (Geldig/Geschorst/etc)
  noiseStationaryDb?: number    // Geluidsniveau stationair dB(A)
  noiseMovingDb?: number        // Geluidsniveau rijdend dB(A)
  noiseRpm?: number             // Toerental geluidsniveau
  euroClass?: string            // Euro 4, Euro 5, etc
  driveType?: string            // Voorwiel/Achterwiel/4WD
  gearCount?: number            // Aantal versnellingen (from RDW)
  segment?: string              // Voertuig segment
  numberOfAxles?: number        // Aantal assen
  numberOfWheels?: number       // Aantal wielen
  // ── Vehicle identity (v8.6) ──
  engineType?: string          // "TSI", "TDI", "TFSI", "PureTech", "EcoBoost", etc.
  engineLabel?: string         // "1.0 TSI" or "2.0 TDI" or "Cooper S"
  transmissionType?: string    // "Handgeschakeld" | "Automaat" | "DSG" | "CVT" | "PDK" | "S-Tronic"
  transmissionAuto?: boolean   // true = automaat, false = handgeschakeld
  gearCount?: number           // Aantal versnellingen
  equipmentLevel?: string      // "Basis" | "Comfort" | "Sport" | "Luxe" | trim name
  modelVariant?: string        // Full: "1.0 TSI 116pk DSG FR"
  subModel?: string            // Performance/special variant for scraper: "cupra", "gti", "rs", "amg"
  _debugSearchText?: string    // Debug: all text searched for identity detection
}

const BASE = "https://opendata.rdw.nl/resource"

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined
}
function str(v: unknown): string { return v ? String(v).trim() : "" }
function parseYear(d?: string): number { if (!d) return 0; return Number(String(d).slice(0, 4)) || 0 }
function fmtDate(d?: string): string {
  if (!d) return ""
  const c = String(d).replace(/[-/T:.]/g, "").slice(0, 8)
  if (c.length === 8) return `${c.slice(6, 8)}-${c.slice(4, 6)}-${c.slice(0, 4)}`
  return d
}
async function rdwFetch(url: string): Promise<any[]> {
  try { const r = await fetch(url); if (!r.ok) return []; const d = await r.json(); return Array.isArray(d) ? d : [] }
  catch { return [] }
}

export async function fetchRDW(plate: string): Promise<VehicleRDW> {
  const p = plate.replace(/[^A-Z0-9]/gi, "").toUpperCase()

  // 9 parallel fetches — ALL available RDW open data
  const [mainArr, catArr, bodyArr, fuelArr, apkArr, recallArr, defectArr, objectArr, meldArr] = await Promise.all([
    rdwFetch(`${BASE}/m9d7-ebf2.json?kenteken=${p}`),                          // Main voertuigdata
    rdwFetch(`${BASE}/8ys7-d773.json?kenteken=${p}`),                          // Catalog + brandstof basis
    rdwFetch(`${BASE}/vezc-m2t6.json?kenteken=${p}`),                          // Carrosserie
    rdwFetch(`${BASE}/a34c-35wb.json?kenteken=${p}`),                          // Brandstof extended (milieu!)
    rdwFetch(`${BASE}/vkij-7mwc.json?kenteken=${p}&$limit=100&$order=vervaldatum_keuring DESC`), // APK keuringen — raised to 100
    rdwFetch(`${BASE}/t49b-isb7.json?kenteken=${p}`),                          // Terugroepacties
    rdwFetch(`${BASE}/2u8a-sfar.json?kenteken=${p}&$limit=200`),               // Geconstateerde gebreken — raised to 200
    rdwFetch(`${BASE}/sghb-dzxx.json?kenteken=${p}`),                          // Toegevoegde objecten (LPG, trekhaak, etc)
    rdwFetch(`${BASE}/sgfe-77wx.json?kenteken=${p}&$limit=100&$order=meld_datum_door_keuringsinstantie_dt DESC`), // Meldingen KI — raised to 100
  ])

  if (!mainArr.length) throw new Error("Kenteken niet gevonden in RDW")

  const d = mainArr[0]
  const c = catArr[0] || {}
  const b = bodyArr[0] || {}

  // ── BASIC ──
  const make = str(d.merk)
  let model = str(d.handelsbenaming)
  // RDW often stores "TOYOTA YARIS HYBRID" as handelsbenaming — strip the make prefix
  if (model.toUpperCase().startsWith(make.toUpperCase() + " ")) {
    model = model.slice(make.length + 1).trim()
  }
  const trim = str(d.variant || d.uitvoering || "")
  const year = parseYear(d.datum_eerste_toelating)
  const vin = str(d.voertuig_identificatienummer)

  // ══════════════════════════════════════════════════════════════
  // FUEL / MOTOR — CRITICAL: handle MULTIPLE fuel records!
  // RDW a34c-35wb returns SEPARATE records per fuel type:
  //   Hybrid Yaris: record[0]="Elektriciteit", record[1]="Benzine"
  // Previously we only used fuelArr[0] → broke ALL hybrids!
  // ══════════════════════════════════════════════════════════════
  const allFuelRecords = fuelArr.length ? fuelArr : (catArr.length ? catArr : [])
  let fuelBenzine: any = null
  let fuelDiesel: any = null
  let fuelElektr: any = null
  let fuelLPG: any = null
  let fuelOther: any = null

  for (const fr of allFuelRecords) {
    const bo = str(fr.brandstof_omschrijving).toLowerCase()
    if (bo.includes("benzine")) fuelBenzine = fr
    else if (bo.includes("diesel")) fuelDiesel = fr
    else if (bo.includes("elektr")) fuelElektr = fr
    else if (bo.includes("lpg") || bo.includes("cng")) fuelLPG = fr
    else if (!fuelOther) fuelOther = fr
  }

  // Primary = combustion record (has cilinderinhoud, motorcode etc)
  const fPrimary = fuelBenzine || fuelDiesel || fuelElektr || fuelLPG || fuelOther || c
  const fSecondary = fuelElektr && (fuelBenzine || fuelDiesel) ? fuelElektr
    : fuelLPG && fuelBenzine ? fuelLPG : null

  // Fuel labels
  const fuel = str(fPrimary.brandstof_omschrijving || c.brandstof_omschrijving || d.brandstof_omschrijving)
  const fuelSecondary = fSecondary ? str(fSecondary.brandstof_omschrijving)
    : str(fPrimary.secundaire_brandstof || c.secundaire_brandstof || "")

  // Engine specs from combustion record (not the electric record!)
  const engineCapacity = num(fPrimary.cilinderinhoud || c.cilinderinhoud)
  const cylinders = num(fPrimary.aantal_cilinders || c.aantal_cilinders)
  const engineCode = str(fPrimary.motorcode || c.motorcode)

  // ══ HYBRID / EV DETECTION ══
  const hasElecRecord = !!fuelElektr
  const hasCombustionRecord = !!(fuelBenzine || fuelDiesel)
  const modelHasHybrid = /hybr/i.test(model) || /hybr/i.test(trim)

  const isHybrid = (hasElecRecord && hasCombustionRecord) ||    // Two fuel records: benzine + elektriciteit
    modelHasHybrid ||                                             // "YARIS HYBRID" in name
    /hybr/i.test(fuel) || /hybr/i.test(fuelSecondary) ||         // "Hybride" label
    (/phev|plug[\s-]?in|e[\s-]?hybrid/i.test(`${model} ${trim}`.toLowerCase()))

  const isPureEV = hasElecRecord && !hasCombustionRecord && !isHybrid && !fuelLPG

  // ══ POWER DETECTION ══
  // Normalize: RDW sometimes stores kW as fraction (0.055 = 55kW)
  const normPw = (v: number | undefined): number | undefined => {
    if (!v || v <= 0) return undefined
    if (v < 1) return Math.round(v * 1000)
    return Math.round(v)
  }

  let powerKw: number | undefined
  // ALWAYS get netto from MAIN record first — this is the most reliable
  const pwNetto = normPw(num(d.nettomaximumvermogen)) || normPw(num(c.nettomaximumvermogen)) ||
    normPw(num(fPrimary.nettomaximumvermogen))
  // Electric power from electric fuel record or main record
  const pwElec = normPw(num(d.vermogen_motor_elektrisch)) ||
    (fuelElektr ? normPw(num(fuelElektr.nominaal_continu_maximumvermogen)) : undefined)
  const pwContinu = normPw(num(d.nominaal_continu_maximumvermogen))

  if (isPureEV) {
    powerKw = pwElec || pwContinu || pwNetto
  } else if (isHybrid) {
    // Hybrid: ALWAYS prefer nettomaximumvermogen (system/combustion power)
    // vermogen_motor_elektrisch is ONLY the tiny e-motor (10kW for Yaris!)
    if (pwNetto && pwNetto > 15) powerKw = pwNetto
    else if (pwNetto && pwElec && pwElec > pwNetto) powerKw = pwElec
    else powerKw = pwNetto || pwContinu || pwElec
  } else {
    powerKw = pwNetto || pwElec || pwContinu
  }
  const powerHp = powerKw ? Math.round(powerKw * 1.36) : undefined

  // Transmission
  const transmission = str(d.type_remsysteem_voertuig_automatisch || "")

  // ── BODY ──
  const body = str(d.inrichting || b.type_carrosserie_europese_omschrijving || "")
  const doors = num(b.aantal_deuren)
  const seats = num(b.aantal_zitplaatsen || d.aantal_zitplaatsen)
  const color = str(d.eerste_kleur)
  const colorSecondary = str(d.tweede_kleur)
  const vehicleType = str(d.voertuigsoort)
  const typeApproval = str(d.typegoedkeuringsnummer)
  const lengthMm = num(b.lengte_voertuig || d.lengte)
  const widthMm = num(b.breedte_voertuig || d.breedte)
  const heightMm = num(b.hoogte_voertuig || d.hoogte)

  // ── WEIGHT ──
  const weightKg = num(d.massa_ledig_voertuig)
  const maxMass = num(d.toegestane_maximum_massa_voertuig)
  const wheelbase = num(d.wielbasis)
  const topSpeed = num(d.maximum_snelheid)
  const towBraked = num(d.maximum_massa_samenstelling || d.aanhangwagen_geremd)
  const towUnbraked = num(d.aanhangwagen_ongeremd)

  // ── PRICE ──
  const catalogPrice = num(d.catalogusprijs) || num(c.catalogusprijs)
  const bpm = num(d.bruto_bpm || c.bruto_bpm)
  const taxMin = num(d.belasting_kwartaal_minimum)
  const taxMax = num(d.belasting_kwartaal_maximum)

  // ── MILIEU & VERBRUIK (from fuel records + catalog) ──
  const co2 = num(fPrimary.co2_uitstoot_gecombineerd || c.co2_uitstoot_gecombineerd)
  const co2Wltp = num(fPrimary.co2_uitstoot_gewogen || c.co2_uitstoot_gewogen)
  const emissionClass = str(fPrimary.emissieklasse || fPrimary.emissiecode_omschrijving || c.emissieklasse || d.euroklasse)
  const energyLabel = str(fPrimary.zuinigheidslabel || c.zuinigheidslabel)
  // NOTE: RDW uses "buitenweg" not "buiten"!
  const fuelCity = num(fPrimary.brandstofverbruik_stad || c.brandstofverbruik_stad)
  const fuelHwy = num(fPrimary.brandstofverbruik_buitenweg || c.brandstofverbruik_buitenweg)
  const fuelCombined = num(fPrimary.brandstofverbruik_gecombineerd || c.brandstofverbruik_gecombineerd)
  // Electric range/consumption from electric fuel record
  const eRange = num((fuelElektr || fPrimary).actie_radius_enkel_elektrisch_wltp || (fuelElektr || fPrimary).actie_radius_enkel_elektrisch_stad || c.elektrisch_bereik)
  const eCons = num((fuelElektr || fPrimary).elektrisch_verbruik_enkel_elektrisch_wltp)

  // ── DATES ──
  const firstAdmission = str(d.datum_eerste_toelating)
  const firstAdmissionNL = str(d.datum_eerste_tenaamstelling_in_nederland)
  const apkUntil = str(d.vervaldatum_apk)
  const importFlag = firstAdmissionNL && firstAdmission && firstAdmissionNL !== firstAdmission
  const exportFlag = str(d.export_indicator) === "Ja"
  const stolenFlag = str(d.gestolen_indicator) === "Ja"
  const wamInsured = str(d.wam_verzekerd) === "Ja"

  // ── FINNIK-LEVEL EXTRA STATUS ──
  const taxiIndicator = str(d.taxi_indicator) === "Ja"
  const wokStatus = str(d.wacht_op_keuren) === "Ja"
  const sloopIndicator = str(d.sloopregistratie_indicator) === "Ja" || str(d.sloop_indicator) === "Ja"
  const parallelImport = str(d.parallel_import) === "Ja" || str(d.parallelimport) === "Ja"
  const registrationDate = fmtDate(d.datum_tenaamstelling)
  const liabilityDate = fmtDate(d.datum_aansprakelijkheid || d.datum_eerste_tenaamstelling_in_nederland_dt)
  const plateStatus = str(d.tenaamstellen_mogelijk) === "Ja" ? "Geldig" : (exportFlag ? "Geexporteerd" : (sloopIndicator ? "Gesloopt" : str(d.status_voertuig || "")))

  // ── GELUIDSNIVEAU (from fuel records) ──
  const noiseStationaryDb = num(fPrimary.geluidsniveau_stationair || c.geluidsniveau_stationair)
  const noiseMovingDb = num(fPrimary.geluidsniveau_rijdend || c.geluidsniveau_rijdend)
  const noiseRpm = num(fPrimary.toerental_geluidsniveau || c.toerental_geluidsniveau)

  // ── EXTRA VEHICLE INFO ──
  const euroClass = str(fPrimary.euroklasse || d.euroklasse || c.euroklasse)
  const numberOfAxles = num(b.aantal_assen || d.aantal_assen)
  const numberOfWheels = num(b.aantal_wielen || d.aantal_wielen)
  const weightReady = num(d.massa_rijklaar || d.massa_bedrijfsklaar)
  const driveType = str(b.aangedreven_as || d.plaats_aandrijving || "")
  const gearCountRDW = num(d.aantal_versnellingen)
  const segment = str(d.europese_voertuigcategorie || c.europese_voertuigcategorie || "")

  // ── APK HISTORY ──
  const apkHistory: ApkRecord[] = []
  const kmHistory: { date: string; km: number }[] = []

  if (apkArr.length) {
    for (const a of apkArr) {
      const date = fmtDate(a.vervaldatum_keuring || a.datum_keuring || a.meld_datum_door_keuringsinstantie)
      const rawResult = str(a.beoordeling)
      const result = rawResult || (str(a.steekproef_indicator) === "Ja" ? "Steekproef" : "Goedgekeurd")
      const kmVal = num(a.kilometerstand_op_moment_keuring || a.kilometerstand)
      apkHistory.push({ date, result, km: kmVal })
      if (kmVal && date) kmHistory.push({ date, km: kmVal })
    }
  }

  // ── EXTRA KM from meldingen keuringsinstantie (sgfe-77wx) ──
  // These can contain km readings from non-APK inspections (LPG, tachograaf, etc.)
  if (meldArr.length) {
    for (const m of meldArr) {
      const kmVal = num(m.kilometerstand || m.kilometerstand_op_moment_keuring)
      const date = fmtDate(m.meld_datum_door_keuringsinstantie_dt || m.meld_datum_door_keuringsinstantie)
      if (kmVal && date) {
        // Only add if not already in kmHistory from APK
        const exists = kmHistory.some(k => k.date === date && k.km === kmVal)
        if (!exists) kmHistory.push({ date, km: kmVal })
      }
    }
  }

  kmHistory.sort((a, b) => {
    const da = a.date.split("-").reverse().join("")
    const db = b.date.split("-").reverse().join("")
    return da.localeCompare(db)
  })

  // Deduplicate km entries with same date (keep highest km)
  const kmDeduped: typeof kmHistory = []
  for (const k of kmHistory) {
    const existing = kmDeduped.find(e => e.date === k.date)
    if (existing) { if (k.km > existing.km) existing.km = k.km }
    else kmDeduped.push({ ...k })
  }
  kmHistory.length = 0
  kmHistory.push(...kmDeduped)

  // ── KM ANALYSIS ──
  let kmAnalysis: { avgPerYear?: number; estimatedCurrent?: number; anomaly?: string; totalRegistrations?: number } | undefined
  if (kmHistory.length >= 2) {
    const first = kmHistory[0]
    const last = kmHistory[kmHistory.length - 1]
    const firstDate = new Date(first.date.split("-").reverse().join("-"))
    const lastDate = new Date(last.date.split("-").reverse().join("-"))
    const years = Math.max(0.5, (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 3600 * 1000))
    const avgPerYear = Math.round((last.km - first.km) / years)
    
    // Estimate current km based on trend
    const now = new Date()
    const yearsSinceLast = (now.getTime() - lastDate.getTime()) / (365.25 * 24 * 3600 * 1000)
    const estimatedCurrent = Math.round(last.km + avgPerYear * yearsSinceLast)

    // Check for anomalies (km rollback, extreme jumps)
    let anomaly: string | undefined
    for (let i = 1; i < kmHistory.length; i++) {
      const diff = kmHistory[i].km - kmHistory[i - 1].km
      if (diff < -500) {
        anomaly = `Mogelijke tellerterugdraaiing: ${kmHistory[i-1].date} (${kmHistory[i-1].km} km) -> ${kmHistory[i].date} (${kmHistory[i].km} km)`
        break
      }
    }

    kmAnalysis = {
      avgPerYear,
      estimatedCurrent,
      anomaly,
      totalRegistrations: kmHistory.length,
    }
  }

  // ── RECALLS ──
  const recalls = recallArr.map(r => ({
    description: str(r.beschrijving_van_het_defect || r.omschrijving || r.referentiecode_fabrikant),
    status: str(r.code_status || "Onbekend"),
  }))

  // ── APK GEBREKEN (geconstateerde defecten) ──
  let defects: { date: string; code: string; description: string }[] = []
  if (defectArr.length) {
    // Collect unique defect codes
    const codes = [...new Set(defectArr.map((d: any) => str(d.gebrek_identificatie)).filter(Boolean))]
    // Fetch descriptions for all codes
    let descMap: Record<string, string> = {}
    if (codes.length) {
      try {
        const codeList = codes.map(c => `'${c}'`).join(",")
        const descArr = await rdwFetch(`${BASE}/hx2c-gt7k.json?$where=gebrek_identificatie in(${codeList})&$limit=200`)
        for (const dd of descArr) {
          const code = str(dd.gebrek_identificatie)
          if (code) descMap[code] = str(dd.gebrek_omschrijving)
        }
      } catch { /* descriptions are optional */ }
    }
    // Build defects list
    defects = defectArr.map((d: any) => {
      const code = str(d.gebrek_identificatie)
      return {
        date: fmtDate(d.meld_datum_door_keuringsinstantie),
        code,
        description: descMap[code] || code,
      }
    })
    // Sort newest first
    defects.sort((a, b) => {
      const da = a.date.split("-").reverse().join("")
      const db = b.date.split("-").reverse().join("")
      return db.localeCompare(da)
    })
  }

  // ── INSTALLED OBJECTS (LPG, trekhaak, etc) ──
  const installedObjects: string[] = []
  for (const obj of objectArr) {
    const desc = str(obj.object_omschrijving || obj.omschrijving)
    if (desc && !installedObjects.includes(desc)) installedObjects.push(desc)
  }

  // ── INSPECTION COUNT from meldingen ──
  const inspectionCount = meldArr.length || undefined

  // ══ VEHICLE IDENTITY (v8.6) — delegated to vehicleIdentity.ts ══
  // Collect ALL text from ALL RDW records for maximum detection coverage
  // GR-Sport, GTI, RS etc. can hide in ANY of these fields
  const allTextParts: string[] = [
    model, trim,
    str(d.handelsbenaming),
    str(d.variant), str(d.uitvoering), str(d.type),
    str(d.typegoedkeuringsnummer),
    str(d.type_gasinstallatie),
    str(c.uitvoering), str(c.variant), str(c.type),
    str(b.type_carrosserie_europese_omschrijving),
  ]
  // Also check ALL catalog records (catArr can have multiple)
  for (const cr of catArr) {
    allTextParts.push(str(cr.uitvoering), str(cr.variant), str(cr.type))
  }
  // And all body records
  for (const br of bodyArr) {
    allTextParts.push(str(br.type_carrosserie_europese_omschrijving), str(br.carrosserie_voertuig))
  }

  const identityAllText = allTextParts.filter(Boolean).join(" ").toLowerCase()
  const identityTrim = [str(d.variant), str(d.uitvoering), str(c.uitvoering)].filter(Boolean).join(" ")

  // Debug: log what we're searching in
  console.log("[T4C] Identity input:", { make, model, identityTrim, year, fuel, fuelSecondary, catalogPrice, powerKw, powerHp, isHybrid, isPureEV })

  let identity: ReturnType<typeof detectVehicleIdentity>
  try {
    identity = detectVehicleIdentity({
      make, model,
      trim: identityTrim,
      year, fuel, fuelSecondary,
      engineCapacity: engineCapacity || 0, powerKw, powerHp,
      allText: identityAllText,
      catalogPrice: catalogPrice || undefined,
      typeCode: [str(d.type), str(d.uitvoering), str(c.type), str(c.uitvoering)].filter(Boolean).join(" "),
      vin: vin || undefined,
      weightKg: weightKg || undefined,
    })
    console.log("[T4C] Identity result:", identity)
  } catch (e) {
    console.error("[T4C] Identity detection failed:", e)
    identity = {
      engineType: "", engineLabel: "", transmissionType: "Onbekend",
      transmissionAuto: false, equipmentLevel: "", modelVariant: "", subModel: "",
    }
  }

  return {
    plate: p, make, model, trim, year, vin,
    fuel, fuelSecondary, engineCapacity, engineCode, cylinders, powerKw, powerHp,
    isHybrid, isPureEV,
    body, bodyCode: "", color, colorSecondary, doors, seats, maxMass, weightKg,
    vehicleType, typeApproval, lengthMm, widthMm, heightMm,
    catalogPrice, bpm, bpmExempt: bpm === 0,
    taxQuarterMin: taxMin, taxQuarterMax: taxMax,
    co2, co2Wltp, emissionClass, energyLabel,
    fuelConsumptionCity: fuelCity, fuelConsumptionHighway: fuelHwy,
    fuelConsumptionCombined: fuelCombined, electricRange: eRange, electricConsumption: eCons,
    firstAdmission: fmtDate(firstAdmission), firstAdmissionNL: fmtDate(firstAdmissionNL),
    apkUntil: fmtDate(apkUntil),
    importFlag: !!importFlag, exportFlag, stolenFlag, wamInsured,
    topSpeed, towCapacityBraked: towBraked, towCapacityUnbraked: towUnbraked, wheelbase,
    apkHistory, kmHistory, recalls, defects, installedObjects, inspectionCount, transmission,
    kmAnalysis,
    // Finnik-level extras
    weightReady, taxiIndicator, wokStatus, sloopIndicator, parallelImport,
    registrationDate, liabilityDate, plateStatus,
    noiseStationaryDb, noiseMovingDb, noiseRpm,
    euroClass, driveType, numberOfAxles, numberOfWheels, segment,
    gearCount: gearCountRDW || identity.gearCount,
    ...identity,
    subModel: identity.subModel || undefined,
    modelVariant: identity.modelVariant || undefined,
    _debugSearchText: identityAllText,
  }
}
