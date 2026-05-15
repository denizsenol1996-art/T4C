// T4C Auth Middleware
const jwt = require("jsonwebtoken")
let JWT_SECRET = "3e9cd9895784e75d87d1e9e2d4954ef47f76f06dfc470ee88cebab62b99bd129ff1778a4b0aacb797727672bc28eac83"


function setSecret(s) { JWT_SECRET = s }
function getSecret() { return JWT_SECRET }

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "")
  if (!token) return res.status(401).json({ ok: false, error: "Niet ingelogd" })
  try { req.user = jwt.verify(token, JWT_SECRET); req.userId = req.user.userId || req.user.uid || 0; next() }
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

module.exports = { authMiddleware, adminOnly, t4cOnly, staffOnly, dealerPlus, setSecret, getSecret }
