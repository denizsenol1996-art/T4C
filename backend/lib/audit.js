// T4C Audit Log — append-only ledger voor financiële + AVG-traceability
// Schrijft naar audit_log tabel. Gebruik vanuit elke route die een gevoelige actie doet.
const { run } = require("../db")

function clientIp(req) {
  if (!req) return null
  // Express met trust proxy "loopback" zet req.ip correct via X-Forwarded-For
  return req.ip || req.connection?.remoteAddress || null
}

function clientUA(req) {
  if (!req) return null
  const ua = req.headers?.["user-agent"] || ""
  return ua.length > 500 ? ua.slice(0, 500) : ua
}

/**
 * Log een gebeurtenis naar audit_log.
 * @param {object} entry
 * @param {number|null} entry.userId
 * @param {string} entry.action  bijv. "login", "login_failed", "bid_placed", "veiling_won", "factuur_created", "profile_update", "account_delete", "admin_action", "data_export"
 * @param {string} [entry.targetType]  bijv. "veiling", "factuur", "user"
 * @param {number} [entry.targetId]
 * @param {object} [entry.details]  alles wat handig is bij betwisting (bedrag, oude/nieuwe waarde, etc)
 * @param {object} [entry.req]  Express request voor IP + UA auto-vulling
 */
function logAudit(entry) {
  try {
    run(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, ip, user_agent, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      [
        entry.userId || null,
        entry.action,
        entry.targetType || null,
        entry.targetId || null,
        clientIp(entry.req),
        clientUA(entry.req),
        entry.details ? JSON.stringify(entry.details) : null
      ]
    )
  } catch (e) {
    // Audit-log mag NOOIT een request laten falen — fail-silent + console
    try { console.error("[AUDIT] write failed:", e.message) } catch {}
  }
}

module.exports = { logAudit }
