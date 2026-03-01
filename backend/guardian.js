/**
 * T4C Guardian — Process Manager & Health Monitor
 * 
 * Runs server.js as a child process with:
 * - Auto-restart on crash (max 5 restarts in 5 min, then cooldown)
 * - Health checks every 30s
 * - File-based logging (logs/ directory)
 * - Log rotation (max 5MB per file, keeps last 5)
 * - Graceful shutdown on Ctrl+C
 * - Uptime tracking
 */
const { spawn } = require("child_process")
const fs = require("fs")
const path = require("path")
const http = require("http")

// ── CONFIG ──
const PORT = process.env.PORT || 3000
const HEALTH_INTERVAL = 30_000       // 30s between health checks
const RESTART_LIMIT = 5              // max restarts in window
const RESTART_WINDOW = 5 * 60_000    // 5 minute window
const COOLDOWN_TIME = 60_000         // 1 min cooldown after too many restarts
const LOG_MAX_SIZE = 5 * 1024 * 1024 // 5MB per log file
const LOG_MAX_FILES = 5              // keep last 5 rotated logs

// ── PATHS ──
const ROOT = path.join(__dirname, "..")
const LOG_DIR = path.join(ROOT, "logs")
const SERVER_JS = path.join(__dirname, "server.js")

// Ensure logs directory
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

// ── STATE ──
let serverProcess = null
let restartTimes = []
let isShuttingDown = false
let startTime = Date.now()
let totalRestarts = 0
let lastHealthOk = null
let healthFailCount = 0

// ══════════════════════════════════════════════
// LOGGING
// ══════════════════════════════════════════════

function rotateLog(logPath) {
  try {
    if (!fs.existsSync(logPath)) return
    const stat = fs.statSync(logPath)
    if (stat.size < LOG_MAX_SIZE) return

    // Rotate: app.log → app.1.log → app.2.log → ...
    const ext = path.extname(logPath)
    const base = logPath.slice(0, -ext.length)
    
    for (let i = LOG_MAX_FILES - 1; i >= 1; i--) {
      const from = `${base}.${i}${ext}`
      const to = `${base}.${i + 1}${ext}`
      if (fs.existsSync(from)) {
        if (i + 1 > LOG_MAX_FILES) fs.unlinkSync(from)
        else fs.renameSync(from, to)
      }
    }
    fs.renameSync(logPath, `${base}.1${ext}`)
  } catch (e) { /* ignore rotation errors */ }
}

function writeLog(file, message) {
  const logPath = path.join(LOG_DIR, file)
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${message}\n`
  
  rotateLog(logPath)
  fs.appendFileSync(logPath, line)
}

function log(msg) {
  const line = `[GUARDIAN] ${msg}`
  console.log(line)
  writeLog("guardian.log", msg)
}

function logError(msg) {
  const line = `[GUARDIAN ERROR] ${msg}`
  console.error(line)
  writeLog("guardian.log", `ERROR: ${msg}`)
  writeLog("errors.log", `GUARDIAN: ${msg}`)
}

// ══════════════════════════════════════════════
// SERVER PROCESS MANAGEMENT
// ══════════════════════════════════════════════

function startServer() {
  if (isShuttingDown) return
  
  log(`Starting server.js (PID will follow)...`)
  
  // On Windows, kill any process holding port 3000 before starting
  if (process.platform === "win32") {
    try {
      const { execSync } = require("child_process")
      const out = execSync(`netstat -ano | findstr ":${PORT} " | findstr "LISTENING"`, { encoding: "utf8", timeout: 5000 }).trim()
      for (const line of out.split("\n")) {
        const pid = line.trim().split(/\s+/).pop()
        if (pid && /^\d+$/.test(pid)) {
          try { execSync(`taskkill /PID ${pid} /F`, { timeout: 3000 }) } catch {}
        }
      }
    } catch {} // No process on port — fine
  }

  // Pipe server stdout/stderr to log files
  const outLog = fs.openSync(path.join(LOG_DIR, "server.log"), "a")
  const errLog = fs.openSync(path.join(LOG_DIR, "errors.log"), "a")

  serverProcess = spawn("node", [SERVER_JS], {
    cwd: __dirname,
    env: { ...process.env, T4C_GUARDIAN: "true", T4C_LOG_DIR: LOG_DIR },
    stdio: ["ignore", "pipe", "pipe"]
  })

  const pid = serverProcess.pid
  log(`Server started with PID ${pid}`)

  // Stream stdout to console + file
  serverProcess.stdout.on("data", (data) => {
    const text = data.toString().trim()
    if (text) {
      process.stdout.write(data)
      // Only write non-empty lines to log
      for (const line of text.split("\n")) {
        if (line.trim()) writeLog("server.log", line.trim())
      }
    }
  })

  // Stream stderr to console + error log
  serverProcess.stderr.on("data", (data) => {
    const text = data.toString().trim()
    if (text) {
      process.stderr.write(data)
      for (const line of text.split("\n")) {
        if (line.trim()) writeLog("errors.log", `SERVER: ${line.trim()}`)
      }
    }
  })

  serverProcess.on("exit", (code, signal) => {
    if (isShuttingDown) {
      log(`Server stopped (shutdown requested)`)
      return
    }

    const reason = signal ? `signal ${signal}` : `exit code ${code}`
    logError(`Server crashed! (${reason})`)
    
    serverProcess = null
    scheduleRestart()
  })

  serverProcess.on("error", (err) => {
    logError(`Failed to start server: ${err.message}`)
    serverProcess = null
    scheduleRestart()
  })
}

function scheduleRestart() {
  if (isShuttingDown) return

  const now = Date.now()
  restartTimes.push(now)
  
  // Clean old restart times outside window
  restartTimes = restartTimes.filter(t => now - t < RESTART_WINDOW)
  totalRestarts++

  if (restartTimes.length >= RESTART_LIMIT) {
    logError(`Too many restarts (${RESTART_LIMIT} in ${RESTART_WINDOW / 1000}s) — cooling down ${COOLDOWN_TIME / 1000}s`)
    writeLog("errors.log", `GUARDIAN: Restart limit reached. Cooling down.`)
    
    setTimeout(() => {
      restartTimes = []
      log("Cooldown over, restarting...")
      startServer()
    }, COOLDOWN_TIME)
  } else {
    const delay = 3000
    log(`Restarting in ${delay / 1000}s... (restart #${totalRestarts})`)
    setTimeout(startServer, delay)
  }
}

