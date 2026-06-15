# AUDIT — transfer4cars.com — 2026-06-10 (avond)

> **Pickup-doc bij crash**: lees deze + `PICKUP-TRANSFER4CARS-2026-06-10.md` + `CRASH-LOG.md`.
> Werk-hervatten = de eerste openstaande BLOCKER aanpakken, deze doc bij elke fix updaten.

## Status van de audit zelf

- [x] Tasks #1–6 aangemaakt in Claude task-system
- [x] Bestaande audit-docs gelezen (T4C-FOUNDATION, MAP-COMPLEET, INFOARCHITECTUUR, ROADMAP, FIX-LOG, MORGEN)
- [x] Code/feature audit `apps/transfer4cars` + `sites/transfer4cars` (Explore-agent A)
- [x] Backend/auth/security audit (Explore-agent B + verificatie-ronde)
- [x] Infra audit (Explore-agent C + verse health-check)
- [x] Klant-dashboard noodzaak-analyse
- [x] Eindprioritering BLOCKERS / BELANGRIJK / NICE-TO-HAVE

## TL;DR (lees als je weinig tijd hebt)

- **De kern werkt**: register → login → veilingen → bieden (SSE live) → admin verwerkt → factuur-record → account-page → AVG-export/delete. Bewezen via E2E-test op 2026-06-09. ~70% van het platform is production-grade.
- **Klant-dashboard bestaat al** op `/account/` met 5 tabs (Biedingen / Gewonnen / Facturen / Profiel / AVG). **Geen nieuw dashboard nodig** zoals cardatax-admin, wel **4 admin-UI's bij te bouwen** (Voorraad/Inkoop/Taxaties/Users) + **betaal-flow toe te voegen** aan `/account/`. Zie sectie E.
- **Niet live-bestendig zonder 6 fixes** (sectie BLOCKERS): plaintext-password-upgrade-pad in db.js, .env mode 664, CORS-wildcard, geen security-headers (helmet/CSP/HSTS), logout invalideert JWT niet server-side, geen betaal-gateway (Mollie/Stripe).
- **Infra-stabiliteit wankel**: `atx-admin` 95 restarts vandaag (memory-leak vermoedelijk), cloudflared had 11:45–12:00 outage met "connection reset by peer", watchdog laatste entry was 2026-06-09 19:36 (cron actief, hoeft niets te loggen als gezond — onbevestigd of hij echt draait).
- **Bestaande docs** (T4C-MAP-COMPLEET-2026-06-10 en T4C-INFOARCHITECTUUR-2026-06-10) dekken al ~60% van wat hier staat. Deze AUDIT is de samenvatting **gefilterd op "wat moet vóór go-live"** en voegt verse health-data + dashboard-aanbeveling toe.

---

## Sectie A — Code/feature inventory (Explore-agent A samengevat)

### Werkt production-ready
Marketing-site `/`, veiling-overzicht `/veilingen/` (SSE real-time), voorraad `/aanbod/`, auto-detail `/auto/`, klant-dashboard `/account/` (5 tabs), veiling-detail-bidding, admin veiling-CRUD met foto-upload, ATX-taxatie-rapport `/telex-inkoop/:id` + `/admin/inbound/:id`, JWT-auth (bcrypt cost 10), rate-limit login (5/15min), email-queue (templates), factuur-auto-generatie bij win, inbox CRUD.

### Half-af (kern werkt, gaten)
- **Betaal-flow**: endpoint `/api/veiling/:id/betaal` markeert factuur 'betaald', **geen** Mollie/Stripe/iDEAL, **geen** UI om te betalen vanuit `/account/`. (`routes/veilingen.js:293-304`)
- **Klant-dashboard**: facturen-tab toont, maar geen factuur-PDF + geen betaal-knop. (`/account/index.html:317-333`)
- **Veiling-foto-upload (admin)**: geen image-validation/size-limit/delete-endpoint/reorder/rollback-on-fail. (`routes/veilingen.js:82-100`)
- **Transport-calculator**: rekent UI-side maar slaat keuze nergens op voor factuur. (`/sites/transfer4cars/index.html:667`)
- **ATX-rapport visibility**: routes werken (200 OK), maar **nergens in admin-nav een link** — admin moet URL handmatig invoeren. (Lost op met 1 regel HTML — zie T4C-INFOARCHITECTUUR.)
- **B2B-aanmelding**: insert+mail werkt, geen auto-approval-logic, status blijft 'nieuw' tot admin het handmatig wijzigt.

