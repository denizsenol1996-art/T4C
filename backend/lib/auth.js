// T4C Auth Middleware
const jwt = require("jsonwebtoken")

// JWT_SECRET komt uit .env via setSecret() bij boot. Geen hardcoded fallback —
// server moet weigeren te starten als de secret ontbreekt (zie server.js boot).
let JWT_SECRET = null

function setSecret(s) {
  if (!s || typeof s !== "string" || s.length < 32) {
    throw new Error("JWT_SECRET ontbreekt of te kort (<32 chars). Set in /opt/t4c/.env.")
  }
  JWT_SECRET = s
}
function getSecret() {
  if (!JWT_SECRET) throw new Error("JWT_SECRET niet geinitialiseerd — setSecret() moet eerst draaien")
  return JWT_SECRET
}
function verifyToken(token) {
  try { return jwt.verify(token, getSecret()) } catch { return null }
}

// ── Logout token-blacklist (2026-06-10 SEC-4)
// In-memory Set van ingetrokken JWT-strings. Reset bij pm2 restart — soft-fix
// tot we Redis-backed of DB-backed blacklist hebben. Frontend clear localStorage
// bij logout = primaire bescherming; deze blacklist sluit het server-side gat
// voor actieve sessies tussen restarts.
const _revokedTokens = new Set()
function revokeToken(token) { if (token && typeof token === "string") _revokedTokens.add(token) }
function isRevoked(token) { return _revokedTokens.has(token) }
// Cleanup elke 6u — drop verlopen tokens uit blacklist
setInterval(() => {
  const now = Math.floor(Date.now() / 1000)
  for (const t of _revokedTokens) {
    try {
      const decoded = jwt.decode(t)
      if (!decoded || (decoded.exp && decoded.exp < now)) _revokedTokens.delete(t)
    } catch { _revokedTokens.delete(t) }
  }
}, 6 * 60 * 60 * 1000).unref?.()

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ ok: false, error: "Niet ingelogd" })
  if (isRevoked(token)) return res.status(401).json({ ok: false, error: "Sessie verlopen (uitgelogd)" })
  try {
    req.user = jwt.verify(token, getSecret())
    const uid = req.user.userId || req.user.uid
    // Geen 0-fallback: token zonder userId = ongeldig (anders zou alles aan user 0 toegeschreven worden)
    if (!uid || typeof uid !== "number" || uid < 1) {
      return res.status(401).json({ ok: false, error: "Token mist userId — log opnieuw in" })
    }
    req.userId = uid
    next()
  }
  catch { return res.status(401).json({ ok: false, error: "Sessie verlopen" }) }
}
const auth = authMiddleware
// ── Rollen: admin > t4c > inkoper > dealer > koper > klant ──
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ ok: false, error: "Geen admin rechten" })
  next()
}
function t4cOnly(req, res, next) {
  if (!["admin","t4c"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Alleen T4C medewerkers" })
  next()
}
function staffOnly(req, res, next) {
  if (!["admin","t4c","inkoper"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Geen toegang" })
  next()
}
function dealerPlus(req, res, next) {
  if (!["admin","t4c","inkoper","dealer"].includes(req.user?.role)) return res.status(403).json({ ok: false, error: "Geen toegang" })
  next()
}

/* ═══════════════════════════════════════════════
   MULTI-USER BEHEER
   ═══════════════════════════════════════════════ */

module.exports = { authMiddleware, adminOnly, t4cOnly, staffOnly, dealerPlus, setSecret, getSecret, verifyToken, revokeToken, isRevoked }
