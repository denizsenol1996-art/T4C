// quick-price-expert.js — Expert price estimate voor snelle taxatie
// Parallel naast comp-engine. Externe call met cache + graceful failure.
const axios = require("axios")
const { getApiKey } = require("./ai")

const CACHE_TTL_MS = 7 * 24 * 3600 * 1000  // 7 dagen
const MAX_ENTRIES = 5000
const _cache = new Map()  // key → { value, expires }

function _makeKey(v) {
  const km = parseInt(v.km) || 0
  const kmBucket = Math.floor(km / 25000) * 25000
  return [
    (v.make || "").toLowerCase().trim(),
    (v.model || "").toLowerCase().trim(),
    v.year || 0,
    kmBucket,
    (v.fuel || "").toLowerCase().trim(),
    (v.transmission || "").toLowerCase().trim(),
    (v.staat || "GOED").toUpperCase(),
    (v.rijdt || "JA").toUpperCase()
  ].join("|")
}

function _cacheGet(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (entry.expires < Date.now()) { _cache.delete(key); return null }
  _cache.delete(key); _cache.set(key, entry)  // LRU touch
  return entry.value
}

function _cacheSet(key, value) {
  if (_cache.size >= MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value
    if (firstKey) _cache.delete(firstKey)
  }
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS })
}

async function getExpertPriceEstimate(vehicle) {
  const t0 = Date.now()
  if (!vehicle || !vehicle.make || !vehicle.model || !vehicle.year) return null
  const key = _makeKey(vehicle)

  const cached = _cacheGet(key)
  if (cached) {
    const _ms = Date.now() - t0
    console.log("[QUICK-EXPERT]", "HIT", _ms + "ms", vehicle.make, vehicle.model)
    return Object.assign({}, cached, { _cached: true, _ms })
  }

  const apiKey = getApiKey("OPENAI_API_KEY")
  if (!apiKey || apiKey === "sk-...") {
    console.log("[QUICK-EXPERT]", "SKIP no api key")
    return null
  }

  const sys = "Je bent een Nederlandse auto-dealer expert met 20+ jaar marktkennis. Geef realistische prijs-ranges voor de NL markt. Antwoord ALLEEN met geldige JSON, geen prose. Voor auto's in slechte staat of defect: denk niet alleen aan straatwaarde maar ook aan onderdelen-waarde, export-mogelijkheden en reparatie-marge. Een defecte premium-auto (BMW, Mercedes, Audi) heeft substantieel meer restwaarde dan een budget-auto vanwege onderdelen en export-vraag."
  let usr = "Schat de prijzen voor: " + (vehicle.make || "?") + " " + (vehicle.model || "?") + " " + vehicle.year + ", " + (vehicle.km || 0) + "km, " + (vehicle.fuel || "?") + ", " + (vehicle.transmission || "?") + ", body=" + (vehicle.body || "?") + ".\n\n" +
    "Geef JSON met:\n" +
    "{\n" +
    "  \"verkoop_low\": <getal>,\n" +
    "  \"verkoop_high\": <getal>,\n" +
    "  \"bod_low\": <getal>,\n" +
    "  \"bod_high\": <getal>,\n" +
    "  \"reasoning\": \"<korte onderbouwing>\"\n" +
    "}\n\n" +
    "Houd rekening met leeftijd, kilometers, marktsegment. Conservatief inschatten."
  // v10.18.71 — staat + rijdt context naar expert (geen post-multipliers meer)
  const staatUp = (vehicle.staat || "").toUpperCase()
  const rijdtUp = (vehicle.rijdt || "").toUpperCase()
  const contextLines = []
  if (staatUp === "SLECHT") {
    contextLines.push("De dealer geeft aan dat de auto in SLECHTE staat verkeert: denk aan zichtbare schade, roest, deuken, of beschadigd interieur. Auto rijdt nog wel.")
  } else if (staatUp === "DEFECT") {
    contextLines.push("De dealer geeft aan dat de auto DEFECT is: ernstige mechanische of structurele problemen.")
  }
  if (rijdtUp === "NEE") {
    contextLines.push("De auto RIJDT NIET (moet versleept worden). Maak de inschatting op basis van onderdelen-waarde, reparatie-marge voor doorverkoop, en eventuele export-mogelijkheden.")
  }
  if (contextLines.length > 0) {
    usr += "\n\nExtra context:\n- " + contextLines.join("\n- ") +
      "\n\nBepaal het bod zoals een professionele inkoper dat zou doen: geïntegreerd oordeel rekening houdend met staat, onderdelen-waarde, reparatie-kosten, doorverkoop-marge, en export-mogelijkheden. Geen standaard discount maar realistische marktbenadering."
  }

  try {
    const resp = await axios.post("https://api.openai.com/v1/responses", {
      model: "gpt-5.4",
      temperature: 0,
      max_output_tokens: 400,
      input: sys + "\n\n" + usr
    }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 8000 })

    const outBlocks = resp.data.output || []
    const textBlock = outBlocks.find(b => b.type === "message")
    let raw = (textBlock && textBlock.content ? (textBlock.content.find(c => c.type === "output_text") || textBlock.content[0] || {}).text : null) || ""
    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) raw = jsonMatch[0]
    const parsed = JSON.parse(raw)

    const result = {
      verkoop_low: Number(parsed.verkoop_low) || null,
      verkoop_high: Number(parsed.verkoop_high) || null,
      bod_low: Number(parsed.bod_low) || null,
      bod_high: Number(parsed.bod_high) || null,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : null
    }

    if (!result.verkoop_low || !result.verkoop_high || !result.bod_low || !result.bod_high) {
      console.log("[QUICK-EXPERT]", "PARSE incomplete", vehicle.make, vehicle.model)
      return null
    }

    _cacheSet(key, result)
    const _ms = Date.now() - t0
    console.log("[QUICK-EXPERT]", "MISS", _ms + "ms", vehicle.make, vehicle.model, "bod=" + result.bod_low + "-" + result.bod_high)
    return Object.assign({}, result, { _cached: false, _ms })
  } catch (e) {
    const _ms = Date.now() - t0
    console.log("[QUICK-EXPERT]", "FAIL", _ms + "ms", vehicle.make, vehicle.model, "—", e.message)
    return null
  }
}

module.exports = { getExpertPriceEstimate }