### Stub / TODO / DEAD
- **GA4 IDs**: `G-ECSBWCG10K` op `/aanbod/`, `/account/`, `/veilingen/`, `/auto/`. **Niet op `/`**. `/aanmelden/ontvangen/` heeft nog `G-XXXXXXX` placeholder. (`/aanmelden/ontvangen/index.html:11-13`)
- **Lege tabellen met code-referenties**: `facturen` (0 rows) — auto-create-bij-win bestaat maar nog geen winnaar gehad in productie. `biedingen` (0 rows) — dubbel met `veiling_biedingen` (2 rows), waarschijnlijk dead/legacy. Beslis: drop of behouden?
- **Dubbele endpoints**: `/api/me/password` (legacy) vs `/api/profiel/password` (current). Beide werken. Opruimen.
- **`/admin/klassiek/`** legacy static-dir nog gelinkt in admin-nav, niemand gebruikt. T4C-INFOARCHITECTUUR zegt: verwijderen uit nav na log-check.
- **Admin-UX**: `alert()`-pop-ups in admin-pages i.p.v. toast/modal; geen loading-states in account-tabs.

### Mist volledig
- **Betaal-gateway** (Mollie/Stripe/iDEAL) — zonder dit kan een gewonnen veiling niet betaald worden via webshop.
- **Factuur-PDF** (`/api/factuur/:id/pdf`).
- **Admin-UI's voor Voorraad / Inkoop / Taxaties-historiek / Users** — backend bestaat, frontend mist (zie T4C-INFOARCHITECTUUR sectie 1B).
- **KvK-verificatie tegen RDW/KvK-register** bij B2B-aanmelding — nu alleen manual-approve.

## Sectie B — Backend/auth/security

### Geverifieerde BLOCKERS
1. **Plaintext-password-upgrade-pad** in `backend/db.js:1243-1252`: als wachtwoord in DB niet `$2a$`/`$2b$` start, wordt plain-string-equal vergeleken en bij succes ge-bcrypt-upgrade. Risico: gebruikers die nooit inloggen sinds upgrade hebben **plaintext password** in DB. Bij DB-dump → catastrofe. **Mitigatie**: forceer reset op alle non-hashed accounts of expliciet detecteren/flaggen.
2. **CORS open wildcard**: `app.use(cors())` zonder origin-whitelist op `server.js:21`. **Mitigatie**: `cors({origin: ['https://transfer4cars.com','https://www.transfer4cars.com'], credentials: true})`.
3. **Geen helmet/CSP/HSTS/X-Frame-Options**: `server.js` heeft geen helmet-middleware. **Mitigatie**: `app.use(helmet({...}))` met CSP-policy.
4. **`.env` mode 664**: `/opt/t4c/.env` en `/opt/t4c/backend/.env` zijn `rw-rw-r--` (group + other readable). JWT_SECRET, OPENAI_API_KEY, SMTP_PASS, DV_WEBHOOK_PASS lekken naar elke user op de server. **Mitigatie**: `chmod 600`.
5. **Logout invalideert JWT niet server-side**: 7d-token blijft geldig na "logout". Token-blacklist of korte expiry + refresh-token-flow nodig vóór dealers reëel geld bieden.
6. **Betaal-gateway ontbreekt** (zie Sectie A) — eigenlijk een product-blocker, niet een security-blocker, maar gevolg = manuele bank-overschrijving zonder reconciliation = fraude-risico.

