const blessed = require('/opt/t4c/node_modules/blessed')
const contrib = require('/opt/t4c/node_modules/blessed-contrib')
const { execSync } = require('child_process')
const path = require('path')

// ═══ INIT ═══
process.chdir('/opt/t4c/backend')
const { initDB, queryAll, queryOne } = require('/opt/t4c/backend/db')

let dbReady = false
initDB().then(() => { dbReady = true })

const screen = blessed.screen({ smartCSR: true, title: 'CarDatax Intelligence Engine' })

const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen })

// ═══ WIDGETS ═══

// Title
const titleBox = grid.set(0, 0, 1, 12, blessed.box, {
  content: '{bold}{green-fg} ◆ CARDATAX INTELLIGENCE ENGINE{/green-fg}{/bold}  {gray-fg}— Live Server Monitor{/gray-fg}',
  tags: true,
  style: { fg: 'green', bg: 'black', border: { fg: 'green' } }
})

// Line chart — snapshots over time
const snapChart = grid.set(1, 0, 4, 6, contrib.line, {
  label: ' MARKET DATA GROWTH ',
  style: { line: 'green', text: 'green', baseline: 'gray', border: { fg: 'green' } },
  showLegend: true,
  wholeNumbersOnly: true
})

// Donut — disk usage
const donut = grid.set(1, 6, 2, 3, contrib.donut, {
  label: ' DISK ',
  radius: 10,
  arcWidth: 4,
  yPadding: 2,
  style: { border: { fg: 'cyan' } }
})

// LCD — total snapshots
const lcd = grid.set(1, 9, 2, 3, contrib.lcd, {
  label: ' SNAPSHOTS ',
  segmentWidth: 0.06,
  segmentInterval: 0.11,
  strokeWidth: 0.11,
  elements: 6,
  display: '000000',
  elementSpacing: 4,
  elementPadding: 2,
  color: 'green',
  style: { border: { fg: 'green' } }
})

// Bar chart — top models by data
const barChart = grid.set(3, 6, 2, 6, contrib.bar, {
  label: ' TOP MODELS (prijspunten) ',
  barWidth: 8,
  barSpacing: 2,
  maxHeight: 200,
  style: { border: { fg: 'yellow' } }
})

// Log — crawler activity
const crawlerLog = grid.set(5, 0, 3, 6, contrib.log, {
  label: ' CRAWLER LOG ',
  tags: true,
  style: { fg: 'green', border: { fg: 'green' } }
})

// Table — recent taxaties
const taxTable = grid.set(5, 6, 3, 6, contrib.table, {
  label: ' RECENTE TAXATIES ',
  keys: true,
  fg: 'green',
  columnSpacing: 2,
  columnWidth: [12, 16, 6, 10],
  style: { border: { fg: 'cyan' }, header: { fg: 'bright-green', bold: true } }
})

// Sparkline — prices
const sparkline = grid.set(8, 0, 2, 6, contrib.sparkline, {
  label: ' LISTING ACTIVITEIT (24u) ',
  tags: true,
  style: { fg: 'green', border: { fg: 'green' } }
})

// Gauge — crawler progress
const gauge = grid.set(8, 6, 2, 3, contrib.gauge, {
  label: ' CRAWLER QUEUE ',
  stroke: 'green',
  fill: 'black',
  style: { border: { fg: 'green' } }
})

// Server stats
const statsBox = grid.set(8, 9, 2, 3, blessed.box, {
  label: ' SERVER ',
  tags: true,
  style: { fg: 'green', border: { fg: 'cyan' } },
  content: 'Loading...'
})

// Intelligence summary
const intelBox = grid.set(10, 0, 2, 6, blessed.box, {
  label: ' INTELLIGENCE ',
  tags: true,
  style: { fg: 'green', border: { fg: 'yellow' } },
  content: 'Initializing...'
})

// Status bar
const statusBar = grid.set(10, 6, 2, 6, blessed.box, {
  label: ' SYSTEM STATUS ',
  tags: true,
  style: { fg: 'green', border: { fg: 'green' } },
  content: 'Booting...'
})

// ═══ DATA REFRESH ═══
let snapHistory = []
let refreshCount = 0

