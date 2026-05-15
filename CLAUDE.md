# T4C / CarDatax — Claude Code Context

> **Lees dit volledig op elke sessie-start. Daarna SESSION-STATE.md.**

---

## STOP. ALTIJD EERST.

1. **Lees `SESSION-STATE.md`** voor je iets doet — dat vertelt waar we zijn.
2. **Backup voor elke wijziging**: `bash /opt/t4c/scripts/t4c-backup.sh "<reden>"`
3. **Log elke significante stap** in `/opt/t4c/data/claude-log/$(date +%Y-%m).md`
4. **Update SESSION-STATE.md** voor je afsluit — anders weet de volgende sessie niets.
5. **Geen secrets in chat, code, of commits**. API keys staan in `.env`, daar blijven ze.

---

## Project

**T4C / CarDatax** — Nederlands B2B platform voor autohandelaren. Drie gezichten:
- `transfer4cars.com/` + `/aanbod/` + `/veilingen/` — publieke verkoop site
- `cardatax` op `/m/` — Dealer Toolkit (PWA, taxatie + scanner)
- `/admin/` — Jurgen only

CarDatax tech stack is **strikt vertrouwelijk** voor externen. Naar buiten alleen "CarDatax AI", geen details.

---

## Architectuur

| | |
|---|---|
| Server | HP Z440 in Langeraar |
| OS | Ubuntu 24.04 |
| IP | 192.168.1.200 (lokaal) / via Cloudflare Tunnel extern |
| User | `deniz` (jij/Jurgen) |
| SSH alias | `ssh t4c` (in Windows ssh config) |
| Code | `/opt/t4c` |
| Repo | `denizsenol1996-art/T4C` (private) |
| Backend entry | `/opt/t4c/backend/server.js` |
| Routes | `/opt/t4c/backend/routes/` |
| Lib | `/opt/t4c/backend/lib/` |
| DB | `/opt/t4c/data/t4c.db` (sql.js, in-memory; atomic save naar disk via rename) |
| Lock-file | `/opt/t4c/data/.t4c-server.lock` (PID; voorkomt tweede instance, sinds 15 mei 2026) |
| SAFE restore | `/opt/t4c/data/SAFE-{datum}.db` (chmod 444, buiten rotation, autoRestore tries deze EERST) |
| DB backups | `/opt/t4c/data/backups/` (auto elke 6h, daily 03:00 cron, handmatig via scripts/t4c-backup.sh) |
| Service | PM2 process `t4c-server` op port 3000 |
| Tunnel | `cloudflared` systemd service |
| Coolify | `admin.transfer4cars.com` |
| Cockpit | `server.transfer4cars.com` |

### Belangrijke modules
- `lib/intelligence.js` (1018 r) — auto-learning market scanner: source scoring, trend detection, autoQueue
- `lib/scoring.js` — scoring module
- `lib/pricing.js` — pricing helpers (depreciation, kmCorrection, learn/getLearned)
- `lib/trade-engine.js` — Trade Engine v4 (risico → bod conversie)
- `lib/comparable-engine/` — comp engine met confidence
- `lib/twins.js` — platform-twins (Aygo/C1/107/108 etc) listing pooling
- `lib/auth.js` — JWT (HARDCODED secret in file — niet in env)
- `routes/valuation.js` (1034 r) — main pricing endpoint `/api/dealer/price`
- `routes/intelligence.js` — `/api/taxatie/validate` (GPT second-opinion)
- `routes/extended-taxatie.js` — `/api/extended-taxatie` met conditie checkboxes
- `routes/admin.js` — `/api/feedback` (echte feedback intake)
- `routes/misc.js` — `/api/taxatie/feedback` (oudere endpoint, schema mismatch)
- `routes/vehicle.js` — `/api/vehicle/enriched` (Finnik scrape)
- `routes/market.js` (1010 r) — listings + comp engine
- `dv-webhook.js` — DV/GO Remarketing webhook ontvang

### Tabellen die ertoe doen
- `users` — login (id 3=Jurgen admin, id 5=Jort inkoper; rest deactivated/removed)
- `taxaties` — alle taxaties (heeft `vin TEXT` veld dat nog niet gevuld wordt)
- `voorraad`, `voorraad_tmp`, `dv_vehicles` — voorraad
- `dealer_feedback` — feedback met `make/model/year/our_bod/sold_price/feedback(JSON)/created_at`
- `pricing_lessons` — GPT-gegenereerde regels uit feedback (write-only nu, niet uitgelezen)
- `learned_prices`, `accuracy_log` — learning tabellen
- `source_scores`, `market_snapshots`, `market_digests`, `crawl_queue` — intelligence engine
- `veilingen`, `veiling_biedingen`, `facturen` — veiling systeem
- `car_photos` (kolom heet `filename` NIET `foto_url`)

---

## KRITIEKE REGELS — NOOIT BREKEN

