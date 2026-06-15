// T4C Scanner Routes
const express = require("express")
const router = express.Router()
const fs = require("fs")
const path = require("path")
const axios = require("axios")
const { stmts, queryAll, queryOne, run, DATA_DIR } = require("../db")
const { authMiddleware, staffOnly } = require("../lib/auth")
const { getApiKey } = require("../lib/ai")
const { writeLog } = require("../lib/state")

// Photo validation
// ═══ AI Photo Validation — Quick check if photo is valid for scan step ═══
router.post("/api/ai/validate-photo", authMiddleware, express.json({ limit: "5mb" }), async (req, res) => {
  try {
    const { image, expected_angle, step } = req.body
    if (!image) return res.json({ ok: true, valid: true, message: "Geen foto" })
    
    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey) return res.json({ ok: true, valid: true, message: "Geaccepteerd (geen AI)" })
    
    const resp = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-5.4",
      max_completion_tokens: 100,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Is dit een foto van een auto/voertuig? Verwachte hoek: " + (expected_angle || "onbekend") + ". Antwoord ALLEEN in JSON: {valid: true/false, message: \"kort waarom\"}" },
          { type: "image_url", image_url: { url: image.startsWith("data:") ? image : "data:image/jpeg;base64," + image, detail: "low" } }
        ]
      }]
    }, {
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      timeout: 8000
    })
    
    const text = resp.data?.choices?.[0]?.message?.content || ""
    try {
      const clean = text.replace(/```json|```/g, "").trim()
      const parsed = JSON.parse(clean)
      return res.json({ ok: true, valid: parsed.valid !== false, message: parsed.message || "OK" })
    } catch {
      // If AI response isn't JSON, accept the photo
      return res.json({ ok: true, valid: true, message: "Geaccepteerd" })
    }
  } catch(e) {
    // On any error, accept the photo (don't block the user)
    return res.json({ ok: true, valid: true, message: "Geaccepteerd" })
  }
})


/* ═══════════════════════════════════════════════
   PUBLIC REGISTRATION + CONTACT (verkoop pagina)
   ═══════════════════════════════════════════════ */

