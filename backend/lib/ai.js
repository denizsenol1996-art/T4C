// T4C AI Helpers
const axios = require("axios")
const { queryOne, run } = require("../db")

function getApiKey(name) {
  try {
    const row = queryOne("SELECT value FROM settings WHERE key=?", ["api_key_" + name])
    if (row && row.value && row.value.length > 5) return row.value
  } catch(e) {}
  return process.env[name] || ""
}

function hasApiKey(name) {
  const key = getApiKey(name)
  return !!(key && key.length > 5 && key !== "sk-...")
}

function maskKey(key) {
  if (!key || key.length < 10 || key === "sk-...") return ""
  return key.substring(0, 7) + "..." + key.substring(key.length - 4)
}

// Helper: call OpenAI API
async function callGPT(systemPrompt, userPrompt, opts = {}) {
  const apiKey = getApiKey("OPENAI_API_KEY")
  if (!apiKey || apiKey === "sk-...") throw new Error("OPENAI_API_KEY niet geconfigureerd — ga naar Admin → AI Services")
  
  const body = {
    model: opts.model || "gpt-5.4",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: opts.temperature ?? 0.3,
    max_completion_tokens: opts.max_completion_tokens || 2000
  }
  
  // Support vision (images)
  if (opts.imageUrl) {
    body.messages[1].content = [
      { type: "text", text: userPrompt },
      { type: "image_url", image_url: { url: opts.imageUrl, detail: "high" } }
    ]
  }
  
  const resp = await axios.post("https://api.openai.com/v1/chat/completions", body, {
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    timeout: 30000
  })
  
  return resp.data.choices[0].message.content
}

module.exports = { getApiKey, hasApiKey, maskKey, callGPT }
