# Session State — Last updated: 2026-05-15 20:15 by Claude

## Waar zijn we

Stabilisatie-sessie na ontdekking van **DB race condition**: dubbele PM2 instances (t4c-server + t4c-test) deelden sinds 11 mei dezelfde `DATA_DIR`. Live `/opt/t4c/data/t4c.db` flikkerde elke 2 min tussen vandaag-state (t4c-server win) en 11-mei state (t4c-test in-memory bevroren op boot). Bij PM2 restart was 50% kans op verlies van alle taxaties + feedback van mei 12–15.

Pricing-werk gepauzeerd (productie klaagt structureel +14% overshoot). Vandaag: fundament-fix. Productie t4c-server (PID 3940995, uptime 4d) **niet herstart** — in-memory data heilig tot we boot-veilig zijn.

## 2026-05-15 — Stabilisatie sessie

### Incident opgelost
- Dubbele PM2 race (t4c-test sinds 11 mei 21:02:33) — `kill -9 3867579` (SIGTERM-trap omzeild) + `pm2 delete t4c-test` (~17:45 UTC).
- `backend-test-full/` → `backend-test-full.ARCHIVE-20260515/` met `DO_NOT_START.txt`.
- `SAFE-2026-05-15.db` (chmod 444) gezet als read-only restore-point buiten `/backups/` rotation.

### Data-loss tijdbommen ontmanteld
- **`watchdog.sh`**: autoRestore `cp $LATEST t4c.db` deel verwijderd. Behoudt: health check + `pm2 restart`. Nieuw: alert log `/opt/t4c/logs/watchdog-alert.log`.
- **`db.js` autoRestore**: alfabetisch sort vervangen door `SAFE-*` eerst (mtime desc), dan `t4c-backup-{ISO-ts}.db` (mtime desc). `t4c-pre-*`/`t4c-fix-*`/`*PRE-*` snapshots niet meer kandidaat (zouden 11-mei state of ouder restoren).
- **`db.js` forceSave frequentie**: `setInterval(forceSave, 120000)` → `30000`. Code-comment zei al "every 30 seconds" maar value was 2 min. Drift hersteld + window naar 30s gekrompen.
- **`server.js` lock-file** (`/opt/t4c/data/.t4c-server.lock`): tweede instance met levend PID → `process.exit(1)` + CRASH.txt + alert. Stale lock (PID dood) → safe overschrijven.

### Backups gemaakt vandaag
- `t4c-pre-pm2-delete-t4c-test-race-fix_-20260515-174519.db` — pre-killing van t4c-test
- `SAFE-2026-05-15.db` — read-only expliciete restore-point
- `watchdog.sh.PRE-fix-20260515` — pre-autoRestore-removal
- `db.js.PRE-fix-20260515` — pre-autoRestore sort fix
- `db.js.PRE-savefreq-20260515` — pre-30s-interval
- `server.js.PRE-lockfile-20260515` — pre-lockfile
- `CLAUDE.md.PRE-stabilisatie-20260515` + `SESSION-STATE.md.PRE-stabilisatie-20260515` — pre-doc-update

### Status na fixes (allemaal in working tree, niet gecommit)
| File | Wijziging | Actief? |
|---|---|---|
| `/opt/t4c/watchdog.sh` | autoRestore weg, alert log toegevoegd | **Ja** (cron pakt direct op) |
| `/opt/t4c/backend/db.js` | autoRestore sort fix + forceSave 30s | Nee — actief bij volgende boot |
| `/opt/t4c/backend/server.js` | Lock-file boot-check | Nee — actief bij volgende boot |
| `backend-test-full/` | → `.ARCHIVE-20260515/` | **Ja** |
| `/opt/t4c/data/SAFE-2026-05-15.db` | Aangemaakt, chmod 444 | **Ja** |

