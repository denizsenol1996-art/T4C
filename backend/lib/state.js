// T4C Shared State — mutable globals used across routes
const fs = require("fs")
const path = require("path")

const { version: VERSION } = require("../package.json")

const _serverStats = {
  startTime: Date.now(),
  requestCount: 0,
  errorCount: 0,
  lastError: null,
  apiCalls: {}
}

// ── Logging ──
const LOG_DIR = path.join(__dirname, "..", "..", "data")
function writeLog(file, msg) {
  try {
    const logPath = path.join(LOG_DIR, file)
    const ts = new Date().toISOString()
    fs.appendFileSync(logPath, `[${ts}] ${msg}\n`)
  } catch (e) {
    console.error("[LOG]", file, msg, e.message)
  }
}

module.exports = { VERSION, _serverStats, writeLog, LOG_DIR }
