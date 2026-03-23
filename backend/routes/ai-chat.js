// routes/ai-chat.js — AI chat, AI validate endpoints
const router = require("express").Router()
const express = require("express")
const axios = require("axios")
const { stmts, queryAll, queryOne, run } = require("../db")
const { getApiKey, hasApiKey, callGPT } = require("../lib/ai")
const { authMiddleware } = require("../lib/auth")
const { writeLog } = require("../lib/state")

router.post("/api/ai/chat", authMiddleware, express.json(), async (req, res) => {
  try {
    const { vraag, context } = req.body
    if (!vraag) return res.status(400).json({ ok: false, error: "Vraag is vereist" })
    
    const systemPrompt = `Je bent de CardDatax AI-assistent, een expert in de Nederlandse automarkt. 
Je helpt dealers met taxaties, marktanalyses, en voertuigvragen.
Antwoord kort, concreet en in het Nederlands. Gebruik cijfers en feiten waar mogelijk.`
    
    const result = await callGPT(systemPrompt, `${context ? context + "\n\n" : ""}Vraag: ${vraag}`, { temperature: 0.5 })
    res.json({ ok: true, antwoord: result })
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// AI Taxatie Validatie — automatische controle na elke taxatie
router.post("/api/ai/validate", authMiddleware, express.json(), async (req, res) => {
  try {
    const { voertuig, marktdata, berekendePrijzen } = req.body
    if (!voertuig) return res.status(400).json({ ok: false, error: "Voertuigdata vereist" })
    
    // Check if OpenAI is configured
    if (!hasApiKey("OPENAI_API_KEY")) {
      return res.json({ ok: true, ai: { beschikbaar: false, reden: "OpenAI niet geconfigureerd" } })
    }

    const systemPrompt = `Je bent een expert automotive taxateur voor de Nederlandse markt. Je controleert taxatieprijzen op correctheid.

Je ENIGE taak: bepaal de correcte inkoopprijs voor dit voertuig op basis van alle beschikbare data.

Antwoord ALLEEN in dit JSON-formaat (geen markdown, geen tekst buiten JSON):
{
  "oordeel": "correct" | "twijfel" | "afwijkend",
  "vertrouwen": <60-100>,
  "ai_schatting": <jouw inkoopprijs als getal - DIT IS DE BELANGRIJKSTE WAARDE>,
  "afwijking_pct": <percentage verschil>,
  "advies": "inkopen" | "voorzichtig" | "afblijven",
  "samenvatting": "<1 zin>"
}

BELANGRIJK:
- ai_schatting = jouw beste inschatting van de INKOOPPRIJS (wat een dealer zou bieden).
- Gebruik marktdata als beschikbaar: inkoop = ca. 55-70% van mediaan vraagprijs (afhankelijk van leeftijd/km).
- Nieuwe/jonge auto's (0-3 jaar): inkoop ~70-75% van mediaan.
- Middensegment (3-8 jaar): inkoop ~60-68% van mediaan.
- Oud (8+ jaar): inkoop ~50-60% van mediaan. Onder €2000 mediaan: inkoop kan 40-55% zijn.
- Correcties: import +risico, gestolen = 0, hoge km = -5 tot -15%, populair merk/model = +5%.
- "oordeel" = "correct" als afwijking <10%, "twijfel" als 10-20%, "afwijkend" als >20%.
- Vertrouwen moet minimaal 70 zijn als je marktdata hebt.`

    const userMsg = `VOERTUIG:
Merk: ${voertuig.make || "?"}
Model: ${voertuig.model || "?"} ${voertuig.variant || ""}
Bouwjaar: ${voertuig.year || "?"}
KM-stand: ${voertuig.km ? voertuig.km.toLocaleString() : "?"}
Brandstof: ${voertuig.fuel || "?"}
Vermogen: ${voertuig.powerHp || "?"} pk
Carrosserie: ${voertuig.body || "?"}
Kleur: ${voertuig.color || "?"}
Import: ${voertuig.importFlag ? "JA" : "Nee"}
Gestolen: ${voertuig.stolenFlag ? "JA" : "Nee"}
${voertuig.catalogPrice ? "Nieuwprijs: €" + voertuig.catalogPrice.toLocaleString() : ""}
${voertuig.apkUntil ? "APK tot: " + voertuig.apkUntil : ""}

BEREKENDE PRIJZEN:
Verkoopadviees (B2C): €${berekendePrijzen?.verkoopadviees || "?"}
Handelswaarde (B2B): €${berekendePrijzen?.handelswaarde || "?"}
Inkoop laag: €${berekendePrijzen?.inkoopLow || "?"}
Inkoop hoog: €${berekendePrijzen?.inkoopHigh || "?"}
Internet vraagprijs: €${berekendePrijzen?.internetPrijs || "?"}
T4C Bod: €${berekendePrijzen?.t4cBod || "?"}

${marktdata && marktdata.count ? `MARKTDATA (${marktdata.count} vergelijkbare auto's):
Gemiddeld: €${marktdata.avg || "?"}
Mediaan: €${marktdata.median || "?"}
P25: €${marktdata.p25 || "?"}
P75: €${marktdata.p75 || "?"}` : "MARKTDATA: Geen marktdata beschikbaar"}

Valideer deze taxatie.`

    const result = await callGPT(systemPrompt, userMsg, { temperature: 0.2, max_completion_tokens: 500 })
    
    let parsed
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(result)
    } catch(e) {
      parsed = { oordeel: "twijfel", samenvatting: result, vertrouwen: 50, raw: true }
    }
    
    parsed.beschikbaar = true
    // Uitgebreide logging
    const logLines = [
      `═══ AI VALIDATIE ═══`,
      `Auto: ${voertuig.make} ${voertuig.model} ${voertuig.variant || ''} (${voertuig.year}) ${voertuig.km ? voertuig.km.toLocaleString() + ' km' : ''}`,
      `Brandstof: ${voertuig.fuel || '?'} | Vermogen: ${voertuig.powerHp || '?'} pk | Import: ${voertuig.importFlag ? 'JA' : 'Nee'}`,
      `── INPUT PRIJZEN ──`,
      `  Verkoopadviees: €${berekendePrijzen?.verkoopadviees || '?'}`,
      `  Handelswaarde:  €${berekendePrijzen?.handelswaarde || '?'}`,
      `  Inkoop range:   €${berekendePrijzen?.inkoopLow || '?'} — €${berekendePrijzen?.inkoopHigh || '?'}`,
      `  T4C Bod:        €${berekendePrijzen?.t4cBod || '?'}`,
      `  Internet prijs: €${berekendePrijzen?.internetPrijs || '?'}`,
      marktdata?.count ? `  Marktdata:      ${marktdata.count} listings, mediaan €${marktdata.median}, gem €${marktdata.avg}` : '  Marktdata: GEEN',
      `── AI OUTPUT ──`,
      `  Oordeel:        ${parsed.oordeel} (${parsed.vertrouwen}% zekerheid)`,
      `  AI schatting:   €${parsed.ai_schatting || '?'}`,
      `  Afwijking:      ${parsed.afwijking_pct || '?'}%`,
      `  Advies:         ${parsed.advies || '?'}`,
      `  Samenvatting:   ${parsed.samenvatting || '-'}`,
      `═══════════════════`
    ]
    writeLog("ai.log", logLines.join("\n"))
    res.json({ ok: true, ai: parsed })
  } catch(e) {
    writeLog("errors.log", `AI VALIDATE ERROR: ${e.message}`)
    res.json({ ok: true, ai: { beschikbaar: false, reden: e.message } })
  }
})

/* ═══════════════════════════════════════════════
   PUBLIC REGISTRATION + CONTACT (verkoop pagina)
   ═══════════════════════════════════════════════ */


module.exports = router
