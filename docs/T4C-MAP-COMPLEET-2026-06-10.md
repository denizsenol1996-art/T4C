# Transfer4cars.com — Complete Map (alle ins en outs)

> **Gemaakt:** 2026-06-10
> **Scope:** uitsluitend wat onder host `transfer4cars.com` valt (incl. interne services die het via proxy bedient). **Niet** dev.cardatax / `/opt/cardatax-app`.
> **Doel:** dit is het referentie-document. Geen aanname meer, geen gokken. Voor elke wijziging eerst hier kijken.
> **Status:** read-only scan, geen code aangeraakt.

---

## 0 · TL;DR — wat is "de bende" in één oog-opslag

1. **Vier verschillende admin-paden naast elkaar** waarvan er twee in de admin-nav broken/verwarrend zijn (`/admin/klassiek/`, `/admin/atx/`) en één publieke werkende rapport-URL (`/telex-inkoop/...`) waarschijnlijk niet gelinkt is.
2. **ATX-taxatierapport werkt technisch** (DB heeft data, `/api/inbound/*` is gemount, `/telex-inkoop/:id` rendert) — alleen de toegangs-route vanuit de UI is onhelder en wisselt per page.
3. **3 design-DNA's tegelijk op de site** (Outfit + IBM Plex Mono / Plus Jakarta Sans + Inter / oude T4C-style) → inconsistente nav, inconsistente headers, inconsistente role-detect.
4. **10 backup-files** in `/opt/t4c/sites/transfer4cars/` (`.pre-dna-*`) + **40+ backup/archive-dirs** server-breed.
5. **2 lege tabellen** (`facturen`, `biedingen`) terwijl de code ze gebruikt → onbeschreven path. `veilingen` heeft alleen 3 testveilingen.

Detail in secties 6–8.

---

## 1 · Services-stack (5 pm2-procs)

| PM2 | Naam | Code | Port | Bereikbaarheid | Rol |
|---|---|---|---|---|---|
| 12 | `t4c-server` | `/opt/t4c/backend/server.js` | **3000 publiek** | `transfer4cars.com` + `cardatax.com` (cloudflared) | Hoofd-app + proxy-hub |
| 7 | `cardatax-server` | `/opt/cardatax/...` | 3010 publiek | (cardatax marketing-site, los) | Buiten scope |
| 8 | `lyra-server` | `/opt/lyra` | 3100 loopback | via t4c-proxy `/lyra-ai/*` + `/api/lyra/*` | AI-helper |
| 9 | `atx-admin` | `/opt/atx-pipeline/server.js` | 3110 loopback | via t4c-proxy `/telex-inkoop/...` + `/admin/inbound*` + `/api/inbound/*` | **Werk** — taxatie-pipeline |
| 11 | `admin-dashboard` | `/opt/atx-pipeline/admin-dashboard.js` | 3200 loopback | via t4c-proxy `/admin/atx/*` | **Beheer** — monitoring (CPU/RAM/DB-browse) |

**Plus** module `pm2-logrotate` (geen runtime-app).
**Lock-file** `/opt/t4c/data/.t4c-server.lock` voorkomt dubbel-instance van t4c-server.
**ecosystem.config.js**: `kill_timeout=10s`, `min_uptime=10s`, `max_restarts=8`, `restart_delay=3s`, fork-mode (single instance).
**watchdog.sh v2** (cron `* * * * *`) — flock-gate + 3-strikes + 5min cooldown. `/opt/t4c/logs/watchdog-alert.log` had 6× DOWN→recovery + 2× FAILED in mei.

---

## 2 · Werk-laag vs Beheer-laag (jouw vraag, expliciet apart)

Twee aparte werelden, **geen merge**.

### 2A Werk-laag — wat klanten en operators doen
- **Veiling-werk** (klant + admin): t4c-server `/veilingen`, `/veilingen/detail`, `/account`, en in admin `/admin` + `/admin/transport` + `/admin/inbox`. Tabellen: `veilingen`, `veiling_biedingen`, `users`, `contact_requests`.
- **Taxatie-werk** (admin/inkoper): atx-admin op 3110 via `/telex-inkoop/...` + `/admin/inbound/:id`. Tabellen in **atx.db** (apart): `inbound_jobs`, `inbound_taxaties`. Workers: mail-watcher → scraper → taxatie → markt → bod-advies.
- **Voorraad/inkoop** (admin/inkoper): t4c-server `/api/voorraad/*`, `/api/taxatie/*`, `/api/dealer/*`. Tabellen: `vorraad`, `taxaties`, `inkoop_pipeline`, `dealer_feedback`, `inspecties`.
- **AI/data-helpers** (alle staff): Lyra `/lyra-ai/*`, scrapers, market_listings (298k rows).