// ══════════════════════════════════════════════
// HEALTH CHECKS
// ══════════════════════════════════════════════

function healthCheck() {
  if (isShuttingDown || !serverProcess) return

  const req = http.get(`http://localhost:${PORT}/api/health`, { timeout: 5000 }, (res) => {
    let body = ""
    res.on("data", d => body += d)
    res.on("end", () => {
      try {
        const data = JSON.parse(body)
        if (data.status === "ok") {
          lastHealthOk = Date.now()
          healthFailCount = 0
        } else {
          healthFail("Bad status: " + body)
        }
      } catch {
        healthFail("Invalid JSON: " + body.slice(0, 100))
      }
    })
  })

  req.on("error", (err) => healthFail(err.message))
  req.on("timeout", () => { req.destroy(); healthFail("Timeout") })
}

function healthFail(reason) {
  healthFailCount++
  writeLog("errors.log", `HEALTH FAIL #${healthFailCount}: ${reason}`)
  
  if (healthFailCount >= 3) {
    logError(`Health check failed ${healthFailCount}x — force restarting server`)
    killServer()
    // The exit handler will trigger scheduleRestart
  }
}

function killServer() {
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM")
      setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL")
        }
      }, 3000)
    } catch {}
  }
}

// ══════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════

function shutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true
  
  log(`Received ${signal} — shutting down gracefully...`)
  
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
    
    // Force kill after 5s
    const forceTimer = setTimeout(() => {
      if (serverProcess) {
        log("Force killing server...")
        serverProcess.kill("SIGKILL")
      }
    }, 5000)
    
    serverProcess.on("exit", () => {
      clearTimeout(forceTimer)
      log("Server stopped. Guardian exiting.")
      process.exit(0)
    })
  } else {
    process.exit(0)
  }
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

// Windows: handle Ctrl+C (safely — stdin might be unavailable)
if (process.platform === "win32") {
  try {
    if (process.stdin.isTTY || process.stdin.readable) {
      const rl = require("readline").createInterface({ input: process.stdin })
      rl.on("SIGINT", () => shutdown("SIGINT"))
      rl.on("close", () => {}) // Don't crash on stdin close
    }
  } catch (e) { /* stdin not available — no problem, SIGINT/SIGTERM still work */ }
}

// ══════════════════════════════════════════════
// STATUS ENDPOINT (guardian's own mini-server)
// ══════════════════════════════════════════════

// Guardian writes a status file that the server can read
function writeStatus() {
  const status = {
    guardianPid: process.pid,
    serverPid: serverProcess?.pid || null,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    totalRestarts,
    lastHealthOk,
    healthFailCount,
    restartsInWindow: restartTimes.length,
    logDir: LOG_DIR
  }
  
  try {
    fs.writeFileSync(
      path.join(LOG_DIR, "guardian-status.json"),
      JSON.stringify(status, null, 2)
    )
  } catch {}
}

// ══════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════

console.log(`
╔═══════════════════════════════════════════════╗
║  T4C Guardian — Process Manager              ║
║  Logs:    ${LOG_DIR.replace(/\\/g, "/")}
║  Server:  ${SERVER_JS.replace(/\\/g, "/")}
╚═══════════════════════════════════════════════╝
`)

log("Guardian starting...")
startServer()

// Health check every 30s (start after 10s to let server boot)
setTimeout(() => {
  setInterval(healthCheck, HEALTH_INTERVAL)
}, 10_000)

// Write status file every 10s
setInterval(writeStatus, 10_000)
writeStatus()