### Geverifieerde ZWAK (live mag, fix binnen 2 weken)
- **Geen CSRF-tokens** op state-changing requests. Risico beperkt door JWT-via-Authorization-header i.p.v. cookie, maar `/admin/` POST/PUT/DELETE blijft kwetsbaar voor reflected-XSS-chains.
- **Input-validation ad-hoc** (manuele regex). Geen zod/joi. KvK-check is alleen lengte 8 cijfers.
- **Admin-routes NIET IP-whitelisted**: `/api/admin/*` bereikbaar van overal als token = admin. Geen aparte admin-subdomain.
- **Geen rate-limit op `/api/bid` en `/api/veiling/*`** (alleen `/api/login` heeft rate-limit).
- **Geen password-reset-flow** (`/api/password-reset` ontbreekt). Verwijderd account = geen self-service herstel.
- **File-upload (foto's)**: alleen extensie-check, geen MIME-validatie, geen malware-scan.
- **Disclosure-risico op veilingen**: `beschrijving`/`highlights` editable via PUT zonder change-history. **Memory-regel: tooling mag NOOIT km-misleiding/schade-verzwijging faciliteren** → audit-trail op deze velden toevoegen.
- **DV_WEBHOOK creds in `.env` plaintext** (`transfer4` / `c5eLtlGy!`) — geen rotation.
- **GDPR soft-delete houdt facturen 7 jaar** met user-row `Verwijderd #ID`. Juridisch OK voor fiscaal, UX kan beter.
- **JWT geen IP-pinning / refresh-token**: token gestolen = attacker free roam tot expiry.

### Wel goed (niet aan zitten)
- bcrypt cost 10, prepared statements overal, trust-proxy loopback, login rate-limit 5/15min, secrets-dir mode 700, AVG-export endpoint werkt, audit-log tabel bestaat + 35 entries, JWT-secret uit `.env` (geen hardcoded fallback meer sinds 2026-06-09 18:35).

### Door agent B foutief gerapporteerd (gecorrigeerd na verificatie)
- ❌ Agent zei "`/api/admin/bulk-seed-queue` + `/api/admin/cleanup-db` zonder auth" → **fout**: beide hebben `authMiddleware, adminOnly` (`routes/admin.js:454` + `:507`).
- ❌ Agent zei "audit_log tabel ontbreekt" → **fout**: tabel bestaat sinds 2026-06-09 18:35, 35 entries.

## Sectie C — Infra (verificatie-stand 2026-06-10 ~21:15)

### 🔥 Urgent vandaag/morgen
- **`atx-admin` 95 restarts in 8 uur** (pid 1044343, 130MB). Vermoedelijke memory-leak in cluster-mode of OOM-kill bij `max_memory_restart`. Geen crash-dump. Vandaag pas live-actie nemen: pm2-logs lezen + heapdump aanzetten.
- **cloudflared intermittent stream-cancels** (gisteren 11:45–12:00 echte outage met `connection reset by peer` op `/api/admin/analytics/stats` en `/api/contact-requests/count`). Mogelijk t4c-server-crash gekoppeld aan die periode. Sindsdien alleen `stream X canceled by remote with error code 0` — dat zijn voornamelijk SSE-stream-closes door browser-navigation, **geen** echte fout.
- **Watchdog log laatste entry 2026-06-09 19:36** — cron `* * * * * /opt/t4c/watchdog.sh` staat actief. Geen entries = ofwel watchdog draait wel maar logt alleen bij fail (waarschijnlijk, v2-flock-gate-redesign), ofwel hij draait niet. **Verifiëren**: `bash -x /opt/t4c/watchdog.sh` 1× handmatig draaien.
- **t4c-server**: vers gemeten — uptime 3u24m, 18 restarts vandaag (concentratie rond 11:45 outage), 1007 requests, 0 errors, heap 59MB/86MB rss 801MB. **Nu gezond**. 800MB rss komt door grote in-memory sql.js DB (179MB) — verwacht.

### ⚠️ Risico binnen sprint
- **Backups niet off-site**: daily 3:00 → `/opt/t4c/backups/db_YYYYMMDD_HHMM.db` (172MB onencrypted), 30d retention, lokaal. Single-point-of-failure = deze server. **Voorstel**: rclone/scp naar externe bucket + GPG-encrypt.
- **`max_memory_restart` ontbreekt** in `ecosystem.config.js` voor t4c-server. 800MB nu OK, maar bij leak → OOM kill ipv soft restart.
- **Dead backup-dirs ~1GB**: `backend.RECOVERY-FAILED`, `*.ARCHIVE-2026*`. Disk 2% vol dus geen drama, wel ruis.
- **10× `.pre-dna-*` backup-files** in `/opt/t4c/sites/transfer4cars/` — opruimen na user-OK (T4C-MAP-COMPLEET P3).

### ✅ Goed
- pm2 systemd `pm2-deniz.service` enabled (overleeft reboot)
- pm2-logrotate actief (10MB cap, retain 7)
- SSL via Let's Encrypt geldig tot 2026-07-30
- `transfer4cars.com` + `www.transfer4cars.com` beide 200 via tunnel
- Backup-cron 3:00, disk-alert-cron 8:00, cardatax-snapshot-cron 4:00 allemaal actief

### 📋 Te beslissen (user-input)
- **Cloudflared config niet zichtbaar**: tunnel draait via systemd-unit-token, geen `config.yml`. Onmogelijk te controleren welke hostnames → welke localhost-poorten zonder uitloggen in Cloudflare dashboard. Optie: token-config exporteren naar `/etc/cloudflared/config.yml` voor zichtbaarheid.
- **Snapshot-cron 4:00**: heet `cardatax-snapshot-dev.sh`. Moet er ook eentje voor t4c-db productie komen?

## Sectie D — Wat bestaande docs al zeggen (recap)

- **T4C-FOUNDATION-AUDIT-2026-06-09**: backend-fundering staat goed (16 veiling-routes, register/login werkt, transport-integratie ingebouwd). 2 DB-kolommen toegevoegd (channel_type, verwachte_prijs).
- **T4C-MAP-COMPLEET-2026-06-10**: complete technische scan met 9 secties — 5 pm2-procs, 80+ endpoints, 20 frontend-pages, 4 admin-paden (waarvan 2 alias), DB met 20+ actieve tabellen. Bevat 10 beslis-punten (P1–P9).
- **T4C-INFOARCHITECTUUR-2026-06-10**: definieert canonieke klant-nav + admin-nav, somt 4 te bouwen admin-UI's op (Voorraad/Inkoop/Taxaties/Users). Beslis-regels per laag.
- **T4C-ROADMAP-2026-06-09**: werk-log van fase 0 (stabiliteit) en alle pages die op 2026-06-09 in CarDataX-DNA zijn gerebuilt. **"Production-status: klaar voor klant-launch op transfer4cars.com"** — geschreven 2026-06-09 21:00.
- **MORGEN-2026-06-11**: openstaande Google-login-beslissing met Jurgen (Optie A: alleen identiteit / Optie B: Gmail-Drive-data).
- **T4C-FIX-LOG-2026-06-10**: lopende lijst van vandaag uitgevoerde fixes (nav-cleanup, hardcoded-password-vervanging, dubbele endpoints opruimen, etc. — niet gelezen voor deze audit; check bij voortzetten).

## Sectie F — Site-health / SEO (Seobility-rapport 2026-06-10)

> Seobility-rapport door user gedeeld. On-page score 55% (4 issues, 1 critical).

### 🔴 Critical (Server-config 0%)
- **Geen redirect www ↔ non-www**: `https://transfer4cars.com/` en `https://www.transfer4cars.com/` zijn beide 200 met identieke content → **duplicate content** = SEO-rank hit.
- **HTTPS-redirect ontbreekt**: `http://transfer4cars.com` redirect niet automatisch naar `https://`.
- **Fix**: Cloudflare-niveau (Page Rule of Bulk Redirect) — *niet* in t4c-server, want tunnel is voor HTTPS al gedaan. Beslis: canonical = non-www (modern NL-standaard) of www (legacy). Aanbevolen: **non-www canonical, www → 301 naar non-www**. Geldt voor `http://` én `https://www.` → `https://transfer4cars.com/`.

### 🟠 Important (Meta data 61% / Page-quality 55% / Headings)
- **`<title>`** 706 px (max 580) → inkorten. Huidig: "Transfer4Cars — B2B Autohandel, Kwaliteitsoccasions & Veilingen | Langeraar". Voorstel: "Transfer4Cars — B2B Autoveilingen & Occasions" (~480 px) of "Transfer4Cars · B2B-veilingen & occasions | Langeraar" (~520 px).
- **`<meta description>`** 1151 px (max 1000) → inkorten tot ~155 chars. Huidig 178 chars.
- **Title-woorden niet in H1 en niet in body** → herschrijven body + H1 zodat hoofd-keywords ("B2B autoveilingen", "occasions", "Langeraar") ≥ 1× in H1 en ≥ 2× in body voorkomen.
- **Word-count 453 (target ≥ 800)** → 1 sectie tekst toevoegen op `/`: "Wat is Transfer4Cars" / "Hoe werken onze veilingen" / "Over Langeraar". Geen filler — echte info-blokken.
- **30 headings + duplicate headings** → dedupliceren + structuur opschonen (H1 → H2 → H3 logisch).
- **`avg sentence length 9.09 woorden`** → te kort. Combineer korte zinnen.

### 🟢 Nice-to-have
- **Apple touch icon** ontbreekt — `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` toevoegen.
- **Social-share-buttons** ontbreken (rapport noemt het, niet zeker of must-have voor B2B).
- **Backlinks 17/6 IPs** — losse marketing-actie, geen code-fix.

### Aanpak
Server-config-fix doe ik via Cloudflare-dashboard (Page Rule of Bulk Redirect — 1 regel). De rest is HTML-edit op `/opt/t4c/sites/transfer4cars/index.html` (60KB single-file). Per memory `feedback_design_iteration_ceiling.md`: max 2 iteraties op visual. Voor SEO-text geldt dat niet (geen design-iteratie).

## Sectie G — Vimexx / transactionele mails

> User regelt zelf Vimexx-mail-account. Hieronder wat T4C nodig heeft + checklist.

### Wat T4C nu doet met mail
- `email_queue` tabel + `lib/mailer.js` met nodemailer
- `processEmailQueue()` draait elke 60s en stuurt pending mails
- 5 templates: `welkom`, `veiling_gewonnen`, `veiling_herstart`, `nieuwe_veiling`, `admin_alert`
- HTML-wrap met branded header/footer, KvK, contact-info
- **Status**: code werkt, maar SMTP gaf 451-fouten (provider-side issue zxcs.nl, per ROADMAP)

### Wat user moet aanleveren (Vimexx)
1. **Sender-mailadres**: bv. `noreply@transfer4cars.com` (aanbevolen — geen reply-verkeer naar persoonlijke mailbox), of `info@transfer4cars.com` (replies komen binnen).
2. **SMTP-creds** uit Vimexx-controlpaneel:
   - Host: `smtp.vimexx.nl` (standaard) of klant-specifiek
   - Port: 587 (STARTTLS) of 465 (SSL)
   - Username: volledig mailadres
   - Password: het mailbox-wachtwoord
3. **SPF + DKIM + DMARC** in DNS (Cloudflare) — anders gaan mails naar spam. Vimexx levert DKIM-record bij setup.

### Wat ik daarna doe in T4C
- `.env`: vervang/voeg toe `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `pm2 restart t4c-server` (graceful, 10-12s)
- Test: stuur 1 welkomstmail naar Jurgen's mailbox, check spam-folder
- Verifieer SPF/DKIM/DMARC via mail-tester.com (≥9/10 score)

### Welke flows nu mail moeten genereren (deels al, deels nog niet)
| Trigger | Template | Status |
|---|---|---|
| `/api/register/koper` (nieuwe koper) | `welkom` | ✅ wired |
| Veiling gewonnen (auto-status 60s loop) | `veiling_gewonnen` | ✅ wired |
| Veiling herstart (reserve niet gehaald, ronde+1) | `veiling_herstart` | ✅ wired |
| Nieuwe veiling gepubliceerd → naar mailing-list | `nieuwe_veiling` | ⚠️ template bestaat, mailing-list-trigger ontbreekt |
| Admin-alert (server-down, etc.) | `admin_alert` | ⚠️ template bestaat, trigger ontbreekt |
| **Te bouwen** B2B-aanmelding goedgekeurd | nog niet | ❌ |
| **Te bouwen** Wachtwoord vergeten | nog niet | ❌ (zit in BLOCKER-lijst) |
| **Te bouwen** Overboden op watch-list-veiling | nog niet | ❌ (nice-to-have lijst) |
| **Te bouwen** Factuur verstuurd / herinnering | nog niet | ❌ |

## Sectie E — Klant-dashboard noodzaak

**Vraag user**: moet er een klant-dashboard komen zoals cardatax (app of admin)?

**Antwoord**: **nee, niet nieuw**. Er **bestaat al** een klant-dashboard op `/account/`, gebouwd 2026-06-09 met dezelfde CarDataX-DNA (Outfit + IBM Plex Mono + #00e68a glass cards). 5 tabs:

| Tab | Wat | Status |
|---|---|---|
| Biedingen | Actieve biedingen, klik door naar veiling | werkt |
| Gewonnen | Foto + kenteken + bedrag + status | werkt |
| Facturen | Lijst factuur-nr/auto/bedrag/betaal-status | werkt, **geen** betaal-knop, **geen** PDF-link |
| Profiel | Naam/email/telefoon + wachtwoord-wijzigen | werkt |
| AVG | Data exporteren (JSON) + account verwijderen | werkt |

**Wat mist t.o.v. cardatax-app-niveau** (zijn dit must-haves of nice-to-haves?):
- Betaal-knop op factuur (BLOCKER — zie Sectie A/B)
- Factuur-PDF download (BELANGRIJK)
- Bidding-history archief (geen actief/gewonnen meer, maar alles) (NICE)
- Watch-list overzicht (geen aparte tab nu — zit in veiling-detail) (NICE)
- Notificatie-instellingen (email-on-outbid, etc.) (NICE)
- 2FA-setup UI (BELANGRIJK)
- Sessions-overzicht "andere apparaten uitloggen" (NICE)

**Aparte vraag**: moet er een **admin-dashboard zoals cardatax-admin** komen? Bestaande `/admin/` t4c-host **is dat al**, maar fragmentair (4 verschillende admin-paden, sommige alias, eentje legacy). T4C-INFOARCHITECTUUR sectie 2 stelt voor: één canonieke admin-nav (Veilingen / Inbox / Transport / Analytics / Taxatie-rapporten / Server-monitor / Site) en **4 nieuwe admin-UI's bouwen** (Voorraad / Inkoop / Taxaties-historiek / Users). Geen nieuwe app, wel modules erbij.

---

## EINDPRIORITERING

### 🔴 BLOCKERS — moeten af voordat externe dealers wachtwoord krijgen
1. ~~**`.env` mode → 600**~~ ✅ done 2026-06-10 22:50
2. ~~**CORS origin-whitelist**~~ ✅ done 2026-06-10 22:55 (SEC-2)
3. ~~**helmet + HSTS + X-Frame + X-Content-Type + Referrer-Policy**~~ ✅ done 2026-06-10 22:55 (SEC-2) — CSP nog uit (apart traject)
4. ~~**Plaintext-password-upgrade-pad**~~ ✅ verified 2026-06-11 00:05 (SEC-INV) — geen huidige exposure, 4/4 users al bcrypt
5. ~~**Logout server-side invalidation**~~ ✅ done 2026-06-10 23:48 (SEC-4) — in-memory blacklist + /api/logout. Limitation: reset bij restart; upgrade naar Redis-backed = aparte taak
6. **Betaal-gateway** (Mollie aanbevolen voor NL/iDEAL, ~4-6u inclusief test + webhook) — Mercury/Stripe is alternatief. Zonder dit kan een gewonnen veiling niet via webshop afgerekend worden. **OPEN — user denkt nog na**
7. **atx-admin restart-loop diagnose** (1-2u) — heapdump aanzetten, leak vinden, leak fixen of `max_memory_restart` verlagen + restart-strategie kiezen. **OPEN — apart traject**
8. **www ↔ non-www + HTTPS redirect** — handleiding klaar in `CF-WWW-REDIRECT-2026-06-10.md`. **OPEN — user moet in CF dashboard activeren**
9. **Transactionele mail via Vimexx werkend** — checklist in AUDIT-doc Sectie G. **OPEN — user moet creds aanmaken bij Vimexx**

### 🟠 BELANGRIJK — binnen 2 weken na go-live
8. **Factuur-PDF endpoint** (`/api/factuur/:id/pdf`) — branded, 1 pagina, downloadable vanuit `/account/` facturen-tab (~2u). **OPEN**
9. ~~**ATX-rapport link in admin-nav**~~ ✅ al gedaan in NavA (06-10 15:20) — staat in canonieke nav
9b. **SEO content-quality `/index.html`** (~1u): title ✅ done (75→57 chars, SEO1), desc ✅ done (186→139 chars, SEO1), apple-touch-icon ✅ done (SEO1). Nog open: 30 headings dedupliceren, content uitbreiden naar ≥ 800 woorden, title-keywords in H1+body. **DEELS OPEN**
9c. **SPF + DKIM + DMARC** in Cloudflare DNS (na Vimexx-mail-config) — anders mail = spam. **OPEN**
10. ~~**`/api/admin/bulk-seed-queue` + `cleanup-db`**~~ ✅ al gedaan in SEC-1 (06-10) — `authMiddleware + adminOnly`
11. **2FA TOTP voor admin/staff** (~3-4u) — `users.totp_secret` + setup-UI in `/account/` of `/admin/` + verify bij login. **OPEN**
12. **Password-reset-flow** (`/api/password-reset` + `/reset/?token=`) — wacht op Vimexx-SMTP. **OPEN**
13. ~~**Rate-limit op `/api/bid` en `/api/veiling/*` POST/PUT/DELETE**~~ ✅ done 2026-06-10 23:40 (SEC-3) — 30/min bid, 60/min watch, 10/min transport/afrekening/betaal
14. ~~**Disclosure-audit-trail**~~ ✅ done 2026-06-10 23:55 (SEC-5) — via audit_log, geen schema-change nodig
15. ~~**GA4 IDs compleet**~~ ✅ verified 2026-06-10 23:33 — homepage HAD AL GA4 (eerste agent had stale info), placeholders in /aanmelden/ontvangen/ schoongemaakt
16. **Off-site backups**: rclone + GPG naar B2/S3/eigen NAS (~2u eenmalig). **OPEN**
17. ~~**`max_memory_restart` op t4c-server**~~ ✅ done 2026-06-10 23:30 (QW-MEM) — 1500MB cap actief
18. ~~**Watchdog smoke-test**~~ ✅ done 2026-06-10 23:32 (QW-WATCHDOG) — flock + 3-strikes + curl-health werken correct
19. **CSRF-protection** op state-changing routes (`csurf` of double-submit-cookie) — ~2u. **OPEN**
20. **Input-validation library**: `zod` schemas voor `/api/register/koper`, `/api/veiling/*`, `/api/contact-requests` — ~3u. **OPEN**

### 🟢 NICE-TO-HAVE — eerste sprint na go-live
21. 4 admin-UI's bouwen (Voorraad/Inkoop/Taxaties-historiek/Users) — backend bestaat, frontend ~1d per stuk.
22. `/admin/klassiek/` verwijderen na log-check.
23. Dubbele password-endpoints opruimen (`/api/me/password` weg).
24. Watchlist-tab in `/account/`, bidding-history-archief.
25. Email-notificatie "je bent overboden" op watch-list.
26. KvK-verificatie tegen RDW/KvK-register bij B2B-aanmelding (~3u real-time / 30 min manual).
27. Admin-UX polish: `alert()` → toast/modal, loading-states in account-tabs.
28. 10× `.pre-dna-*` backup-files opruimen + dead `.ARCHIVE-*` dirs ~1GB.
29. SSE-fallback voor browsers achter strict proxies.
30. Google-login (Optie A in MORGEN-2026-06-11) na user-beslissing met Jurgen.

---

## Crash-pickup volgorde

Als deze sessie crasht / disconnect / context-loss:
1. Lees deze doc top-down — afgevinkte secties zijn klaar.
2. Lees `CRASH-LOG.md` voor laatste crash-entry.
3. Lees `T4C-FIX-LOG-2026-06-10.md` voor wat vandaag aan fixes is uitgevoerd (na deze audit).
4. Eerste open BLOCKER = volgende werkstap.
5. Task-list bekijken (Claude-task-system #1–6).

## Wijzigingen aan deze doc

- 2026-06-10 21:30 — initial versie geschreven na 3 parallel Explore-agents + verificatie-ronde.
- 2026-06-10 22:10 — Sectie F (Seobility/SEO) + Sectie G (Vimexx mail) toegevoegd. BLOCKERS #8 (www-redirect) + #9 (Vimexx-mail) toegevoegd. BELANGRIJK #9b (SEO content) + #9c (SPF/DKIM/DMARC) toegevoegd.
- 2026-06-11 00:05 — Zero-risk batch done: BLOCKERS #1-5 + BELANGRIJK #9 #10 #13 #14 #15 #17 #18 afgevinkt. Open BLOCKERS: #6 (Mollie, user denkt na) + #7 (atx-admin diagnose) + #8 (CF redirect, user dashboard) + #9 (Vimexx, user creds).