### Pricing
- **v11 blend engine is BEVROREN** (sinds ~25 maart 2026, herbevestigd 15 mei). Niet aanraken: `lib/intelligence.js`, `lib/pricing.js`, `lib/trade-engine.js`, of de pricing logica in `routes/valuation.js`.
- Pricing-aanpassingen alleen via additieve lagen (bijv. damage correction module, advisory layer post-v11).
- Voor pricing-relevante wijziging: **eerst testen tegen referentie-auto's** (zie REFERENTIE PRICES hieronder).

### Code patronen
- **Nooit `sed` op `server.js`** (gebruik Python of read+write). Memory-regel #9.
- Na elke JS edit: `node --check <bestand>`.
- PM2 restart altijd met `--update-env` flag.
- 404 catch-all in `server.js` komt **NA** DV webhook mount, anders eet hij `/api/dv/webhook`.
- `addVeiling`: alle velden expliciet met defaults, anders SQL error.
- `/api/image` returnt JSON, niet img tag.

### Database
- **`sql.js`** (pure-JS WASM SQLite) — DB leeft in PM2 proces-geheugen. `better-sqlite3` is aanwezig in `node_modules/` maar **NIET gebruikt** door `backend/db.js` (bevestigd 15 mei 2026; eerdere CLAUDE.md zei het andersom — fout).
- Disk file `/opt/t4c/data/t4c.db` is een snapshot, herschreven door:
  - `scheduleSave()` debounced 5s na elke write
  - `setInterval(forceSave, 30000)` elke 30s (was 120000, verlaagd 15 mei)
  - SIGINT/SIGTERM/exit handlers
- Save = `fs.writeFileSync(t4c.db.tmp)` + `fs.renameSync(tmp→db)` (atomic). Verwacht: `stat t4c.db` toont **nieuwe Birth-tijd** na elke save. Geen open file-handle in `/proc/<pid>/fd/` voor t4c.db.
- Voor multi-row UPDATE/DELETE: **eerst backup**, eventueel `pm2 stop t4c-server` om in-flight writes te voorkomen.
- Read inspecties altijd via `sqlite3 -readonly`. Voor "echte" referentie zonder live-write interferentie: gebruik `sqlite3 -readonly /opt/t4c/data/SAFE-*.db ...`.
- Multi-statement queries voor sqlite3 CLI: gebruik `--init` of split, `.schema X .schema Y` werkt niet.

### DB & Backup safety (post 15-mei-2026 incident)
- **Eén t4c-server instance, altijd.** `server.js` heeft lock-file (`/opt/t4c/data/.t4c-server.lock`); tweede instance met levend PID → `process.exit(1)` + CRASH.txt + alert.
- **`backend-test-full/` is gearchiveerd**. Map = `/opt/t4c/backend-test-full.ARCHIVE-20260515/`. Bevat `DO_NOT_START.txt`. Bij start zou hij dezelfde `DATA_DIR` delen met productie → race condition zoals 11-15 mei.
- **SAFE-{datum}.db** conventie voor expliciete restore-points bij milestones:
  ```bash
  cp /opt/t4c/data/t4c.db /opt/t4c/data/SAFE-$(date +%Y-%m-%d).db
  chmod 444 /opt/t4c/data/SAFE-$(date +%Y-%m-%d).db
  ```
  Ligt **buiten** `/data/backups/` → cleanup rotation raakt 'm niet.
- **autoRestore volgorde** (`db.js`, post-fix 15 mei):
  1. `SAFE-*.db` in `DATA_DIR` op mtime desc — handmatig, expliciet betrouwbaar
  2. `t4c-backup-{ISO-ts}.db` in `BACKUP_DIR` op mtime desc — auto-backups elke 6h
  3. **NIET meer**: `t4c-pre-*`, `t4c-fix-*`, `t4c-backup-GOED-*`, `*PRE-*` (kunnen oude state hebben → data verlies).
- **Watchdog** (`/opt/t4c/watchdog.sh`, cron elke minuut): health check + alert naar `/opt/t4c/logs/watchdog-alert.log` + `pm2 restart t4c-server`. **GEEN auto-restore meer** — verwijderd 15 mei na incident.

### AI
- **GPT-5.4** voor alle pricing/VIN/chat. Gebruik `max_completion_tokens` — `max_tokens` geeft 400 op gpt-5.x.
- **gpt-image-1.5** voor blueprint images. Size 1536x1024, quality medium, geen `response_format` parameter.
- API key in `/opt/t4c/backend/.env`. **Nooit** committen, **nooit** in chat plakken.
- `temperature=0` voor deterministische pricing.

