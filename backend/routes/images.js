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

router.post("/api/generate-car-images", express.json(), async (req, res) => {
  try {
    const { make, model, year, color, colorSecondary, body, plate, variant, generation, subModel, trimLevel } = req.body
    if (!make || !model) return res.status(400).json({ error: "make + model vereist" })

    const apiKey = getApiKey("OPENAI_API_KEY")
    if (!apiKey || apiKey === "sk-...") return res.status(500).json({ error: "OpenAI API key niet geconfigureerd" })

    // Create plate-based folder for caching
    const plateClean = (plate || "AUTO").replace(/[^A-Z0-9]/gi, "").toUpperCase() || "UNKNOWN"
    const cacheDir = path.join(GENERATED_DIR, plateClean)

    // Check cache — if all 5 exist, return immediately
    const angles = ["1-front", "2-front-right", "3-right", "4-rear", "5-left"]
    const cached = angles.every(a => fs.existsSync(path.join(cacheDir, a + ".png")))
    if (cached) {
      console.log(`[DALL-E] Cache hit for ${plateClean}`)
      return res.json({
        ok: true, cached: true,
        images: angles.map(a => ({ angle: a, url: `/photos/generated/${plateClean}/${a}.png` }))
      })
    }

    // Build the car description
    const colorEn = COLOR_MAP[(color || "").toUpperCase()] || (color || "grey").toLowerCase()
    const colorDesc = (colorSecondary && colorSecondary !== "Niet geregistreerd") ? `${colorEn} with ${COLOR_MAP[(colorSecondary||"").toUpperCase()]||colorSecondary.toLowerCase()} accents` : `${colorEn} metallic`
    const bodyEn = BODY_MAP[(body || "").toLowerCase()] || (body || "hatchback").toLowerCase()
    const cleanSub = (subModel && model && !subModel.toLowerCase().includes(model.toLowerCase().split(" ")[0])) ? "" : subModel
    const trimInfo = [variant, generation, cleanSub, trimLevel].filter(Boolean).join(" ")
    const carDesc = `${year || 2020} ${make} ${model}${trimInfo ? " " + trimInfo : ""}, ${bodyEn}, ${colorDesc}`

    // 5 turntable angles — include plate text so DALL-E picks the right model, UI overlay corrects the text
    const plateText = plate || "XX-999-X"
    const studioBg = "on a round dark showroom turntable platform. Clean neutral grey studio background with soft even lighting and subtle reflections on a polished dark floor. Professional car dealership photography, ultra sharp focus, 8K quality. Small subtle watermark text EXAMPLE IMAGE in bottom left corner."
    const prompts = [
      { angle: "1-front",          prompt: `Photorealistic studio photograph of a ${carDesc}. Straight-on front view, camera at bumper height, showing the full front face symmetrically. Dutch yellow license plate reading "${plateText}" on the front bumper. Car is placed ${studioBg}` },
      { angle: "2-front-right",  prompt: `Photorealistic studio photograph of a ${carDesc}. Classic right front 3/4 view from passenger side, camera 30 degrees to the right, showing front grille and entire right flank. Hero dealership angle. Car is placed ${studioBg}` },
      { angle: "3-right",       prompt: `Photorealistic studio photograph of a ${carDesc}. Full right side profile view, perfectly level, showing the entire passenger side of the car from wheel to wheel. Car is placed ${studioBg}` },
      { angle: "4-rear",        prompt: `Photorealistic studio photograph of a ${carDesc}. Rear 3/4 view from behind-left, showing the full rear and left side. Dutch yellow license plate reading "${plateText}" on rear bumper. Car is placed ${studioBg}` },
      { angle: "5-left",          prompt: `Photorealistic studio photograph of a ${carDesc}. Left rear 3/4 view from driver side, camera 30 degrees to the left-rear, showing rear and entire left flank. Car is placed ${studioBg}` }
    ]

    console.log(`[DALL-E] Generating 4 images for ${make} ${model} (${plateClean})...`)

    // Create cache dir
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })

    // Call DALL-E 3 for all 4 angles in parallel
    const results = await Promise.allSettled(prompts.map(async ({ angle, prompt }) => {
      try {
        const dalleResp = await axios.post("https://api.openai.com/v1/images/generations", {
          model: "gpt-image-1.5",
          prompt,
          n: 1,
          size: "1536x1024",
          quality: "medium",
          
        }, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          timeout: 120000 // 2 min per image
        })

        const imgB64 = dalleResp.data?.data?.[0]?.b64_json || dalleResp.data?.data?.[0]?.url
        if (!imgB64) throw new Error("No image data")
        const savePath = path.join(cacheDir, angle + ".png")
        if (imgB64.startsWith("http")) { const dl = await axios.get(imgB64,{responseType:"arraybuffer",timeout:30000}); fs.writeFileSync(savePath, dl.data) }
        else { fs.writeFileSync(savePath, Buffer.from(imgB64, "base64")) }

        console.log(`[DALL-E] ✓ ${angle} saved for ${plateClean}`)
        return { angle, url: `/photos/generated/${plateClean}/${angle}.png` }
      } catch (err) {
        console.error(`[DALL-E] ✗ ${angle} failed:`, err.response?.data?.error?.message || err.message)
        return { angle, url: "", error: err.response?.data?.error?.message || err.message }
      }
    }))

    const images = results.map(r => r.status === "fulfilled" ? r.value : { angle: "?", url: "", error: "Failed" })
    const successCount = images.filter(i => i.url).length

    console.log(`[DALL-E] Done: ${successCount}/4 images generated for ${plateClean}`)
    res.json({ ok: true, cached: false, generated: successCount, images })

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
  const angles = ["1-front", "2-front-right", "3-right", "4-rear", "5-left"]
  const images = angles.map(a => {
    const exists = fs.existsSync(path.join(cacheDir, a + ".png"))
    return { angle: a, url: exists ? `/photos/generated/${plateClean}/${a}.png` : "" }
  }).filter(i => i.url)
  res.json({ ok: images.length > 0, images })
})

/* ═══════════════════════════════════════════════
   DEALER PRICE (server-side pricing engine)
   ═══════════════════════════════════════════════ */


module.exports = router