// Analyze damage
router.post("/api/analyze-damage", authMiddleware, async (req, res) => {
  try {
    const { images, frames, plate, kenteken } = req.body
    const src = frames || images
    if (!src || !src.length) return res.status(400).json({ error: "No images" })
    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey) return res.status(500).json({ error: "No OpenAI key" })

    const imageContent = src.slice(0, 8).map(img => {
      const url = img.image || img.url || ""
      return { type: "image_url", image_url: { url: url.startsWith("data:") ? url : `data:image/jpeg;base64,${url}`, detail: "high" } }
    })

    const systemPrompt = `Je bent een professionele automotive schade-expert die auto foto's analyseert. Je MOET ALTIJD antwoorden met ALLEEN valide JSON — geen uitleg, geen excuses, geen tekst buiten de JSON. Als je de foto's niet goed kunt zien, geef dan je beste schatting op basis van wat je ziet. Als er geen schade zichtbaar is, geef een leeg damages array met hoge scores. NOOIT weigeren, ALTIJD JSON teruggeven.`

    const userPrompt = `Analyseer deze ${(src||[]).length} foto's van een auto (kenteken: ${plate || "onbekend"}) gefotografeerd vanuit deze hoeken: ${(images||[]).map(i => i.name).join(", ")}.

Per zichtbare schade, geef:
- zone: een van motorkap, voorruit, dak, achterruit, kofferbak, voorbumper, achterbumper, links_voor, links_achter, rechts_voor, rechts_achter, deur_links, deur_rechts, velg_lv, velg_rv, velg_la, velg_ra, interieur, motor
- type: een van kras, deuk, lakschade, roest, bumper, ruit, spiegel, velg, interieur
- severity: licht, gemiddeld of ernstig
- cost: geschatte herstelkosten in EUR (Nederlandse marktprijzen)
- description: korte beschrijving in het Nederlands

Antwoord ALLEEN met deze JSON structuur:
{"damages":[{"zone":"...","type":"...","severity":"licht","cost":0,"description":"..."}],"overall_score":8,"paint_score":7,"body_score":8,"total_cost":0,"summary":"Korte samenvatting"}`

    // Try up to 2 times
    let result = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-5.4",
          max_completion_tokens: 2000,
          temperature: 0.3,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: [{ type: "text", text: userPrompt }, ...imageContent] }
          ]
        }, { headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 90000 })

        const text = resp.data?.choices?.[0]?.message?.content || ""
        console.log(`[DAMAGE] GPT raw (attempt ${attempt+1}): ${text.substring(0, 200)}...`)

        // Extract JSON from response (handle markdown fences, leading text, etc.)
        let jsonStr = text.replace(/```json|```/g, "").trim()
        const jsonStart = jsonStr.indexOf("{")
        const jsonEnd = jsonStr.lastIndexOf("}")
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1)
        }

        result = JSON.parse(jsonStr)
        break // Success
      } catch (parseErr) {
        console.log(`[DAMAGE] Attempt ${attempt+1} failed: ${parseErr.message}`)
        if (attempt === 1) throw parseErr // Give up after 2nd attempt
      }
    }

    if (!result) throw new Error("Kon GPT response niet parsen na 2 pogingen")

    // Ensure required fields
    result.damages = Array.isArray(result.damages) ? result.damages : []
    result.overall_score = Number(result.overall_score) || 7
    result.paint_score = Number(result.paint_score) || 7
    result.body_score = Number(result.body_score) || 7
    result.total_cost = Number(result.total_cost) || result.damages.reduce((s, d) => s + (Number(d.cost) || 0), 0)
    result.summary = result.summary || "Analyse voltooid"

    // Map zones to SVG coordinates
    const zoneCoords = {
      motorkap: {x:200,y:65}, voorruit: {x:200,y:145}, dak: {x:200,y:270},
      achterruit: {x:200,y:550}, kofferbak: {x:200,y:635}, voorbumper: {x:200,y:40},
      achterbumper: {x:200,y:660}, links_voor: {x:100,y:165}, links_achter: {x:100,y:475},
      rechts_voor: {x:300,y:165}, rechts_achter: {x:300,y:475}, deur_links: {x:100,y:315},
      deur_rechts: {x:300,y:315}
    }
    result.damages = result.damages.map(d => ({
      ...d, sev: d.severity,
      x: zoneCoords[d.zone]?.x || 200,
      y: zoneCoords[d.zone]?.y || 350
    }))

    console.log(`[DAMAGE] Analyzed ${(src||[]).length} photos for ${plate}: ${result.damages.length} damages found, total €${result.total_cost}`)
    res.json({ ok: true, ...result })
  } catch(e) {
    console.error("[DAMAGE] Error:", e.response?.data?.error?.message || e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── Auto-save search history when plate is looked up ──

// ── POST /api/inspecties — Save scan report ──

// Save inspection
router.post("/api/inspecties", authMiddleware, async (req, res) => {
  try {
    const { kenteken, overall_score, paint_score, body_score, total_cost,
            damages, summary, photos, gpt_raw, frames_captured, scan_duration } = req.body
    const result = run(
      `INSERT INTO inspecties (kenteken, user_id, overall_score, paint_score, body_score,
        total_cost, damages, summary, photos, gpt_raw, frames_captured, scan_duration, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'completed')`,
      [kenteken, req.user?.userId||1, overall_score||0, paint_score||0, body_score||0,
       total_cost||0, typeof damages==='string'?damages:JSON.stringify(damages||[]),
       summary||'', typeof photos==='string'?photos:JSON.stringify(photos||[]),
       typeof gpt_raw==='string'?gpt_raw:JSON.stringify(gpt_raw||{}),
       frames_captured||0, scan_duration||0]
    )
    res.json({ success: true, id: result.lastInsertRowid })
  } catch(e) { res.status(500).json({ success: false, error: e.message }) }
})

// ── SCAN PHOTO STORAGE — Save/retrieve 8 scan photos per kenteken ──
const SCAN_PHOTOS_DIR = path.join(DATA_DIR, "photos", "scans")
if (!fs.existsSync(SCAN_PHOTOS_DIR)) fs.mkdirSync(SCAN_PHOTOS_DIR, { recursive: true })

// Scan photo storage
router.post("/api/scan-photos/:kenteken", authMiddleware, express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const plate = req.params.kenteken.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    if (!plate) return res.status(400).json({ ok: false, error: "Geen kenteken" })
    const { photos } = req.body
    if (!photos || !photos.length) return res.status(400).json({ ok: false, error: "Geen foto's" })

    const plateDir = path.join(SCAN_PHOTOS_DIR, plate)
    if (!fs.existsSync(plateDir)) fs.mkdirSync(plateDir, { recursive: true })

    const saved = []
    for (const p of photos) {
      const name = (p.angle || p.name || "photo").replace(/[^a-zA-Z0-9_-]/g, "")
      const filename = `scan_${name}.jpg`
      const filepath = path.join(plateDir, filename)
      const base64 = (p.image || "").replace(/^data:image\/\w+;base64,/, "")
      if (base64.length > 100) {
        fs.writeFileSync(filepath, Buffer.from(base64, "base64"))
        saved.push({ name: p.name, angle: p.angle, filename, url: `/photos/scans/${plate}/${filename}` })
      }
    }

    console.log(`[SCAN] Saved ${saved.length} photos for ${plate}`)
    res.json({ ok: true, saved, count: saved.length })
  } catch (e) {
    console.error("[SCAN] Photo save error:", e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

router.get("/api/scan-photos/:kenteken", (req, res) => {
  try {
    const plate = req.params.kenteken.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
    const plateDir = path.join(SCAN_PHOTOS_DIR, plate)
    if (!fs.existsSync(plateDir)) return res.json({ ok: true, photos: [] })
    const files = fs.readdirSync(plateDir).filter(f => f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".png")).sort()
    const photos = files.map(f => ({
      filename: f,
      url: `/photos/scans/${plate}/${f}`,
      angle: f.replace("scan_", "").replace(/\.\w+$/, "")
    }))
    res.json({ ok: true, photos, count: photos.length })
  } catch (e) { res.json({ ok: true, photos: [] }) }
})

// Serve scan photos
router.use("/photos/scans", express.static(SCAN_PHOTOS_DIR))

// ── Create voorraad entry from scan data ──
router.post("/api/voorraad/from-scan", authMiddleware, express.json(), async (req, res) => {
  try {
    const { kenteken, vraag_prijs, beschrijving } = req.body
    if (!kenteken) return res.status(400).json({ ok: false, error: "Geen kenteken" })
    const plate = kenteken.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()

    // Get RDW data if we have a taxatie
    const tax = queryOne("SELECT * FROM taxaties WHERE REPLACE(UPPER(kenteken),'-','') = ? ORDER BY created_at DESC LIMIT 1", [plate])

    const d = {
      kenteken: tax?.kenteken || plate,
      make: tax?.make || '', model: tax?.model || '', model_variant: tax?.model_variant || '',
      year: tax?.year || 0, fuel: tax?.fuel || '', km: tax?.km || 0,
      color: tax?.color || '', body: tax?.body || '',
      power_kw: tax?.power_kw || 0, power_hp: tax?.power_hp || 0,
      engine_label: tax?.engine_label || '', transmission: tax?.transmission || '',
      doors: 0, seats: 0,
      vraag_prijs: vraag_prijs || tax?.verkoopadviees || tax?.internet_prijs || 0,
      beschrijving: beschrijving || '', highlights: '',
      apk_until: tax?.apk_until || '', vin: tax?.vin || '',
      status: 'te_koop', featured: 0
    }

    stmts.addVoorraad.run(d)
    const newCar = queryOne("SELECT id FROM voorraad ORDER BY id DESC LIMIT 1")
    const carId = newCar?.id

    // Link scan photos to voorraad
    if (carId) {
      const plateDir = path.join(SCAN_PHOTOS_DIR, plate)
      if (fs.existsSync(plateDir)) {
        const files = fs.readdirSync(plateDir).filter(f => f.endsWith(".jpg")).sort()
        for (let i = 0; i < files.length; i++) {
          const src = path.join(plateDir, files[i])
          const dest = path.join(PHOTOS_DIR, `car-${carId}-scan-${i}.jpg`)
          fs.copyFileSync(src, dest)
          stmts.addCarPhoto.run(carId, `car-${carId}-scan-${i}.jpg`, i, i === 0 ? 1 : 0)
        }
        console.log(`[SCAN] Linked ${files.length} photos to voorraad #${carId} (${plate})`)
      }
    }

    res.json({ ok: true, id: carId, kenteken: d.kenteken })
  } catch (e) {
    console.error("[SCAN] Voorraad from scan error:", e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ── POST /api/analyze-audio — Motor sound analysis ──

// Audio analysis
router.post("/api/analyze-audio", authMiddleware, async (req, res) => {
  try {
    const { audio, kenteken } = req.body
    if (!audio) return res.status(400).json({ error: "No audio" })
    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey) return res.status(500).json({ error: "No OpenAI key" })
    const { default: OpenAI } = await import('openai')
    const openai = new OpenAI({ apiKey })
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-audio-preview",
      messages: [{
        role: "user",
        content: `Analyseer dit motorgeluid van een auto (kenteken: ${kenteken||'onbekend'}). 
        Beschrijf in het Nederlands: 1) Is het geluid normaal? 2) Zijn er afwijkingen? 
        3) Mogelijke oorzaak? 4) Urgentie (laag/gemiddeld/hoog)? 
        Geef een korte professionele analyse in max 3 zinnen.`
      }]
    })
    res.json({ success: true, result: completion.choices[0].message.content })
  } catch(e) {
    // Fallback — audio preview not available
    res.json({ success: true, result: 'Motorgeluid analyse niet beschikbaar. Controleer of de motor normaal klinkt zonder ongebruikelijke geluiden.' })
  }
})


module.exports = router