### Auth/Security
- JWT_SECRET hardcoded in `lib/auth.js`. Roteren = secret in code wijzigen + PM2 hard restart (`pm2 delete` + `pm2 start`).
- Active users (per 8 mei 2026): id 3 (Jurgen, admin), id 5 (Jort, inkoper).
- Verwijderd: id 4 (Ewout, ZZP'er, no NDA, removed na incident).
- Deactivated: id 1 (admin seed), id 2 (dealer seed). `users.json` is leeggemaakt.

---

## WORKFLOW

### Bij elke sessie-start
```bash
cd /opt/t4c
cat SESSION-STATE.md         # waar zijn we?
git log --oneline -10        # wat is er recent gebeurd?
pm2 status                   # draait alles?
```
Begroet user kort met: "Vorige sessie: <samenvatting>. Wat wil je oppakken?"

### Voor elke code/DB wijziging
```bash
bash /opt/t4c/scripts/t4c-backup.sh "<korte-reden>"
# bewerken...
node --check <bestand>       # voor JS files
# of: dry-run query met -readonly voor DB
```
Toon de wijziging, vraag bevestiging voor non-triviale changes, **dan pas** apply.

### Logging
Elke significante actie naar `/opt/t4c/data/claude-log/$(date +%Y-%m).md`:
```
## YYYY-MM-DD HH:MM:SS — <korte titel>
- Wat: <wijziging>
- Waarom: <reden>
- Files: <paden>
- Backup: <pad naar backup>
- Verificatie: <test/check uitkomst>
```

### Voor sessie-einde of grote mijlpaal
Update `SESSION-STATE.md` met:
```markdown
# Session State — Last updated: YYYY-MM-DD HH:MM by Claude

## Waar zijn we
<2-3 zinnen status>

## Laatst gedaan
- <wijziging 1>
- <wijziging 2>

## Volgende stap
<wat moet er nu gebeuren>

## Open issues / blockers
- <issue>
```

---

## CONVENTIES

- **Nederlands** primair. Engels alleen op verzoek.
- **Kort. Direct. Geen overdreven caveats.**
- **Geen sessie-duur opmerkingen** ("genoeg voor vanavond?", "slaap lekker", "wil je stoppen?"). Jurgen bepaalt zelf wanneer hij stopt.
- **Complete deliverables** boven piecemeal patches.
- **100% data validatie**, geen 80% oplossingen.
- **Altijd backup** voor wijziging.
- **Altijd verifiëren** na wijziging.

---

## REFERENTIE PRICES (voor pricing test)

Auto's die "goed" moeten uitkomen na pricing change:

| Auto | km | Inkoop verwacht |
|---|---|---|
| BMW 535i F11 | 289k | €5.500 – 5.800 |
| Mercedes E350 CGI | 269k | €4.700 – 5.350 |
| Toyota Aygo | 150k | €2.350 – 2.600 |
| Audi A3 | 200k | €2.150 – 2.400 |
| Seat Leon | 288k | €1.150 – 1.300 |
| MG ZS EV | 25k | €7.000 |

Trade Engine v4 matcht deze al (25 maart). Bewaak deze bij wijzigingen.

---

## BEKENDE TODO / OPEN ISSUES

- **Versie-drift**: `package.json` v10.7.0, `lib/state.js` v10.16.0, git HEAD v10.18.53 — uncommitted code in working tree (`git status -s` toont 10+ M). Sync nodig.
- **Dubbele inserts** bij taxatie save: 4 van 5 unieke taxaties op 15 mei dubbel ingevoerd op exact dezelfde seconde (CALIFORNIA, SLK, I20, CAPTUR). Verdacht: double-render/double-POST in dealer toolkit. Latente bug.
- **`taxaties.user_id` NULL bij save** — alle 9 taxaties van 15 mei hebben NULL user_id. Analytics op `taxaties.user_id` zijn blind.
- **`taxaties.final_bod` NULL** — kolom wordt niet gevuld door save-flow. Feature niet afgemaakt.
- `dv-webhook.js:792` — `scheduleSaveFn` ✓ fixed 8 mei.
- `pricing_lessons` tabel wordt write-only gebruikt (GPT genereert regels, niemand leest ze).
- Aygo/C1/107/108 budget volume: +50% gemiddeld over-bid (data laat zien bij 16 entries).
- Frontend desktop layout amateuristisch — nodig: bottom nav weg, minder neon, 4 kernkaarten boven.
- VIN data integratie wacht op GT Motive output (8 mei 2026 meeting).
- Pricing parallel endpoint refactor (zie `T4C-PARALLEL-PRICING-BRIEF.txt`).
- Mollie + SMTP integratie.

### Fundament-fix prioriteit (komende sessies)
- **better-sqlite3 + WAL migratie**: grootschalig, fundament voor echt professional. Weg van sql.js in-memory model → echte file-based DB met locking, multi-instance support.
- `safe-start.sh` documenteren als enige officiële boot-route (i.p.v. directe `pm2 start backend/server.js`).

---

## SNELLE COMMANDOS (cheat sheet)

```bash
# Service
pm2 status
pm2 restart t4c-server --update-env
pm2 logs t4c-server --lines 30 --nostream

# DB read
sqlite3 -readonly /opt/t4c/data/t4c.db "SELECT ..."
sqlite3 -readonly /opt/t4c/data/t4c.db ".schema <tabel>"

# Backup
bash /opt/t4c/scripts/t4c-backup.sh "<reden>"

# Tunnel
sudo systemctl status cloudflared
sudo systemctl restart cloudflared

# Project search
grep -rn "<term>" /opt/t4c/backend --include="*.js" | grep -v "\.bak\|node_modules"
```

---

*Last updated: 2026-05-15 by Claude (post-DB-race-incident stabilisatie — t4c-test killed, watchdog/autoRestore/lockfile/savefreq fixes)*
