import { useEffect, useMemo, useRef, useState } from "react"
import { fetchVehicleEnriched, type EnrichedVehicle } from "./services/vehicleEnrichment"
import { fetchMarket, type MarketData } from "./services/market"
import { calculateDealerPrice, type DealerResult } from "./engine/dealerPricing"
import "./styles.css"

function getToken() { return localStorage.getItem("t4c_token") || "" }
function logout() { localStorage.removeItem("t4c_token"); window.location.href = "/login" }
function cleanPlate(s: string) { return String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() }
function formatPlate(input: string): string {
  const p = cleanPlate(input); if (p.length !== 6) return p
  const rx = [/^([A-Z]{2})(\d{2})(\d{2})$/,/^(\d{2})(\d{2})([A-Z]{2})$/,/^(\d{2})([A-Z]{2})(\d{2})$/,/^([A-Z]{2})(\d{2})([A-Z]{2})$/,/^([A-Z]{2})([A-Z]{2})(\d{2})$/,/^(\d{2})([A-Z]{2})([A-Z]{2})$/,/^(\d{2})([A-Z]{3})(\d{1})$/,/^(\d{1})([A-Z]{3})(\d{2})$/,/^([A-Z]{2})(\d{3})([A-Z]{1})$/,/^([A-Z]{1})(\d{3})([A-Z]{2})$/,/^([A-Z]{3})(\d{2})([A-Z]{1})$/,/^([A-Z]{1})(\d{2})([A-Z]{3})$/,/^(\d{1})([A-Z]{2})(\d{3})$/,/^(\d{3})([A-Z]{2})(\d{1})$/]
  for (const r of rx) { const m = p.match(r); if (m) return `${m[1]}-${m[2]}-${m[3]}` }
  return `${p.slice(0,2)}-${p.slice(2,4)}-${p.slice(4)}`
}
const E = (n?: number|null) => {
  if (!n || !Number.isFinite(n)) return "\u2014"
  return "\u20AC " + new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n)
}
const N = (n?: number|null) => {
  if (!n || !Number.isFinite(n)) return "\u2014"
  return new Intl.NumberFormat("nl-NL").format(n)
}

type HistEntry = { plate: string; make: string; model: string; year: number; price?: number; ts: number }
function loadHist(): HistEntry[] { try { return JSON.parse(localStorage.getItem("t4c_hist") || "[]") } catch { return [] } }
function saveHist(h: HistEntry[]) { localStorage.setItem("t4c_hist", JSON.stringify(h.slice(0, 50))) }
type PFEntry = { plate: string; make: string; model: string; year: number; inkoop: number; verkoop?: number; inkoopDate: string; verkoopDate?: string }
function loadPF(): PFEntry[] { try { return JSON.parse(localStorage.getItem("t4c_portfolio") || "[]") } catch { return [] } }
function savePF(p: PFEntry[]) { localStorage.setItem("t4c_portfolio", JSON.stringify(p)) }
function calcBpmRest(bpmOrig: number, year: number) {
  const ageM = Math.max(0, (new Date().getFullYear() - year) * 12 + new Date().getMonth())
  const tbl: [number, number][] = [[0,100],[1,98],[3,95],[6,89],[9,83],[12,77],[15,64],[18,54],[21,46],[24,40],[30,32],[36,26],[48,19],[60,15],[72,12],[84,10],[96,8],[120,6],[180,4]]
  let pct = 4; for (const [m, p] of tbl) { if (ageM >= m) pct = p; else break }
  return { rest: Math.round(bpmOrig * pct / 100), ageM, pct }
}
type Deal = { title: string; price: number; km: number | null; year: number | null; url: string; source: string; mk: string; ml: string; yr: number; marketMedian: number; potentialMargin: number; marginPct: number }
type Page = "dashboard" | "taxatie" | "deals" | "bulk" | "portfolio" | "voorraad" | "biedingen" | "inspecties" | "inbox" | "instellingen" | "admin"

const OPTS: { id: string; label: string; pct: number; cat: string }[] = [
  { id: "leer", label: "Leder interieur", pct: 3.5, cat: "Comfort" },
  { id: "stoel_verw", label: "Stoelverwarming", pct: 1.5, cat: "Comfort" },
  { id: "stoel_elek", label: "Elektrische stoelen", pct: 1.5, cat: "Comfort" },
  { id: "keyless", label: "Keyless entry", pct: 1.0, cat: "Comfort" },
  { id: "clima", label: "Climate control 2z+", pct: 1.2, cat: "Comfort" },
  { id: "pano", label: "Panoramadak", pct: 3.0, cat: "Exterieur" },
  { id: "led", label: "Full LED / Matrix", pct: 1.5, cat: "Exterieur" },
  { id: "cam360", label: "360\u00B0 camera", pct: 1.5, cat: "Exterieur" },
  { id: "trek", label: "Trekhaak", pct: 1.2, cat: "Exterieur" },
  { id: "velg", label: "LM velgen 18\"+", pct: 1.0, cat: "Exterieur" },
  { id: "navi", label: "Navigatie groot", pct: 1.5, cat: "Tech" },
  { id: "hud", label: "Head-up display", pct: 2.0, cat: "Tech" },
  { id: "audio", label: "Premium audio", pct: 1.5, cat: "Tech" },
  { id: "carplay", label: "CarPlay/Android", pct: 0.8, cat: "Tech" },
  { id: "acc", label: "Adaptive cruise", pct: 1.5, cat: "Rijhulp" },
  { id: "lane", label: "Lane assist", pct: 1.0, cat: "Rijhulp" },
  { id: "park", label: "Park assist", pct: 1.5, cat: "Rijhulp" },
  { id: "dh", label: "Dodehoekdetectie", pct: 1.0, cat: "Rijhulp" },
]
const RECON: { id: string; label: string; cost: number; cat: string }[] = [
  { id: "apk", label: "APK keuring", cost: 50, cat: "Technisch" },
  { id: "kb", label: "Kleine beurt", cost: 150, cat: "Technisch" },
  { id: "gb", label: "Grote beurt", cost: 350, cat: "Technisch" },
  { id: "dist", label: "Distributieriem", cost: 600, cat: "Technisch" },
  { id: "rem", label: "Remschijven+blokken", cost: 300, cat: "Technisch" },
  { id: "band", label: "Banden (4x)", cost: 300, cat: "Technisch" },
  { id: "airco", label: "Airco service", cost: 80, cat: "Technisch" },
  { id: "accu", label: "Accu vervangen", cost: 150, cat: "Technisch" },
  { id: "lak", label: "Lakschade", cost: 250, cat: "Optisch" },
  { id: "deuk", label: "Deuk/kras", cost: 150, cat: "Optisch" },
  { id: "poets", label: "Prof. poetsen", cost: 100, cat: "Optisch" },
  { id: "int", label: "Interieur reiniging", cost: 75, cat: "Optisch" },
  { id: "ruit", label: "Voorruit vervangen", cost: 350, cat: "Optisch" },
  { id: "adv", label: "Advertentiekosten", cost: 50, cat: "Verkoop" },
  { id: "trans", label: "Transport", cost: 150, cat: "Verkoop" },
  { id: "rdw", label: "RDW overschrijving", cost: 40, cat: "Verkoop" },
  { id: "gar", label: "Garantie 3 mnd", cost: 200, cat: "Verkoop" },
]

function splitPlates(input: string): string[] {
  return input.split(/[\n,;]+/).map(s => cleanPlate(s.trim())).filter(p => p.length >= 5)
}