### Niet herstart — bewuste keuze
t4c-server PID 3940995 sinds mei 11 22:08:26 (4d uptime). Code-fixes worden actief bij volgende boot. Reden: in-memory state is heilig zolang we niet zeker zijn dat fix-keten compleet werkt bij boot. Volgende boot moet gepland zijn (Jurgen bepaalt wanneer, idealiter na een save-cycle en met SAFE backup als parachute).

### Open TODO's (prioriteit hoog → laag)
- [ ] **better-sqlite3 + WAL migratie**: groot werk, fundament voor echt professional. Komende dagen.
- [ ] Geplande t4c-server PM2 restart (na Jurgen OK) → fixes server.js + db.js worden actief
- [ ] `package.json` 10.7.0 → git HEAD (10.18.53) syncen
- [ ] Uncommitted code in working tree (`git status -s` toont 10+ M): committen of weggooien
- [ ] Audit "frozen files" lijst heroverwegen na pricing-fundament
- [ ] **Dubbele inserts** bij save: 4 van 5 unieke 15-mei taxaties dubbel ingevoerd, zelfde seconde → react double-render of double-POST. Latente bug.
- [ ] `taxaties.user_id` NULL bij save → analytics breken (alle 9 taxaties 15 mei NULL)
- [ ] `taxaties.final_bod` NULL → kolom niet gevuld
- [ ] `safe-start.sh` documenteren als enige officiële PM2 boot-route

### Pricing — VOLGENDE sessie (NIET vandaag)
- Damage correction module bouwen + Vident OBD parser koppelen
- Comp engine drempel verlagen (33 listings = bruikbaar, geen `insufficient_data` meer)
- Blend gewicht adaptief op comp confidence (niet hard 0.4 cap)
- Sub-€2k aparte logica of bewust "geen geautomatiseerde prijs"
- Pricing-code aanrakingen ALLEEN na fundament-fix is af

### Pricing-quality benchmark
Jurgen wil exact bod = wat hij zou betalen, weinig handmatige correctie.

- **Huidige meting**: 35% binnen 10%, gem **+€659 te hoog** (overshoot)
- **Target**: 70% binnen 10%, gem afwijking **<€200**

15 mei observaties (2 feedback entries vandaag):
- HYUNDAI I20: ons bod €9800 vs Jurgen €8800 → +€1000 overshoot (10%)
- MERC SLK 230: ons bod €4850 vs Jurgen €1500 → +€3350 overshoot (220%) — comp engine `insufficient_data` bij 33 listings (mediaan €2250), 100% GPT fallback gaf €6950

---

## Eerder relevant (pre-15-mei)

### 2026-05-08 fixes (audit & runtime)
- `dv-webhook.js:792` `scheduleSaveFn` → `scheduleSave && scheduleSave()` (fix unhandled rejection bij 06:00 cleanup)
- `server.js:226-330` daily-scrapers refactor: top-level i.p.v. ingenest in email-poller. Skip-recovery + `last_daily_scraper_run` marker in `settings`.

### Audit 2026-05-08 nog open
- `/api/search-history` GET 404-storm (frontend admin doet GET, backend alleen POST)
- Schema mismatch `/api/taxatie/feedback` in `routes/misc.js`
- 66 `.bak` files cleanup
- `pricing_lessons` write-only beslissing (inhaken op blend, of schrijflogica weghalen)

### DB-status (16:08 backup, post-fix snapshot)

```
taxaties        : 3025  (vandaag 15 mei: 9 rijen = 5 unieke auto's door dubbel-insert bug)
dealer_feedback : 551   (vandaag: 2, beide overshoot)
market_listings : 224136
voorraad        : 30
dv_vehicles     : 80
```

## Belangrijke paden

- Audit rapport: `/opt/t4c/AUDIT-2026-05-08.md`
- SAFE restore-point: `/opt/t4c/data/SAFE-2026-05-15.db` (chmod 444)
- Backups vandaag: `/opt/t4c/data/backups/*-20260515*`
- Claude log: `/opt/t4c/data/claude-log/2026-05.md` (incident + alle fix-stappen)
- Archive: `/opt/t4c/backend-test-full.ARCHIVE-20260515/` (NIET starten)
