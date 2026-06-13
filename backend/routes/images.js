// routes/images.js — /api/image, /api/generate-car-images, /api/car-images
const router = require("express").Router()
const express = require("express")
const axios = require("axios")
const fs = require("fs")
const path = require("path")
const { stmts, queryAll, queryOne, run, DATA_DIR } = require("../db")
const { getCached, setCache, safeFetch, ua, TIMEOUT } = require("../lib/helpers")

const COLOR_MAP = {
  ZWART:"black",GRIJS:"grey",WIT:"white",BLAUW:"dark blue",ROOD:"red",GROEN:"green",
  GEEL:"yellow",BRUIN:"brown",ORANJE:"orange",PAARS:"purple",BEIGE:"beige",CREME:"cream",
  ZILVER:"silver",ANTRACIET:"anthracite grey",DIVERSEN:"dark grey",
  "LICHT BLAUW":"light blue","DONKER BLAUW":"dark blue","LICHT GRIJS":"light grey",
  "DONKER GRIJS":"dark grey","DONKER ROOD":"dark red","LICHT GROEN":"light green"
}
const BODY_MAP = {
  hatchback:"hatchback",sedan:"sedan",stationwagen:"station wagon",suv:"SUV",
  "sports utility vehicle":"SUV",cabriolet:"convertible",coupe:"coupe","coupé":"coupe",
  mpv:"MPV minivan",bus:"van",bedrijfswagen:"van",bestelwagen:"cargo van",
  "open terreinwagen":"open-top SUV",terreinwagen:"off-road SUV",pickup:"pickup truck"
}

const { getApiKey, hasApiKey } = require("../lib/ai")
const { authMiddleware, staffOnly } = require("../lib/auth")
const { writeLog } = require("../lib/state")

const GENERATED_DIR = path.join(DATA_DIR, "photos", "generated")
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true })