### 2B Beheer-laag — command-center (over de werk-laag heen)
- **Monitoring** = `/admin/atx/` (admin-dashboard op 3200): CPU/RAM/disk/PM2-status/DB-browser/job-tellers.
- **System-admin** = T4C eigen `/admin/` admin-pages (users, settings, api-keys, scraper-test, logs, market-stats, crawler-stats).
- **Inkomende post / contact** = `/admin/inbox` (contact_requests CRUD).
- **Analytics** = `/admin/analytics` (GA4 dashboard iframe — vereist GA4-SA fix uit `PICKUP-TRANSFER4CARS-2026-06-10.md`).

**Wat NU mist:** één centrale "command-center"-page die per werk-systeem (Veiling, Taxatie, Voorraad, AI) een kaart toont met status + snelle-link. Dat is geen mergen, dat is een navigatie-shell.

---

## 3 · Backend-routes (16 route-files, ~80 endpoints)

### 3A Middleware-volgorde in server.js
1. trust-proxy + x-powered-by uit
2. CORS
3. `express.json` 10MB **behalve** `/api/extended-taxatie` (50MB)
4. process error-handlers (uncaught/unhandled)
5. Single-instance lock (DB-race-prevention sinds 2026-05-15)
6. Request-logging + stats
7. Login rate-limit `/api/login` (5/15min → 429 + Retry-After)
8. Host-detect → `req.site = "transfer4cars"|"cardatax"|"local"`

### 3B Proxy/static-tabel
| Pad | Target | Auth in t4c | Cookie/Path-rewrite | Wat |
|---|---|---|---|---|
| `/admin/atx/*` | 127.0.0.1:3200 | nee (admin-dashboard heeft eigen wachtwoord `T4C-admin-2026` hardcoded in `admin-dashboard.js:26`) | ja, Path→/admin/atx/ + HTML body prefix | Monitoring-UI |
| `/telex-inkoop` + `/telex-inkoop/:id` | 127.0.0.1:3110 | nee (HTML), client doet zelf `localStorage.t4c_token` voor API-calls | nee | Inbound/rapport-pages |
| `/admin/inbound` + `/admin/inbound/:id` | 127.0.0.1:3110 | nee (HTML) | nee | Identieke rapport-pages onder andere prefix |
| `/api/inbound/*` | 127.0.0.1:3110 | **ja** (`authMiddleware`) | nee | API achter inbound-pages |
| `/api/scraper/photos` | 127.0.0.1:3110 | nee (opaque job_id) | nee | Foto-bestanden uit scrape |
| `/inbound*.js`, `/inbound*.css`, `/admin.css` | 127.0.0.1:3110 | nee | nee | Static assets voor rapport-pages |
| `/lyra-ai/*` | 127.0.0.1:3100 | nee | nee | Lyra UI |
| `/api/lyra/*` | 127.0.0.1:3100 | nee | nee | Lyra API |
| `/admin/klassiek/*` | static `/opt/t4c/sites/cardatax/admin/` | nee | nee | **Oude** cardatax-admin (legacy) |
| `/m/*` | static `/opt/t4c/sites/cardatax/m/` | nee | nee | Dealer-toolkit PWA (cardatax-host) |
| `/photos/*` | static `/opt/t4c/data/photos/` | nee | nee | Veiling-foto's |
| `/sitemap.xml`, `/robots.txt` | `routes/seo.js` | nee | nee | SEO (alleen t4c-host) |

### 3C Endpoint-overzicht per route-file
Volledige tabel is te groot voor inline weergave (~80 endpoints). Beknopt per file, met auth-niveau:

| File | Endpoints (telling) | Auth-niveau (meest) | Functie |
|---|---|---|---|
| `admin.js` | ~24 | `adminOnly` | users CRUD, table-browser, logs, API-keys, crawler-control, market-stats |
| `misc.js` | ~22 | gemengd | register, profiel, settings, contact-requests, analytics, search-history, taxatie-feedback |
| `vehicle.js` | 4 | publiek | plate OCR/scan, RDW-9-endpoints enrichment, known-issues |
| `valuation.js` | ~10+ (file 25k regels) | `staffOnly` | `/api/dealer/price`, comp-pool, market-pricing |
| `taxatie.js` | ~8 | `staffOnly` | taxatie save/list/get/delete, confidence, portfolio, DB-backup |
| `extended-taxatie.js` | 1 | `staffOnly` | 2-pass Vision (50MB body) |
| `images.js` | 3 | gemengd | catalog-photo cache, generate, list |
| `pdf.js` | 1 | `staffOnly` | taxatie-PDF (2 pagina's branded) |
| `dealer.js` | 6 | `staffOnly` | voorraad-kosten, inkoop, verkocht, dashboard |
| `veilingen.js` | ~10 + SSE | gemengd | CRUD, bieden, SSE-stream, foto-upload, auto-status (60s interval) |
| `ai-chat.js` | 2 | `authMiddleware` | `/api/ai/chat`, `/api/ai/validate` |
| `market.js` | ~5 | `authMiddleware` | markt-data, crawl-queue |
| `intelligence.js`, `inspectie.js`, `voorraad.js`, `scanner.js`, `seo.js` | divers | gemengd | scoring, inspectierapport, inventaris, scanner-flows, SEO |
| `server.js` zelf | `/api/login` + `/api/me` | publiek/JWT | Auth-entry |

**Bende-signalen in code:**
- Duplicate: `/api/profiel/password` (PUT) **én** `/api/me/password` (POST) doen hetzelfde.
- `/api/extended-taxatie` heeft eigen 50MB body-limit (de hand-patch uit memory).
- `/api/admin/bulk-seed-queue` + `/api/admin/cleanup-db` zonder auth — risico.
- Cache-laag dubbel: DB-cache + in-memory `enrichCache` in `vehicle.js`.

---

## 4 · Frontend-pages (20 pages onder `/opt/t4c/sites/transfer4cars/`)

### 4A Page-tabel
| Pad | Auth | API-calls | Opmerking |
|---|---|---|---|
| `/index.html` | publiek (login inline) | `/api/login`, `/api/register`, `/api/public/contact`, `/api/dv/voorraad` | 65KB. **Eigen DNA** (Plus Jakarta Sans + Inter + JetBrains Mono) |
| `/login/` | publiek | `/api/login` | 3KB. Outfit-DNA |
| `/aanmelden/` | publiek | `/api/register` | B2B/koper-signup |
| `/aanmelden/ontvangen/` | publiek | — | TODO-comments met `XXXXX` GA4/Ads placeholders |
| `/aanbod/` | login | `/api/public/voorraad` | Guest-wall. Role-gating in JS |
| `/auto/` | login | `/api/public/voorraad/{id}` + `/api/dv/vehicles/{id}` | **Dual fallback API** |
| `/veilingen/` | publiek | `/api/veilingen/public` | Eigen hero-DNA (Plus Jakarta Sans), niet Outfit |
| `/veilingen/detail/` | login (JS-gate) | `/api/veiling/{id}`, `/api/veiling/{id}/bied`, SSE | bidding-UI |
| `/account/` | login | `/api/mijn-veilingen`, `/api/mijn-facturen`, `/api/profiel`, `/api/profiel/password`, `/api/profiel/export` | Dashboard |
| `/transport/` | publiek | — | Static landing |
| `/verkoop/` | publiek | — | Static, **eigen nav** |
| `/verkoop/aanbod/` | publiek | `/api/public/voorraad`, `/api/dv/vehicles` | Dual API |
| `/verkoop/auto/` | publiek | idem | idem |
| `/admin/` | staff-gated (`admin/staff/t4c`) | `/api/veiling/*`, `/api/contact-requests/count` | Auction mgmt + sidebar |
| `/admin/inbox/` | staff-gated | `/api/contact-requests` | Contact-mgmt. Hard JS-redirect bij 401 |
| `/admin/analytics/` | staff-gated | GA4 iframe | Wacht op GA4-SA fix |
| `/admin/transport/` | staff-gated | transport-API | Logistiek-planner |
| `/privacy/` | publiek | — | Static, eigen header |
| `/voorwaarden/` | publiek | — | (in tree maar niet meegescand) |
| `/404.html` | publiek | — | 2.2KB |

### 4B Nav-consistentie (matrix)
| Link | `/` | `/aanbod/` | `/veilingen/` | `/account/` | `/admin/` | `/verkoop/` | `/login/` |
|---|---|---|---|---|---|---|---|
| Voorraad | nee | active | ja | ja | sidebar | nee | nee |
| Veilingen | nee | ja | active | ja | sidebar | nee | nee |
| Transport | nee | ja | ja | ja | sidebar | nee | nee |
| Over ons | ja | nee | nee | nee | nee | nee | nee |
| B2B | ja | nee | nee | nee | nee | nee | nee |
| Contact | ja | nee | nee | nee | nee | nee | nee |

**Conclusies nav-bende:**
- `/index.html` heeft een eigen nav-set (Over ons / B2B / Contact) die nergens anders bestaat.
- Admin-pages gebruiken **sidebar**, niet de horizontale nav.
- `/transport/` en `/verkoop/` hebben minimale/eigen nav.
- `#user-area` ID is wel universeel, maar wordt door `/index.html` niet gebruikt (eigen hero-login).

### 4C Bende-signalen frontend (top-15)
1. 10× `.pre-dna-*` backup-files door de tree (bv. `login/index.html.pre-dna-20260609-evening`).
2. **3 fonts-systemen** door elkaar (Outfit/Plex Mono · Plus Jakarta Sans/Inter · JetBrains Mono).
3. Admin-pages linken naar `/admin/klassiek/` en `/admin/atx/` — eerste = legacy static, tweede = monitoring (3200). **Niemand linkt zichtbaar naar `/telex-inkoop/` voor het echte rapport.**
4. Index.html zet rol-routing in `localStorage.setItem` callback; andere pages doen JS-init. Inconsistente flow.
5. Dual API-fallback op `/auto/` en `/verkoop/auto/` — `/api/public/voorraad/{id}` **én** `/api/dv/vehicles/{id}`.
6. `/veilingen/` heeft eigen hero-DNA buiten Outfit-systeem.
7. **Checkout-/betaal-flow ontbreekt** — `/account/` toont gewonnen biedingen + facturen, maar geen page om af te rekenen.
8. Hardcoded GA4 ID `G-ECSBWCG10K` in `/aanbod/`, `/account/`, `/login/`, `/auto/`. Niet op `/`.
9. TODO's met `XXXXX` placeholders in `/aanmelden/ontvangen/`.
10. API-naming inconsistent: `/api/public/*` · `/api/dv/*` · `/api/veilingen/*` · `/api/profiel/*` · `/api/contact-requests/*`. Geen versioning.
11. localStorage tokens `t4c_token` + `t4c_user` zonder refresh + zonder expiry-check. Logout = `localStorage.clear()`.
12. Mobile-nav-toggle code dubbel uitgevoerd (verschillende handlers per DNA).
13. `/verkoop/` is eigen wereld (eigen theme + nav).
14. Auth-gate inconsistent: `/admin/inbox` doet hard `location.href=/login/?next=…`, andere pages tonen guest-wall.
15. **Geen enkele page zegt expliciet "ATX-rapport hier" met directe URL** — terwijl `/telex-inkoop/:id` werkt.

---

## 5 · Database (alle data in `/opt/t4c/data/t4c.db`, taxatie-pipeline in `/opt/atx-pipeline/data/atx.db`)

### 5A Hoofdtabellen t4c.db (20+ actief)
| Tabel | Rows | Doel |
|---|---|---|
| `market_listings` | 298 239 | Scrapes van 12+ marktplaatsen |
| `taxaties` | 4 261 | Snelle + uitgebreide waardeschattingen |
| `dealer_feedback` | 662 | Eigen-bod vs onze-schatting → leerregels via GPT |
| `vorraad` (sic) | 30 | Inventaris |
| `audit_log` | 35 | Append-only ledger |
| `veilingen` | 3 | Alle **actief** (test-veilingen 24h/batch/free) |
| `contact_requests` | 12 | B2B + buyer signups |
| `veiling_biedingen` | 2 | Biedhistorie |
| `inspecties` | 2 | Inspectierapporten |
| `inkoop_pipeline` | 0 | Pre-taxatie intake (kenteken + contact + status) |
| `facturen` | 0 | **Leeg** — code refereert er wel naar |
| `biedingen` | 0 | **Leeg** (echte biedingen in `veiling_biedingen`?) |
| `price_history`, `learned_prices`, `pricing_lessons`, `search_history`, `settings`, `transport`, `seller_profiles`, `voorraad_tmp`, `email_queue`, `dealer_profiles`, `leads` | div | werk-tabellen |

### 5B atx.db (apart!)
- `inbound_jobs` (~2000+, status-track) — niet in t4c.db
- `inbound_taxaties` — `t4c_handelswaarde`, `t4c_response_json`, `scrape_completed_at`, `bod_advies_max`, `markt_listings_json`
- 7× `.bak-pre-*` backup-files (mei 24–28)

### 5C Rollen
| Rol | Aantal | Waar gebruikt |
|---|---|---|
| `admin` | 2 | `adminOnly` gate |
| `t4c` | 1 | `t4cOnly` gate |
| `inkoper` | 1 | `staffOnly` gate |
| `dealer` | (?) | `dealerPlus` gate |
| `koper`, `klant` | (?) | self-register + `/veilingen` |

Geen 2FA-kolom. Geen `auth_provider`-kolom (Google-login zou er een nodig hebben → zie `MORGEN-2026-06-11.md`). Geen `deleted_at` op `users` — soft-delete via audit-log + PII-wipe.

### 5D audit_log (35 entries) — actions die wél worden gelogd
- `login_success` (20×), `login_failed`, `login_blocked`
- `password_changed`, `profile_update`
- `bid_placed`
- `account_deleted` (soft-delete + PII-anon)
- `b2b_aanmelding_afgewezen`
- `data_export`

### 5E Verrassingen DB
- `facturen` + `biedingen` leeg, maar code schrijft er code voor → onbeschreven flow.
- `veilingen` alleen 3 testveilingen, allemaal status='actief'.
- `market_listings` heeft 298k rows zonder FK naar users/dealers (puur crawl).
- Rate-limit-state alleen in-memory (Map per IP) — bij restart verloren.
- Audit-log mag NOOIT request laten falen (fail-silent in `audit.js:42-44`).

---

## 6 · De vier admin-paden — kerntelling

Hier zit veel van jouw "kanker bende"-gevoel.

| Pad | Wat het is | Auth | Werk- of beheer-laag |
|---|---|---|---|
| `/admin/` (t4c-host) | T4C eigen admin (veiling/transport/inbox/analytics + system tabellen) | t4c-JWT, role∈{admin,staff,t4c} | **Beheer + Werk** (mengt veiling-CRUD met system-admin) |
| `/admin/klassiek/` | **Legacy** static-dir uit oude cardatax admin (gebleven na cleanup-sprint 06-03) | geen (statisch) | Dood gewicht of nog gebruikt? Onduidelijk |
| `/admin/atx/` | Reverse proxy → `admin-dashboard.js` (port 3200) | Eigen hardcoded password `T4C-admin-2026` | **Beheer** — monitoring/dashboard |
| `/telex-inkoop/` + `/telex-inkoop/:id` | Reverse proxy → `atx-admin` (port 3110) **rapport-pages** | client-side `localStorage.t4c_token` → `/api/inbound/*` met t4c-JWT-authMiddleware | **Werk** — taxatie-rapporten |
| `/admin/inbound` + `/admin/inbound/:id` | **Identiek** aan `/telex-inkoop/...` (dezelfde proxy → 3110) | idem | Werk — dubbele alias |

**Dit is wat verkeerd voelt:**
- 4 paden voor "admin", waarvan 2 voor hetzelfde (`/telex-inkoop` = `/admin/inbound`).
- Geen enkele page (frontend-scan bevestigde dit) heeft een zichtbare link naar `/telex-inkoop/` of `/admin/inbound/`. Admin-nav heeft alleen `/admin/atx/` (= monitoring, niet rapport) + `/admin/klassiek/` (= legacy).
- `/admin/atx/` heeft eigen hardcoded password los van t4c-auth. Twee inloggen.

---

## 7 · ATX-taxatie-rapport — de keten end-to-end

### Hoe een taxatie nu loopt
1. Mail-watcher (`atx-admin`) checkt mailbox elke 60s → maakt `inbound_jobs`-rij (status `scraping`).
2. Scraper-worker doet OCR/Vision → vult `inbound_taxaties` (`scrape_completed_at`, `scrape_duration_ms`).
3. Taxatie-worker stuurt foto's + metadata naar T4C `/api/...` (waarschijnlijk via interne call) → krijgt `t4c_handelswaarde` + `t4c_response_json`.
4. Markt-worker doet gaspedaal-lookup + berekent bod-advies → `bod_advies_max`, `markt_listings_json`.
5. **Rapport-render**: `inbound-detail.html` (gemount op 3110) toont alles. Bereikbaar publiek op:
   - `https://transfer4cars.com/telex-inkoop/:id` ✅
   - `https://transfer4cars.com/admin/inbound/:id` ✅ (alias)
   - `http://127.0.0.1:3110/admin/inbound/:id` (alleen via ssh-tunnel)

### Waarom je het niet ziet
**Het werkt technisch.** ~2000 records in atx.db, route is gemount, page rendert (200 OK). Wat ontbreekt:
- **Geen UI-link** vanuit `/admin/` of `/account/` naar `/telex-inkoop/` of `/admin/inbound/`. Admin-sidebar wijst alleen naar `/admin/atx/` (monitoring) en `/admin/klassiek/` (legacy).
- **Auth-keten klopt mogelijk niet altijd**: page is publiek HTML (3110), maar API-calls daarbinnen gaan naar `/api/inbound/*` op t4c-server (vereist JWT). Als `localStorage.t4c_token` daar ontbreekt of verlopen is → 401 → "niets te zien".
- **Geen overzichts-page** met alle taxaties als lijst. `/admin/inbound` toont één lijst (inbound.html, 116 regels), maar nergens duidelijk gelinkt.

### Wat de scan voorstelt te verifiëren (geen wijziging gedaan)
- Test: `curl https://transfer4cars.com/telex-inkoop/` met je JWT → werkt het?
- Test: idem `/admin/inbound/:id` met geldige id → werkt het?
- Als allebei 200 → de fix is puur navigatie/UI (link toevoegen). Geen code-merge.

---

## 8 · De bende — concrete lijst (geen vaagheden)

### 8A Backup/archive-files (server-breed)
| Pad | Aantal | Type |
|---|---|---|
| `/opt/t4c/data/*.db*` backups + WAL | 20+ files, 350+ MB | Backup + WAL shards |
| `/opt/atx-pipeline/data/*.bak-pre-*` | 7 | ATX backups mei 24–28 |
| `/tmp/atx-*` fase1..fase8 | 30MB, 10d oud | Stale temp-work, geen cleanup |
| `/opt/t4c/backend.RECOVERY-FAILED/` | 1 dir | Fallback-dir |
| `/opt/t4c/backend-test-*.ARCHIVE-*/` | 3 dirs | Test-branches |
| `/opt/t4c/backups/pre-zombie-fix-*` | 1 dir | server.js/db.js/watchdog.sh pre-fix |
| `/opt/t4c/sites/transfer4cars/**/*.pre-dna-*` | 10 | Per-page DNA-iteratie-backups |
| `/opt/t4c/sites/cardatax/admin/index.html.bak-pre-cleanup-20260603` | 1 | Cleanup-sprint backup |

### 8B Code-bende
- Dubbele wachtwoord-endpoints (`/api/me/password` + `/api/profiel/password`).
- Dual API op detail-pages (`/api/public/voorraad/{id}` + `/api/dv/vehicles/{id}`).
- 4 admin-paden waarvan 2 alias en 1 legacy.
- 3 fonts-systemen door elkaar.
- TODO/XXXXX-placeholders in `/aanmelden/ontvangen/`.
- 2 lege tabellen die wel code-paden hebben (`facturen`, `biedingen`).
- `/api/admin/bulk-seed-queue` + `/api/admin/cleanup-db` **zonder auth**.
- Watchdog-alert-log heeft 6× DOWN→recovery + 2× FAILED in mei (recente recoveries OK na v2-watchdog 06-09).
- Hardcoded admin-password in `admin-dashboard.js:26` (`T4C-admin-2026`).
- Geen 2FA, geen `auth_provider`-kolom — Google-login uit `MORGEN-2026-06-11.md` zou hier op stuklopen.

### 8C Crontab actief (deniz)
- `* * * * * /opt/t4c/watchdog.sh` — gezond v2
- backup-cron @3:00
- disk-alert-cron @8:00
- snapshot-cron @4:00

---

## 9 · Anti-break-regels voor verdere sessies

1. **Niets mergen.** T4C-veiling / atx-taxatie-pipeline / admin-dashboard / lyra blijven 4 aparte codebases. Eventuele "command-center" = navigatie-shell met links, geen samenvoegen van apps.
2. **Geen overschrijven zonder `.bak-<datum>` ernaast.** Voor élke `Edit`/`Write`: backup eerst.
3. **Per stap user-OK.** Per stap eerst diff/intent → user "ja" → dan doen.
4. **Geen `pm2 delete`, geen `rm`, geen DB-drop zonder expliciet akkoord per regel.**
5. **Sluit altijd t4c-server clean** (SIGTERM → forceSave → exit) — nooit `kill -9`.
6. **Backup vóór schema-change**: `cp /opt/t4c/data/t4c.db /opt/t4c/backups/pre-<change>-<datum>.db`.
7. **CRASH-LOG bijhouden** bij elke disconnect.
8. **Eén DNA**. Geen nieuwe iteraties bovenop iteraties zonder eerst de bestaande DNA te bevestigen.
9. **Geen dev.cardatax-werk** vanuit deze sessies. Dat is een aparte sessie/repo.
10. **`/admin/klassiek/` niet aanraken** tot besloten is of het weg mag — bewijs eerst dat niemand het meer gebruikt (log-check).

---

## 10 · Beslis-punten voor user (volgordevoorstellen, niet uitvoeren tot OK)

### Snel (≤30 min werk per stuk)
- **P1 — ATX-rapport vindbaar maken.** Voeg in `/admin/` (transfer4cars) sidebar één link toe: "Taxatie-rapporten" → `/telex-inkoop/` (of `/admin/inbound`). Werk-laag wordt zichtbaar zonder code-merge. *1 regel HTML.*
- **P2 — Admin-nav opschonen.** Verwijder `/admin/klassiek/` link als die niet meer gebruikt wordt (eerst log-check); herbenoem `/admin/atx/` naar "Server-monitor" zodat duidelijk is dat het géén rapport is.
- **P3 — Backup-files opruimen.** `.pre-dna-*` (10×) verplaatsen naar `/opt/t4c/backups/cleanup-20260610/`. Geen delete, alleen verplaatsen.

### Middel (1–3 uur)
- **P4 — Eén DNA kiezen voor klant-pages.** Outfit + IBM Plex Mono is de gestabiliseerde (memory `feedback_t4c_veiling_cardatax_dna`). `/index.html` + `/veilingen/` aanpassen naar dezelfde basis.
- **P5 — `/admin/atx/` hardcoded password weg.** Vervangen door t4c-JWT-gate (alleen `role=admin`).
- **P6 — Dubbele endpoints opruimen.** `/api/me/password` weg, alles op `/api/profiel/password`.

### Groter (halve dag+)
- **P7 — Command-center page bouwen** onder `/admin/` met kaarten: Veiling-status / Taxatie-pipeline-status (uit atx.db) / Voorraad-stats / Server-monitor. Pure navigatie + read-only KPI's. **Geen merge.**
- **P8 — `facturen` + `biedingen` lege-tabel-flow afmaken** OF code die ze gebruikt verwijderen. Beslis welke kant op.
- **P9 — Auth-provider-kolom + Google-login** (uit `MORGEN-2026-06-11.md`).

### Niet beginnen tot user kiest
- Niets uit "Groter" tot user zegt "P7 mag".
- Niets aan dev.cardatax.

---

**Einde document.** Volgende stap = user leest dit, geeft akkoord op volgorde, dan pas verandert er iets.