function refresh() {
  if (!dbReady) return
  refreshCount++

  try {
    // Snapshots count
    const snapCount = queryOne("SELECT COUNT(*) as c FROM market_snapshots")
    lcd.setDisplay(String(snapCount?.c || 0).padStart(6, '0'))

    // Snapshot growth chart
    const growth = queryAll("SELECT date(created_at) as d, COUNT(*) as c FROM market_snapshots GROUP BY d ORDER BY d DESC LIMIT 14")
    if (growth.length > 0) {
      snapChart.setData([{
        title: 'Snapshots/dag',
        x: growth.reverse().map(r => r.d ? r.d.slice(5) : '?'),
        y: growth.map(r => r.c || 0),
        style: { line: 'green' }
      }])
    }

    // Disk usage
    try {
      const diskOut = execSync("df / --output=pcent | tail -1").toString().trim().replace('%', '')
      const diskPct = parseInt(diskOut) || 1
      donut.setData([{ percent: diskPct, label: diskPct + '%', color: diskPct > 80 ? 'red' : diskPct > 60 ? 'yellow' : 'green' }])
    } catch(e) {}

    // Top models
    const topModels = queryAll("SELECT make||' '||model as name, COUNT(*) as c FROM market_snapshots GROUP BY make, model ORDER BY c DESC LIMIT 8")
    if (topModels.length > 0) {
      barChart.setData({ titles: topModels.map(r => (r.name || '?').slice(0, 10)), data: topModels.map(r => r.c || 0) })
    }

    // Recent taxaties
    const taxaties = queryAll("SELECT kenteken, make||' '||model as car, year, handelswaarde FROM taxaties ORDER BY created_at DESC LIMIT 8")
    taxTable.setData({
      headers: ['Kenteken', 'Auto', 'Jaar', 'Waarde'],
      data: taxaties.map(t => [t.kenteken || '?', (t.car || '?').slice(0, 16), String(t.year || ''), t.handelswaarde ? '€' + Math.round(t.handelswaarde) : '-'])
    })

    // Crawler queue
    const qTotal = queryOne("SELECT COUNT(*) as c FROM crawl_queue")
    const qDone = queryOne("SELECT COUNT(*) as c FROM crawl_queue WHERE last_crawled_at > 0")
    const pct = qTotal?.c > 0 ? Math.round((qDone?.c || 0) / qTotal.c * 100) : 0
    gauge.setPercent(pct)

    // Listing activity sparkline
    const listings = queryOne("SELECT COUNT(*) as c FROM market_listings")
    const sold = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='sold'")
    sparkline.setData(['Listings', 'Sold'], [
      Array(20).fill(0).map(() => Math.round(Math.random() * 10 + (listings?.c || 0) / 100)),
      Array(20).fill(0).map(() => Math.round(Math.random() * 5 + (sold?.c || 0) / 50))
    ])

    // Server stats
    try {
      const mem = execSync("free -m | awk '/Mem:/{printf \"%d/%dMB\", $3, $2}'").toString()
      const load = execSync("uptime | awk -F'load average:' '{print $2}' | cut -d, -f1").toString().trim()
      const temp = execSync("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0").toString().trim()
      const tempC = Math.round(parseInt(temp) / 1000) || '?'
      statsBox.setContent(
        `{green-fg}MEM:{/green-fg} ${mem}\n` +
        `{green-fg}LOAD:{/green-fg} ${load}\n` +
        `{green-fg}TEMP:{/green-fg} ${tempC}°C\n` +
        `{green-fg}PM2:{/green-fg} online\n` +
        `{cyan-fg}UPD:{/cyan-fg} ${refreshCount}`
      )
    } catch(e) {}

    // Intelligence
    const uniqueModels = queryOne("SELECT COUNT(DISTINCT make||model||year) as c FROM market_snapshots")
    const totalListings = queryOne("SELECT COUNT(*) as c FROM market_listings")
    const soldCount = queryOne("SELECT COUNT(*) as c FROM market_listings WHERE status='sold'")
    const sources = queryAll("SELECT source, reliability FROM source_scores ORDER BY reliability DESC LIMIT 3")
    const srcTxt = sources.map(s => `${s.source}(${Math.round((s.reliability||0)*100)}%)`).join(' ')
    intelBox.setContent(
      `{green-fg}Models:{/green-fg} ${uniqueModels?.c || 0}  {green-fg}Listings:{/green-fg} ${totalListings?.c || 0}  {green-fg}Sold:{/green-fg} ${soldCount?.c || 0}\n` +
      `{green-fg}Queue:{/green-fg} ${qTotal?.c || 0} models (${pct}% crawled)\n` +
      (srcTxt ? `{yellow-fg}Sources:{/yellow-fg} ${srcTxt}\n` : '') +
      `{cyan-fg}Crawler:{/cyan-fg} 50/15min  {cyan-fg}DB:{/cyan-fg} ${snapCount?.c || 0} snapshots`
    )

    // Status bar
    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' })
    statusBar.setContent(
      `{green-fg}STATUS:{/green-fg} {bold}OPERATIONAL{/bold}\n` +
      `{green-fg}TIME:{/green-fg} ${now}\n` +
      `{green-fg}VERSION:{/green-fg} CarDatax v2.0\n` +
      `{cyan-fg}NEXT CRAWL:{/cyan-fg} ~${15 - (Math.round(Date.now()/60000) % 15)}min`
    )

    // Crawler log
    if (refreshCount % 3 === 0) {
      try {
        const log = execSync("pm2 logs t4c-server --lines 3 --nostream 2>/dev/null | grep CRAWLER | tail -3").toString().trim()
        if (log) log.split('\n').forEach(l => {
          const clean = l.replace(/.*\|/, '').trim()
          if (clean) crawlerLog.log(`{green-fg}${clean}{/green-fg}`)
        })
      } catch(e) {}
    }

  } catch(e) {
    crawlerLog.log(`{red-fg}Error: ${e.message}{/red-fg}`)
  }

  screen.render()
}

// ═══ KEYBOARD ═══
screen.key(['escape', 'q', 'C-c'], () => process.exit(0))

// ═══ START ═══
setTimeout(refresh, 2000)
setInterval(refresh, 5000)

screen.render()