export default function App() {
  const [page, setPageRaw] = useState<Page>("dashboard")

  // Mobile → redirect to Dealer Toolkit
  useEffect(() => {
    if (window.innerWidth <= 768 && !window.location.search.includes("force=desktop")) {
      window.location.href = "/m/"
    }
  }, [])

  const [theme, setThemeRaw] = useState<"dark"|"light">(() => (localStorage.getItem("t4c_theme") as "dark"|"light") || "dark")
  const setTheme = (t: "dark"|"light") => { setThemeRaw(t); localStorage.setItem("t4c_theme", t); document.documentElement.setAttribute("data-theme", t) }
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme) }, [])
  const setPage = (p: Page) => {
    if (p === "taxatie") { setV(null); setR(null); setM(null); setError(""); }
    if (p === "admin") { setTimeout(() => { loadAdminData(); loadAdminLogs("server.log"); }, 50) }
    setPageRaw(p);
  }
  const [plate, setPlate] = useState("")
  const [km, setKm] = useState("")
  const [v, setV] = useState<EnrichedVehicle | null>(null)
  const [m, setM] = useState<MarketData | null>(null)
  const [r, setR] = useState<DealerResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [issues, setIssues] = useState<{ issues: { category: string; text: string }[]; source: string } | null>(null)
  const [margeAdj, setMargeAdj] = useState<number | null>(null)
  const [history, setHistory] = useState<HistEntry[]>(loadHist)
  const [selOpts, setSelOpts] = useState<Set<string>>(new Set())
  const [userName, setUserName] = useState("")
  const [userRole, setUserRole] = useState("dealer")
  const scrollToSec = (id: string) => { document.getElementById("sec-"+id)?.scrollIntoView({ behavior: "smooth", block: "start" }) }
  const [reconS, setReconS] = useState<Record<string, boolean>>({})
  const [reconC, setReconC] = useState("")
  const [deals, setDeals] = useState<Deal[]>([])
  const [dealsL, setDealsL] = useState(false)
  const [bulkIn, setBulkIn] = useState("")
  const [bulkRes, setBulkRes] = useState<any[]>([])
  const [bulkL, setBulkL] = useState(false)
  const [pf, setPF] = useState<PFEntry[]>(loadPF)
  const [showVoorraad, setShowVoorraad] = useState(false)
  const [vrPrijs, setVrPrijs] = useState("")
  const [vrBeschr, setVrBeschr] = useState("")
  const [vrHighlights, setVrHighlights] = useState("")
  const [vrSaving, setVrSaving] = useState(false)
  const [vrId, setVrId] = useState<number | null>(null)
  const [vrPhotos, setVrPhotos] = useState<string[]>([])
  const [vrUploading, setVrUploading] = useState(false)
  const [vrEnhance, setVrEnhance] = useState(true)
  const pageRef = useRef<HTMLDivElement>(null)

  // Auth header helper
  const authHeaders = () => ({ Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" })
  const authGet = () => ({ headers: { Authorization: `Bearer ${getToken()}` } })

  // Admin state
  const [adminUsers, setAdminUsers] = useState<any[]>([])
  const [adminStats, setAdminStats] = useState<any>(null)
  const [adminLogs, setAdminLogs] = useState<string[]>([])
  const [adminLogFile, setAdminLogFile] = useState("server.log")
  const loadAdminData = async () => {
    try {
      const [uRes, sRes] = await Promise.all([
        fetch("/api/users", authGet()).then(r => r.json()),
        fetch("/api/admin/stats", authGet()).then(r => r.json()),
      ])
      if (uRes.ok) setAdminUsers(uRes.users)
      setAdminStats(sRes)
    } catch {}
  }
  const loadAdminLogs = async (file?: string) => {
    const f = file || adminLogFile
    try {
      const r = await fetch(`/api/admin/logs/${f}?n=100`, authGet()).then(r => r.json())
      setAdminLogs(r.lines || [])
    } catch { setAdminLogs(["Kan logs niet laden"]) }
  }

  // ── New page state ──
  const [voorraadList, setVoorraadList] = useState<any[]>([])
  const [voorraadLoading, setVoorraadLoading] = useState(false)
  const [voorraadEdit, setVoorraadEdit] = useState<any>(null)
  const [contactRequests, setContactRequests] = useState<any[]>([])
  const [contactLoading, setContactLoading] = useState(false)
  const [biedingenList, setBiedingenList] = useState<any[]>([])
  const [biedingenLoading, setBiedingenLoading] = useState(false)
  const [inspectiesList, setInspectiesList] = useState<any[]>([])
  const [inspectiesLoading, setInspectiesLoading] = useState(false)
  const [dbPortfolio, setDbPortfolio] = useState<any[]>([])
  const [dbPortfolioLoading, setDbPortfolioLoading] = useState(false)
  const [dbTaxaties, setDbTaxaties] = useState<any[]>([])
  const [settingsState, setSettingsState] = useState<Record<string, string>>({})
  const [pwOld, setPwOld] = useState("")
  const [pwNew, setPwNew] = useState("")
  const [pwMsg, setPwMsg] = useState("")
  const fmt = useMemo(() => formatPlate(plate), [plate])
  const kmN = Number(km.replace(/[^\d]/g, "")) || 0
  const reconTot = useMemo(() => {
    let t = 0
    for (const it of RECON) { if (reconS[it.id]) t += it.cost }
    return t + (Number(reconC) || 0)
  }, [reconS, reconC])
  const optPct = useMemo(() => {
    let t = 0
    for (const o of OPTS) { if (selOpts.has(o.id)) t += o.pct }
    return t
  }, [selOpts])

  useEffect(() => {
    const token = getToken()
    if (!token) { window.location.href = "/login"; return }
    fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.ok) { setUserName(d.name || d.username); setUserRole(d.role || "dealer") } else logout() })
      .catch(() => logout())
    // Load taxatie history from DB
    fetch("/api/taxaties?limit=50", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (d.ok) setDbTaxaties(d.taxaties || []) }).catch(() => {})
    // Load portfolio from DB
    fetch("/api/portfolio", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => { if (d.ok) setDbPortfolio(d.portfolio || []) }).catch(() => {})
  }, [])

  async function loadVoorraad() {
    setVoorraadLoading(true)
    try {
      const res = await fetch("/api/voorraad", authGet())
      const d = await res.json()
      if (d.ok) setVoorraadList(d.cars || [])
    } catch {} finally { setVoorraadLoading(false) }
  }
  async function loadContacts() {
    setContactLoading(true)
    try {
      const res = await fetch("/api/contact-requests", authGet())
      const d = await res.json()
      if (d.ok) setContactRequests(d.requests || [])
    } catch {} finally { setContactLoading(false) }
  }
  async function loadBiedingen() {
    setBiedingenLoading(true)
    try {
      const res = await fetch("/api/biedingen", authGet())
      const d = await res.json()
      if (d.ok) setBiedingenList(d.biedingen || [])
    } catch {} finally { setBiedingenLoading(false) }
  }
  async function loadInspecties() {
    setInspectiesLoading(true)
    try {
      const res = await fetch("/api/inspecties", authGet())
      const d = await res.json()
      if (d.ok) setInspectiesList(d.inspecties || [])
    } catch {} finally { setInspectiesLoading(false) }
  }
  async function deleteVoorraadItem(id: number) {
    if (!confirm("Weet je zeker dat je deze auto wilt verwijderen?")) return
    try {
      await fetch(`/api/voorraad/${id}`, { method: "DELETE", ...authGet() })
      loadVoorraad()
    } catch {}
  }
  async function updateVoorraadItem(id: number, data: any) {
    try {
      await fetch(`/api/voorraad/${id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(data) })
      setVoorraadEdit(null); loadVoorraad()
    } catch {}
  }
  async function deleteContactRequest(id: number) {
    try {
      await fetch(`/api/contact-requests/${id}`, { method: "DELETE", ...authGet() })
      loadContacts()
    } catch {}
  }
  async function markContactRead(id: number) {
    try {
      await fetch(`/api/contact-requests/${id}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ status: "gelezen" }) })
      loadContacts()
    } catch {}
  }
  async function updateBodStatus(id: number, status: string) {
    try {
      await fetch(`/api/bod/${id}/status`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ status }) })
      loadBiedingen()
    } catch {}
  }
  async function addToDbPortfolio() {
    if (!v || !r) return
    try {
      const res = await fetch("/api/portfolio/add", { method: "POST", headers: authHeaders(),
        body: JSON.stringify({ kenteken: formatPlate(plate), make: v.make, model: v.model, year: v.year,
          inkoop_prijs: adjMid, vraag_prijs: r.verkoopadviees, reconditie_kosten: reconTot, status: "in_stock" }) })
      const d = await res.json()
      if (d.ok) {
        alert(`${v.make} ${v.model} toegevoegd aan portfolio`)
        fetch("/api/portfolio", authGet()).then(r => r.json()).then(d => { if (d.ok) setDbPortfolio(d.portfolio || []) }).catch(() => {})
      }
    } catch {}
  }
  async function sellDbPortfolioItem(id: number) {
    const inp = document.getElementById(`dbpf-${id}`) as HTMLInputElement
    const val = Number(inp?.value)
    if (!val || val <= 0) return
    try {
      await fetch(`/api/portfolio/${id}/sell`, { method: "PUT", headers: authHeaders(), body: JSON.stringify({ verkoop_prijs: val }) })
      fetch("/api/portfolio", authGet()).then(r => r.json()).then(d => { if (d.ok) setDbPortfolio(d.portfolio || []) }).catch(() => {})
    } catch {}
  }
  async function deleteDbPortfolioItem(id: number) {
    if (!confirm("Verwijderen uit portfolio?")) return
    try {
      await fetch(`/api/portfolio/${id}`, { method: "DELETE", ...authGet() })
      fetch("/api/portfolio", authGet()).then(r => r.json()).then(d => { if (d.ok) setDbPortfolio(d.portfolio || []) }).catch(() => {})
    } catch {}
  }
  async function changePassword() {
    setPwMsg("")
    if (!pwOld || !pwNew) { setPwMsg("Vul beide velden in"); return }
    if (pwNew.length < 6) { setPwMsg("Minimaal 6 tekens"); return }
    try {
      const res = await fetch("/api/me/password", { method: "POST", headers: authHeaders(),
        body: JSON.stringify({ current_password: pwOld, new_password: pwNew }) })
      const d = await res.json()
      if (d.ok) { setPwMsg("✓ Wachtwoord gewijzigd!"); setPwOld(""); setPwNew("") }
      else setPwMsg(d.error || "Fout")
    } catch { setPwMsg("Verbindingsfout") }
  }
  async function loadSettings() {
    try {
      const res = await fetch("/api/settings", authGet())
      const d = await res.json()
      if (d.ok) setSettingsState(d.settings || {})
    } catch {}
  }
  async function saveSetting(key: string, value: string) {
    try {
      await fetch("/api/settings", { method: "PUT", headers: authHeaders(), body: JSON.stringify({ [key]: value }) })
      setSettingsState(prev => ({ ...prev, [key]: value }))
    } catch {}
  }

  const adjM = margeAdj ?? r?.marginPercent ?? 30
  const optMul = 1 + (optPct / 100)
  const adjMid = r ? Math.round((r.verkoopadviees * optMul) / (1 + adjM / 100)) : 0
  const adjSpr = r && r.t4cBod > 0 ? (r.inkoopHigh - r.inkoopLow) / (2 * r.t4cBod) : 0.07
  const adjLow = r ? Math.round(adjMid * (1 - adjSpr)) : 0
  const adjHigh = r ? Math.round(adjMid * (1 + adjSpr)) : 0
  const bpm = v?.bpm && v?.year ? calcBpmRest(v.bpm, v.year) : null
  const vLaag = m?.p25 ? Math.round(m.p25) : r ? Math.round(r.verkoopadviees * 0.85) : 0
  const vMid = m?.median ? Math.round(m.median) : r ? r.verkoopadviees : 0
  const vHoog = m?.p75 ? Math.round(m.p75) : r ? Math.round(r.verkoopadviees * 1.15) : 0

  async function taxeer() {
    const p = cleanPlate(plate)
    if (!p) { setError("Vul kenteken in"); return }
    if (!kmN) { setError("Vul km-stand in"); return }
    setLoading(true); setError(""); setR(null); setM(null); setV(null)
    setIssues(null); setMargeAdj(null); setSelOpts(new Set())
    setReconS({}); setReconC(""); setPage("taxatie")
    try {
      const ve = await fetchVehicleEnriched(p); setV(ve)
      let mk: MarketData | null = null
      try { mk = await fetchMarket(ve.make, ve.model, ve.year, kmN, ve.subModel, ve.body || "", ve.fuel || ""); setM(mk) } catch { /* ok */ }
      const res = calculateDealerPrice({
        make: ve.make, model: ve.model, trim: ve.trim, year: ve.year, km: kmN,
        fuel: ve.fuel, weightKg: ve.weightKg, catalogPrice: ve.catalogPrice,
        bpm: ve.bpm, power: ve.powerKw, marketAvg: mk?.avg, marketMedian: mk?.median,
        marketCount: mk?.count, marketPrices: mk?.prices, marketP10: mk?.p10,
        marketP25: mk?.p25, marketP75: mk?.p75, marketP90: mk?.p90,
        marketQuality: mk?.validation?.quality, finnikAvailable: ve.source?.finnik === true,
        finnikWaardeLow: (ve as any).finnikData?.waardeLow, finnikWaardeHigh: (ve as any).finnikData?.waardeHigh,
        ownerCount: (ve as any).ownerCount || 0, isExDealer: (ve as any).isExDealer || false,
        bpmRest: (ve as any).bpmRest || 0, bijtelling: (ve as any).bijtelling || null,
        emissieKlasse: (ve as any).emissieKlasse || null,
        importFlag: ve.importFlag, stolenFlag: ve.stolenFlag,
        transmissionAuto: ve.transmissionAuto, equipmentLevel: ve.equipmentLevel,
        engineLabel: ve.engineLabel, subModel: ve.subModel
      })
      // AI validation now embedded in res.aiValidation (server-side)
      setR(res)
      const h = loadHist().filter(x => x.plate !== formatPlate(p))
      h.unshift({ plate: formatPlate(p), make: ve.make, model: ve.model, year: ve.year, price: res.t4cBod, ts: Date.now() })
      saveHist(h); setHistory(loadHist())
      fetch(`/api/known-issues?make=${encodeURIComponent(ve.make)}&model=${encodeURIComponent(ve.model)}&year=${ve.year}`)
        .then(r => r.json()).then(d => { if (d?.issues?.length) setIssues(d) }).catch(() => { })
      // Auto-save taxatie to database
      fetch("/api/taxatie/save", { method: "POST", headers: authHeaders(),
        body: JSON.stringify({ kenteken: formatPlate(p), make: ve.make, model: ve.model, model_variant: ve.modelVariant || "",
          year: ve.year, fuel: ve.fuel, km: kmN || 0, color: ve.color, body: ve.body,
          power_kw: ve.powerKw, power_hp: ve.powerHp, engine_label: ve.engineLabel, transmission: ve.transmissionType || "",
          catalog_price: ve.catalogPrice, bpm: ve.bpm, market_avg: mk?.avg, market_median: mk?.median,
          market_count: mk?.count, p25: mk?.p25, p50: mk?.median, p75: mk?.p75,
          verkoopadviees: res.verkoopadviees, handelswaarde: res.handelswaarde,
          inkoop_low: res.inkoopLow, inkoop_high: res.inkoopHigh, internet_prijs: res.internetPrijs,
          apk_until: ve.apkUntil, vin: ve.vin, status: "concept" })
      }).catch(() => {})
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Fout") }
    finally { setLoading(false) }
  }

  async function scanDeals() {
    setDealsL(true)
    try {
      const res = await fetch("/api/deals")
      const d = await res.json()
      if (d.deals) setDeals(d.deals)
    } catch { /* ok */ }
    finally { setDealsL(false) }
  }

  async function runBulk() {
    const plates = splitPlates(bulkIn)
    if (!plates.length) return
    setBulkL(true); setBulkRes([])
    const res: any[] = []
    for (const p of plates) {
      try {
        const ve = await fetchVehicleEnriched(p)
        let mk: MarketData | null = null
        try { mk = await fetchMarket(ve.make, ve.model, ve.year, 100000, ve.subModel, ve.body || "", ve.fuel || "") } catch { /* ok */ }
        const pr = calculateDealerPrice({
          make: ve.make, model: ve.model, trim: ve.trim, year: ve.year, km: 100000,
          fuel: ve.fuel, weightKg: ve.weightKg, catalogPrice: ve.catalogPrice,
          bpm: ve.bpm, power: ve.powerKw, marketAvg: mk?.avg, marketMedian: mk?.median,
          marketCount: mk?.count, marketPrices: mk?.prices, marketP10: mk?.p10,
          marketP25: mk?.p25, marketP75: mk?.p75, marketP90: mk?.p90,
          marketQuality: mk?.validation?.quality, finnikAvailable: ve.source?.finnik === true,
          importFlag: ve.importFlag, stolenFlag: ve.stolenFlag,
          transmissionAuto: ve.transmissionAuto, equipmentLevel: ve.equipmentLevel,
          engineLabel: ve.engineLabel, subModel: ve.subModel
        })
        res.push({ plate: formatPlate(p), make: ve.make, model: ve.model, year: ve.year, inkoop: `${pr.inkoopLow}-${pr.inkoopHigh}`, verkoop: pr.verkoopadviees, listings: mk?.count || 0, ok: true })
      } catch {
        res.push({ plate: formatPlate(p), ok: false, error: "Niet gevonden" })
      }
      setBulkRes([...res])
    }
    setBulkL(false)
  }

  async function exportPdf() {
    try {
      const body = { vehicle: { ...v, plate: formatPlate(plate) }, result: { ...r, inkoopLow: adjLow, inkoopHigh: adjHigh }, market: m || {}, km: kmN }
      const res = await fetch("/api/pdf", { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
      if (!res.ok) throw new Error("fail")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a"); a.href = url; a.download = `CarDatax_${formatPlate(plate)}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch { alert("PDF mislukt") }
  }

  function addToPortfolio() {
    addToDbPortfolio()
  }

  function openVoorraad() {
    if (!v || !r) return
    setVrPrijs(String(r.verkoopadviees || r.internetPrijs || ""))
    setVrBeschr("")
    setVrHighlights("")
    setVrId(null)
    setVrPhotos([])
    setShowVoorraad(true)
  }

  async function addToVoorraad() {
    if (!v || !r) return
    setVrSaving(true)
    try {
      const body = {
        kenteken: formatPlate(plate), make: v.make, model: v.model,
        model_variant: v.modelVariant || v.subModel || "",
        year: v.year, fuel: v.fuel, km: kmN || v.km || 0,
        color: v.color, body: v.body,
        power_kw: v.powerKw, power_hp: v.powerHp,
        engine_label: v.engineLabel, transmission: v.transmissionType || "",
        doors: v.doors, seats: v.seats,
        vraag_prijs: Number(vrPrijs) || r.verkoopadviees || 0,
        beschrijving: vrBeschr,
        highlights: vrHighlights,
        apk_until: v.apkUntil || "", vin: v.vin || "",
        status: "te_koop", featured: false
      }
      const res = await fetch("/api/voorraad/add", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.ok) {
        setVrId(data.id)
      } else {
        alert("Fout: " + (data.error || "Onbekend"))
      }
    } catch (e) { alert("Fout bij opslaan") }
    setVrSaving(false)
  }

  async function uploadPhotos(files: FileList) {
    if (!vrId || files.length === 0) return
    setVrUploading(true)
    const newPhotos = [...vrPhotos]
    for (let i = 0; i < files.length; i++) {
      try {
        const endpoint = vrEnhance
          ? `/api/voorraad/${vrId}/photos/enhanced`
          : `/api/voorraad/${vrId}/photos`
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": files[i].type || "image/jpeg", "Authorization": `Bearer ${getToken()}` },
          body: files[i]
        })
        const data = await res.json()
        if (data.ok) newPhotos.push(data.filename)
      } catch {}
    }
    setVrPhotos(newPhotos)
    setVrUploading(false)
  }

  async function saveTaxatieToDb() {
    if (!v || !r) return
    try {
      await fetch("/api/taxatie/save", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          kenteken: formatPlate(plate), make: v.make, model: v.model,
          model_variant: v.modelVariant || "", year: v.year, fuel: v.fuel,
          km: kmN || v.km || 0, color: v.color, body: v.body,
          power_kw: v.powerKw, power_hp: v.powerHp, engine_label: v.engineLabel,
          transmission: v.transmissionType || "",
          catalog_price: v.catalogPrice, bpm: v.bpm, bpm_rest: v.bpmRest,
          market_avg: m?.avg, market_median: m?.median, market_count: m?.count,
          p25: m?.p25, p50: m?.median, p75: m?.p75,
          verkoopadviees: r.verkoopadviees, handelswaarde: r.handelswaarde,
          inkoop_low: r.inkoopLow, inkoop_high: r.inkoopHigh,
          internet_prijs: r.internetPrijs, reconditie_kosten: reconTot,
          import_flag: v.importFlag, export_flag: v.exportFlag,
          apk_until: v.apkUntil, vin: v.vin, status: "concept"
        })
      })
    } catch {}
  }

  const NAV: [Page, string][] = (() => {
    const r = userRole
    if (r === "klant") return [
      ["dashboard", "Dashboard"] as [Page, string],
      ["voorraad", "Voorraad"] as [Page, string],
      ["biedingen", "Mijn Biedingen"] as [Page, string],
      ["instellingen", "Instellingen"] as [Page, string],
    ]
    if (r === "inkoper") return [
      ["dashboard", "Dashboard"] as [Page, string],
      ["taxatie", "Taxatie"] as [Page, string],
      ["bulk", "Bulk Taxatie"] as [Page, string],
      ["portfolio", "Portfolio"] as [Page, string],
      ["instellingen", "Instellingen"] as [Page, string],
    ]
    // admin = alles
    return [
      ["dashboard", "Dashboard"] as [Page, string],
      ["taxatie", "Taxatie"] as [Page, string],
      ["voorraad", "Voorraad"] as [Page, string],
      ["deals", "Deals"] as [Page, string],
      ["bulk", "Bulk Taxatie"] as [Page, string],
      ["portfolio", "Portfolio"] as [Page, string],
      ["biedingen", "Biedingen"] as [Page, string],
      ["inspecties", "Inspecties"] as [Page, string],
      ["inbox", "Inbox"] as [Page, string],
      ["instellingen", "Instellingen"] as [Page, string],
      ["admin", "Admin"] as [Page, string],
    ]
  })()

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 6) return "Goedenacht"
    if (h < 12) return "Goedemorgen"
    if (h < 18) return "Goedemiddag"
    return "Goedenavond"
  })()

  const navIcons: Record<string, string> = {
    dashboard: "\u25A0", taxatie: "\u2605", voorraad: "\u2699", deals: "\u2197",
    bulk: "\u2630", portfolio: "\u2696", biedingen: "\u20AC", inspecties: "\u2611",
    inbox: "\u2709", instellingen: "\u2638", admin: "\u2694"
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sb-brand" onClick={() => setPage("dashboard")}>
          <h1><span className="brand-t">T</span><span className="brand-4">4</span><span className="brand-c">C</span>
            {userRole && <span className={"sb-badge" + (userRole === "klant" ? " klant" : userRole === "inkoper" ? " inkoper" : "")}>{userRole}</span>}
          </h1>
          <div className="sb-sub">Transfer4Cars</div>
        </div>
        <nav className="sb-nav">
          {NAV.map(([id, label]) => (
            <button key={id} className={"sb-item" + (page === id ? " active" : "")} onClick={() => setPage(id)}>
              <span className="sb-icon">{navIcons[id] || "\u25CF"}</span>
              <span className="sb-label">{label}</span>
            </button>
          ))}
        </nav>
        <div style={{padding:"0 8px",marginTop:"auto"}}>
          <a href="/download" target="_blank" className="sb-item"
            style={{background:"linear-gradient(135deg, rgba(94,189,62,0.1), rgba(94,189,62,0.05))", border:"1px dashed rgba(94,189,62,0.3)", borderRadius:8, marginBottom:8, textDecoration:"none", display:"flex", alignItems:"center", gap:8}}>
            <span className="sb-icon">{"\uD83D\uDCF2"}</span>
            <span className="sb-label" style={{color:"var(--green)"}}>Installeer App</span>
          </a>
        </div>
        <div className="sb-footer">
          <div className="sb-user">
            <div className="sb-avatar">{(userName || "U")[0].toUpperCase()}</div>
            <div className="sb-info">
              <div className="sb-name">{userName || "Gebruiker"}</div>
              <div className="sb-role">{userRole}</div>
            </div>
            <button className="sb-theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={theme === "dark" ? "Light mode" : "Dark mode"}>
              {theme === "dark" ? "\u2600" : "\u263D"}
            </button>
            <button className="sb-logout" onClick={logout}>Uit</button>
          </div>
        </div>
      </aside>
      <button className="mobile-toggle" onClick={() => document.querySelector('.sidebar')?.classList.toggle('open')}>{"\u2630"}</button>

      <main className="main-content" ref={pageRef}>

        {/* DASHBOARD */}
        {page === "dashboard" && (
          <>
            <div className="pg-head"><h1>{greeting}, {userName || "Gebruiker"}</h1><p>Welkom bij Transfer4Cars</p></div>

            {/* Quick Taxatie */}
            <div style={{background:"var(--surface)",border:"1px solid var(--accent-border)",borderRadius:16,padding:"20px 24px",marginBottom:20,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:14,fontWeight:600,color:"var(--text)",marginBottom:4}}>Snel taxeren</div>
                <div style={{fontSize:12,color:"var(--text3)"}}>Voer kenteken in en krijg direct een taxatie</div>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div className="plate-bar" style={{marginBottom:0}}>
                  <div className="plate-nl">NL</div>
                  <input className="plate-inp" style={{fontSize:18,padding:"8px 10px",width:140}}
                    placeholder="XX-999-X"
                    onKeyDown={e => { if (e.key === "Enter") { setPlate((e.target as HTMLInputElement).value.replace(/[^A-Za-z0-9]/g,"").toUpperCase()); setPage("taxatie"); setTimeout(taxeer, 100) } }}
                    onChange={e => setPlate(e.target.value.replace(/[^A-Za-z0-9]/g,"").toUpperCase().slice(0,6))}
                    value={fmt}
                  />
                </div>
                <button className="btn-tax" style={{width:"auto",padding:"10px 20px",fontSize:13}} onClick={() => { setPage("taxatie"); setTimeout(taxeer, 100) }}>Taxeer</button>
              </div>
            </div>

            <div className="dash-stats">
              <div className="stat-card"><div className="stat-n">{dbTaxaties.length}</div><div className="stat-l">Taxaties</div></div>
              <div className="stat-card"><div className="stat-n">{dbPortfolio.length}</div><div className="stat-l">Portfolio</div></div>

              <div className="stat-card"><div className="stat-n">{deals.length}</div><div className="stat-l">Deals</div></div>
            </div>
            <div className="dash-grid">
              <div className="dash-card">
                <h3>Recente Taxaties</h3>
                {dbTaxaties.length > 0 ? dbTaxaties.slice(0, 10).map((h: any, i: number) => (
                  <div key={i} className="dhr" onClick={() => { setPlate((h.kenteken||"").replace(/-/g, "")); setPage("taxatie") }}>
                    <span className="dhr-p">{h.kenteken}</span>
                    <span className="dhr-c">{h.make} {h.model} {"\u00B7"} {h.year}</span>
                    {h.handelswaarde ? <span className="dhr-v">{E(h.handelswaarde)}</span> : null}
                  </div>
                )) : history.length > 0 ? history.slice(0, 10).map((h, i) => (
                  <div key={i} className="dhr" onClick={() => { setPlate(h.plate.replace(/-/g, "")); setPage("taxatie") }}>
                    <span className="dhr-p">{h.plate}</span>
                    <span className="dhr-c">{h.make} {h.model} {"\u00B7"} {h.year}</span>
                    {h.price ? <span className="dhr-v">{E(h.price)}</span> : null}
                  </div>
                )) : <p className="dim">Nog geen taxaties</p>}
              </div>
              <div className="dash-card">
                <h3>Snelle acties</h3>
                <div className="dash-actions">
                  {userRole === "klant" ? <>
                    <button className="action-btn" onClick={() => setPage("voorraad")}>Voorraad bekijken</button>
                    <button className="action-btn" onClick={() => setPage("biedingen")}>Mijn biedingen</button>
                  </> : userRole === "inkoper" ? <>
                    <button className="action-btn" onClick={() => setPage("taxatie")}>Nieuwe taxatie</button>
                    <button className="action-btn" onClick={() => setPage("bulk")}>Bulk taxatie</button>
                    <button className="action-btn" onClick={() => setPage("portfolio")}>Portfolio</button>
                  </> : <>
                    <button className="action-btn" onClick={() => setPage("taxatie")}>Nieuwe taxatie</button>
                    <button className="action-btn" onClick={() => setPage("voorraad")}>Voorraad beheren</button>
                    <button className="action-btn" onClick={() => setPage("deals")}>Deals bekijken</button>
                    <button className="action-btn" onClick={() => window.open("/admin/","_blank")}>Admin portaal</button>
                  </>}
                </div>
              </div>
            </div>
          </>
        )}

        {/* TAXATIE */}
        {page === "taxatie" && (
          <>
            <div className="pg-head"><h1>Taxatie</h1><p>Voer kenteken en kilometerstand in voor een volledige analyse</p></div>
            <div className="tax-bar">
              <div className="plate-bar">
                <div className="plate-nl">NL</div>
                <input className="plate-inp" value={fmt}
                  onChange={e => setPlate(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6))}
                  onKeyDown={e => { if (e.key === "Enter") document.getElementById("t4c-km")?.focus() }}
                  placeholder="AA-123-B" maxLength={9} />
              </div>
              <div className="km-field">
                <input id="t4c-km" className="km-inp" value={km}
                  onChange={e => setKm(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") taxeer() }}
                  placeholder="Kilometerstand" />
                <span className="km-u">km</span>
              </div>
              <button className="btn-tax" onClick={taxeer} disabled={loading}>{loading ? "Bezig..." : "Taxeer"}</button>
            </div>
            {error && <div className="err">{error}</div>}
            {loading && <div className="load-bar" />}

            {r && v ? (
              <>
                {/* VEHICLE HEADER */}
                <div className="veh-head">
                  <div className="vh-img">
                    {v.imageUrl ? <img src={v.imageUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} /> : <div className="vh-placeholder" />}
                  </div>
                  <div className="vh-info">
                    <div className="vh-name">{v.make} {v.model}</div>
                    <div className="vh-variant">{[v.engineLabel, v.modelVariant || v.subModel !== v.model ? v.subModel : ""].filter(Boolean).join(" · ") || ""}</div>
                    <div className="vh-badges">
                      <span className="sb">{v.year}</span>
                      <span className="sb">{N(kmN)} km</span>
                      <span className="sb">{v.isHybrid ? "Hybride" : v.isPureEV ? "EV" : v.fuel || ""}</span>
                      {v.powerHp && <span className="sb">{v.powerHp} pk</span>}
                      {v.body && <span className="sb">{v.body}</span>}
                      {v.importFlag && <span className="sb warn">Import</span>}
                      {v.stolenFlag && <span className="sb danger">Gestolen</span>}
                    </div>
                  </div>
                </div>

                {/* ═══ PRICE CARD — Mobile style with score bars ═══ */}
                <div id="sec-prijzen">
                {true && (
                  <>
                <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,padding:"20px 24px",marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>Voorgesteld Bod</div>
                      <div style={{fontSize:32,fontWeight:800,color:"var(--accent)",fontFamily:"'IBM Plex Mono',monospace",letterSpacing:"-1px"}}>{E(r.t4cBod || Math.round((adjLow + adjHigh) / 2))}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:4}}>Verkoopprijs</div>
                      <div style={{fontSize:22,fontWeight:700,color:"var(--text)",fontFamily:"'IBM Plex Mono',monospace"}}>{E(r.verkoopadviees || r.internetPrijs)}</div>
                    </div>
                  </div>
                  {/* Price range bar */}
                  <div style={{height:6,borderRadius:3,background:"linear-gradient(90deg, var(--red), var(--yellow), var(--accent))",marginBottom:10,position:"relative"}}>
                    <div style={{position:"absolute",top:-3,left:Math.min(95,Math.max(5,(r.t4cBod||adjLow)/(r.verkoopadviees||r.internetPrijs||1)*100))+"%",width:12,height:12,borderRadius:"50%",background:"#fff",border:"2px solid var(--accent)",transform:"translateX(-50%)"}} />
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginBottom:12}}>
                    <span>{E(adjLow)}</span><span>{E(adjHigh)}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",marginBottom:2}}>Marge</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:(r.verkoopadviees||0)-(r.t4cBod||adjLow)>2000?"var(--accent)":(r.verkoopadviees||0)-(r.t4cBod||adjLow)>0?"var(--yellow)":"var(--red)"}}>{E((r.verkoopadviees||r.internetPrijs||0)-(r.t4cBod||Math.round((adjLow+adjHigh)/2)))}</div>
                    </div>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",marginBottom:2}}>Handelswaarde</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--text)"}}>{E(r.handelswaarde)}</div>
                    </div>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",marginBottom:2}}>Marge %</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--accent)"}}>{adjM}%</div>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"var(--text3)",textAlign:"center",marginTop:10}}>(Gebaseerd op NL handelsdata, uitvoering, km-stand, opties en huidige marktprijzen)</div>
                </div>

                {/* ═══ SCORE BARS — Identical to mobile ═══ */}
                <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,padding:"18px 20px",marginBottom:16}}>
                  {[
                    {label:"Courantheid",score:r.etr || r.etrScore || 5,color:r.etrScore>=7?"var(--accent)":r.etrScore>=5?"var(--yellow)":"var(--red)"},
                    {label:"Vergelijk",score:r.itr || Math.round(r.confidence/10*10)/10 || 5,color:(r.itr||r.confidence/10)>=7?"var(--accent)":(r.itr||r.confidence/10)>=5?"var(--yellow)":"var(--red)"},
                    {label:"Techniek",score:r.atrScore || 5,color:r.atrScore>=7?"var(--accent)":r.atrScore>=5?"var(--yellow)":"var(--red)"}
                  ].map(s=>(
                    <div key={s.label} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border)"}}>
                      <div style={{fontSize:13,fontWeight:600,color:"var(--text)",width:100}}>{s.label}</div>
                      <div style={{flex:1,height:8,borderRadius:4,background:"var(--surface2)",overflow:"hidden"}}>
                        <div style={{height:"100%",borderRadius:4,width:(s.score/10*100)+"%",background:s.color,transition:"width .5s ease"}} />
                      </div>
                      <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:s.color,width:50,textAlign:"right"}}>{typeof s.score==="number"?s.score.toFixed(1):s.score}</div>
                    </div>
                  ))}
                  {/* Marge Score */}
                  {(() => {
                    const etr=r.etr||r.etrScore||5,atr=r.atrScore||5,risk=r.riskScore||50
                    const kostenDruk=Math.max(1,Math.min(10,Math.round(risk/12)))
                    const ms=Math.round(Math.max(1,Math.min(10,etr*0.4+atr*0.2-(risk/100*10)*0.2-kostenDruk*0.2+3))*10)/10
                    const msColor=ms>=7?"var(--accent)":ms>=5?"var(--yellow)":"var(--red)"
                    const msLabel=ms<=3?"Niet doen":ms<=5?"Alleen scherp":ms<=6?"Acceptabel":ms<=7?"Goed":ms<=8?"Sterk":ms<=9?"Top deal":"No-brainer"
                    return (
                      <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0"}}>
                        <div style={{fontSize:13,fontWeight:800,color:"var(--text)",width:100}}>Marge Score</div>
                        <div style={{flex:1,height:8,borderRadius:4,background:"var(--surface2)",overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:4,width:(ms/10*100)+"%",background:msColor,transition:"width .5s ease"}} />
                        </div>
                        <div style={{display:"flex",alignItems:"baseline",gap:6}}>
                          <div style={{fontSize:18,fontWeight:800,fontFamily:"'IBM Plex Mono',monospace",color:msColor}}>{ms}</div>
                          <div style={{fontSize:10,color:"var(--text3)"}}>{msLabel}</div>
                        </div>
                      </div>
                    )
                  })()}
                  {/* Barometer */}
                  <div style={{marginTop:8}}>
                    <div style={{height:10,borderRadius:5,background:"linear-gradient(90deg, var(--red) 0%, var(--yellow) 40%, var(--accent) 100%)",position:"relative"}}>
                      {(() => {
                        const etr=r.etr||r.etrScore||5,atr=r.atrScore||5,risk=r.riskScore||50
                        const pct=Math.max(5,Math.min(95,((etr+atr)/20*100+50-risk)/2))
                        return <div style={{position:"absolute",top:-2,left:pct+"%",width:14,height:14,borderRadius:"50%",background:"#fff",border:"2px solid var(--text)",transform:"translateX(-50%)"}} />
                      })()}
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)",marginTop:4}}>
                      <span>NIET KOPEN</span><span>NEUTRAAL</span><span>KOPEN</span>
                    </div>
                    <div style={{textAlign:"center",fontSize:11,color:"var(--text3)",marginTop:4}}>Vergelijkbare modellen {E(m?.low || adjLow)} – {E(m?.high || adjHigh)}</div>
                  </div>
                </div>

                {/* ═══ HANDMATIGE AANPASSING — Sliders like mobile ═══ */}
                <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:14,padding:"18px 20px",marginBottom:16}}>
                  <div style={{fontSize:11,color:"var(--text3)",textTransform:"uppercase",letterSpacing:"1px",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
                    <span>🔧</span> Handmatige Aanpassing
                  </div>
                  {/* Marge slider */}
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>Gewenste marge</span>
                      <span style={{fontSize:14,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--accent)"}}>{adjM}%</span>
                    </div>
                    <input type="range" min="5" max="80" step="1" value={adjM} onChange={e => setMargeAdj(Number(e.target.value))} className="slider" />
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text3)"}}>
                      <span>5%</span>
                      <span className="link" onClick={() => setMargeAdj(null)}>Reset ({r.marginPercent}%)</span>
                      <span>80%</span>
                    </div>
                  </div>
                  {/* Profit row */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase"}}>Winst B2B</div>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--accent)",marginTop:2}}>{E(Math.max(r.handelswaarde-adjMid,0))}</div>
                    </div>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px",textAlign:"center",border:"1px solid rgba(94,189,62,.2)"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase"}}>Winst B2C</div>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--accent)",marginTop:2}}>{E(Math.max(r.verkoopadviees-adjMid,0))}</div>
                    </div>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase"}}>Marge</div>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--yellow)",marginTop:2}}>{adjM}%</div>
                    </div>
                    <div style={{background:"var(--surface2)",borderRadius:10,padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase"}}>BPM Rest</div>
                      <div style={{fontSize:15,fontWeight:700,fontFamily:"'IBM Plex Mono',monospace",color:"var(--text)",marginTop:2}}>{E(r.bpmRest)}</div>
                    </div>
                  </div>
                </div>

                {/* Warnings */}
                {r.smartSummary && r.smartSummary.length > 0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                      {r.smartSummary.filter((t: string) => t.includes("⚠") || t.includes("GESTOLEN") || t.includes("Import") || t.includes("Hoge km") || t.includes("NAP")).map((t: string, i: number) => (
                        <span key={i} style={{display:"inline-block",padding:"4px 10px",borderRadius:8,fontSize:11,fontWeight:600,background:t.includes("GESTOLEN")?"rgba(239,68,68,.15)":"rgba(245,158,11,.1)",color:t.includes("GESTOLEN")?"var(--red)":"var(--yellow)",border:"1px solid "+(t.includes("GESTOLEN")?"rgba(239,68,68,.3)":"rgba(245,158,11,.2)")}}>{t.replace(/[>•]/g,"").trim()}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Insight */}
                {r.aiValidation && r.aiValidation.available && (
                  <div style={{background:'var(--surface2)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:14}}>
                    <div style={{fontSize:13,lineHeight:1.5}}>{r.aiValidation.reasoning || ''}</div>
                    {r.aiValidation.marketInsight && <div style={{fontSize:12,color:'var(--text3)',fontStyle:'italic',marginTop:6}}>{r.aiValidation.marketInsight}</div>}
                    {r.aiValidation.riskFlags && r.aiValidation.riskFlags.length > 0 && (
                      <div style={{marginTop:8}}>{r.aiValidation.riskFlags.map((f: string, i: number) => <span key={i} style={{display:'inline-block',padding:'3px 8px',borderRadius:6,fontSize:11,background:'var(--yellow-dim)',color:'var(--yellow)',margin:2}}>{f}</span>)}</div>
                    )}
                  </div>
                )}

                {/* Courant label + Smart Summary */}
                {r.courantLabel && (
                  <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 18px',marginBottom:14}}>
                    <div style={{fontSize:14,fontWeight:700,color:"var(--accent)",marginBottom:6}}>{r.courantLabel}</div>
                    {r.smartSummary && r.smartSummary.filter((t: string) => !t.includes("⚠") && !t.includes("GESTOLEN")).length > 0 && (
                      <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.6}}>
                        {r.smartSummary.filter((t: string) => !t.includes("⚠") && !t.includes("GESTOLEN")).map((t: string, i: number) => (
                          <div key={i} style={{padding:"2px 0"}}>{'>'} {t.replace(/[>•]/g,"").trim()}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                    <section className="sec">
                      <div className="sec-head"><h2>Opties</h2>{selOpts.size > 0 && <span className="sec-sub">+{optPct.toFixed(1)}%</span>}</div>
                      <div className="options-grid">
                        {["Comfort", "Exterieur", "Tech", "Rijhulp"].map(cat => (
                          <div key={cat} className="options-cat">
                            <div className="options-cat-title">{cat}</div>
                            {OPTS.filter(o => o.cat === cat).map(opt => (
                              <label key={opt.id} className={"option-item" + (selOpts.has(opt.id) ? " active" : "")}>
                                <input type="checkbox" checked={selOpts.has(opt.id)} onChange={() => { setSelOpts(p => { const n = new Set(p); if (n.has(opt.id)) n.delete(opt.id); else n.add(opt.id); return n }) }} />
                                <span className="option-check">{selOpts.has(opt.id) ? "\u2713" : ""}</span>
                                <span className="option-label">{opt.label}</span>
                                <span className="option-pct">+{opt.pct}%</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="sec btn-row">
                      <button className="btn-secondary" onClick={exportPdf}>PDF Export</button>
                      <button className="btn-secondary" onClick={addToPortfolio}>Toevoegen aan Portfolio</button>

                    </section>
                  </>
                )}
                </div>

                <div id="sec-markt">
                {true && (
                  <>
                    <section className="sec">
                      <div className="sec-head"><h2>Marktanalyse</h2><span className="sec-sub">{m?.count || 0} vergelijkingen</span></div>
                      {m && m.count > 0 ? (
                        <>
                          <div className="mc-row">
                            <div className="mc"><div className="mc-lbl">Gemiddeld</div><div className="mc-val">{E(m.avg)}</div></div>
                            <div className="mc hl"><div className="mc-lbl">Mediaan</div><div className="mc-val">{E(m.median)}</div></div>
                          </div>
                          <PriceChart prices={m.prices} bidLow={adjLow} bidHigh={adjHigh} median={m.median} />
                          <div className="kv-grid">
                            <KV l="P10" v={E(m.p10 || m.low)} />
                            <KV l="P25" v={E(m.p25)} />
                            <KV l="P75" v={E(m.p75)} />
                            <KV l="P90" v={E(m.p90 || m.high)} />
                          </div>

                        </>
                      ) : <p className="dim">Geen marktdata</p>}
                    </section>
                    {m?.intelligence && (
                      <section className="sec">
                        <div className="sec-head"><h2>Intelligence</h2></div>
                        {m.intelligence.insights?.length > 0 && (
                          <div className="insights-list">
                            {m.intelligence.insights.map((ins: any, i: number) => (
                              <div key={i} className={`insight insight-${ins.type}`}>
                                <span className="insight-text">{ins.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
                </div>

                <div id="sec-voertuig">
                {true && (
                  <>
                    <section className="sec">
                      <div className="sec-head"><h2>Snelle check</h2></div>
                      <div className="quick-grid">
                        <div className="qg-item"><span className="qg-label">APK tot</span><span className="qg-val">{v.apkUntil || "\u2014"}</span></div>
                        <div className="qg-item"><span className="qg-label">Bouwjaar</span><span className="qg-val">{v.year}</span></div>
                        <div className="qg-item"><span className="qg-label">Vermogen</span><span className="qg-val">{v.powerHp ? `${v.powerHp} pk` : "\u2014"}</span></div>
                        <div className="qg-item"><span className="qg-label">Topsnelheid</span><span className="qg-val">{v.topSpeed ? `${v.topSpeed} km/u` : "\u2014"}</span></div>
                        <div className="qg-item"><span className="qg-label">Taxi geweest</span><span className="qg-val">{v.taxiIndicator ? "Ja" : "Nee"}</span></div>
                        <div className="qg-item"><span className="qg-label">Import</span><span className="qg-val">{v.importFlag ? "Ja" : (v.parallelImport ? "Parallel" : "Nee")}</span></div>
                        <div className="qg-item"><span className="qg-label">1e toelating NL</span><span className="qg-val">{v.firstAdmissionNL || v.firstAdmission || "\u2014"}</span></div>
                        <div className="qg-item"><span className="qg-label">Status</span><span className={"qg-val" + (v.plateStatus === "Geldig" ? " g" : "")}>{v.plateStatus || "Onbekend"}</span></div>
                      </div>
                    </section>

                    <section className="sec">
                      <div className="sec-head"><h2>Basisgegevens</h2></div>
                      <div className="cols3">
                        <div className="col">
                          <KV l="Merk" v={v.make} />
                          <KV l="Model" v={v.model} />
                          {v.modelVariant && <KV l="Uitvoering" v={v.modelVariant} />}
                          <KV l="Bouwjaar" v={String(v.year)} />
                          <KV l="Brandstof" v={v.fuel} />
                          {v.fuelSecondary && <KV l="2e brandstof" v={v.fuelSecondary} />}
                        </div>
                        <div className="col">
                          <KV l="Kleur" v={v.color} />
                          {v.colorSecondary && <KV l="2e kleur" v={v.colorSecondary} />}
                          <KV l="Voertuigsoort" v={v.vehicleType} />
                          <KV l="Inrichting" v={v.body} />
                          {v.doors && <KV l="Deuren" v={String(v.doors)} />}
                          {v.seats && <KV l="Zitplaatsen" v={String(v.seats)} />}
                        </div>
                        <div className="col">
                          {v.transmissionType && <KV l="Transmissie" v={v.transmissionType} />}
                          {v.gearCount && <KV l="Versnellingen" v={String(v.gearCount)} />}
                          {v.driveType && <KV l="Aandrijving" v={v.driveType} />}
                          {v.isHybrid && <KV l="Type" v="Hybride" />}
                          {v.isPureEV && <KV l="Type" v="Volledig elektrisch" />}
                          {v.segment && <KV l="Segment" v={v.segment} />}
                          {v.equipmentLevel && <KV l="Uitrustingsniveau" v={v.equipmentLevel} />}
                        </div>
                      </div>
                    </section>

                    <section className="sec">
                      <div className="sec-head"><h2>Technische gegevens</h2></div>
                      <div className="cols3">
                        <div className="col">
                          <div className="col-title">Motor</div>
                          {v.engineLabel && <KV l="Motor" v={v.engineLabel} />}
                          {v.engineCapacity && <KV l="Cilinderinhoud" v={`${N(v.engineCapacity)} cc`} />}
                          {v.cylinders && <KV l="Cilinders" v={String(v.cylinders)} />}
                          {v.engineCode && <KV l="Motorcode" v={v.engineCode} />}
                          {v.powerKw ? <KV l="Vermogen" v={`${v.powerKw} kW (${v.powerHp || Math.round(v.powerKw * 1.36)} pk)`} /> : null}
                          {v.topSpeed && <KV l="Topsnelheid" v={`${v.topSpeed} km/u`} />}
                          {v.electricRange && <KV l="Bereik EV" v={`${v.electricRange} km`} />}
                        </div>
                        <div className="col">
                          <div className="col-title">Gewicht / Afmetingen</div>
                          {v.weightKg && <KV l="Leeggewicht" v={`${N(v.weightKg)} kg`} />}
                          {v.weightReady && <KV l="Rijklaar gewicht" v={`${N(v.weightReady)} kg`} />}
                          {v.maxMass && <KV l="Max. gewicht" v={`${N(v.maxMass)} kg`} />}
                          {v.towCapacityBraked && <KV l="Trekgewicht geremd" v={`${N(v.towCapacityBraked)} kg`} />}
                          {v.towCapacityUnbraked && <KV l="Trekgewicht ongeremd" v={`${N(v.towCapacityUnbraked)} kg`} />}
                          {v.lengthMm && <KV l="Lengte" v={`${N(v.lengthMm)} mm`} />}
                          {v.widthMm && <KV l="Breedte" v={`${N(v.widthMm)} mm`} />}
                          {v.heightMm && <KV l="Hoogte" v={`${N(v.heightMm)} mm`} />}
                          {v.wheelbase && <KV l="Wielbasis" v={`${N(v.wheelbase)} mm`} />}
                        </div>
                        <div className="col">
                          <div className="col-title">Overig</div>
                          {v.numberOfAxles && <KV l="Assen" v={String(v.numberOfAxles)} />}
                          {v.numberOfWheels && <KV l="Wielen" v={String(v.numberOfWheels)} />}
                          {v.typeApproval && <KV l="Typegoedkeuring" v={v.typeApproval} />}
                          {v.vin && <KV l="VIN" v={v.vin} />}
                        </div>
                      </div>
                    </section>

                    <section className="sec">
                      <div className="sec-head"><h2>Financieel / Waarde</h2></div>
                      <div className="cols3">
                        <div className="col">
                          <KV l="Nieuwprijs" v={E(v.catalogPrice)} />
                          <KV l="BPM nieuw" v={E(v.bpm)} />
                          {bpm && <KV l="Rest BPM" v={`${E(bpm.rest)} (${bpm.pct}%)`} />}
                          {v.bpmExempt && <KV l="BPM vrijstelling" v="Ja" />}
                        </div>
                        <div className="col">
                          {v.taxQuarterMin && <KV l="MRB per kwartaal" v={`${E(v.taxQuarterMin)}${v.taxQuarterMax && v.taxQuarterMax !== v.taxQuarterMin ? ` - ${E(v.taxQuarterMax)}` : ""}`} />}
                        </div>
                        <div className="col" />
                      </div>
                    </section>

                    <section className="sec">
                      <div className="sec-head"><h2>Voertuigstatus</h2></div>
                      <div className="cols3">
                        <div className="col">
                          <div className="col-title">Registratie</div>
                          <KV l="1e toelating" v={v.firstAdmission} />
                          {v.firstAdmissionNL && <KV l="1e toelating NL" v={v.firstAdmissionNL} />}
                          {v.registrationDate && <KV l="Tenaamstelling" v={v.registrationDate} />}
                          {v.liabilityDate && <KV l="Aansprakelijkheid" v={v.liabilityDate} />}
                          <KV l="APK tot" v={v.apkUntil} />
                          {v.inspectionCount && <KV l="Keuringen totaal" v={String(v.inspectionCount)} />}
                        </div>
                        <div className="col">
                          <div className="col-title">Status</div>
                          <KV l="Kentekenstatus" v={v.plateStatus || "Onbekend"} />
                          <KV l="WAM verzekerd" v={v.wamInsured ? "Ja" : "Nee"} />
                          <KV l="Gestolen" v={v.stolenFlag ? "JA" : "Nee"} />
                          <KV l="WOK" v={v.wokStatus ? "Ja" : "Nee"} />
                          <KV l="Gesloopt" v={v.sloopIndicator ? "Ja" : "Nee"} />
                          <KV l="Taxi geweest" v={v.taxiIndicator ? "Ja" : "Nee"} />
                        </div>
                        <div className="col">
                          <div className="col-title">Import / Export</div>
                          <KV l="Geimporteerd" v={v.importFlag ? "Ja" : "Nee"} />
                          <KV l="Parallel import" v={v.parallelImport ? "Ja" : "Nee"} />
                          <KV l="Geexporteerd" v={v.exportFlag ? "Ja" : "Nee"} />
                        </div>
                      </div>
                    </section>

                    <section className="sec">
                      <div className="sec-head"><h2>Milieu / Verbruik</h2></div>
                      <div className="cols3">
                        <div className="col">
                          <div className="col-title">Emissie</div>
                          {v.co2 && <KV l="CO2 uitstoot" v={`${v.co2} g/km`} />}
                          {v.co2Wltp && <KV l="CO2 (WLTP)" v={`${v.co2Wltp} g/km`} />}
                          {v.euroClass && <KV l="Euroklasse" v={v.euroClass} />}
                          {v.emissionClass && v.emissionClass !== v.euroClass && <KV l="Emissieklasse" v={v.emissionClass} />}
                          {v.energyLabel && <KV l="Energielabel" v={v.energyLabel} />}
                        </div>
                        <div className="col">
                          <div className="col-title">Verbruik</div>
                          {v.fuelConsumptionCombined && <KV l="Gecombineerd" v={`1 op ${(100/v.fuelConsumptionCombined).toFixed(1)} (${v.fuelConsumptionCombined} l/100km)`} />}
                          {v.fuelConsumptionCity && <KV l="Stad" v={`1 op ${(100/v.fuelConsumptionCity).toFixed(1)} (${v.fuelConsumptionCity} l/100km)`} />}
                          {v.fuelConsumptionHighway && <KV l="Buitenweg" v={`1 op ${(100/v.fuelConsumptionHighway).toFixed(1)} (${v.fuelConsumptionHighway} l/100km)`} />}
                          {v.electricConsumption && <KV l="Verbruik EV" v={`${v.electricConsumption} Wh/km`} />}
                        </div>
                        <div className="col">
                          <div className="col-title">Geluid</div>
                          {v.noiseStationaryDb && <KV l="Stationair" v={`${v.noiseStationaryDb} dB(A)`} />}
                          {v.noiseMovingDb && <KV l="Rijdend" v={`${v.noiseMovingDb} dB(A)`} />}
                          {v.noiseRpm && <KV l="Toerental" v={`${N(v.noiseRpm)} rpm`} />}
                        </div>
                      </div>
                    </section>

                    {v.installedObjects && v.installedObjects.length > 0 && (
                      <section className="sec">
                        <div className="sec-head"><h2>Geregistreerde objecten</h2></div>
                        <div className="obj-list">
                          {v.installedObjects.map((obj, i) => (
                            <span key={i} className="obj-tag">{obj}</span>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="sec">
                      <div className="sec-head"><h2>Kilometerhistorie</h2><span className="sec-sub">{v.kmHistory.length} registraties</span></div>
                      {v.kmAnalysis && (
                        <div className="km-analysis">
                          {v.kmAnalysis.avgPerYear && <div className="kma-item"><span className="kma-label">Gem. per jaar</span><span className="kma-val">{N(v.kmAnalysis.avgPerYear)} km/jaar</span></div>}
                          {v.kmAnalysis.estimatedCurrent && <div className="kma-item"><span className="kma-label">Geschatte huidige stand</span><span className="kma-val">{N(v.kmAnalysis.estimatedCurrent)} km</span></div>}
                          {v.kmAnalysis.anomaly && <div className="kma-warn">{v.kmAnalysis.anomaly}</div>}
                        </div>
                      )}
                      {v.kmHistory.length > 1 && <KmLine data={v.kmHistory} currentKm={kmN} />}
                      {v.kmHistory.length > 0 ? (
                        <div className="km-table">
                          <div className="km-head"><span>Datum</span><span>KM</span><span>Verschil</span></div>
                          {v.kmHistory.map((k, i) => {
                            const prev = i > 0 ? v.kmHistory[i - 1].km : 0
                            const diff = prev ? k.km - prev : 0
                            return (
                              <div key={i} className="km-row">
                                <span>{k.date}</span>
                                <span className="mono">{N(k.km)}</span>
                                <span className={"mono" + (diff < 0 ? " red" : "")}>{prev ? (diff >= 0 ? "+" : "") + N(diff) : "\u2014"}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : <p className="dim">Geen km-historie</p>}
                    </section>

                    {v.apkHistory.length > 0 && (
                      <section className="sec">
                        <div className="sec-head"><h2>APK Keuringen</h2><span className="sec-sub">{v.apkHistory.length} keuringen</span></div>
                        {v.apkHistory.map((a, i) => {
                          const pass = a.result.toLowerCase().includes("goed") || a.result.toLowerCase().includes("steekproef")
                          const relatedDefects = v.defects?.filter(d => d.date === a.date) || []
                          return (
                            <div key={i} className={"apk-entry" + (pass ? "" : " fail")}>
                              <div className="apk-row">
                                <span className="apk-date">{a.date}</span>
                                <span className={"apk-badge " + (pass ? "pass" : "fail")}>{a.result}{relatedDefects.length > 0 ? ` (${relatedDefects.length} bevindingen)` : ""}</span>
                                {a.km ? <span className="mono-sm">{N(a.km)} km</span> : null}
                              </div>
                              {relatedDefects.length > 0 && (
                                <div className="apk-defects">
                                  {relatedDefects.map((d, j) => (
                                    <div key={j} className="apk-defect">
                                      <span className="defect-code">{d.code}</span>
                                      <span className="defect-desc">{d.description}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </section>
                    )}

                    {v.recalls && v.recalls.length > 0 && (
                      <section className="sec">
                        <div className="sec-head"><h2>Terugroepacties</h2></div>
                        {v.recalls.map((rc, i) => (
                          <div key={i} className="recall-row">
                            <span className="recall-desc">{rc.description}</span>
                            <span className={"recall-status " + (rc.status.toLowerCase().includes("hersteld") ? "fixed" : "open")}>{rc.status}</span>
                          </div>
                        ))}
                      </section>
                    )}

                    {issues?.issues?.length && issues.issues.length > 0 && (
                      <section className="sec">
                        <div className="sec-head"><h2>Aandachtspunten</h2></div>
                        <div className="issues-list">
                          {issues.issues.map((iss, i) => (
                            <div key={i} className="issue-card">
                              <div className="issue-cat">{iss.category}</div>
                              <div className="issue-txt">{iss.text}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
                </div>

                <div id="sec-reconditie">
                {true && (
                  <>
                    <section className="sec">
                      <div className="recon-summary">
                        <div className="recon-total">
                          <span className="recon-total-label">Totale reconditiekosten</span>
                          <span className="recon-total-val">{E(reconTot)}</span>
                        </div>
                        <div className="recon-netto">
                          <span>Netto marge</span>
                          <span className={(r.verkoopadviees - adjMid - reconTot) >= 0 ? "g" : "red"}>{E(r.verkoopadviees - adjMid - reconTot)}</span>
                        </div>
                      </div>
                      <div className="recon-grid">
                        {["Technisch", "Optisch", "Verkoop"].map(cat => (
                          <div key={cat} className="recon-cat">
                            <div className="recon-cat-title">{cat}</div>
                            {RECON.filter(it => it.cat === cat).map(item => (
                              <label key={item.id} className={"recon-item" + (reconS[item.id] ? " active" : "")}>
                                <input type="checkbox" checked={!!reconS[item.id]} onChange={() => setReconS(p => ({ ...p, [item.id]: !p[item.id] }))} />
                                <span className="recon-check">{reconS[item.id] ? "\u2713" : ""}</span>
                                <span className="recon-label">{item.label}</span>
                                <span className="recon-cost">{E(item.cost)}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="recon-custom">
                        <span>Overige kosten</span>
                        <div className="recon-custom-field">
                          <span className="recon-eur">{"\u20AC"}</span>
                          <input type="number" value={reconC} onChange={e => setReconC(e.target.value)} placeholder="0" className="recon-input" />
                        </div>
                      </div>
                    </section>
                    {reconTot > 0 && (
                      <section className="sec">
                        <div className="sec-head"><h2>Winstberekening na reconditie</h2></div>
                        <div className="ptable">
                          <div className="prow"><span>Verkoop</span><span>{E(r.verkoopadviees)}</span></div>
                          <div className="prow"><span>Inkoop</span><span>{"\u2212"} {E(adjMid)}</span></div>
                          <div className="prow"><span>Bruto</span><span>{E(Math.max(r.verkoopadviees - adjMid, 0))}</span></div>
                          <div className="prow" style={{ color: "var(--red)" }}><span>Reconditie</span><span>{"\u2212"} {E(reconTot)}</span></div>
                          <div className="prow hl">
                            <span>Netto</span>
                            <span className={(r.verkoopadviees - adjMid - reconTot) >= 0 ? "g" : "red"}>{E(r.verkoopadviees - adjMid - reconTot)}</span>
                          </div>
                        </div>
                      </section>
                    )}
                  </>
                )}
                </div>


                <div id="sec-inspectie">
                {true && (
                  <section className="sec">
                    <div className="sec-head"><h2>Inspectie</h2><span className="sec-sub">{formatPlate(plate)}</span></div>
                    <div className="insp-scores">
                      {["Exterieur","Interieur","Technisch"].map(cat => (
                        <div key={cat} className="insp-score-card">
                          <span className="insp-cat">{cat}</span>
                          <div className="insp-stars">
                            {[1,2,3,4,5].map(n => (
                              <span key={n} className="insp-star" onClick={e => { const p = (e.target as HTMLElement).parentElement; if(p) p.setAttribute("data-score",String(n)) }}>{"★"}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:16}}>
                      <h3 style={{fontSize:14,marginBottom:8}}>Gebreken toevoegen</h3>
                      <div className="tc-row">
                        <select id="insp-cat" className="tc-input"><option value="exterieur">Exterieur</option><option value="interieur">Interieur</option><option value="motor">Motor</option><option value="banden">Banden/Remmen</option><option value="electronica">Electronica</option></select>
                        <input id="insp-omschr" className="tc-input" placeholder="bijv. kras achterbumper" />
                        <select id="insp-ernst" className="tc-input"><option value="licht">Licht</option><option value="gemiddeld">Gemiddeld</option><option value="ernstig">Ernstig</option></select>
                        <input id="insp-kosten" type="number" className="tc-input" placeholder="€ kosten" />
                      </div>
                      <button className="btn-secondary" style={{marginTop:8}} onClick={() => {
                        const o = (document.getElementById("insp-omschr") as HTMLInputElement)?.value; if (!o) return
                        const el = document.getElementById("insp-list"); if (!el) return
                        const k = Number((document.getElementById("insp-kosten") as HTMLInputElement)?.value) || 0
                        el.innerHTML += `<div class="insp-item"><span class="badge ${(document.getElementById("insp-ernst") as HTMLSelectElement)?.value}">${(document.getElementById("insp-ernst") as HTMLSelectElement)?.value}</span><span>${(document.getElementById("insp-cat") as HTMLSelectElement)?.value}: ${o}</span><span>€${k}</span></div>`;
                        (document.getElementById("insp-omschr") as HTMLInputElement).value = ""
                      }}>+ Gebrek</button>
                      <div id="insp-list" style={{marginTop:12}}></div>
                    </div>
                    <button className="btn-primary" style={{marginTop:16,width:"100%"}} onClick={async () => {
                      const res = await fetch("/api/inspectie", { method:"POST", headers:authHeaders(), body: JSON.stringify({ kenteken: formatPlate(plate), inspecteur: userName, exterieur_score: 3, interieur_score: 3, technisch_score: 3, status: "afgerond" }) })
                      const d = await res.json(); if (d.ok) alert(`Inspectie opgeslagen! Score: ${d.totaal_score}/5`)
                    }}>Inspectie opslaan</button>
                  </section>
                )}
                </div>


              </>
            ) : !loading && page === "taxatie" && (
              <div className="empty-pg">
                <p>Voer kenteken en km-stand in</p>
                {history.length > 0 && (
                  <div className="tax-hist">
                    <h3>Recent</h3>
                    {history.slice(0, 6).map((h, i) => (
                      <div key={i} className="dhr" onClick={() => setPlate(h.plate.replace(/-/g, ""))}>
                        <span className="dhr-p">{h.plate}</span>
                        <span className="dhr-c">{h.make} {h.model}</span>
                        {h.price ? <span className="dhr-v">{E(h.price)}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* DEALS */}
        {page === "deals" && (
          <>
            <div className="pg-head">
              <h1>{"Potenti\u00EBle Deals"}</h1>
              <p>{"Auto's onder marktwaarde \u2014 Marktplaats, AutoScout24, AutoTrack, Gaspedaal"}</p>
            </div>
            <button className="btn-tax" onClick={scanDeals} disabled={dealsL} style={{ marginBottom: 16 }}>
              {dealsL ? "Scannen..." : "Scan alle platforms"}
            </button>
            {dealsL && <div className="load-bar" />}
            {deals.length > 0 ? (
              <div className="deals-list">
                {deals.map((d, i) => (
                  <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="deal-card">
                    <div className="deal-margin-badge">{"\u2212"}{d.marginPct}%</div>
                    <div className="deal-info">
                      <div className="deal-title">{d.title || `${d.mk} ${d.ml} ${d.yr}`}</div>
                      <div className="deal-meta">
                        <span>{d.yr}</span>
                        {d.km && <span>{N(d.km)} km</span>}
                        <span className="deal-source">{d.mk} {d.ml}</span>
                      </div>
                    </div>
                    <div className="deal-prices">
                      <div className="deal-ask">{E(d.price)}</div>
                      <div className="deal-market">Markt: {E(d.marketMedian)}</div>
                      <div className="deal-profit">+{E(d.potentialMargin)}</div>
                    </div>
                  </a>
                ))}
              </div>
            ) : <p className="dim">Klik op Scan om deals te zoeken</p>}
          </>
        )}

        {/* BULK */}
        {page === "bulk" && (
          <>
            <div className="pg-head"><h1>Bulk Taxatie</h1><p>Plak kentekens (1 per regel)</p></div>
            <textarea className="bulk-input" rows={6} value={bulkIn} onChange={e => setBulkIn(e.target.value)} placeholder="AB123C  DE456F  GH789I" />
            <button className="btn-tax" onClick={runBulk} disabled={bulkL} style={{ marginTop: 8 }}>
              {bulkL ? `Bezig (${bulkRes.length})` : "Start Bulk"}
            </button>
            {bulkL && <div className="load-bar" />}
            {bulkRes.length > 0 && (
              <div className="bulk-table">
                <div className="bulk-head"><span>Kenteken</span><span>Auto</span><span>Jaar</span><span>Inkoop</span><span>Verkoop</span><span>#</span></div>
                {bulkRes.map((b, i) => (
                  <div key={i} className={"bulk-row" + (b.ok ? "" : " err")}>
                    <span className="mono">{b.plate}</span>
                    {b.ok ? (
                      <>
                        <span>{b.make} {b.model}</span>
                        <span>{b.year}</span>
                        <span className="mono">{b.inkoop}</span>
                        <span className="mono">{E(b.verkoop)}</span>
                        <span>{b.listings}</span>
                      </>
                    ) : <span className="dim" style={{ gridColumn: "span 5" }}>{b.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* PORTFOLIO (DB-based) */}
        {page === "portfolio" && (
          <>
            <div className="pg-head"><h1>Portfolio</h1><p>Winsttracker — gekoppeld aan database</p></div>
            {dbPortfolio.length > 0 ? (
              <>
                <div className="dash-stats">
                  <div className="stat-card"><div className="stat-n">{dbPortfolio.length}</div><div className="stat-l">{"Auto's"}</div></div>
                  <div className="stat-card"><div className="stat-n">{dbPortfolio.filter((p: any) => p.status === "verkocht").length}</div><div className="stat-l">Verkocht</div></div>
                  <div className="stat-card"><div className="stat-n g">{E(dbPortfolio.filter((p: any) => p.status === "verkocht").reduce((s: number, p: any) => s + (p.winst || 0), 0))}</div><div className="stat-l">Winst</div></div>
                </div>
                <div className="pf-list">
                  {dbPortfolio.map((p: any) => (
                    <div key={p.id} className={"pf-row" + (p.status === "verkocht" ? " sold" : "")}>
                      <span className="pf-plate">{p.kenteken}</span>
                      <span className="pf-car">{p.make} {p.model} {"\u00B7"} {p.year}</span>
                      <span className="pf-inkoop">Inkoop: {E(p.inkoop_prijs)}</span>
                      {p.status === "verkocht" ? (
                        <span className="pf-verkoop g">Verkocht: {E(p.verkoop_prijs)} (+{E(p.winst)})</span>
                      ) : (
                        <div className="pf-sell-form">
                          <input type="number" placeholder="Verkoopprijs" className="pf-sell-inp" id={`dbpf-${p.id}`} />
                          <button className="pf-sell-btn" onClick={() => sellDbPortfolioItem(p.id)}>Verkocht</button>
                        </div>
                      )}
                      <button className="pf-del" onClick={() => deleteDbPortfolioItem(p.id)}>{"\u00D7"}</button>
                    </div>
                  ))}
                </div>
              </>
            ) : <p className="dim">Nog geen auto{"'"}s {"\u2014"} doe een taxatie en klik Toevoegen aan Portfolio</p>}
          </>
        )}

        {/* VOORRAAD BEHEER */}
        {page === "voorraad" && (
          <>
            <div className="pg-head"><h1>Voorraad Beheer</h1><p>Beheer je auto{"'"}s op de verkoop website</p></div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <button className="btn-tax" onClick={loadVoorraad} disabled={voorraadLoading}>{voorraadLoading ? "Laden..." : "Ververs"}</button>
              <button className="btn-secondary" onClick={() => window.open("/verkoop/","_blank")}>Bekijk website</button>
            </div>
            {voorraadLoading && <div className="load-bar" />}
            {voorraadList.length > 0 ? (
              <div className="bulk-table">
                <div className="bulk-head"><span>Kenteken</span><span>Auto</span><span>Jaar</span><span>KM</span><span>Prijs</span><span>Status</span><span>Foto{"'"}s</span><span></span></div>
                {voorraadList.map((c: any) => (
                  voorraadEdit?.id === c.id ? (
                    <div key={c.id} className="bulk-row" style={{background:"rgba(0,255,156,.04)"}}>
                      <span className="mono">{c.kenteken}</span>
                      <span><input className="tc-input" style={{width:100}} defaultValue={c.make} id={`ve-mk-${c.id}`} /> <input className="tc-input" style={{width:100}} defaultValue={c.model} id={`ve-ml-${c.id}`} /></span>
                      <span><input className="tc-input" style={{width:60}} type="number" defaultValue={c.year} id={`ve-yr-${c.id}`} /></span>
                      <span><input className="tc-input" style={{width:80}} type="number" defaultValue={c.km} id={`ve-km-${c.id}`} /></span>
                      <span><input className="tc-input" style={{width:80}} type="number" defaultValue={c.vraag_prijs} id={`ve-pr-${c.id}`} /></span>
                      <span>
                        <select className="tc-input" style={{width:90}} defaultValue={c.status} id={`ve-st-${c.id}`}>
                          <option value="te_koop">Te koop</option><option value="reservering">Gereserveerd</option><option value="verkocht">Verkocht</option><option value="concept">Concept</option>
                        </select>
                      </span>
                      <span>{c.photo_count || 0}</span>
                      <span style={{display:"flex",gap:4}}>
                        <button className="btn-sm g" onClick={() => {
                          const mk = (document.getElementById(`ve-mk-${c.id}`) as HTMLInputElement)?.value
                          const ml = (document.getElementById(`ve-ml-${c.id}`) as HTMLInputElement)?.value
                          const yr = Number((document.getElementById(`ve-yr-${c.id}`) as HTMLInputElement)?.value)
                          const km = Number((document.getElementById(`ve-km-${c.id}`) as HTMLInputElement)?.value)
                          const pr = Number((document.getElementById(`ve-pr-${c.id}`) as HTMLInputElement)?.value)
                          const st = (document.getElementById(`ve-st-${c.id}`) as HTMLSelectElement)?.value
                          updateVoorraadItem(c.id, { make: mk, model: ml, year: yr, km, vraag_prijs: pr, beschrijving: c.beschrijving, status: st, featured: c.featured })
                        }}>{"✓"}</button>
                        <button className="btn-sm" onClick={() => setVoorraadEdit(null)}>{"✕"}</button>
                      </span>
                    </div>
                  ) : (
                    <div key={c.id} className="bulk-row">
                      <span className="mono">{c.kenteken}</span>
                      <span>{c.make} {c.model}</span>
                      <span>{c.year}</span>
                      <span>{N(c.km)}</span>
                      <span className="mono">{E(c.vraag_prijs)}</span>
                      <span><span className={`admin-status ${c.status === "te_koop" ? "active" : c.status === "verkocht" ? "sold" : "pending"}`}>{c.status}</span></span>
                      <span>{c.photo_count || 0}</span>
                      <span style={{display:"flex",gap:4}}>
                        <button className="btn-sm" onClick={() => setVoorraadEdit(c)}>{"✎"}</button>
                        <button className="btn-sm r" onClick={() => deleteVoorraadItem(c.id)}>{"✕"}</button>
                      </span>
                    </div>
                  )
                ))}
              </div>
            ) : !voorraadLoading ? (
              <div className="empty-pg">
                <p>Geen auto{"'"}s in voorraad. Voeg auto{"'"}s toe via een taxatie of laad de pagina opnieuw.</p>
                <button className="btn-tax" onClick={loadVoorraad} style={{marginTop:12}}>Voorraad laden</button>
              </div>
            ) : null}
          </>
        )}

        {/* BIEDINGEN */}
        {page === "biedingen" && (
          <>
            <div className="pg-head"><h1>Biedingen</h1><p>Binnenkomende biedingen beheren</p></div>
            <button className="btn-tax" onClick={loadBiedingen} disabled={biedingenLoading}>{biedingenLoading ? "Laden..." : "Ververs"}</button>
            {biedingenLoading && <div className="load-bar" />}
            {biedingenList.length > 0 ? (
              <div className="pf-list" style={{marginTop:16}}>
                {biedingenList.map((b: any) => (
                  <div key={b.id} className="pf-row">
                    <span className="pf-plate">{b.kenteken}</span>
                    <span className="pf-car">{b.bieder}</span>
                    <span className="pf-inkoop" style={{fontWeight:700,color:"var(--green)"}}>{E(b.bedrag)}</span>
                    <span className="pf-car">{b.notitie || ""}</span>
                    <span><span className={`admin-status ${b.status === "actief" ? "active" : b.status === "geaccepteerd" ? "active" : "sold"}`}>{b.status}</span></span>
                    {b.status === "actief" && (
                      <span style={{display:"flex",gap:4}}>
                        <button className="btn-sm g" onClick={() => updateBodStatus(b.id, "geaccepteerd")}>{"✓"} Accept</button>
                        <button className="btn-sm r" onClick={() => updateBodStatus(b.id, "afgewezen")}>{"✕"} Afwijs</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : <p className="dim" style={{marginTop:12}}>Geen actieve biedingen</p>}
          </>
        )}

        {/* INSPECTIES */}
        {page === "inspecties" && (
          <>
            <div className="pg-head"><h1>Inspecties</h1><p>Overzicht van alle walkaround inspecties</p></div>
            <button className="btn-tax" onClick={loadInspecties} disabled={inspectiesLoading}>{inspectiesLoading ? "Laden..." : "Ververs"}</button>
            {inspectiesLoading && <div className="load-bar" />}
            {inspectiesList.length > 0 ? (
              <div className="bulk-table" style={{marginTop:16}}>
                <div className="bulk-head"><span>Kenteken</span><span>Inspecteur</span><span>Ext.</span><span>Int.</span><span>Tech.</span><span>Totaal</span><span>Kosten</span><span>Status</span><span>Datum</span></div>
                {inspectiesList.map((insp: any) => (
                  <div key={insp.id} className="bulk-row">
                    <span className="mono">{insp.kenteken}</span>
                    <span>{insp.inspecteur || "—"}</span>
                    <span>{insp.exterieur_score}/5</span>
                    <span>{insp.interieur_score}/5</span>
                    <span>{insp.technisch_score}/5</span>
                    <span style={{fontWeight:700,color: insp.totaal_score >= 3.5 ? "var(--green)" : insp.totaal_score >= 2.5 ? "var(--yellow)" : "var(--red)"}}>{insp.totaal_score}</span>
                    <span>{insp.totaal_kosten ? E(insp.totaal_kosten) : "—"}</span>
                    <span><span className={`admin-status ${insp.status === "afgerond" ? "active" : "pending"}`}>{insp.status}</span></span>
                    <span style={{fontSize:11,color:"var(--text3)"}}>{insp.created_at?.slice(0, 10)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="dim" style={{marginTop:12}}>Geen inspecties gevonden. Gebruik de mobiele app voor walkaround inspecties.</p>}
          </>
        )}

        {/* INBOX (admin) */}
        {page === "inbox" && (
          <>
            <div className="pg-head"><h1>Berichten</h1><p>Contact verzoeken en B2B aanmeldingen</p></div>
            <button className="btn-tax" onClick={loadContacts} disabled={contactLoading}>{contactLoading ? "Laden..." : "Ververs"}</button>
            {contactLoading && <div className="load-bar" />}
            {contactRequests.length > 0 ? (
              <div className="pf-list" style={{marginTop:16}}>
                {contactRequests.map((c: any) => (
                  <div key={c.id} className={"pf-row" + (c.status === "nieuw" ? "" : " sold")} style={{flexDirection:"column",alignItems:"stretch",gap:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:600}}>{c.naam || "Onbekend"} {c.bedrijf ? `(${c.bedrijf})` : ""}</span>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span className={`admin-status ${c.status === "nieuw" ? "active" : "pending"}`}>{c.type === "b2b_registratie" ? "B2B" : c.type} — {c.status}</span>
                        <span style={{fontSize:11,color:"var(--text3)"}}>{c.created_at?.slice(0, 10)}</span>
                      </div>
                    </div>
                    <div style={{fontSize:13,color:"var(--text2)"}}>
                      {c.email && <span>{"\u2709"} {c.email} </span>}
                      {c.telefoon && <span>{"\u260E"} {c.telefoon} </span>}
                      {c.kvk && <span>KvK: {c.kvk}</span>}
                    </div>
                    {c.onderwerp && <div style={{fontSize:12,color:"var(--text3)"}}>Onderwerp: {c.onderwerp}</div>}
                    {c.bericht && <div style={{fontSize:13,color:"var(--text)",background:"rgba(255,255,255,.03)",padding:"8px 12px",borderRadius:8}}>{c.bericht}</div>}
                    <div style={{display:"flex",gap:6}}>
                      {c.status === "nieuw" && <button className="btn-sm g" onClick={() => markContactRead(c.id)}>{"✓"} Gelezen</button>}
                      <button className="btn-sm r" onClick={() => deleteContactRequest(c.id)}>{"✕"} Verwijder</button>
                      {c.email && <a className="btn-sm" href={`mailto:${c.email}`} style={{textDecoration:"none"}}>{"✉"} Mail</a>}
                      {c.telefoon && <a className="btn-sm" href={`tel:${c.telefoon}`} style={{textDecoration:"none"}}>{"📞"} Bel</a>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="dim" style={{marginTop:12}}>Geen berichten</p>}
          </>
        )}

        {/* INSTELLINGEN */}
        {page === "instellingen" && (
          <>
            <div className="pg-head"><h1>Instellingen</h1><p>Profiel, wachtwoord en bedrijfsgegevens</p></div>
            <div className="dash-grid">
              <div className="dash-card">
                <h3>Profiel</h3>
                <div className="admin-table">
                  <div className="admin-row"><span>Naam</span><span>{userName}</span></div>
                  <div className="admin-row"><span>Rol</span><span>{userRole}</span></div>
                </div>
                <h3 style={{marginTop:20}}>Wachtwoord wijzigen</h3>
                <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>
                  <input className="tc-input" type="password" placeholder="Huidig wachtwoord" value={pwOld} onChange={e => setPwOld(e.target.value)} />
                  <input className="tc-input" type="password" placeholder="Nieuw wachtwoord (min 6 tekens)" value={pwNew} onChange={e => setPwNew(e.target.value)} />
                  <button className="btn-primary" onClick={changePassword}>Wijzig wachtwoord</button>
                  {pwMsg && <div style={{fontSize:13,color:pwMsg.startsWith("✓") ? "var(--green)" : "var(--red)"}}>{pwMsg}</div>}
                </div>
              </div>
              <div className="dash-card">
                <h3>Bedrijfsgegevens</h3>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  <label style={{fontSize:12,color:"var(--text3)"}}>Bedrijfsnaam
                    <input className="tc-input" placeholder="Transfer4Cars" defaultValue={settingsState.bedrijfsnaam || ""} onBlur={e => saveSetting("bedrijfsnaam", e.target.value)} style={{marginTop:4}} />
                  </label>
                  <label style={{fontSize:12,color:"var(--text3)"}}>Telefoon
                    <input className="tc-input" placeholder="+31 6..." defaultValue={settingsState.telefoon || ""} onBlur={e => saveSetting("telefoon", e.target.value)} style={{marginTop:4}} />
                  </label>
                  <label style={{fontSize:12,color:"var(--text3)"}}>E-mail
                    <input className="tc-input" placeholder="info@..." defaultValue={settingsState.email || ""} onBlur={e => saveSetting("email", e.target.value)} style={{marginTop:4}} />
                  </label>
                  <label style={{fontSize:12,color:"var(--text3)"}}>Locatie
                    <input className="tc-input" placeholder="Ter Aar" defaultValue={settingsState.locatie || ""} onBlur={e => saveSetting("locatie", e.target.value)} style={{marginTop:4}} />
                  </label>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ADMIN */}
        {page === "admin" && (
          <>
            <div className="pg-head"><h1>Admin Paneel</h1><p>Gebruikersbeheer, server status en logs</p></div>

            {/* Stats row */}
            <div className="dash-stats">
              <div className="stat-card"><div className="stat-n">{adminUsers.length}</div><div className="stat-l">Gebruikers</div></div>
              <div className="stat-card"><div className="stat-n">{adminUsers.reduce((s,u) => s + (u.taxatie_count||0), 0)}</div><div className="stat-l">Taxaties totaal</div></div>
              <div className="stat-card"><div className="stat-n">{adminStats?.uptimeStr || "..."}</div><div className="stat-l">Uptime</div></div>
              <div className="stat-card"><div className="stat-n">{adminStats?.memory?.heapUsedMB || "?"}MB</div><div className="stat-l">Geheugen</div></div>
            </div>

            {/* Users table */}
            <div className="dash-card" style={{marginTop:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <h3>Gebruikers ({adminUsers.length})</h3>
                <button className="btn-primary" onClick={loadAdminData} style={{fontSize:11,padding:"4px 10px"}}>{"\u21BB"} Ververs</button>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{borderBottom:"2px solid var(--border)",textAlign:"left"}}>
                      <th style={{padding:"8px 6px"}}>Naam</th>
                      <th style={{padding:"8px 6px"}}>Username</th>
                      <th style={{padding:"8px 6px"}}>Rol</th>
                      <th style={{padding:"8px 6px",textAlign:"center"}}>Taxaties</th>
                      <th style={{padding:"8px 6px"}}>Laatste taxatie</th>
                      <th style={{padding:"8px 6px"}}>Status</th>
                      <th style={{padding:"8px 6px"}}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map((u: any) => (
                      <tr key={u.id} style={{borderBottom:"1px solid var(--border)"}}>
                        <td style={{padding:"8px 6px",fontWeight:600}}>{u.name || u.username}</td>
                        <td style={{padding:"8px 6px",color:"var(--text3)",fontFamily:"monospace",fontSize:12}}>{u.username}</td>
                        <td style={{padding:"8px 6px"}}>
                          <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,fontWeight:600,
                            background: u.role==="admin" ? "rgba(239,68,68,.15)" : u.role==="inkoper" ? "rgba(59,130,246,.15)" : u.role==="dealer" ? "rgba(94,189,62,.15)" : "rgba(148,163,184,.15)",
                            color: u.role==="admin" ? "#ef4444" : u.role==="inkoper" ? "#3b82f6" : u.role==="dealer" ? "#5ebd3e" : "#94a3b8"
                          }}>{u.role}</span>
                        </td>
                        <td style={{padding:"8px 6px",textAlign:"center",fontWeight:700,color:"var(--green)"}}>{u.taxatie_count || 0}</td>
                        <td style={{padding:"8px 6px",color:"var(--text3)",fontSize:12}}>{u.last_taxatie ? new Date(u.last_taxatie).toLocaleDateString("nl-NL") : "—"}</td>
                        <td style={{padding:"8px 6px"}}>
                          <span style={{width:8,height:8,borderRadius:"50%",display:"inline-block",background: u.active !== 0 ? "#5ebd3e" : "#ef4444",marginRight:4}}></span>
                          {u.active !== 0 ? "Actief" : "Inactief"}
                        </td>
                        <td style={{padding:"8px 6px"}}>
                          <button style={{background:"none",border:"1px solid var(--border)",borderRadius:4,color:"var(--text3)",padding:"2px 6px",cursor:"pointer",fontSize:11,marginRight:4}} onClick={async () => {
                            const np = prompt(`Nieuw wachtwoord voor ${u.username}:`)
                            if (!np) return
                            const r = await fetch(`/api/users/${u.id}/password`, {method:"POST",headers:authHeaders(),body:JSON.stringify({password:np})}).then(r=>r.json())
                            alert(r.ok ? "Wachtwoord gewijzigd" : "Fout: " + r.error)
                          }}>Wachtwoord</button>
                          <button style={{background:"none",border:"1px solid rgba(239,68,68,.3)",borderRadius:4,color:"#ef4444",padding:"2px 6px",cursor:"pointer",fontSize:11}} onClick={async () => {
                            if (!confirm(`${u.username} verwijderen?`)) return
                            const r = await fetch(`/api/users/${u.id}`, {method:"DELETE",headers:authHeaders()}).then(r=>r.json())
                            if (r.ok) loadAdminData()
                            else alert("Fout: " + r.error)
                          }}>{"\u2715"}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add user form */}
              <div style={{marginTop:16,padding:16,background:"var(--bg)",borderRadius:10,border:"1px dashed var(--border)"}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>Nieuwe gebruiker toevoegen</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                  <div style={{flex:"1 1 140px"}}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Naam</label>
                    <input id="au-name" className="tc-input" placeholder="Jan de Vries" style={{width:"100%"}} />
                  </div>
                  <div style={{flex:"1 1 120px"}}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Username</label>
                    <input id="au-user" className="tc-input" placeholder="jan" style={{width:"100%"}} />
                  </div>
                  <div style={{flex:"1 1 120px"}}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Wachtwoord</label>
                    <input id="au-pass" className="tc-input" type="password" placeholder="min. 4 tekens" style={{width:"100%"}} />
                  </div>
                  <div style={{flex:"0 0 110px"}}>
                    <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:3}}>Rol</label>
                    <select id="au-role" className="tc-input" style={{width:"100%"}}><option value="dealer">Dealer</option><option value="inkoper">Inkoper</option><option value="klant">Klant</option><option value="admin">Admin</option></select>
                  </div>
                  <button className="btn-primary" style={{padding:"9px 20px",whiteSpace:"nowrap"}} onClick={async () => {
                    const name = (document.getElementById("au-name") as HTMLInputElement)?.value.trim()
                    const username = (document.getElementById("au-user") as HTMLInputElement)?.value.trim()
                    const password = (document.getElementById("au-pass") as HTMLInputElement)?.value
                    const role = (document.getElementById("au-role") as HTMLSelectElement)?.value
                    if (!username || !password) return alert("Username en wachtwoord zijn verplicht")
                    if (password.length < 4) return alert("Wachtwoord moet minimaal 4 tekens zijn")
                    try {
                      const r = await fetch("/api/users", {method:"POST", headers:authHeaders(), body:JSON.stringify({name: name||username, username, password, role})}).then(r=>r.json())
                      if (r.ok) {
                        ;(document.getElementById("au-name") as HTMLInputElement).value = ""
                        ;(document.getElementById("au-user") as HTMLInputElement).value = ""
                        ;(document.getElementById("au-pass") as HTMLInputElement).value = ""
                        loadAdminData()
                      } else { alert("Fout: " + (r.error || "Onbekende fout")) }
                    } catch(e: any) { alert("Verbindingsfout: " + e.message) }
                  }}>+ Toevoegen</button>
                </div>
              </div>
            </div>

            {/* Server Logs */}
            <div className="dash-card" style={{marginTop:16}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <h3>Server Logs</h3>
                <div style={{display:"flex",gap:6}}>
                  {["server.log","errors.log","guardian.log"].map(f => (
                    <button key={f} className="btn-primary" style={{fontSize:11,padding:"4px 10px", background: adminLogFile === f ? "var(--green)" : "transparent", color: adminLogFile === f ? "#000" : "var(--text3)", border: adminLogFile === f ? "none" : "1px solid var(--border)"}}
                      onClick={() => { setAdminLogFile(f); loadAdminLogs(f) }}>{f.replace(".log","")}</button>
                  ))}
                  <button style={{background:"none",border:"1px solid rgba(239,68,68,.3)",borderRadius:6,color:"#ef4444",padding:"4px 10px",cursor:"pointer",fontSize:11}} onClick={async () => {
                    if (!confirm(`${adminLogFile} legen?`)) return
                    await fetch(`/api/admin/logs/${adminLogFile}`, {method:"DELETE",headers:authHeaders()})
                    loadAdminLogs()
                  }}>Leeg</button>
                </div>
              </div>
              <div style={{background:"#050810",border:"1px solid var(--border)",borderRadius:8,padding:12,maxHeight:400,overflowY:"auto",fontFamily:"monospace",fontSize:11,lineHeight:"18px",color:"#8b9ab5"}}>
                {adminLogs.length === 0 ? <div style={{color:"var(--text3)"}}>Geen logs gevonden</div> :
                  adminLogs.map((line, i) => (
                    <div key={i} style={{borderBottom:"1px solid rgba(255,255,255,.03)",padding:"2px 0",color: line.includes("ERROR") || line.includes("FATAL") ? "#ef4444" : line.includes("WARN") ? "#f59e0b" : "#8b9ab5"}}>{line}</div>
                  ))
                }
              </div>
            </div>

            {/* Top API routes */}
            {adminStats?.topRoutes?.length > 0 && (
              <div className="dash-card" style={{marginTop:16}}>
                <h3 style={{marginBottom:12}}>Top API Routes</h3>
                <div style={{display:"grid",gap:4}}>
                  {adminStats.topRoutes.slice(0,15).map((r: any, i: number) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",background: i%2===0 ? "var(--bg)" : "transparent",borderRadius:4,fontSize:12,fontFamily:"monospace"}}>
                      <span style={{color:"var(--text2)"}}>{r.route}</span>
                      <span style={{color:"var(--green)",fontWeight:600}}>{r.count}x</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export & Platforms */}
            <div className="dash-grid" style={{marginTop:16}}>
              <div className="dash-card">
                <h3>Export</h3>
                <div className="admin-sources">
                  <div className="admin-src" style={{cursor:"pointer"}} onClick={() => window.open("/api/export/csv","_blank")}><span>{"\uD83D\uDCCA"} CSV Export (voorraad)</span><span className="admin-status active">Download</span></div>
                  <div className="admin-src" style={{cursor:"pointer"}} onClick={() => window.open("/api/export/marktplaats","_blank")}><span>{"\uD83C\uDFF7\uFE0F"} Marktplaats XML</span><span className="admin-status active">Download</span></div>
                  <div className="admin-src" style={{cursor:"pointer"}} onClick={() => window.open("/verkoop/","_blank")}><span>{"\uD83C\uDF10"} Verkoop Website</span><span className="admin-status active">Open</span></div>
                  <div className="admin-src" style={{cursor:"pointer"}} onClick={() => window.open("/download","_blank")}><span>{"\uD83D\uDCF2"} App Download Pagina</span><span className="admin-status active">Open</span></div>
                </div>
              </div>
              <div className="dash-card">
                <h3>Server Info</h3>
                <div className="admin-sources">
                  <div className="admin-src"><span>Node.js</span><span style={{color:"var(--text3)",fontSize:12}}>{adminStats?.nodeVersion || "?"}</span></div>
                  <div className="admin-src"><span>PID</span><span style={{color:"var(--text3)",fontSize:12}}>{adminStats?.pid || "?"}</span></div>
                  <div className="admin-src"><span>Requests</span><span style={{color:"var(--green)",fontWeight:600}}>{adminStats?.requests?.toLocaleString() || "0"}</span></div>
                  <div className="admin-src"><span>Errors</span><span style={{color: (adminStats?.errors||0) > 0 ? "#ef4444" : "var(--text3)",fontWeight:600}}>{adminStats?.errors || 0}</span></div>
                  <div className="admin-src"><span>Heap</span><span style={{color:"var(--text3)",fontSize:12}}>{adminStats?.memory?.heapUsedMB || "?"}MB / {adminStats?.memory?.heapTotalMB || "?"}MB</span></div>
                  <div className="admin-src"><span>RSS</span><span style={{color:"var(--text3)",fontSize:12}}>{adminStats?.memory?.rssMB || "?"}MB</span></div>
                </div>
              </div>
            </div>
          </>
        )}


      </main>

      {/* VOORRAAD MODAL */}
      {showVoorraad && v && r && (
        <div className="modal-overlay" onClick={e => { if ((e.target as HTMLElement).className === "modal-overlay") setShowVoorraad(false) }}>
          <div className="voorraad-modal">
            <div className="vm-head">
              <h2>{vrId ? "Foto's toevoegen" : "Zet op verkoop website"}</h2>
              <button className="vm-close" onClick={() => setShowVoorraad(false)}>&times;</button>
            </div>
            <div className="vm-car">{v.make} {v.model} {v.modelVariant || v.subModel || ""} — {v.year}</div>

            {!vrId ? (
              <div className="vm-form">
                <label className="vm-label">
                  <span>Vraagprijs</span>
                  <div className="vm-price-input">
                    <span className="vm-euro">€</span>
                    <input type="number" value={vrPrijs} onChange={e => setVrPrijs(e.target.value)} placeholder={String(r.verkoopadviees)} />
                  </div>
                  <div className="vm-price-presets">
                    <span className="vm-presets-label">Snel instellen:</span>
                    <button onClick={() => setVrPrijs(String(r.internetPrijs))}>Internet {E(r.internetPrijs)}</button>
                    <button onClick={() => setVrPrijs(String(r.verkoopadviees))}>Advies {E(r.verkoopadviees)}</button>
                    <button onClick={() => setVrPrijs(String(m?.p75 || r.verkoopadviees))}>P75 {E(m?.p75)}</button>
                  </div>
                  <div className="vm-price-correct">
                    <span className="vm-presets-label">Correctie:</span>
                    <button className="vm-cor-minus" onClick={() => setVrPrijs(String(Math.max(0, (Number(vrPrijs) || r.verkoopadviees) - 1000)))}>-1000</button>
                    <button className="vm-cor-minus" onClick={() => setVrPrijs(String(Math.max(0, (Number(vrPrijs) || r.verkoopadviees) - 500)))}>-500</button>
                    <button className="vm-cor-minus" onClick={() => setVrPrijs(String(Math.max(0, (Number(vrPrijs) || r.verkoopadviees) - 250)))}>-250</button>
                    <button className="vm-cor-plus" onClick={() => setVrPrijs(String((Number(vrPrijs) || r.verkoopadviees) + 250))}>+250</button>
                    <button className="vm-cor-plus" onClick={() => setVrPrijs(String((Number(vrPrijs) || r.verkoopadviees) + 500))}>+500</button>
                    <button className="vm-cor-plus" onClick={() => setVrPrijs(String((Number(vrPrijs) || r.verkoopadviees) + 1000))}>+1000</button>
                  </div>
                </label>
                <label className="vm-label">
                  <span>Beschrijving</span>
                  <textarea value={vrBeschr} onChange={e => setVrBeschr(e.target.value)} placeholder={`Prachtige ${v.make} ${v.model} in nette staat. ${v.engineLabel ? v.engineLabel + " motor. " : ""}${v.powerHp ? v.powerHp + " PK. " : ""}Dealer onderhouden.`} rows={4} />
                </label>
                <label className="vm-label">
                  <span>Highlights (komma gescheiden)</span>
                  <input type="text" value={vrHighlights} onChange={e => setVrHighlights(e.target.value)} placeholder="Navigatie, LED, Camera, Leder, Panoramadak" />
                </label>
                <div className="vm-summary">
                  <div className="vm-sum-row"><span>Kenteken</span><span>{formatPlate(plate)}</span></div>
                  <div className="vm-sum-row"><span>Inkoop advies</span><span>{E(adjMid)}</span></div>
                  <div className="vm-sum-row"><span>Vraagprijs</span><span className="g">{E(Number(vrPrijs) || r.verkoopadviees)}</span></div>
                  <div className="vm-sum-row hl"><span>Verwachte marge</span><span className="g">{E((Number(vrPrijs) || r.verkoopadviees) - adjMid - reconTot)}</span></div>
                </div>
                <button className="vm-submit" onClick={addToVoorraad} disabled={vrSaving}>
                  {vrSaving ? "Opslaan..." : "Volgende → Foto's"}
                </button>
              </div>
            ) : (
              <div className="vm-form">
                <div className="vm-success">✓ Auto staat op de website!</div>

                <div className="vm-photos-grid">
                  {vrPhotos.map((fn, i) => (
                    <div key={i} className="vm-photo">
                      <img src={`/photos/${fn}`} alt={`Foto ${i+1}`} />
                      {i === 0 && <span className="vm-photo-badge">Cover</span>}
                    </div>
                  ))}
                  <label className={"vm-photo-add" + (vrUploading ? " uploading" : "")}>
                    <input type="file" accept="image/*" multiple capture="environment"
                      onChange={e => e.target.files && uploadPhotos(e.target.files)}
                      style={{ display: "none" }} />
                    {vrUploading ? (
                      <><div className="vm-spinner" /><span>Uploaden...</span></>
                    ) : (
                      <><span className="vm-photo-plus">+</span><span>{vrPhotos.length === 0 ? "Foto's toevoegen" : "Meer foto's"}</span></>
                    )}
                  </label>
                </div>

                <div className="vm-photo-tip">
                  <label className="vm-toggle">
                    <input type="checkbox" checked={vrEnhance} onChange={e => setVrEnhance(e.target.checked)} />
                    <span className="vm-toggle-label">✨ AI foto verbetering</span>
                    <span className="vm-toggle-desc">(belichting, scherpte, contrast + branding)</span>
                  </label>
                </div>

                <button className="vm-submit" onClick={() => setShowVoorraad(false)}>
                  {vrPhotos.length > 0 ? `Klaar (${vrPhotos.length} foto's)` : "Sluiten — later foto's toevoegen"}
                </button>
                <div className="vm-note">Bekijk op <a href="/verkoop/" target="_blank" style={{color:"var(--green)"}}>/verkoop/</a></div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

/* COMPONENTS */
function KV({ l, v }: { l: string; v?: string | number | null }) {
  return <div className="kv"><span className="kv-l">{l}</span><span className="kv-v">{v || "\u2014"}</span></div>
}

function Gauge({ label, value, sub, count }: { label: string; value: number; sub: string; count: number | null }) {
  const v = Math.min(Math.max(value, 0), 100)
  const R = 54, C = 2 * Math.PI * R, offset = C - (v / 100) * C
  const color = v >= 65 ? "#00FF9C" : v >= 40 ? "#f5a623" : "#ff4757"
  return (
    <div className="gauge">
      <svg viewBox="0 0 128 128" className="gauge-svg">
        <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="8" />
        <circle cx="64" cy="64" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} transform="rotate(-90 64 64)" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="gauge-center"><div className="gauge-num" style={{ color }}>{v}</div><div className="gauge-of">/100</div></div>
      <div className="gauge-label">{label}</div>
      <div className="gauge-sub">{sub}</div>
      {count !== null && <div className="gauge-count">{count} listings</div>}
    </div>
  )
}

function PriceChart({ prices, bidLow, bidHigh, median }: { prices: number[]; bidLow: number; bidHigh: number; median: number }) {
  if (!prices.length) return null
  const W = 580, H = 140, P = 35
  const sorted = [...prices].sort((a, b) => a - b)
  const min = sorted[0], max = sorted[sorted.length - 1], range = max - min || 1
  const bins = 18, binW = range / bins, counts = Array(bins).fill(0)
  for (const p of sorted) { const i = Math.min(Math.floor((p - min) / binW), bins - 1); counts[i]++ }
  const maxC = Math.max(...counts, 1), bW = (W - P * 2) / bins
  const xS = (p: number) => P + ((p - min) / range) * (W - P * 2)
  const bLx = xS(Math.max(bidLow, min)), bHx = xS(Math.min(bidHigh, max)), mX = xS(median)
  return (
    <div className="chart-box">
      <div className="chart-title">Prijsverdeling</div>
      <svg viewBox={`0 0 ${W} ${H + 30}`} className="chart-svg">
        <rect x={bLx} y={8} width={Math.max(bHx - bLx, 2)} height={H - 8} fill="rgba(0,255,156,0.07)" stroke="rgba(0,255,156,0.25)" strokeDasharray="4" rx={4} />
        {counts.map((c, i) => {
          const bH = (c / maxC) * (H - 28), x = P + i * bW
          const mid = min + i * binW + binW / 2, inBid = mid >= bidLow && mid <= bidHigh
          return <rect key={i} x={x + 1} y={H - bH} width={bW - 2} height={bH} rx={2} fill={inBid ? "var(--accent)" : "var(--surface3)"} opacity={inBid ? 0.85 : 0.5} />
        })}
        <line x1={mX} y1={4} x2={mX} y2={H} stroke="var(--green)" strokeWidth={2} strokeDasharray="5 3" />
        <text x={mX} y={H + 14} fill="var(--green)" fontSize="9" textAnchor="middle">Mediaan {E(median)}</text>
        <text x={(bLx + bHx) / 2} y={H + 26} fill="var(--accent)" fontSize="9" textAnchor="middle" fontWeight="600">Jouw bod</text>
        <text x={P} y={H + 14} fill="var(--text3)" fontSize="8">{E(min)}</text>
        <text x={W - P} y={H + 14} fill="var(--text3)" fontSize="8" textAnchor="end">{E(max)}</text>
      </svg>
    </div>
  )
}

function KmLine({ data, currentKm }: { data: { date: string; km: number }[]; currentKm: number }) {
  if (data.length < 2) return null
  const W = 580, H = 160, P = 50
  const all = [...data.map(d => ({ d: d.date, km: d.km })), { d: "Nu", km: currentKm }]
  const minK = Math.min(...all.map(d => d.km)), maxK = Math.max(...all.map(d => d.km))
  const rng = maxK - minK || 1, xS = (W - P * 2) / (all.length - 1)
  const pts = all.map((d, i) => ({ x: P + i * xS, y: P + (1 - (d.km - minK) / rng) * (H - P * 2), d: d.d, km: d.km }))
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
  const drops = pts.filter((p, i) => i > 0 && p.km < pts[i - 1].km)
  return (
    <div className="chart-box">
      <div className="chart-title">KM-verloop{drops.length > 0 ? " \u2014 daling gedetecteerd" : ""}</div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="chart-svg">
        {[0, .25, .5, .75, 1].map(f => {
          const y = P + (1 - f) * (H - P * 2)
          return (
            <g key={f}>
              <line x1={P} y1={y} x2={W - P} y2={y} stroke="var(--border-l)" />
              <text x={P - 6} y={y + 3} fill="var(--text3)" fontSize="8" textAnchor="end">{N(Math.round(minK + f * rng))}</text>
            </g>
          )
        })}
        <path d={`${path} L${pts[pts.length - 1].x},${H - P} L${pts[0].x},${H - P} Z`} fill="url(#kmG)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" />
        <defs>
          <linearGradient id="kmG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.12" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 5 : 3}
            fill={i === pts.length - 1 ? "var(--accent)" : "var(--bg)"}
            stroke={i === pts.length - 1 ? "var(--accent)" : "var(--text3)"} strokeWidth={1.5} />
        ))}
        {drops.map((d, i) => (
          <text key={i} x={d.x} y={d.y - 10} fill="var(--red)" fontSize="12" textAnchor="middle" fontWeight="700">{"\u26A0"}</text>
        ))}
        {[0, Math.floor(pts.length / 2), pts.length - 1].map(i => (
          <text key={i} x={pts[i].x} y={H + 8} fill="var(--text3)" fontSize="8" textAnchor="middle">{pts[i].d}</text>
        ))}
      </svg>
    </div>
  )
}
