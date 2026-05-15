// routes/extended-taxatie.js — Uitgebreide taxatie met staat-correctie
// RAAKT GEEN BESTAANDE CODE AAN — volledig standalone
const router = require("express").Router()
const express = require("express")
const axios = require("axios")
const { authMiddleware } = require("../lib/auth")
const { getApiKey } = require("../lib/ai")

const CORRECTIONS = {
  lichte_schade:    { label: "Lichte schade (krasjes, velgschade)", pct: -0.05 },
  zware_schade:     { label: "Zware schade (deuken, lakschade, roest)", pct: -0.15 },
  motorprobleem:    { label: "Motorprobleem / storing", pct: -0.15 },
  waarschuwingslampje: { label: "Waarschuwingslampje brandt", pct: -0.07 },
  veel_aanbod:      { label: "Veel aanbod / overjaard model", pct: -0.07 },
  drie_deurs:       { label: "3-deurs (minder courant)", pct: -0.07 },
  kale_uitvoering:  { label: "Kale uitvoering / basis trim", pct: -0.10 },
  import_auto:      { label: "Import auto", pct: -0.05 },
  rokers_auto:      { label: "Rokers auto", pct: -0.05 },
  apk_verlopen:     { label: "APK verlopen", pct: -0.05 },
  veel_eigenaren:   { label: "Veel eigenaren (5+)", pct: -0.05 },
  ex_taxi:          { label: "Ex-taxi / ex-lease", pct: -0.10 },
}
const MAX_CORRECTION = -0.50

