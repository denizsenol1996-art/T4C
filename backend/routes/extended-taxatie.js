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

// PATCH 9 (2026-05-25): 2-pass vision architecture
// Pass 1: lo-detail classifier op ALLE foto's → per_foto + selected_photos (7 standaard-posities)
// Pass 2: hi-detail schade-detector op de 7 geselecteerde foto's, met Autotelex-prior
// Voordeel: GPT verliest niet de index-tracking ("lost in the middle") + hi-res alleen waar nodig
const POS_ORDER = ['voor', 'linksvoor', 'linksachter', 'achter', 'rechtsachter', 'rechtsvoor', 'interieur']

function _parseVisionJSON(resp) {
  const blocks = resp.data && resp.data.output || []
  const msg = blocks.find(b => b.type === 'message')
  const content = msg && msg.content || []
  const textBlock = content.find(c => c.type === 'output_text') || content[0] || {}
  const txt = textBlock.text || '{}'
  return JSON.parse(String(txt).replace(/```json|```/g, '').trim())
}

async function runVisionTwoPass(photos, overrides, apiKey) {
  // ───────────────────────── PASS 1 — lo-detail position classifier ─────────────────────────
  const pass1Imgs = photos.map(p => ({
    type: "input_image",
    image_url: p.startsWith("data:") ? p : "data:image/jpeg;base64," + p,
    detail: "low"
  }))

  const pass1System = "Je bent een foto-classificatie expert voor voertuig-foto's.\n" +
    "Per meegestuurde foto (index 0 t/m N-1):\n" +
    "- identificeer het type. Mogelijk: voor, linksvoor, linksachter, achter, rechtsachter, rechtsvoor, interieur, dashboard, motorruimte, kofferbak, laadruimte, detail, rotzooi.\n" +
    "  * 'detail' = velg-close-up, lakdetail, kenteken-close-up, schade-close-up\n" +
    "  * 'rotzooi' = geen voertuig zichtbaar (schoen, vloer, lucht, taxateur, willekeurig)\n" +
    "- confidence 0-1\n" +
    "- bruikbaar (bool) = of de foto inhoudelijk verder bruikbaar is\n" +
    "\nVervolgens: kies per van de 7 standaard-posities de BESTE matchende foto-index. Posities:\n" +
    "  voor (frontaal recht van voren), linksvoor (3/4 linker-voor), linksachter (3/4 linker-achter), achter (frontaal recht van achteren), rechtsachter (3/4 rechter-achter), rechtsvoor (3/4 rechter-voor), interieur (representatieve binnenshot).\n" +
    "Geen geschikte foto (positie ontbreekt OF confidence < 0.7) → null. Eén foto-index aan maximaal ÉÉN positie. Wees streng — geef liever null dan een verkeerde positie-match.\n" +
    "\nAntwoord ALLEEN in JSON (geen markdown):\n" +
    "{\"per_foto\":[{\"index\":0,\"type\":\"voor\",\"confidence\":0.9,\"bruikbaar\":true}],\"selected_photos\":{\"voor\":{\"index\":0,\"confidence\":0.9},\"linksvoor\":null,\"linksachter\":null,\"achter\":null,\"rechtsachter\":null,\"rechtsvoor\":null,\"interieur\":null}}"

  const pass1Resp = await axios.post("https://api.openai.com/v1/responses", {
    model: "gpt-5.4",
    input: [
      { role: "system", content: pass1System },
      { role: "user", content: [
        { type: "input_text", text: "Classificeer en selecteer per positie. " + photos.length + " foto's." },
        ...pass1Imgs
      ]}
    ],
    max_output_tokens: 2000,
    temperature: 0
  }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 60000 })

  let pass1Data
  try { pass1Data = _parseVisionJSON(pass1Resp) }
  catch (e) { return { error: "Pass1 parse error: " + e.message } }

  const sel = pass1Data.selected_photos || {}
  const orderedIndices = []
  const seen = new Set()
  for (const pos of POS_ORDER) {
    const m = sel[pos]
    if (m && typeof m.index === 'number' && !seen.has(m.index) && photos[m.index]) {
      orderedIndices.push(m.index)
      seen.add(m.index)
    }
  }

  if (!orderedIndices.length) {
    return {
      schade: "geen", schade_items: [], schade_details: "Pass 1: geen bruikbare exterieur/interieur foto's geselecteerd",
      interieur: "onbekend", rokers_auto: false, model_correctie: "geen",
      kenteken_gezien: "niet zichtbaar", opties_gezien: [], algehele_staat: "onbekend",
      per_foto: pass1Data.per_foto || [], selected_photos: sel,
      _pass1_only: true,
    }
  }

  // ───────────────────────── PASS 2 — hi-detail schade-detector ─────────────────────────
  const pass2Imgs = orderedIndices.map(i => ({
    type: "input_image",
    image_url: photos[i].startsWith("data:") ? photos[i] : "data:image/jpeg;base64," + photos[i],
    detail: "high"
  }))

  const _sv = overrides.autotelex_schadevrij
  const _defects = Array.isArray(overrides.defects) ? overrides.defects : []
  let atxPrior
  if (_sv === true) {
    atxPrior = "Officiële Autotelex-inspecteur status: SCHADEVRIJ. Verwacht GEEN schade-items tenzij zeer duidelijk zichtbaar bewijs (substantiële deuk, vervorming, ontbrekend onderdeel). Lichte krasjes of steenslag op een schadevrij-gemelde auto: NIET rapporteren."
  } else if (_defects.length > 0) {
    atxPrior = "Officiële Autotelex-inspecteur heeft de volgende " + _defects.length + " schadepunten gemeld:\n- " + _defects.join("\n- ") + "\nGebruik dit als sterk uitgangspunt: verifieer deze items op de foto's. Zoek GEEN extra schade buiten deze lijst tenzij zeer duidelijk zichtbaar bewijs."
  } else {
    atxPrior = "Officiële Autotelex-inspecteur status: niet meegestuurd. Beoordeel voorzichtig: alleen duidelijk zichtbare schade rapporteren."
  }

  const posPerSlot = orderedIndices.map((origIdx, slot) => "  foto " + slot + " = positie " + (POS_ORDER.find(p => sel[p] && sel[p].index === origIdx) || "?"))

  const pass2System = "Je bent een voorzichtige voertuig-inspecteur. Accuracy boven volume. Je krijgt " + orderedIndices.length + " VOORGEselecteerde foto's (beste exterieur/interieur shots per standaard-positie).\n" +
    "1. SCHADE: Markeer ALLEEN duidelijk zichtbare schade (≥1 cm of substantieel). Een ingedeukte bumper, vervormd plaatwerk, grote deuken of ontbrekende onderdelen = zwaar. Oppervlakkige krassen of steenslag = licht.\n" +
    "   - Bij twijfel: NIET rapporteren.\n" +
    "   - foto_nr verwijst naar de positie in DEZE geselecteerde set (0 t/m " + (orderedIndices.length - 1) + ").\n" +
    "   - Locatie als percentage (x/y, 0,0=linksboven).\n" +
    "   - Geef per item een confidence 0-100. Rapporteer GEEN items met confidence < 70.\n" +
    "   - Als dezelfde schade vanuit meerdere foto's zichtbaar is, rapporteer als ÉÉN item met 'ook_zichtbaar_op': [foto-nrs]. NIET als aparte items per foto.\n" +
    "2. INTERIEUR: als interieur-foto beschikbaar: slijtage? brandgaatjes? Als alleen exterieur: zet rokers_auto op false.\n" +
    "3. MODEL VERIFICATIE: klopt het model? (badges, bumpers, velgen).\n" +
    "4. KENTEKEN: als kenteken zichtbaar, vermeld het.\n" +
    "5. OPTIES: welke opties zie je?\n" +
    "Antwoord ALLEEN in JSON (geen markdown):\n" +
    "{\"schade\":\"geen|licht|zwaar\",\"schade_items\":[{\"foto_nr\":1,\"x\":50,\"y\":70,\"breedte\":15,\"hoogte\":10,\"type\":\"deuk\",\"ernst\":\"zwaar\",\"confidence\":85,\"ook_zichtbaar_op\":[],\"beschrijving\":\"ingedeukte voorbumper\"}],\"schade_details\":\"samenvatting\",\"interieur\":\"goed|matig|slecht\",\"rokers_auto\":false,\"model_correctie\":\"geen|beschrijving\",\"kenteken_gezien\":\"XX-YY-ZZ of niet zichtbaar\",\"opties_gezien\":[\"optie1\"],\"algehele_staat\":\"goed|redelijk|matig|slecht\"}"

  const pass2User = atxPrior + "\n\nDe geselecteerde foto's zijn (in volgorde):\n" + posPerSlot.join("\n") + "\n\nAnalyseer schade. Meld alleen duidelijk zichtbare schade en gebruik bovenstaande Autotelex-prior als uitgangspunt."

  const pass2Resp = await axios.post("https://api.openai.com/v1/responses", {
    model: "gpt-5.4",
    input: [
      { role: "system", content: pass2System },
      { role: "user", content: [{ type: "input_text", text: pass2User }, ...pass2Imgs]}
    ],
    max_output_tokens: 2000,
    temperature: 0
  }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 60000 })

  let pass2Data
  try { pass2Data = _parseVisionJSON(pass2Resp) }
  catch (e) { return { error: "Pass2 parse error: " + e.message } }

  // Map pass-2 foto_nr (0..N-1 binnen selectie) terug naar originele photos[]-index
  if (Array.isArray(pass2Data.schade_items)) {
    for (const it of pass2Data.schade_items) {
      const selIdx = it.foto_nr
      const origIdx = orderedIndices[selIdx]
      if (typeof origIdx === 'number') {
        it.foto_nr_in_selection = selIdx
        it.foto_nr = origIdx
      }
      if (Array.isArray(it.ook_zichtbaar_op)) {
        it.ook_zichtbaar_op = it.ook_zichtbaar_op.map(n => orderedIndices[n]).filter(x => typeof x === 'number')
      }
    }
  }

  return {
    ...pass2Data,
    per_foto: pass1Data.per_foto || [],
    selected_photos: sel,
    _pass1_indices_used: orderedIndices,
  }
}