router.get("/api/image", async (req, res) => {
  const make = (req.query.make || "").trim()
  const model = (req.query.model || "").trim()
  const year = parseInt(req.query.year) || 0
  const variant = (req.query.variant || "").trim()
  const generation = (req.query.generation || "").trim()
  if (!make || !model) return res.json({ url: "" })

  // Clean model name: remove make prefix, trim generation codes
  const cleanModel = model.replace(new RegExp("^" + make + "\\s+", "i"), "").trim()
  const modelBase = cleanModel.split(/\s+/)[0] // First word only: "AYGO" from "AYGO X-PLAY"
  const genTag = generation || "" // e.g. "F30", "W205", "8Y"

  const ck = "img_" + make + "_" + cleanModel + "_" + year + "_" + genTag
  const cached = getCached(ck, 86400000 * 7) // 7 day cache
  if (cached) return res.json(cached)

  const ua = { "User-Agent": "CarDatax/2.0 (automotive-data-platform)" }
  const ok = (url) => { const r = { url, source: "auto" }; setCache(ck, r); return res.json(r) }

  try {
    // Determine generation for Wikipedia search
    // Most cars have 5-8 year generation cycles
    const genStart = Math.floor(year / 7) * 7 // approximate generation grouping

    // Map model to Wikipedia series name (320i → 3 Series, A4 → Audi A4, C200 → C-Class)
    const seriesName = (() => {
      const ml = modelBase.toLowerCase()
      if (make === 'BMW') {
        if (/^[1-8]\d{2}/i.test(ml)) return make + ' ' + ml[0] + ' Series'
        if (/^x[1-7]/i.test(ml)) return make + ' ' + ml.toUpperCase().slice(0,2)
        if (/^z[1-4]/i.test(ml)) return make + ' ' + ml.toUpperCase().slice(0,2)
        if (/^m[1-8]/i.test(ml)) return make + ' ' + ml.toUpperCase()
      }
      if (make === 'MERCEDES-BENZ' || make === 'MERCEDES') {
        if (/^[a-c]\s?\d/i.test(ml)) return 'Mercedes-Benz ' + ml[0].toUpperCase() + '-Class'
        if (/^[e-s]\s?\d/i.test(ml)) return 'Mercedes-Benz ' + ml[0].toUpperCase() + '-Class'
        if (/^gl[a-s]/i.test(ml)) return 'Mercedes-Benz ' + ml.toUpperCase().slice(0,3)
      }
      return null
    })()

    // ── Strategy 1: Wikipedia NL ──
    const nlSearches = [
      genTag && seriesName ? `${seriesName} (${genTag})` : null,
      genTag ? `${make} ${modelBase} (${genTag})` : null,
      seriesName || null,
      `${make} ${modelBase}`,
    ].filter(Boolean)
    for (const q of nlSearches) {
      try {
        const url = `https://nl.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(q)}&prop=pageimages&format=json&pithumbsize=800&redirects=1`
        const r = await axios.get(url, { timeout: 4000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          if (p.thumbnail?.source && p.thumbnail.width > 200) return ok(p.thumbnail.source)
        }
      } catch {}
    }

    // ── Strategy 2: Wikipedia EN with series names ──
    const enSearches = [
      genTag && seriesName ? `${seriesName} (${genTag})` : null,
      genTag ? `${make} ${genTag}` : null,
      seriesName || null,
      `${make} ${modelBase}`,
      `${make} ${modelBase} (car)`,
    ].filter(Boolean)
    for (const q of enSearches) {
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(q)}&prop=pageimages&format=json&pithumbsize=800&redirects=1`
        const r = await axios.get(url, { timeout: 4000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          // Filter: must be wider than tall (landscape = real car photo, not logo/icon)
          if (p.thumbnail?.source && p.thumbnail.width > 200) {
            const w = p.thumbnail.width || 0, h = p.thumbnail.height || 0
            if (w > h * 0.8) return ok(p.thumbnail.source) // at least roughly landscape
          }
        }
      } catch {}
    }

    // ── Strategy 3: Wikipedia search API (broader) ──
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(make + " " + modelBase + " car automobile")}&gsrlimit=8&prop=pageimages&format=json&pithumbsize=800`
      const r = await axios.get(searchUrl, { timeout: 5000, headers: ua })
      const pages = r.data?.query?.pages || {}
      // Score pages by relevance
      const candidates = Object.values(pages).filter(p => p.thumbnail?.source && p.thumbnail.width > 200)
      // Prefer pages whose title contains the model name
      const best = candidates.find(p => p.title?.toLowerCase().includes(modelBase.toLowerCase())) || candidates[0]
      if (best) return ok(best.thumbnail.source)
    } catch {}

    // ── Strategy 4: Wikimedia Commons (largest free image library) ──
    const commonsSearches = [
      `${make} ${modelBase} ${genTag || year}`,
      `${make} ${modelBase}`,
      `${make} ${cleanModel} automobile`,
    ]
    for (const q of commonsSearches) {
      try {
        const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=8&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=800&format=json`
        const r = await axios.get(url, { timeout: 5000, headers: ua })
        const pages = r.data?.query?.pages || {}
        for (const p of Object.values(pages)) {
          const ii = p.imageinfo?.[0]
          if (!ii) continue
          // Filter: must be JPEG/PNG, landscape, decent size
          const mime = ii.mime || ""
          if (!mime.includes("jpeg") && !mime.includes("png")) continue
          const w = ii.width || 0, h = ii.height || 0
          if (w < 400 || h < 200) continue
          if (w < h) continue // skip portrait images
          const thumbUrl = ii.thumburl || ii.url
          if (thumbUrl) return ok(thumbUrl)
        }
      } catch {}
    }

    // ── Strategy 5: Placeholder with make/model text ──
    setCache(ck, { url: "" })
    res.json({ url: "" })
  } catch { res.json({ url: "" }) }
})

/* ═══════════════════════════════════════════════
   GENERATE CAR IMAGES — DALL-E 3 (4 hoeken)
   ═══════════════════════════════════════════════ */
// GENERATED_DIR already defined above

router.use("/photos/generated", express.static(GENERATED_DIR))

router.post("/api/generate-car-images", authMiddleware, staffOnly, express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const { make, model, year, color, body, plate, referencePhotos, allAngles } = req.body
    if (!make || !model) return res.status(400).json({ error: "make + model vereist" })

    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey) return res.status(500).json({ error: "OpenAI API key niet geconfigureerd" })

    const plateClean = (plate || "AUTO").replace(/[^A-Z0-9]/gi, "").toUpperCase() || "UNKNOWN"
    const cacheDir = path.join(GENERATED_DIR, plateClean)
    const { execSync } = require("child_process")

    // === VEILING MODUS: rembg mask + gpt-image-1.5 inpainting per foto ===
    if (allAngles && referencePhotos && referencePhotos.length > 0) {
      const cacheFiles = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => /^photo-\d+\.jpg$/.test(f)) : []
      if (cacheFiles.length >= referencePhotos.length) {
        return res.json({ ok: true, cached: true, images: cacheFiles.sort().map((f, i) => ({ angle: "photo-" + (i+1), url: `/photos/generated/${plateClean}/${f}` })) })
      }

      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

      // Classificeer foto's
      const positions = req.body.photoPositions || []
      const hasPositions = positions.some(p => p && p.trim())
      let usablePhotos

      if (hasPositions) {
        // Positie-namen beschikbaar — gebruik die
        usablePhotos = referencePhotos.map((url, i) => {
          const positie = (positions[i] || "").toLowerCase()
          if (/interieur|dashboard|instrument|laadruimte|kofferbak|motorruimte|motor|stoel|navigatie|scherm/.test(positie)) return { index: i, type: "interior" }
          if (/voorzijde|achterzijde|zijde|voor|achter|links|rechts/.test(positie)) return { index: i, type: "exterior" }
          return { index: i, type: "interior" }
        })
      } else {
        // Geen positie-namen — vision classificatie
        try {
          const fR = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: [
              { type: "text", text: "Classify each car photo: \"exterior\" (outside of car visible), \"interior\" (inside car, dashboard, seats, trunk, engine, detail shots, close-ups of parts). Return ONLY JSON: [{\"index\":0,\"type\":\"exterior\"},...]" },
              ...referencePhotos.map((url, i) => ({ type: "image_url", image_url: { url, detail: "low" } }))
            ]}], max_tokens: 500, temperature: 0
          }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 30000 })
          const ft = fR.data?.choices?.[0]?.message?.content || "[]"
          const jm = ft.match(/\[.*\]/s)
          if (jm) usablePhotos = JSON.parse(jm[0])
          else usablePhotos = referencePhotos.map((_, i) => ({ index: i, type: "exterior" }))
          console.log("[VEILING] Vision classified:", usablePhotos.map(p=>p.type).join(","))
        } catch (e) {
          console.log("[VEILING] Vision failed:", e.message)
          usablePhotos = referencePhotos.map((_, i) => ({ index: i, type: "exterior" }))
        }
      }

      console.log(`[VEILING] Processing ${usablePhotos.length} photos for ${plateClean}...`)

      const boothPrompt = "Replace only the background. Do not change the car at all. Do not change the license plate. Plain white walls, grey concrete floor, overhead lighting. Nothing on the walls. Just a simple empty room."
      const interiorPrompt = "Keep this photo exactly as-is. Only very subtle color grading."

      const results = await Promise.allSettled(usablePhotos.map(async (info, idx) => {
        const refUrl = referencePhotos[info.index]
        if (!/^https?:\/\//i.test(refUrl || "")) { console.warn(`[VEILING] skip photo-${idx + 1}: geen geldige URL`); return null }
        try {
          let refResp
          for (let attempt = 1; ; attempt++) {
            try { refResp = await axios.get(refUrl, { responseType: "arraybuffer", timeout: 20000 }); break }
            catch (e) { if (attempt >= 3 || !/ECONNRESET|ETIMEDOUT|socket hang up/i.test(e.message || "")) throw e; await new Promise(r => setTimeout(r, attempt * 1000)) }
          }
          const tmpOrig = path.join(cacheDir, `_tmp_${idx}.png`)
          const tmpMask = path.join(cacheDir, `_tmp_mask_${idx}.png`)
          fs.writeFileSync(tmpOrig, refResp.data)

          const savePath = path.join(cacheDir, `photo-${idx + 1}.jpg`)

          if (info.type === "exterior") {
            // rembg mask — als het faalt, gebruik origineel
            try {
              execSync(`python3 /opt/t4c/scripts/make-mask.py "${tmpOrig}" "${tmpMask}"`, { timeout: 60000 })
            } catch (maskErr) {
              console.log(`[VEILING] Mask failed photo-${idx + 1}, using original`)
              try { execSync(`python3 -c "from PIL import Image;i=Image.open('${tmpOrig}');i.thumbnail((1200,900),Image.LANCZOS);i.convert('RGB').save('${savePath}','JPEG',quality=90)"`, { timeout: 10000 }) } catch(e) { fs.copyFileSync(tmpOrig, savePath) }
              try { fs.unlinkSync(tmpOrig) } catch(e) {}
              return { angle: `photo-${idx + 1}`, url: `/photos/generated/${plateClean}/photo-${idx + 1}.jpg`, type: "original" }
            }
          }


          if (info.type === "interior") {
            // Interior foto's: origineel behouden, NIET door GPT
            try { execSync(`python3 -c "from PIL import Image;i=Image.open('${tmpOrig}');i.thumbnail((1200,900),Image.LANCZOS);i.convert('RGB').save('${savePath}','JPEG',quality=90)"`, { timeout: 10000 }) } catch(e) { fs.copyFileSync(tmpOrig, savePath) }
          } else {
            // Exterieur: rembg mask + GPT inpainting
            const FormData = require("form-data")
            const form = new FormData()
            form.append("model", "gpt-image-1.5")
            form.append("prompt", boothPrompt)
            form.append("n", "1")
            form.append("size", "1536x1024")
            form.append("quality", "high")
            form.append("image", fs.createReadStream(tmpOrig), { filename: "orig.png", contentType: "image/png" })
            form.append("mask", fs.createReadStream(tmpMask), { filename: "mask.png", contentType: "image/png" })

            const dR = await axios.post("https://api.openai.com/v1/images/edits", form, {
              headers: { "Authorization": `Bearer ${apiKey}`, ...form.getHeaders() },
              timeout: 180000, maxContentLength: Infinity, maxBodyLength: Infinity
            })

            const b64 = dR.data?.data?.[0]?.b64_json || dR.data?.data?.[0]?.url
            if (!b64) throw new Error("No image data")
            if (b64.startsWith("http")) { const dl = await axios.get(b64, { responseType: "arraybuffer", timeout: 30000 }); fs.writeFileSync(savePath, dl.data) }
            else { fs.writeFileSync(savePath, Buffer.from(b64, "base64")) }
          }

          // Compress
          try { execSync(`python3 -c "from PIL import Image;i=Image.open('${savePath}');i.thumbnail((1200,900),Image.LANCZOS);i.convert('RGB').save('${savePath}','JPEG',quality=85)"`, { timeout: 10000 }) } catch(e) {}

          // Cleanup
          try { fs.unlinkSync(tmpOrig) } catch(e) {}
          try { fs.unlinkSync(tmpMask) } catch(e) {}

          console.log(`[VEILING] OK photo-${idx + 1} (${info.type})`)
          return { angle: `photo-${idx + 1}`, url: `/photos/generated/${plateClean}/photo-${idx + 1}.jpg`, type: info.type }
        } catch (err) {
          console.error(`[VEILING] FAIL photo-${idx + 1}:`, err.response?.data?.error?.message || err.message)
          try { fs.unlinkSync(path.join(cacheDir, `_tmp_${idx}.png`)) } catch(e) {}
          try { fs.unlinkSync(path.join(cacheDir, `_tmp_mask_${idx}.png`)) } catch(e) {}
          return { angle: `photo-${idx + 1}`, url: "", error: err.message }
        }
      }))

      const images = results.map(r => r.status === "fulfilled" ? r.value : { angle: "?", url: "", error: "Failed" })
      const ok = images.filter(i => i.url).length
      console.log(`[VEILING] Done: ${ok}/${usablePhotos.length}`)
      return res.json({ ok: true, cached: false, generated: ok, images })
    }

    // === STANDAARD: front-only text generatie ===
    const angles = ["1-front"]
    const cached = angles.every(a => fs.existsSync(path.join(cacheDir, a + ".png")))
    if (cached) return res.json({ ok: true, cached: true, images: angles.map(a => ({ angle: a, url: `/photos/generated/${plateClean}/${a}.png` })) })

    const colorEn = COLOR_MAP[(color || "").toUpperCase()] || (color || "grey").toLowerCase()
    const bodyEn = BODY_MAP[(body || "").toLowerCase()] || (body || "hatchback").toLowerCase()
    const prompt = `Photorealistic studio photo of a ${year||2020} ${make} ${model}, ${bodyEn}, ${colorEn} metallic. Front 3/4 view on dark showroom turntable. Black plate TRANSFER4CARS. Grey studio, 8K.`

    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
    const dR = await axios.post("https://api.openai.com/v1/images/generations", {
      model: "gpt-image-1.5", prompt, n: 1, size: "1536x1024", quality: "medium"
    }, { headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 120000 })
    const b64 = dR.data?.data?.[0]?.b64_json || dR.data?.data?.[0]?.url
    if (!b64) throw new Error("No image data")
    const sp = path.join(cacheDir, "1-front.png")
    if (b64.startsWith("http")) { const dl = await axios.get(b64,{responseType:"arraybuffer",timeout:30000}); fs.writeFileSync(sp, dl.data) }
    else { fs.writeFileSync(sp, Buffer.from(b64, "base64")) }
    try { execSync(`python3 -c "from PIL import Image;i=Image.open('${sp}');i.thumbnail((800,600),Image.LANCZOS);i.convert('RGB').save('${sp}','JPEG',quality=80)"`, { timeout: 10000 }) } catch(e) {}
    res.json({ ok: true, cached: false, generated: 1, images: [{ angle: "1-front", url: `/photos/generated/${plateClean}/1-front.png` }] })
  } catch (err) {
    console.error("[DALL-E] Error:", err.message)
    res.status(500).json({ error: err.message })
  }
})


// Quick check if generated images exist (no generation, just cache check)
router.get("/api/car-images/:plate", (req, res) => {
  const plateClean = (req.params.plate || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()
  if (!plateClean) return res.json({ ok: false })
  const cacheDir = path.join(GENERATED_DIR, plateClean)
  const angles = ["1-front", "2-right", "3-rear", "4-left"]
  const images = angles.map(a => {
    const exists = fs.existsSync(path.join(cacheDir, a + ".png"))
    return { angle: a, url: exists ? `/photos/generated/${plateClean}/${a}.png` : "" }
  }).filter(i => i.url)
  res.json({ ok: images.length > 0, images })
})

/* ═══════════════════════════════════════════════
   DEALER PRICE (server-side pricing engine)
   ═══════════════════════════════════════════════ */



// Veiling foto cache check
router.get("/api/veiling-photos/:plate", (req, res) => {
  const pc = (req.params.plate || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()
  if (!pc) return res.json({ ok: false })
  const dir = path.join(GENERATED_DIR, pc)
  if (!fs.existsSync(dir)) return res.json({ ok: false, photos: [] })
  const files = fs.readdirSync(dir).filter(f => /^photo-\d+\.jpg$/.test(f)).sort()
  const photos = files.map(f => ({ url: `/photos/generated/${pc}/${f}`, filename: f }))
  res.json({ ok: photos.length > 0, photos })
})

module.exports = router
