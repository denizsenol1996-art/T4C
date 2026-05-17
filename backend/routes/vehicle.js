// routes/vehicle.js — plate validate/scan, vehicle enriched, finnik, known-issues
const router = require("express").Router()
const axios = require("axios")
const { stmts, queryAll, queryOne, run } = require("../db")
const { getCached, setCache, safeFetch, ua, maxPrice, MIN_PRICE, TIMEOUT, fmtE } = require("../lib/helpers")
const { getApiKey, hasApiKey, callGPT } = require("../lib/ai")
const { authMiddleware, staffOnly, adminOnly } = require("../lib/auth")
const { writeLog } = require("../lib/state")
const enrichCache = require("../lib/enrich-cache")

router.post("/api/plate/validate", async (req, res) => {
  try {
    const candidates = (req.body.candidates || []).map(p => p.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(p => p.length >= 5 && p.length <= 6)
    if (!candidates.length) return res.json({ ok: false, error: "Geen kandidaten" })
    // Test candidates in batches of 10, stop on first hit
    const toTest = candidates.slice(0, 60)
    for (let batch = 0; batch < toTest.length; batch += 20) {
      const chunk = toTest.slice(batch, batch + 20)
      const results = await Promise.allSettled(
        chunk.map(plate =>
          axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${plate}`, { timeout: 4000 })
            .then(r => ({ plate, found: Array.isArray(r.data) && r.data.length > 0, data: r.data[0] || null }))
            .catch(() => ({ plate, found: false, data: null }))
        )
      )
      const hits = results.filter(r => r.status === "fulfilled" && r.value.found).map(r => r.value)
      if (hits.length > 0) {
        const best = hits[0]
        return res.json({ ok: true, plate: best.plate, make: best.data?.merk || "", model: best.data?.handelsbenaming || "" })
      }
    }
    res.json({ ok: false, error: "Geen geldig kenteken gevonden" })
  } catch (e) { res.json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   SERVER-SIDE PLATE OCR
   Client sends cropped plate image → server does OCR + RDW
   Requires: apt install tesseract-ocr
   Fallback: tesseract.js npm package
   ═══════════════════════════════════════════════ */
const { execFile } = require("child_process")
const os = require("os")

const PLATE_SIDECODES = [
  { p: 'LLDDDL', w: 0 }, { p: 'LDDDLL', w: 0 },
  { p: 'LLDDLL', w: 1 }, { p: 'DDLLLD', w: 1 }, { p: 'DLLLDD', w: 1 },
  { p: 'LLLDDL', w: 2 }, { p: 'LDDLLL', w: 2 },
  { p: 'LLLLDD', w: 3 }, { p: 'DDLLDD', w: 3 }, { p: 'DLLDDD', w: 3 }, { p: 'DDDLLD', w: 3 },
  { p: 'LLDDDD', w: 4 }, { p: 'DDDDLL', w: 4 }, { p: 'DDLLLL', w: 4 },
]
function toLOpts(c) {
  if (/[A-Z]/.test(c)) return [c]
  return {'0':['O','D','Q'],'1':['I','T','L'],'2':['Z'],'3':['B','E'],'4':['A','H'],'5':['S'],'6':['G','C'],'7':['T','Z','J'],'8':['B','S'],'9':['G','P']}[c] || []
}
function toDOpts(c) {
  if (/[0-9]/.test(c)) return [c]
  return {'O':['0'],'D':['0'],'Q':['0'],'I':['1'],'T':['7','1'],'L':['1'],'Z':['2'],'B':['8','6'],'E':['3'],'A':['4'],'H':['4'],'S':['5'],'G':['6'],'C':['6'],'J':['7'],'P':['9'],'Y':['7','4'],'V':['7'],'U':['0'],'R':['8']}[c] || []
}
function serverSidecodeCandidates(raw) {
  if (!raw || raw.length < 5) return []
  const scored = []
  for (let offset = 0; offset <= Math.min(raw.length - 6, 3); offset++) {
    const chunk = raw.substring(offset, offset + 6)
    for (const { p: sc, w: weight } of PLATE_SIDECODES) {
      const posOpts = []
      let valid = true
      for (let i = 0; i < 6; i++) {
        const opts = sc[i] === 'L' ? toLOpts(chunk[i]) : toDOpts(chunk[i])
        if (!opts.length) { valid = false; break }
        posOpts.push(opts.map(o => ({ ch: o, changed: o !== chunk[i] ? 1 : 0 })))
      }
      if (!valid) continue
      let combos = [{ chars: [], changes: 0 }]
      for (const arr of posOpts) {
        const next = []
        for (const prev of combos) {
          for (const { ch, changed } of arr) {
            next.push({ chars: [...prev.chars, ch], changes: prev.changes + changed })
            if (next.length >= 120) break
          }
          if (next.length >= 120) break
        }
        combos = next
      }
      for (const c of combos) scored.push({ plate: c.chars.join(''), score: c.changes + weight })
    }
  }
  scored.sort((a, b) => a.score - b.score)
  const seen = new Set(), result = []
  for (const s of scored) { if (!seen.has(s.plate)) { seen.add(s.plate); result.push(s.plate); if (result.length >= 60) break } }
  return result
}

function runSystemTesseract(imgPath) {
  return new Promise((resolve) => {
    execFile("tesseract", [imgPath, "stdout", "--psm", "7", "-c", "tessedit_char_whitelist=ABCDEFGHJKLMNPRSTUVWXYZ0123456789"],
      { timeout: 5000 }, (err, stdout) => {
        if (err) return resolve(null)
        resolve(stdout.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      })
  })
}

async function preprocessPlate(base64Data) {
  const Jimp = require("jimp")
  const buf = Buffer.from(base64Data, "base64")
  const img = await Jimp.read(buf)
  if (img.getWidth() < 400) img.scale(Math.ceil(400 / img.getWidth()))
  const versions = []
  // V1: High contrast grayscale
  versions.push(img.clone().grayscale().contrast(0.6))
  // V2: Binary threshold dark
  const v2 = img.clone().grayscale().contrast(0.8)
  v2.scan(0, 0, v2.getWidth(), v2.getHeight(), function(x, y, idx) {
    const val = this.bitmap.data[idx] < 140 ? 0 : 255
    this.bitmap.data[idx] = val; this.bitmap.data[idx+1] = val; this.bitmap.data[idx+2] = val
  })
  versions.push(v2)
  // V3: Binary threshold light
  const v3 = img.clone().grayscale().contrast(0.4)
  v3.scan(0, 0, v3.getWidth(), v3.getHeight(), function(x, y, idx) {
    const val = this.bitmap.data[idx] < 110 ? 0 : 255
    this.bitmap.data[idx] = val; this.bitmap.data[idx+1] = val; this.bitmap.data[idx+2] = val
  })
  versions.push(v3)
  return versions
}

router.post("/api/plate/scan", async (req, res) => {
  const t0 = Date.now()
  try {
    const { image } = req.body
    if (!image) return res.json({ ok: false, error: "Geen afbeelding" })
    const imgType = image.charAt(0) === '/' ? 'image/jpeg' : 'image/png'

    // Strategy 1: OpenAI Vision (best accuracy)
    const apiKey = getApiKey("OPENAI_API_KEY")
    let ocrPlate = null

    if (apiKey && apiKey !== "sk-...") {
      try {
        const visionResp = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-5.4",
          max_completion_tokens: 20,
          temperature: 0,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: "Read the Dutch license plate in this image. Return ONLY the characters, no dashes/spaces. Example: 59NDZ6. If unreadable return NONE." },
              { type: "image_url", image_url: { url: `data:${imgType};base64,${image}`, detail: "low" } }
            ]
          }]
        }, { headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 6000 })

        const raw = (visionResp.data?.choices?.[0]?.message?.content || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        if (raw.length >= 5 && raw !== "NONE") {
          ocrPlate = raw
          writeLog("ocr.log", `[Vision] Read: ${raw} (${Date.now()-t0}ms)`)
        }
      } catch(e) {
        writeLog("ocr.log", `[Vision] Failed: ${e.message}`)
      }
    }

    // Strategy 2: Tesseract fallback (if no OpenAI key or Vision failed)
    if (!ocrPlate) {
      const allRaw = new Set()
      try {
        const imgs = await preprocessPlate(image)
        const tmpDir = os.tmpdir()
        for (let i = 0; i < imgs.length; i++) {
          const tmpPath = path.join(tmpDir, `plate_${Date.now()}_${i}.png`)
          try {
            await imgs[i].writeAsync(tmpPath)
            const ocrText = await runSystemTesseract(tmpPath)
            if (ocrText && ocrText.length >= 4) allRaw.add(ocrText)
            try { fs.unlinkSync(tmpPath) } catch {}
          } catch(e) { try { fs.unlinkSync(tmpPath) } catch {} }
        }
        if (allRaw.size === 0) {
          try {
            const Tjs = require("tesseract.js")
            if (!global._tessWorker) {
              global._tessWorker = await Tjs.createWorker("eng")
              await global._tessWorker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789', tessedit_pageseg_mode: '7' })
            }
            const buf = Buffer.from(image, "base64")
            const { data: { text } } = await global._tessWorker.recognize(buf)
            const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
            if (cleaned.length >= 4) allRaw.add(cleaned)
          } catch(e) { writeLog("ocr.log", "tesseract.js fallback: " + e.message) }
        }
        if (allRaw.size > 0) ocrPlate = [...allRaw][0]
      } catch(e) { writeLog("ocr.log", `[Tesseract] Error: ${e.message}`) }
    }

    if (!ocrPlate) return res.json({ ok: false, error: "Kon kenteken niet lezen", ms: Date.now() - t0 })

    // Try the exact Vision/OCR reading first (fastest path)
    writeLog("ocr.log", `OCR: ${ocrPlate} — trying direct RDW lookup`)
    try {
      const directCheck = await axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${ocrPlate}`, { timeout: 4000 })
      if (Array.isArray(directCheck.data) && directCheck.data.length > 0) {
        const d = directCheck.data[0]
        writeLog("ocr.log", `✓ DIRECT HIT: ${ocrPlate} (${d.merk} ${d.handelsbenaming}) ${Date.now()-t0}ms`)
        return res.json({ ok: true, plate: ocrPlate, make: d.merk || "", model: d.handelsbenaming || "", ms: Date.now() - t0 })
      }
    } catch(e) {}

    // Direct lookup failed — generate sidecode candidates and batch validate
    const candidates = serverSidecodeCandidates(ocrPlate).slice(0, 30)
    writeLog("ocr.log", `Direct miss, trying ${candidates.length} candidates`)

    for (let batch = 0; batch < candidates.length; batch += 20) {
      const chunk = candidates.slice(batch, batch + 20)
      const results = await Promise.allSettled(
        chunk.map(plate =>
          axios.get(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${plate}`, { timeout: 4000 })
            .then(r => ({ plate, found: Array.isArray(r.data) && r.data.length > 0, data: r.data[0] || null }))
            .catch(() => ({ plate, found: false, data: null }))
        )
      )
      const hits = results.filter(r => r.status === "fulfilled" && r.value.found).map(r => r.value)
      if (hits.length > 0) {
        const best = hits[0]
        writeLog("ocr.log", `✓ ${best.plate} (${best.data?.merk} ${best.data?.handelsbenaming}) ${Date.now()-t0}ms`)
        return res.json({ ok: true, plate: best.plate, make: best.data?.merk || "", model: best.data?.handelsbenaming || "", ms: Date.now() - t0 })
      }
    }
    res.json({ ok: false, plate: candidates[0] || ocrPlate, error: "Niet gevonden in RDW", ms: Date.now() - t0 })
  } catch (e) { res.json({ ok: false, error: e.message }) }
})

/* ═══════════════════════════════════════════════
   VEHICLE ENRICHED (for mobile app)
   Fetches RDW data + enriches server-side
   ═══════════════════════════════════════════════ */
// ═══ FINNIK DATA FETCH ═══
async function fetchFinnikData(plate) {
  try {
    const cleanPlate = plate.replace(/[\s-]/g, '').toUpperCase()
    const url = 'https://finnik.nl/kenteken/' + cleanPlate
    const resp = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' }
    })
    const html = resp.data || ''
    const result = {}

    // Helper: extract number after label
    const extractNum = (label) => {
      const re = new RegExp(label + '[\\s\\S]*?€\\s*([\\d.,]+)', 'i')
      const m = html.match(re)
      if (m) { const v = m[1].replace(/\./g, '').replace(',', '.'); const num = parseFloat(v); if (num > 0) return Math.round(num) }
      return null
    }

    // Nieuwprijs
    const np = extractNum('Nieuwprijs')
    if (np && np > 1000 && np < 500000) result.catalogPrice = np

    // Waarde-indicatie: € 1,0-2,5k
    const waardeMatch = html.match(/Waarde-indicatie[\s\S]*?€\s*([\d.,]+)\s*-\s*([\d.,]+)\s*k/i)
    if (waardeMatch) {
      result.waardeLow = Math.round(parseFloat(waardeMatch[1].replace(',', '.')) * 1000)
      result.waardeHigh = Math.round(parseFloat(waardeMatch[2].replace(',', '.')) * 1000)
    }

    // BPM
    const bpm = extractNum('(?:Bruto\\s+)?BPM(?!\\s*rest)')
    if (bpm && bpm > 0 && bpm < 100000) result.bpm = bpm

    // Rest BPM
    const restBpm = extractNum('Rest\\s*BPM')
    if (restBpm && restBpm > 0) result.bpmRest = restBpm

    // Bijtellingsklasse
    const bijtMatch = html.match(/Bijtellingsklasse[\s\S]*?(\d+)\s*%/i)
    if (bijtMatch) result.bijtelling = parseInt(bijtMatch[1])

    // Netto bijtelling
    const netBijt = html.match(/Netto bijtelling[\s\S]*?([\d.,]+%:\s*€\s*[\d.,]+[\s\S]*?[\d.,]+%:\s*€\s*[\d.,]+)/i)
    if (netBijt) result.nettoBijtelling = netBijt[1].trim()

    // Wegenbelasting - extract first province
    const wegMatch = html.match(/Wegenbelasting per kwartaal[\s\S]*?((?:[A-Z][a-z\-]+:\s*€\s*[\d.,]+[\s\S]*?){1,12})/i)
    if (wegMatch) {
      const lines = wegMatch[1].match(/([A-Z][a-z\-]+(?:\s+[A-Z][a-z\-]+)?):\s*€\s*([\d.,]+)/g) || []
      result.wegenbelasting = {}
      for (const line of lines.slice(0, 12)) {
        const parts = line.match(/([A-Za-z\-\s]+):\s*€\s*([\d.,]+)/)
        if (parts) result.wegenbelasting[parts[1].trim()] = Math.round(parseFloat(parts[2].replace('.', '').replace(',', '.')))
      }
    }

    // Energielabel / emissieklasse from Finnik
    const energieMatch = html.match(/Energielabel[\s\S]*?([A-G]\+{0,3})/i)
    if (energieMatch) result.energielabel = energieMatch[1]

    if (Object.keys(result).length > 0) {
      console.log('[FINNIK] Data:', Object.keys(result).join(', '))
      return result
    }
    return null
  } catch (e) {
    console.log('[FINNIK] Fetch failed:', e.message)
    return null
  }
}

router.get("/api/vehicle/enriched", async (req, res) => {
  try {
    const plate = (req.query.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
    const km = parseInt(req.query.km) || 0
    if (!plate || plate.length < 5) return res.status(400).json({ error: "Ongeldig kenteken" })
    const ck = "vehicle_" + plate
    const _enrichCached = enrichCache.get(plate)
    if (_enrichCached) return res.json(_enrichCached)
    const cached = getCached(ck)
    if (cached) return res.json(cached)

    // DB-PERSISTENT CACHE: statische data ophalen, alleen dynamische RDW live
    const _dbCached = queryOne("SELECT static_data, gpt_data, finnik_data FROM vehicle_cache WHERE kenteken=?", [plate])
    let _useDbCache = false
    let _staticRdw = null, _gptCached = null, _finnikCached = null
    if (_dbCached) {
      try {
        _staticRdw = JSON.parse(_dbCached.static_data || 'null')
        _gptCached = JSON.parse(_dbCached.gpt_data || 'null')
        _finnikCached = JSON.parse(_dbCached.finnik_data || 'null')
        if (_staticRdw && _staticRdw.mainA && _staticRdw.mainA.length > 0) {
          _useDbCache = true
          console.log('[VEHICLE] DB cache hit:', plate)
        }
      } catch(pe) { _useDbCache = false }
    }


    const B = "https://opendata.rdw.nl/resource"
    const rdw = async (u) => { try { const r = await axios.get(u, { timeout: 5000 }); return Array.isArray(r.data) ? r.data : [] } catch { return [] } }
    // RDW calls: dynamic altijd live, static uit DB cache of live
    const _t0 = Date.now()
    let mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA

    // Dynamic RDW (altijd live: APK, recalls, gebreken, meldingen, eigenaar, milieu)
    const _dynPromise = Promise.all([
      rdw(B+"/vkij-7mwc.json?kenteken="+plate+"&$limit=100&$order=vervaldatum_keuring DESC"),
      rdw(B+"/t49b-isb7.json?kenteken="+plate),
      rdw(B+"/2u8a-sfar.json?kenteken="+plate+"&$limit=200"),
      rdw(B+"/sgfe-77wx.json?kenteken="+plate+"&$limit=100&$order=meld_datum_door_keuringsinstantie_dt DESC"),
      rdw(B+"/stcx-yhbq.json?kenteken="+plate+"&$limit=50&$order=datum_tenaamstelling DESC"),
      rdw(B+"/242p-gehg.json?kenteken="+plate),
    ])

    // Static RDW (uit DB cache of live)
    let _statPromise
    if (_useDbCache) {
      mainA = _staticRdw.mainA; catA = _staticRdw.catA; bodyA = _staticRdw.bodyA
      fuelA = _staticRdw.fuelA; objectA = _staticRdw.objectA; handelsA = _staticRdw.handelsA
      brandstofSpecA = _staticRdw.brandstofSpecA; typeA = _staticRdw.typeA; oviA = _staticRdw.oviA
      _statPromise = Promise.resolve(null)
      console.log('[VEHICLE] Static RDW: DB cache')
    } else {
      _statPromise = Promise.all([
        rdw(B+"/m9d7-ebf2.json?kenteken="+plate),
        rdw(B+"/8ys7-d773.json?kenteken="+plate),
        rdw(B+"/vezc-m2t6.json?kenteken="+plate),
        rdw(B+"/a34c-35wb.json?kenteken="+plate),
        rdw(B+"/sghb-dzxx.json?kenteken="+plate),
        rdw(B+"/jhie-znh9.json?kenteken="+plate),
        rdw(B+"/55kv-xf7m.json?kenteken="+plate),
        rdw(B+"/mu2w-cjg5.json?kenteken="+plate),
        rdw(B+"/3huj-srit.json?kenteken="+plate),
      ])
    }

    // Run dynamic + static + finnik ALL PARALLEL
    const [_dynResult, _statResult] = await Promise.all([_dynPromise, _statPromise])

    // Unpack dynamic
    const [apkA, recallA, defectA, meldA, eigenaarA, milieuA] = _dynResult

    // Unpack static (als niet uit cache)
    if (_statResult) {
      ;[mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA] = _statResult
      console.log('[VEHICLE] Static RDW: live fetch')
    }
    console.log('[VEHICLE] RDW total:', (Date.now()-_t0) + 'ms (' + (_useDbCache ? 'cached' : 'live') + ')')
    const d = mainA[0]; if(!d) return res.status(404).json({error:"Kenteken niet gevonden bij RDW"})
    const c = catA[0]||{}, b = bodyA[0]||{}
    const s = v => v ? String(v).trim() : ""
    const n = v => { const x=Number(v); return Number.isFinite(x)&&x>0?x:undefined }
    const fmD = v => { if(!v)return""; const z=String(v).replace(/[-/T:.]/g,"").slice(0,8); return z.length===8?z.slice(6,8)+"-"+z.slice(4,6)+"-"+z.slice(0,4):v }

    // Fuel detection
    let fB=null,fD=null,fE=null,fL=null,fO=null
    for(const fr of (fuelA.length?fuelA:catA)){const bo=s(fr.brandstof_omschrijving).toLowerCase();if(bo.includes("benzine"))fB=fr;else if(bo.includes("diesel"))fD=fr;else if(bo.includes("elektr"))fE=fr;else if(bo.includes("lpg")||bo.includes("cng"))fL=fr;else if(!fO)fO=fr}
    const fP=fB||fD||fE||fL||fO||c
    const isHybrid=!!(fE&&(fB||fD))||/hybr/i.test(s(d.handelsbenaming))
    const isPureEV=!!fE&&!fB&&!fD&&!isHybrid
    const fuelLabel=isHybrid?"Hybride":isPureEV?"Elektrisch":(s(fP.brandstof_omschrijving)||"Onbekend")
    
    // Power
    const normP=v=>{const x=n(v);if(!x)return undefined;return x<1?Math.round(x*1000):Math.round(x)}
    const pwN=normP(n(d.nettomaximumvermogen))||normP(n(c.nettomaximumvermogen))||normP(n(fP.nettomaximumvermogen))
    const pwE=normP(n(d.vermogen_motor_elektrisch))||(fE?normP(n(fE.nominaal_continu_maximumvermogen)):undefined)
    let powerKw=isPureEV?(pwE||pwN):isHybrid?(pwN&&pwN>15?pwN:pwE||pwN):(pwN||pwE)
    const powerHp=powerKw?Math.round(powerKw*1.36):0
    const cc=parseFloat(fP.cilinderinhoud||c.cilinderinhoud)||0
    let catalogPrice=n(d.catalogusprijs)||n(c.catalogusprijs)||0
    const year=parseInt((d.datum_eerste_toelating||"").substring(0,4))||0
    var engineLabel="";if(cc>0)engineLabel=(cc/1000).toFixed(1);if(isHybrid)engineLabel+=" Hybrid";if(isPureEV)engineLabel="EV";if(powerHp>0)engineLabel+=" "+powerHp+"pk"

    // APK + KM history
    const apkHistory=[], kmHistory=[]
    for(const a of apkA){const dt=fmD(a.vervaldatum_keuring||a.datum_keuring);const rs=s(a.beoordeling)||"Goedgekeurd";const kmV=n(a.kilometerstand_op_moment_keuring||a.kilometerstand);apkHistory.push({date:dt,result:rs,km:kmV});if(kmV&&dt)kmHistory.push({date:dt,km:kmV})}
    for(const m of meldA){const kmV=n(m.kilometerstand||m.kilometerstand_op_moment_keuring);const dt=fmD(m.meld_datum_door_keuringsinstantie_dt||m.meld_datum_door_keuringsinstantie);if(kmV&&dt&&!kmHistory.some(k=>k.date===dt&&k.km===kmV))kmHistory.push({date:dt,km:kmV})}
    kmHistory.sort((a,b)=>a.date.split("-").reverse().join("").localeCompare(b.date.split("-").reverse().join("")))
    const kmDed=[];for(const k of kmHistory){const ex=kmDed.find(e=>e.date===k.date);if(ex){if(k.km>ex.km)ex.km=k.km}else kmDed.push({...k})}
    
    // KM analysis
    let kmAnalysis=undefined
    if(kmDed.length>=2){const f=kmDed[0],l=kmDed[kmDed.length-1];const fd=new Date(f.date.split("-").reverse().join("-")),ld=new Date(l.date.split("-").reverse().join("-"));const yrs=Math.max(.5,(ld-fd)/(365.25*24*3600000));const avg=Math.round((l.km-f.km)/yrs);const ySL=(Date.now()-ld)/(365.25*24*3600000);const est=Math.round(l.km+avg*ySL);let anom=undefined;for(let i=1;i<kmDed.length;i++){if(kmDed[i].km-kmDed[i-1].km<-500){anom="Mogelijke tellerterugdraaiing: "+kmDed[i-1].date+" ("+kmDed[i-1].km+" km) -> "+kmDed[i].date+" ("+kmDed[i].km+" km)";break}};kmAnalysis={avgPerYear:avg,estimatedCurrent:est,anomaly:anom,total:kmDed.length}}

    // Recalls
    const recalls=recallA.map(r=>({description:s(r.beschrijving_van_het_defect||r.omschrijving||r.referentiecode_fabrikant),status:s(r.code_status||"Onbekend")}))
    // Installed objects
    const installedObjects=[];for(const o of objectA){const desc=s(o.object_omschrijving||o.omschrijving);if(desc&&!installedObjects.includes(desc))installedObjects.push(desc)}

    // Handelsbenaming (trade/marketing name from RDW)
    const handelsRec = handelsA[0] || {}
    const handelsbenaming = s(handelsRec.handelsbenaming || '')

    // Brandstof-specifiek (detailed fuel consumption from RDW)
    const bsRec = brandstofSpecA[0] || {}
    const verbruikGecomb = parseFloat(bsRec.brandstofverbruik_gecombineerd_wltp || bsRec.brandstofverbruik_gecombineerd || 0) || 0
    const verbruikStad = parseFloat(bsRec.brandstofverbruik_stad_wltp || bsRec.brandstofverbruik_stad || 0) || 0
    const verbruikSnelweg = parseFloat(bsRec.brandstofverbruik_buiten_wltp || bsRec.brandstofverbruik_buiten_de_stad || 0) || 0
    const actieradius = n(bsRec.actieradius_enkel_elektrisch_wltp || bsRec.actieradius_extern_opladen_wltp || bsRec.actieradius_enkel_elektrisch_stad_wltp)

    // Typegoedkeuring (EU type approval — extra specs from RDW)
    const typeRec = typeA[0] || {}
    const typegoedkeuringNr = s(typeRec.typegoedkeuringsnummer || '')
    const euVariant = s(typeRec.eu_type_goedkeuringssleutel || typeRec.variant || '')

    // Defects (basic - just codes)
    const defects=defectA.map(x=>({date:fmD(x.meld_datum_door_keuringsinstantie),code:s(x.gebrek_identificatie),description:s(x.gebrek_identificatie)})).sort((a,b)=>b.date.split("-").reverse().join("").localeCompare(a.date.split("-").reverse().join("")))

    // Ownership history (tenaamstellingen)
    const ownerCount = eigenaarA.length || 0
    const ownerHistory = eigenaarA.slice(0,20).map(e => ({
      date: fmD(e.datum_tenaamstelling),
      soort: s(e.soort_eigenaar_tenaamstelling) // Particulier, Bedrijf, etc.
    }))
    const lastOwnerType = ownerHistory.length > 0 ? ownerHistory[0].soort : null
    const isExDealer = ownerHistory.some(o => (o.soort||'').toLowerCase().includes('bedrijf') || (o.soort||'').toLowerCase().includes('rechtspersoon'))

    // Milieu/emissions data
    const milieuRec = milieuA[0] || {}
    const emissieKlasse = s(milieuRec.emissieklasse_eg_goedkeuring_zwaar || d.euroklasse || milieuRec.milieuklasse_eg_goedkeuring_licht || '')
    const roetFilter = s(milieuRec.roetfilter || '')
    const fijnstof = n(milieuRec.uitstoot_deeltjes_licht || milieuRec.uitstoot_deeltjes_zwaar)
    const nox = n(milieuRec.emissie_co2_gecombineerd_wltp || milieuRec.emissie_co2_gecombineerd)

    // BPM rest calculation — official PIT gids afschrijvingstabel (02-01-2025)
    // Table: [months_from, base_pct, monthly_add_pct]
    const bpmNieuw = parseFloat(d.bruto_bpm) || 0
    let bpmRest = 0, bpmRestPct = 0
    if (bpmNieuw > 0) {
      const vehAge = year > 0 ? (new Date().getFullYear() - year) : 0
      const firstUseDate = d.datum_eerste_toelating || d.datum_eerste_tenaamstelling_in_nederland || ''
      let ageMonths = vehAge * 12
      if (firstUseDate) {
        try {
          const fd = new Date(String(firstUseDate).replace(/(\d{2})-(\d{2})-(\d{4})/, '$3-$2-$1').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
          if (!isNaN(fd)) ageMonths = Math.max(0, Math.floor((Date.now() - fd.getTime()) / (30.44 * 24 * 60 * 60 * 1000)))
        } catch(e){}
      }
      // Official table: [min_months, base_depreciation%, monthly_add%]
      const bpmTable = [
        [0, 0, 12],       // 0 dagen - 1 mnd: 0% + 12%/mnd
        [1, 12, 4],       // 1-3 mnd: 12% + 4%/mnd
        [3, 20, 3.5],     // 3-5 mnd: 20% + 3.5%/mnd
        [5, 27, 1.5],     // 5-9 mnd: 27% + 1.5%/mnd
        [9, 33, 1],       // 9-18 mnd: 33% + 1%/mnd
        [18, 42, 0.75],   // 18-30 mnd: 42% + 0.75%/mnd
        [30, 51, 0.5],    // 30-42 mnd: 51% + 0.5%/mnd
        [42, 57, 0.42],   // 42-54 mnd: 57% + 0.42%/mnd
        [54, 62, 0.42],   // 54-66 mnd: 62% + 0.42%/mnd
        [66, 67, 0.42],   // 66-78 mnd: 67% + 0.42%/mnd
        [78, 72, 0.25],   // 78-90 mnd: 72% + 0.25%/mnd
        [90, 75, 0.25],   // 90-102 mnd: 75% + 0.25%/mnd
        [102, 78, 0.25],  // 102-114 mnd: 78% + 0.25%/mnd
        [114, 81, 0.19],  // 114+ mnd: 81% + 0.19%/mnd
      ]
      let depPct = 0
      for (let t = bpmTable.length - 1; t >= 0; t--) {
        if (ageMonths >= bpmTable[t][0]) {
          depPct = bpmTable[t][1] + (ageMonths - bpmTable[t][0]) * bpmTable[t][2]
          break
        }
      }
      depPct = Math.min(depPct, 100)
      bpmRest = Math.round(bpmNieuw * (1 - depPct / 100))
      if (bpmRest < 0) bpmRest = 0
    }
    bpmRestPct = bpmNieuw > 0 ? Math.round(bpmRest / bpmNieuw * 100) : 0

    // ═══ PARALLEL: Finnik scrape + VIN decode (independent calls) ═══
    const _platePF = req.query.plate || req.query.kenteken || ''
    const vin = s(d.voertuig_identificatienummer) || s((oviA[0]||{}).voertuig_identificatienummer) || ""
    const rdwType = s(d.type), rdwVariant = s(d.variant), rdwUitvoering = s(d.uitvoering)
    const hasMakeModel = s(d.merk) && s(d.handelsbenaming)
    const hasTypeCodes = rdwType || rdwVariant || rdwUitvoering
    const _parT0 = Date.now()

    const finnikPromise = (async () => {
      if (!_platePF) return null
      if (_finnikCached) return _finnikCached
      try { return await fetchFinnikData(_platePF) }
      catch (fe) { console.log('[FINNIK] Skip:', fe.message); return null }
    })()

    const vinPromise = (async () => {
      let vinData = { transmission: null, transmissionDetail: null, motorCode: null, generation: null, trimLevel: null, drivetrain: null }
      if (!(hasMakeModel && (hasTypeCodes || vin))) return vinData
      const vinCk = "vin4_" + s(d.merk) + "_" + rdwType + "_" + rdwVariant + "_" + rdwUitvoering + "_" + year
      const vinCached = getCached(vinCk, 86400000) || (_gptCached ? _gptCached : null)
      if (vinCached) {
        console.log('[VIN] Cached:', vin, vinCached.transmission)
        return vinCached
      }
      try {
        const vinKey = getApiKey("OPENAI_API_KEY")
        if (!vinKey || vinKey === "sk-...") {
          console.log('[VIN] ✗ No OpenAI API key configured')
          return vinData
        }
        console.log(`[VIN] Starting decode: ${s(d.merk)} ${s(d.handelsbenaming)} | Type:${rdwType} Var:${rdwVariant} Uitv:${rdwUitvoering} | VIN:${vin||'n/a'} | Key:${vinKey.slice(0,8)}...`)
            const vinResp = await axios.post("https://api.openai.com/v1/chat/completions", {
              model: "gpt-5.4", temperature: 0, max_completion_tokens: 1500,
              messages: [{
                role: "system",
                content: `Je bent een expert automotive analist. Analyseer het voertuig op basis van de RDW Type/Variant/Uitvoering codes, bouwjaar en vermogen.

REGELS:
- Geef ALLEEN informatie die je ZEKER weet op basis van de codes en het bouwjaar
- Motorcode: kies de ENIGE juiste code voor dit bouwjaar (bijv BMW 320i 2013 = N20B20, NIET B48)
- Opties: ALLEEN wat STANDAARD is bij deze uitvoering/trim. NIET gokken op extra opties
- Als je iets niet zeker weet: laat het veld LEEG (null/[])
- BELANGRIJK: De RDW Type code bevat vaak de generatie-aanduiding. Bijv Opel Type "A-H/SW" = Astra H (niet J of K). BMW Type "3L" = 3-serie. Gebruik de Type code als primaire bron voor generatie, NIET je eigen kennis.
- UITZONDERING: "transmission" MOET ALTIJD ingevuld worden ("Automaat" of "Handgeschakeld"). Gebruik Type/Variant codes, vermogen en bouwjaar om dit te bepalen. Dit is VERPLICHT.
- GEEN Harman Kardon, panoramadak, camera etc toekennen tenzij standaard bij trim
- Interior kleur is NIET af te leiden uit RDW data — laat leeg
- likelyOptions moet LEEG blijven — we kunnen opties niet verifiëren

Antwoord ALLEEN in JSON:
{
  "specificModel": "het EXACTE commerciële modelnaam (bijv '320i', 'Golf R-Line', 'A180', 'Yaris Cross', 'C5 Aircross'). Dit is hoe de auto op Marktplaats/AutoScout24 wordt aangeboden. NIET de RDW handelsbenaming.",
  "marketSearchName": "zoekterm voor marktplaatsen (bijv '320i' of 'golf 1.4 tsi' of 'a180'). Kort en specifiek.",
  "transmission": "Automaat" of "Handgeschakeld",
  "transmissionDetail": "bijv ZF 8-traps",
  "motorCode": "ENKELE correcte code voor dit bouwjaar",
  "generation": "bijv F30",
  "trimLevel": "bijv Luxury Line / M-Sport / SE",
  "drivetrain": "FWD/RWD/AWD",
  "gearCount": 8,
  "cylinders": 4,
  "turbo": true,
  "timingType": "Ketting" of "Distributieriem",
  "timingReplace": "bijv Niet nodig (ketting levenslang)",

  "standardEquipment": ["ALLEEN items die ZEKER standaard zijn bij deze trim, max 8"],
  "likelyOptions": [],
  "optionPackage": null,
  "interior": null,
  "interiorColor": null,
  "audioSystem": null,
  "naviType": null,
  "roofType": null,
  "wheelSize": "standaard voor deze trim of null",
  "camera": null,
  "driverAssist": [],
  "towbar": null,
  "heatedSeats": null,
  "heatedSteeringWheel": null,
  "headlightType": "standaard bij trim of null",
  "parkingSensors": "standaard bij trim of null",

  "knownIssues": ["ECHTE bekende problemen voor dit model+motor, max 5"],
  "maintenanceAdvice": "specifiek voor deze motor en km-stand, max 2 zinnen",
  "engineRiskProfile": "Laag/Gemiddeld/Hoog",
  "engineRiskDetail": "1 zin waarom",
  "expectedMaintenanceCost": 1200,

  "optionPriceImpact": [{"option":"Automaat","impact":1000}],
  "courantScore": 7,
  "courantExplain": "1 zin",
  "targetAudience": "doelgroep",
  "salesChannelAdvice": "kanaal",
  "sellingPoints": ["max 4 punten gebaseerd op FEITEN"],
  "dealBreakers": ["max 3"]
}`
              }, {
                role: "user",
                content: `${vin?'VIN: '+vin+'\n':''}Merk: ${s(d.merk)}\nModel: ${s(d.handelsbenaming)}\nType: ${rdwType||'?'}\nVariant: ${rdwVariant||'?'}\nUitvoering: ${rdwUitvoering||'?'}\nTypegoedkeuring: ${typegoedkeuringNr||'?'}\nBouwjaar: ${year}\nBrandstof: ${fuelLabel}\nVermogen: ${powerHp}pk\nCC: ${cc||'?'}\nGewicht: ${n(d.massa_rijklaar)||'?'}kg\nCarrosserie: ${s(d.inrichting)}\nKleur: ${s(d.eerste_kleur)}\nKM-stand: ${km||'onbekend'}\nAantal eigenaren: ${ownerCount||'?'}\nAPK tot: ${fmD(d.vervaldatum_apk)||'?'}\n1e toelating: ${fmD(d.datum_eerste_toelating)||'?'}\nNL toelating: ${fmD(d.datum_eerste_tenaamstelling_in_nederland)||'?'}`
              }]
            }, { headers: { "Authorization": "Bearer " + vinKey, "Content-Type": "application/json" }, timeout: 15000 })
            
            let vinTxt = String(vinResp.data?.choices?.[0]?.message?.content || '{}')
            vinTxt = vinTxt.replace(/```json/g, '').replace(/```/g, '').trim()
            // Robust JSON recovery: fix common truncation issues
            if (!vinTxt.endsWith('}')) {
              const openBrackets = (vinTxt.match(/\[/g)||[]).length - (vinTxt.match(/\]/g)||[]).length
              const openBraces = (vinTxt.match(/\{/g)||[]).length - (vinTxt.match(/\}/g)||[]).length
              vinTxt = vinTxt.replace(/,\s*"[^"]*"?\s*:?\s*[^}\]]*$/, '')
              for (let i = 0; i < openBrackets; i++) vinTxt += ']'
              for (let i = 0; i < openBraces; i++) vinTxt += '}'
              console.log('[VIN] Repaired truncated JSON')
            }
            const parsed = JSON.parse(vinTxt)
            vinData = { ...vinData, ...parsed }
            setCache(vinCk, vinData)
            console.log(`[VIN] ✓ Full decode: ${vin} → ${vinData.specificModel||'?'} | ${vinData.transmission} | ${vinData.motorCode} | ${vinData.generation} | ${vinData.trimLevel} | ${(vinData.standardEquipment||[]).length} std + ${(vinData.likelyOptions||[]).length} opts | risk: ${vinData.engineRiskProfile} | courant: ${vinData.courantScore}`)
            // Transmissie fallback als null
            if (vinData.transmission === null && vinKey) {
              try {
                const tResp = await axios.post("https://api.openai.com/v1/chat/completions", {
                  model: "gpt-5.4", temperature: 0, max_completion_tokens: 20,
                  messages: [{role:"user",content:`${s(d.merk)} ${s(d.handelsbenaming)}, Type:${rdwType}, Variant:${rdwVariant}, Bouwjaar:${year}, ${fuelLabel}, ${powerHp}pk, ${cc||"?"}cc. Automaat of Handgeschakeld? Antwoord 1 woord.`}]
                }, {headers:{"Authorization":"Bearer "+vinKey,"Content-Type":"application/json"},timeout:8000})
                const tAns = (tResp.data?.choices?.[0]?.message?.content||'').trim().toLowerCase()
                if (tAns.includes('automaat')) { vinData.transmission = 'Automaat'; console.log('[VIN] ✓ Transmissie fallback: Automaat') }
                else if (tAns.includes('handgeschakeld') || tAns.includes('handge') || tAns.includes('manueel')) { vinData.transmission = 'Handgeschakeld'; console.log('[VIN] ✓ Transmissie fallback: Handgeschakeld') }
                setCache(vinCk, vinData)
              } catch(te) { console.log('[VIN] Transmissie fallback failed:', te.message) }
            }
      } catch(ve) {
        console.error('[VIN] ✗ Decode failed:', ve.message)
      }
      return vinData
    })()

    // ═══ Wait for both parallel calls ═══
    const [_finRes, _vinRes] = await Promise.allSettled([finnikPromise, vinPromise])
    console.log('[PARALLEL] Finnik+VIN total: ' + (Date.now()-_parT0) + 'ms')

    let finnikData = _finRes.status === 'fulfilled' ? _finRes.value : null
    let finnikSource = !!finnikData
    if (finnikData && !catalogPrice && finnikData.catalogPrice) {
      catalogPrice = finnikData.catalogPrice
      console.log('[FINNIK] Nieuwprijs aangevuld:', catalogPrice)
    }

    let vinData = (_vinRes.status === 'fulfilled' && _vinRes.value)
      ? _vinRes.value
      : { transmission: null, transmissionDetail: null, motorCode: null, generation: null, trimLevel: null, drivetrain: null }

    const isAuto = vinData.transmission?.toLowerCase()?.includes('automaat') || vinData.transmission?.toLowerCase()?.includes('automatic') || false
    const transmissionType = vinData.transmission || null
    const transmissionDetail = vinData.transmissionDetail || null

    const result = {
      make:s(d.merk), model:s(d.handelsbenaming).replace(new RegExp("^" + s(d.merk) + "\\s+", "i"), ""), subModel: vinData.specificModel || vinData.marketSearchName || s(d.handelsbenaming),
      marketSearchName: vinData.marketSearchName || null, specificModel: vinData.specificModel || null,
      modelVariant:[d.type,d.variant,d.uitvoering].filter(x=>x&&String(x).trim()).map(x=>String(x).trim()).join(" ")||"",
      year, fuel:fuelLabel, km:km||parseInt(d.tellerstandoordeel_afgelezen_waarde)||0,
      color:s(d.eerste_kleur), colorSecondary:s(d.tweede_kleur), body:s(d.inrichting||b.type_carrosserie_europese_omschrijving||""),
      powerKw:powerKw||0, powerHp, engineLabel, catalogPrice, cc,
      bpm:parseFloat(d.bruto_bpm)||0, weightKg:n(d.massa_rijklaar)||n(d.massa_ledig_voertuig)||0,
      transmissionAuto:isAuto, transmissionType, transmissionDetail,
      vin, motorCode: vinData.motorCode || null, generation: vinData.generation || null,
      trimLevel: vinData.trimLevel || null, drivetrain: vinData.drivetrain || null,
      gearCount: vinData.gearCount || null,
      // Blok 1: Uitgebreide technische specs
      cylinders: vinData.cylinders || null, turbo: vinData.turbo || null,
      timingType: vinData.timingType || null, timingReplace: vinData.timingReplace || null,
      tireSize: vinData.tireSize || null, wheelSize: vinData.wheelSize || null,
      // Blok 1: Uitrusting & opties
      standardEquipment: vinData.standardEquipment || [], likelyOptions: vinData.likelyOptions || [],
      optionPackage: vinData.optionPackage || null, interior: vinData.interior || null,
      interiorColor: vinData.interiorColor || null, audioSystem: vinData.audioSystem || null,
      naviType: vinData.naviType || null, roofType: vinData.roofType || null,
      camera: vinData.camera || null, driverAssist: vinData.driverAssist || [],
      towbar: vinData.towbar || false, heatedSeats: vinData.heatedSeats || false,
      heatedSteeringWheel: vinData.heatedSteeringWheel || false,
      headlightType: vinData.headlightType || null, parkingSensors: vinData.parkingSensors || null,
      // Blok 2: Risico-analyse
      knownIssues: vinData.knownIssues || [], maintenanceAdvice: vinData.maintenanceAdvice || null,
      engineRiskProfile: vinData.engineRiskProfile || null, engineRiskDetail: vinData.engineRiskDetail || null,
      expectedMaintenanceCost: vinData.expectedMaintenanceCost || null,
      warrantyStatus: vinData.warrantyStatus || null,
      // Blok 3: Courantheid & verkoopadvies
      optionPriceImpact: vinData.optionPriceImpact || [],
      courantScore: vinData.courantScore || null, courantExplain: vinData.courantExplain || null,
      targetAudience: vinData.targetAudience || null, salesChannelAdvice: vinData.salesChannelAdvice || null,
      sellingPoints: vinData.sellingPoints || [], dealBreakers: vinData.dealBreakers || [],
      apkUntil:fmD(d.vervaldatum_apk),
      importFlag:s(d.datum_eerste_tenaamstelling_in_nederland)&&s(d.datum_eerste_toelating)&&s(d.datum_eerste_tenaamstelling_in_nederland)!==s(d.datum_eerste_toelating),
      stolenFlag:s(d.gestolen_indicator)==="Ja", exportFlag:s(d.export_indicator)==="Ja",
      wamInsured:s(d.wam_verzekerd)==="Ja", taxiIndicator:s(d.taxi_indicator)==="Ja",
      doors:parseInt(d.aantal_deuren)||null, seats:parseInt(d.aantal_zitplaatsen)||null,
      firstAdmission:fmD(d.datum_eerste_toelating), firstAdmissionNL:fmD(d.datum_eerste_tenaamstelling_in_nederland),
      registrationDateNL:fmD(d.datum_eerste_tenaamstelling_in_nederland),
      registrationDate:fmD(d.datum_tenaamstelling), plateStatus:s(d.tenaamstellen_mogelijk)==="Ja"?"Geldig":"Onbekend",
      topSpeed:n(d.maximum_snelheid), towWeight:n(d.maximum_massa_samenstelling||d.aanhangwagen_geremd),
      vehicleType:s(d.voertuigsoort), isHybrid, isPureEV,
      co2:n(fP.co2_uitstoot_gecombineerd||c.co2_uitstoot_gecombineerd),
      euroClass:s(fP.euroklasse||d.euroklasse||c.euroklasse),
      fuelConsumption:n(fP.brandstofverbruik_gecombineerd||c.brandstofverbruik_gecombineerd||fP.brandstofverbruik_gecombineerd_wltp||c.brandstofverbruik_gecombineerd_wltp),
      fuelConsumptionCity:n(fP.brandstofverbruik_stad||c.brandstofverbruik_stad||fP.brandstofverbruik_stad_wltp||c.brandstofverbruik_stad_wltp),
      fuelConsumptionHighway:n(fP.brandstofverbruik_buitenweg||c.brandstofverbruik_buitenweg||fP.brandstofverbruik_buitenweg_wltp||c.brandstofverbruik_buitenweg_wltp),
      mrb:(n(d.belasting_kwartaal_minimum)||n(d.belasting_kwartaal_maximum))?Math.round((n(d.belasting_kwartaal_minimum)||n(d.belasting_kwartaal_maximum))*4):undefined,
      taxQuarterMin:n(d.belasting_kwartaal_minimum), taxQuarterMax:n(d.belasting_kwartaal_maximum),
      lengthMm:n(b.lengte_voertuig||d.lengte), widthMm:n(b.breedte_voertuig||d.breedte),
      wheelbase:n(d.wielbasis), electricRange:n((fE||fP).actie_radius_enkel_elektrisch_wltp),
      // History data
      apkHistory, kmHistory:kmDed, kmAnalysis, recalls, defects, installedObjects,
      inspectionCount:meldA.length||undefined,
      equipmentLevel:"", source:{rdw:true,finnik:finnikSource,as24:false,anwb:false},
      finnikData: finnikData || null,
      as24Waarde: null,
      anwbWaarde: null,
      // Ownership
      ownerCount, ownerHistory: ownerHistory.slice(0,10), lastOwnerType, isExDealer,
      // Milieu
      emissieKlasse: emissieKlasse || null, roetFilter: roetFilter || null,
      // BPM rest (calculated)
      bpmRest, bpmRestPct, bpmNieuw,
      // Finnik extra
      bijtelling: finnikData?.bijtelling || null,
      nettoBijtelling: finnikData?.nettoBijtelling || null,
      wegenbelasting: finnikData?.wegenbelasting || null,
      energielabel: finnikData?.energielabel || null,
      // Extra RDW data
      handelsbenaming: handelsbenaming || null,
      verbruik: verbruikGecomb > 0 ? { gecombineerd: verbruikGecomb, stad: verbruikStad || null, snelweg: verbruikSnelweg || null } : null,
      actieradius: actieradius || null,
      typegoedkeuringNr: typegoedkeuringNr || null,
      euVariant: euVariant || null,
      typeApproval: s(d.typegoedkeuringsnummer),
      typeVariant: s(d.type), typeVersion: s(d.variant), typeUitvoering: s(d.uitvoering)
    }
    
    // GPT pricing + market call verwijderd (frontend doet dit al via /api/dealer/price)

    
    setCache(ck, result)
    enrichCache.set(plate, result)
    // Sla statische data op in DB voor volgende keer
    if (!_useDbCache) {
      try {
        const _sRdw = JSON.stringify({ mainA, catA, bodyA, fuelA, objectA, handelsA, brandstofSpecA, typeA, oviA })
        const _sGpt = vinData ? JSON.stringify(vinData) : null
        const _sFin = finnikData ? JSON.stringify(finnikData) : null
        run("INSERT OR REPLACE INTO vehicle_cache (kenteken, static_data, gpt_data, finnik_data, created_at) VALUES (?, ?, ?, ?, datetime('now'))", [plate, _sRdw, _sGpt, _sFin])
        console.log('[VEHICLE] Saved to DB cache:', plate)
      } catch(ce) { console.log('[VEHICLE] DB cache save error:', ce.message) }
    }
    res.json(result)
  } catch(e){ console.error("[API] vehicle/enriched error:",e.message); res.status(500).json({error:"RDW ophalen mislukt: "+e.message}) }
})


/* ── Vehicle Image (catalog photo) ────────── */

router.get("/api/known-issues", async (req,res)=>{
  const mk=(req.query.make||"").toLowerCase().trim()
  const ml=(req.query.model||"").toLowerCase().trim()
  const yr=parseInt(req.query.year)||0
  if(!mk||!ml)return res.json({issues:[],source:""})

  const ck=`issues|${mk}|${ml}|${yr}`
  const cc=getCached(ck,86400000) // cache 24h
  if(cc)return res.json(cc)

  const issues=[]
  let source=""

  // Clean model: strip make prefix if present
  let mlClean=ml
  if(mlClean.startsWith(mk+" "))mlClean=mlClean.slice(mk.length+1).trim()

  try{
    // Source 1: AutoCup.nl - structured known issues per model
    const autocupUrl=`https://autocup.nl/zwakke-punten-bekende-problemen/${mk}-${mlClean.replace(/\s+/g,"-")}/`
    const acHtml=await safeFetch(autocupUrl)
    if(acHtml){
      const $=cheerio.load(acHtml)
      // Extract issue paragraphs
      $("h2, h3").each((_,el)=>{
        const heading=$(el).text().trim().toLowerCase()
        if(heading.includes("probleem")||heading.includes("aandachtspunt")||heading.includes("zwak")||heading.includes("gebrek")||heading.includes("motor")||heading.includes("transmissie")||heading.includes("elektr")||heading.includes("roest")||heading.includes("ophang")||heading.includes("koppeling")){
          const headText=$(el).text().trim()
          let desc=""
          let next=$(el).next()
          for(let i=0;i<3&&next.length;i++){
            if(next.is("p")||next.is("ul")||next.is("li")){
              const t=next.text().trim()
              if(t.length>20&&t.length<500) desc+=(desc?" ":"")+t
            }
            if(next.is("h2")||next.is("h3"))break
            next=next.next()
          }
          if(desc&&desc.length>30) issues.push({category:headText,text:desc.slice(0,300)})
        }
      })
      if(issues.length) source="AutoCup.nl"
    }
  }catch{}

  // Source 2: Autoblog.nl aankoopadvies via Google
  if(issues.length<3){
    try{
      const gUrl=`https://www.google.nl/search?q=${encodeURIComponent(mk+" "+mlClean+" aandachtspunten bekende problemen site:autoblog.nl")}&num=3`
      const gHtml=await safeFetch(gUrl)
      if(gHtml){
        const $g=cheerio.load(gHtml)
        const links=[]
        $g("a").each((_,el)=>{
          const h=$g(el).attr("href")||""
          const m=h.match(/url\?q=(https:\/\/www\.autoblog\.nl[^&]+)/)
          if(m&&m[1]&&m[1].includes("aankoopadvies"))links.push(m[1])
        })
        for(const link of links.slice(0,1)){
          const abHtml=await safeFetch(link)
          if(abHtml){
            const $a=cheerio.load(abHtml)
            // Autoblog puts aandachtspunten in the article body
            let capturing=false
            $a("h2, h3, p, li").each((_,el)=>{
              const t=$a(el).text().trim()
              const tl=t.toLowerCase()
              if($a(el).is("h2")||$a(el).is("h3")){
                if(tl.includes("aandachtspunt"))capturing=true
                else if(capturing&&(tl.includes("verdict")||tl.includes("conclus")||tl.includes("uitvoering")||tl.includes("motoren")))capturing=false
              }
              if(capturing&&($a(el).is("p")||$a(el).is("li"))&&t.length>40&&t.length<500){
                issues.push({category:"Autoblog",text:t.slice(0,300)})
              }
            })
            if(!source&&issues.length)source="Autoblog.nl"
          }
        }
      }
    }catch{}
  }

  // Source 3: ANWB auto review
  if(issues.length<2){
    try{
      const anwbUrl=`https://www.google.nl/search?q=${encodeURIComponent(mk+" "+mlClean+" bevindingen wegenwacht problemen site:anwb.nl")}&num=3`
      const anwbHtml=await safeFetch(anwbUrl)
      if(anwbHtml){
        const $n=cheerio.load(anwbHtml)
        const anwbLinks=[]
        $n("a").each((_,el)=>{
          const h=$n(el).attr("href")||""
          const m=h.match(/url\?q=(https:\/\/www\.anwb\.nl\/auto\/tests\/auto-reviews[^&]+)/)
          if(m&&m[1])anwbLinks.push(m[1])
          const m2=h.match(/url\?q=(https:\/\/(www\.)?anwb\.nl\/experts\/auto[^&]+)/)
          if(m2&&m2[1])anwbLinks.push(m2[1])
        })
        for(const link of anwbLinks.slice(0,1)){
          const arHtml=await safeFetch(link)
          if(arHtml){
            const $r=cheerio.load(arHtml)
            $r("p").each((_,el)=>{
              const t=$r(el).text().trim()
              const tl=t.toLowerCase()
              if(t.length>60&&t.length<500&&(tl.includes("wegenwacht")||tl.includes("probleem")||tl.includes("aandacht")||tl.includes("defect")||tl.includes("kapot")||tl.includes("slijt"))){
                issues.push({category:"ANWB Wegenwacht",text:t.slice(0,300)})
              }
            })
            if(!source)source="ANWB.nl"
          }
        }
      }
    }catch{}
  }

  // Deduplicate similar issues
  const seen=new Set()
  const unique=[]
  for(const iss of issues){
    const key=iss.text.slice(0,60).toLowerCase()
    if(!seen.has(key)){seen.add(key);unique.push(iss)}
  }

  const result={issues:unique.slice(0,8),source,model:`${mk} ${mlClean}`,year:yr}
  if(unique.length>0)setCache(ck,result)
  res.json(result)
})

// SPA fallback — serve app index.html for all /app/ routes


module.exports = router