router.post("/api/extended-taxatie", authMiddleware, express.json({ limit: "50mb" }), async (req, res) => {
  try {
    const { plate, km, corrections, photos, ...overrides } = req.body
    if (!plate) return res.status(400).json({ error: "Kenteken verplicht" })

    const token = req.headers.authorization || ""
    const t0 = Date.now()

    // === PARALLEL: basisprijs + foto-analyse tegelijk ===
    const basePromise = axios.post("http://localhost:3000/api/dealer/price",
      { plate, km: Number(km) || 0, ...overrides },
      { headers: { "Authorization": token, "Content-Type": "application/json" }, timeout: 60000 }
    )

    let visionPromise = null
    if (photos && photos.length > 0) {
      const apiKey = getApiKey("OPENAI_API_KEY")
      if (apiKey) {
        // PATCH 9 (2026-05-25): 2-pass vision — lo-detail position-classifier + hi-detail schade-detection op selected_photos
        visionPromise = runVisionTwoPass(photos, overrides, apiKey).catch(e => ({ error: e.message || String(e) }))
      }
    }

    // Wacht op beide tegelijk
    const [baseResp, visionResult] = await Promise.all([basePromise, visionPromise || Promise.resolve(null)])

    const base = baseResp.data
    if (!base || !base.verkoopadviees) {
      return res.status(500).json({ error: "Basisprijs kon niet berekend worden" })
    }

    // Verwerk foto-analyse (PATCH 9: visionResult is direct het photoAnalysis-object van runVisionTwoPass)
    let photoAnalysis = null
    let autoCorrections = {}
    if (visionResult && !visionResult.error) {
      photoAnalysis = visionResult
      if (photoAnalysis.schade === "licht") autoCorrections.lichte_schade = true
      if (photoAnalysis.schade === "zwaar") autoCorrections.zware_schade = true
      if (photoAnalysis.rokers_auto && photoAnalysis.interieur !== "goed") autoCorrections.rokers_auto = true
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
      full_pricing: base,
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
