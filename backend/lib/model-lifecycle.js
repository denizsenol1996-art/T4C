// lib/model-lifecycle.js — Model lifecycle via GPT-5.4, in-memory cache 30 dagen
const axios = require("axios")
const { getApiKey } = require("./ai")

const TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 dagen
const MAX_ENTRIES = 5000

const _store = new Map()
const _stats = { hits: 0, misses: 0, stores: 0, evictions: 0, errors: 0 }

function _key(make, model, year) {
  return String(make || "").toUpperCase().trim() + "_" + String(model || "").toUpperCase().trim() + "_" + (parseInt(year) || 0)
}

function _evictLRU(count) {
  const sorted = [..._store.entries()].sort((a, b) => (a[1].lastHit || 0) - (b[1].lastHit || 0))
  for (let i = 0; i < Math.min(count, sorted.length); i++) {
    _store.delete(sorted[i][0])
    _stats.evictions++
  }
}

function _classify(d, year) {
  const now = new Date().getFullYear()
  const start = d.productionStart || 0
  const end = d.productionEnd
  const succYear = d.successorYearStart || null
  if (!end && year >= start - 2) return "actueel"
  if (end && year <= end && succYear && succYear > year) return "uitgaand"
  if (end && (now - end) > 5) return "niet_meer_geproduceerd"
  return "aflopend"
}

function _color(status) {
  switch (status) {
    case "actueel": return "green"
    case "aflopend": return "yellow"
    case "uitgaand": return "orange"
    case "niet_meer_geproduceerd": return "red"
    default: return "gray"
  }
}

function _statusText(d) {
  const start = d.productionStart || "?"
  const end = d.productionEnd || "heden"
  let txt = `Generatie ${d.generation || "?"} (${start}-${end})`
  if (d.successor && d.successorYearStart) {
    txt += ` · opvolger: ${d.successor} sinds ${d.successorYearStart}`
  }
  return txt
}

async function getModelLifecycle(make, model, year) {
  if (!make || !model || !year) return null
  const k = _key(make, model, year)

  // Cache check
  const cached = _store.get(k)
  if (cached) {
    if (Date.now() <= cached.expiresAt) {
      cached.lastHit = Date.now()
      cached.hitCount = (cached.hitCount || 0) + 1
      _stats.hits++
      console.log("[LIFECYCLE-CACHE] HIT", k)
      return cached.data
    }
    _store.delete(k)
  }
  _stats.misses++
  console.log("[LIFECYCLE-CACHE] MISS", k)

  // GPT call
  const apiKey = getApiKey("OPENAI_API_KEY")
  if (!apiKey || apiKey === "sk-...") return null

  try {
    const resp = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-5.4",
      temperature: 0,
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content: 'Je bent automotive expert. Geef productiejaren + generatie van exact voertuig. Antwoord ALLEEN met geldige JSON:\n{\n  "generation":"<code/naam>",\n  "productionStart":<jaar>,\n  "productionEnd":<jaar of null>,\n  "status":"actueel|aflopend|uitgaand|niet_meer_geproduceerd",\n  "successor":"<naam of null>",\n  "successorYearStart":<jaar of null>,\n  "confidence":<0.0-1.0>\n}'
        },
        { role: "user", content: `${make} ${model} ${year}` }
      ]
    }, { headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, timeout: 12000 })

    let txt = (resp.data?.choices?.[0]?.message?.content || "").trim()
    txt = txt.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(txt)

    const status = _classify(parsed, parseInt(year))
    const data = {
      generation: parsed.generation || null,
      productionStart: parsed.productionStart || null,
      productionEnd: parsed.productionEnd || null,
      status,
      statusText: _statusText(parsed),
      color: _color(status),
      successor: parsed.successor || null,
      successorYearStart: parsed.successorYearStart || null,
      confidence: parsed.confidence || null
    }

    _store.set(k, { data, expiresAt: Date.now() + TTL_MS, lastHit: Date.now(), hitCount: 0 })
    _stats.stores++
    console.log("[LIFECYCLE-CACHE] STORE", k, "->", status, "(size:" + _store.size + ")")
    if (_store.size > MAX_ENTRIES) _evictLRU(Math.ceil(MAX_ENTRIES * 0.1))
    return data
  } catch (e) {
    _stats.errors++
    console.log("[LIFECYCLE-CACHE] ERROR", k, ":", e.message)
    return null
  }
}

function stats() {
  const total = _stats.hits + _stats.misses
  return {
    size: _store.size,
    maxEntries: MAX_ENTRIES,
    ttlMs: TTL_MS,
    hits: _stats.hits,
    misses: _stats.misses,
    stores: _stats.stores,
    evictions: _stats.evictions,
    errors: _stats.errors,
    hitRate: total > 0 ? Math.round(_stats.hits / total * 10000) / 100 : 0
  }
}

module.exports = { getModelLifecycle, stats }
