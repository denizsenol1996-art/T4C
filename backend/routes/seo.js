// routes/seo.js — dynamic sitemap + robots.txt (2026-06-03 SEO-cleanup)
const router = require("express").Router()
const { queryAll } = require("../db")

const BASE = process.env.PUBLIC_URL || "https://transfer4cars.com"

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

router.get("/sitemap.xml", (req, res) => {
  const statics = [
    { loc: "/",            prio: "1.0", chg: "daily"   },
    { loc: "/aanbod/",     prio: "0.9", chg: "hourly"  },
    { loc: "/veilingen/",  prio: "0.9", chg: "hourly"  },
    { loc: "/verkoop/",    prio: "0.7", chg: "weekly"  },
    { loc: "/transport/",  prio: "0.7", chg: "weekly"  },
    { loc: "/privacy/",    prio: "0.3", chg: "yearly"  },
    { loc: "/voorwaarden/",prio: "0.3", chg: "yearly"  },
  ]
  let cars = []
  try {
    cars = queryAll(
      "SELECT id, merk, model, bouwjaar, updated_at FROM dv_vehicles WHERE status='active' ORDER BY updated_at DESC"
    ) || []
  } catch (e) { /* silent — sitemap mag niet crashen */ }

  let auctions = []
  try {
    auctions = queryAll(
      "SELECT id, merk, model, updated_at FROM veilingen WHERE status IN ('actief','gepland') ORDER BY eind_datum ASC"
    ) || []
  } catch (e) { /* silent */ }

  const today = new Date().toISOString().slice(0, 10)
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...statics.map(s =>
      `  <url><loc>${BASE}${s.loc}</loc><changefreq>${s.chg}</changefreq><priority>${s.prio}</priority></url>`
    ),
    ...cars.map(c => {
      const last = (c.updated_at || "").slice(0, 10) || today
      return `  <url><loc>${BASE}/auto/?id=${c.id}</loc><lastmod>${last}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
    }),
    ...auctions.map(a => {
      const last = (a.updated_at || "").slice(0, 10) || today
      return `  <url><loc>${BASE}/veilingen/detail/?id=${a.id}</loc><lastmod>${last}</lastmod><changefreq>hourly</changefreq><priority>0.8</priority></url>`
    }),
    `</urlset>`,
  ].join("\n")

  res.set("Content-Type", "application/xml; charset=utf-8")
  res.set("Cache-Control", "public, max-age=3600")
  res.send(lines)
})

router.get("/robots.txt", (req, res) => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /app/",
    "Disallow: /lyra-ai/",
    "Disallow: /telex-inkoop",
    "Disallow: /photos/",
    "",
    "# AI training crawlers — content not licensed for model training",
    "User-agent: GPTBot",
    "Disallow: /",
    "User-agent: CCBot",
    "Disallow: /",
    "User-agent: ClaudeBot",
    "Disallow: /",
    "User-agent: Google-Extended",
    "Disallow: /",
    "User-agent: Applebot-Extended",
    "Disallow: /",
    "User-agent: anthropic-ai",
    "Disallow: /",
    "User-agent: PerplexityBot",
    "Disallow: /",
    "User-agent: Amazonbot",
    "Disallow: /",
    "User-agent: Bytespider",
    "Disallow: /",
    "",
    `Sitemap: ${BASE}/sitemap.xml`,
    ""
  ].join("\n")
  res.set("Content-Type", "text/plain; charset=utf-8")
  res.set("Cache-Control", "public, max-age=3600")
  res.send(body)
})

module.exports = router