router.post("/api/extended-taxatie", authMiddleware, express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const { plate, km, corrections, photos } = req.body
    if (!plate) return res.status(400).json({ error: "Kenteken verplicht" })

    const token = req.headers.authorization || ""
    const t0 = Date.now()

    // === PARALLEL: basisprijs + foto-analyse tegelijk ===
    const basePromise = axios.post("http://localhost:3000/api/dealer/price",
      { plate, km: Number(km) || 0 },
      { headers: { "Authorization": token, "Content-Type": "application/json" }, timeout: 60000 }
    )

    let visionPromise = null
    if (photos && photos.length > 0) {
      const apiKey = getApiKey("OPENAI_API_KEY")
      if (apiKey) {
        const imageContent = photos.slice(0, 8).map(p => ({
          type: "image_url",
          image_url: { url: p.startsWith("data:") ? p : "data:image/jpeg;base64," + p, detail: "low" }
        }))
        visionPromise = axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Je bent een voertuig-inspecteur en schade-expert. Beoordeel STRENG.\n1. SCHADE: Een ingedeukte bumper, vervormd plaatwerk, grote deuken of ontbrekende onderdelen = ALTIJD zwaar. Alleen oppervlakkige krasjes of steenslag = licht. Markeer ELKE schade met locatie als percentage (x/y, 0,0=linksboven). Bij twijfel: kies zwaar.\n2. INTERIEUR: als interieur foto beschikbaar: slijtage? brandgaatjes? Als alleen exterieur: zet rokers_auto op false\n3. MODEL VERIFICATIE: klopt het model? (badges, bumpers, velgen)\n4. KENTEKEN: als kenteken zichtbaar, vermeld het\n5. OPTIES: welke opties zie je?\nAntwoord ALLEEN in JSON (geen markdown, geen backticks):\n{\"schade\":\"geen|licht|zwaar\",\"schade_items\":[{\"foto_nr\":1,\"x\":50,\"y\":70,\"breedte\":15,\"hoogte\":10,\"type\":\"deuk\",\"ernst\":\"zwaar\",\"beschrijving\":\"ingedeukte voorbumper\"}],\"schade_details\":\"samenvatting\",\"interieur\":\"goed|matig|slecht\",\"rokers_auto\":false,\"model_correctie\":\"geen|beschrijving\",\"kenteken_gezien\":\"XX-YY-ZZ of niet zichtbaar\",\"opties_gezien\":[\"optie1\"],\"algehele_staat\":\"goed|redelijk|matig|slecht\"}" },
            { role: "user", content: [
              { type: "text", text: "Analyseer deze foto's van het voertuig. Beoordeel streng — elke deuk, kras of schade telt." },
              ...imageContent
            ]}
          ],
          max_tokens: 800,
          temperature: 0
        }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 60000 }).catch(e => ({ error: e.message }))
      }
    }

    // Wacht op beide tegelijk
    const [baseResp, visionResult] = await Promise.all([basePromise, visionPromise || Promise.resolve(null)])

    const base = baseResp.data
    if (!base || !base.verkoopadviees) {
      return res.status(500).json({ error: "Basisprijs kon niet berekend worden" })
    }

    // Verwerk foto-analyse
    let photoAnalysis = null
    let autoCorrections = {}
    if (visionResult && !visionResult.error && visionResult.data) {
      try {
        const visionText = visionResult.data.choices[0].message.content || "{}"
        const clean = visionText.replace(/```json|```/g, "").trim()
        photoAnalysis = JSON.parse(clean)
      } catch(e) {
        photoAnalysis = { error: "Parse error: " + e.message }
      }
      if (photoAnalysis && !photoAnalysis.error) {
        if (photoAnalysis.schade === "licht") autoCorrections.lichte_schade = true
        if (photoAnalysis.schade === "zwaar") autoCorrections.zware_schade = true
        if (photoAnalysis.rokers_auto && photoAnalysis.interieur !== "goed") autoCorrections.rokers_auto = true
      }
    } else if (visionResult && visionResult.error) {
      photoAnalysis = { error: visionResult.error }
    }

    // Combineer auto + handmatige correcties
    const allCorrections = { ...autoCorrections }
    if (corrections && typeof corrections === "object") {
      for (const [k, v] of Object.entries(corrections)) {
        if (v === true && CORRECTIONS[k]) allCorrections[k] = true
      }
    }

    // Bereken totale correctie
    let totalPct = 0
    const appliedCorrections = []
    for (const [k, active] of Object.entries(allCorrections)) {
      if (active && CORRECTIONS[k]) {
        totalPct += CORRECTIONS[k].pct
        appliedCorrections.push({
          key: k, label: CORRECTIONS[k].label, pct: CORRECTIONS[k].pct,
          bedrag: Math.round(base.verkoopadviees * CORRECTIONS[k].pct)
        })
      }
    }
    totalPct = Math.max(totalPct, MAX_CORRECTION)

    // Pas correctie toe
    const factor = 1 + totalPct
    const corrected = {
      verkoopadviees: Math.round(base.verkoopadviees * factor / 50) * 50,
      handelswaarde: Math.round((base.handelswaarde || base.verkoopadviees * 0.85) * factor / 50) * 50,
      inkoopLow: Math.round(base.inkoopLow * factor / 50) * 50,
      inkoopHigh: Math.round(base.inkoopHigh * factor / 50) * 50,
    }

    const timing = Date.now() - t0
    // Sla foto's op per kenteken
    if (photos && photos.length > 0) {
      try {
        const fs = require("fs")
        const path = require("path")
        const plateClean = plate.replace(/[^A-Z0-9]/gi, "").toUpperCase()
        const dir = path.join("/opt/t4c/data/photos/inspections", plateClean)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        photos.forEach((p, i) => {
          const base64 = p.replace(/^data:image\/\w+;base64,/, "")
          fs.writeFileSync(path.join(dir, (i+1) + ".jpg"), Buffer.from(base64, "base64"))
        })
        console.log("[EXTENDED] Saved", photos.length, "photos for", plateClean)
      } catch(e) { console.log("[EXTENDED] Photo save error:", e.message) }
    }

    console.log("[EXTENDED]", plate, "VP:", base.verkoopadviees, "correctie:", Math.round(totalPct*100)+"%", "-> VP:", corrected.verkoopadviees, "|", timing+"ms", photoAnalysis ? "vision:"+photoAnalysis.schade : "no-photos")

    res.json({
      basis: {
        verkoopadviees: base.verkoopadviees, handelswaarde: base.handelswaarde,
        inkoopLow: base.inkoopLow, inkoopHigh: base.inkoopHigh,
        confidence: base.confidence, priceSource: base.priceSource,
        reasoning: base.aiValidation?.reasoning || null,
      },
      gecorrigeerd: corrected,
      correctie: {
        totalePct: Math.round(totalPct * 100),
        totaleBedrag: Math.round(base.verkoopadviees * totalPct),
        items: appliedCorrections,
        cap: totalPct === MAX_CORRECTION,
      },
      photoAnalysis,
      availableCorrections: CORRECTIONS,
    })

  } catch (e) {
    console.error("[EXTENDED] Error:", e.message)
    res.status(500).json({ error: e.message })
  }
})

router.get("/api/extended-taxatie/corrections", authMiddleware, (req, res) => {
  res.json(CORRECTIONS)
})

module.exports = router
