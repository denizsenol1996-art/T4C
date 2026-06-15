# Transfer4Cars — Cleanup + Strategie + Implementatie-plan

**Datum**: 2026-06-03 avond
**Strategische positie**: Marketplace **en** Veilingen gelijkwaardig (besluit deze sessie)
**Status**: AUDIT COMPLEET — implementatie start nu
**Companion-document**: `SEO-AUDIT-2026-06-03.md` (blijft geldig, dit overschrijft niets)

---

## 0. Wat is de werkelijke status van de site (eerlijk)

### 0.1 Wat WERKT
- Homepage rendert (57 KB, dark/light theme, NL alleen)
- `/aanbod/` met filters + sort fetcht 40 actieve voertuigen uit `/api/dv/voorraad`
- `/auto/?id=X` static detail-page bestaat
- `/api/public/contact` — werkt (test 200 OK, gaat in `contact_requests` + `email_queue`)
- `/api/register` — werkt als KvK 8 cijfers (test 200 OK)
- Veilingen back-end is COMPLEET geïmplementeerd (18+ routes, lifecycle, biedingen, facturen, transport, afrekening, watchers)
- Cloudflared tunnel stabiel
- pm2 t4c-server stabiel

### 0.2 Wat is BROKEN of LEEG (bron van "troep en niet werkende dingen")

| # | Bug / leegte | Bewijs | Severity |
|---|---|---|---|
| B1 | **Login redirect → 404** | Homepage `doLogin()` regel 519: na success `window.location.href='/m/dashboard.html'` — die file bestaat niet (HTTP 404, 155 bytes Express-error) | KRITIEK |
| B2 | **Register-form silent fail** | Homepage register-form heeft KvK als optioneel (`ins[4]?.value\|\|''`), backend (`routes/misc.js:17`) EIST 8 cijfers, anders 400. Gebruiker ziet alleen rode toast "Geldig KvK-nummer (8 cijfers) is vereist" zonder begeleiding | HOOG |
| B3 | **Veilingen-tabel = 0 rows** | `veilingen`, `veiling_biedingen`, `facturen` allemaal 0 rows in DB. UI `/veilingen/` is compleet maar toont permanent leeg | KRITIEK (voor strategie) |
| B4 | **0 dealer/koper users** | `users` tabel = 4: 2 admin, 1 inkoper, 1 t4c-service. Geen B2B-dealers, geen kopers → niemand kan inloggen op veilingen | KRITIEK (voor strategie) |
| B5 | **Wildcard 200-fallback** | Alle 7 random URLs (`/abc`, `/foo/bar`, `/occasions`, `/merken/bmw`, etc) returnen 200 met homepage HTML. Google ziet duplicate content overal | HOOG (SEO) |
| B6 | **Sitemap 404** | `/sitemap.xml` returnt Express "Cannot GET" | HOOG (SEO) |
| B7 | **/admin/ publiek 200** | `<title>T4C Command Center</title>`, geen X-Robots-Tag, geen server-auth-gate op HTML | HOOG (security + SEO) |
| B8 | **/verkoop is duplicate domain mirror** | `app.use("/verkoop", express.static(T4C_SALES_DIR))` (server.js:184) — exact dezelfde content op tweede pad → duplicate content | MEDIUM |
| B9 | **NL/EN/DE language-buttons doen niets** | Klik wisselt alleen `.active`-class en `localStorage`, geen vertaling. Misleidt user, kosten geloofwaardigheid | MEDIUM |
| B10 | **Footer Privacy + Voorwaarden = `href="#"`** | Geen pagina's. AVG-blocker, E-E-A-T signal voor Google | MEDIUM (AVG-verplicht) |
| B11 | **Voorraad-data zit in 3 tabellen** | `voorraad` (30 rows, te_koop), `dv_vehicles` (40 active + 74 sold = 114 totaal), `market_listings` (scrape-bron). UI gebruikt `dv_vehicles`. `voorraad` is legacy maar nog gerefereerd door veilingen-code (line 36: `UPDATE voorraad SET status='in_veiling'`) | HOOG (data-integriteit) |
| B12 | **/telex-inkoop = 502** | atx-pipeline-proxy is uit (gestopt na 2026-06-03 Autotelex-rule). Maar route staat nog in server.js → "Bad Gateway" naar wie de URL volgt | MEDIUM |
| B13 | **2 verschillende /api/register-flows** | Homepage roept `/api/register` (KvK-required), `/veilingen/index.html:213` roept ZELFDE `/api/register` met `{username,email,password,name}` — die velden worden NIET geaccepteerd door backend (verwacht `bedrijf,telefoon,kvk`) | HOOG |
| B14 | **8 contact-aanvragen in DB, geen workflow** | 7 `contact` + 1 `b2b_aanmelding` met status `nieuw`. Komen er emails uit? 1 email in queue pending → SMTP-pipeline status onbekend | HOOG (sales-blocker) |
| B15 | **Backup-bestanden in static dir** | `auto/index.htmlclear`, `veilingen/index.html.bak-pre-s4`, `server.js.bak-pre-lyra-*`, `valuation.js.bak-pre-observer-*` worden niet uitgeleverd door static maar tonen wel onhygiëne | LAAG |
| B16 | **x-powered-by: Express header** | Reveals stack — security-hygiene | LAAG |
| B17 | **Homepage meta description = 74 chars** | Te kort voor Google snippet (target ~150-160), gemiste click-through | LAAG (SEO-tweak) |
| B18 | **Geen OG / canonical / JSON-LD** | Social shares zonder image, geen rich results | MEDIUM (SEO) |
| B19 | **/lyra-ai/ pad-miss serveert homepage** | Cosmetisch raar, content-leak voor crawlers | LAAG |
| B20 | **/m/dashboard.html bestaat niet maar /m/ heeft wel index.html (CardDatax mobiele app)** | Tussen verkoopdomein en CardDatax-domain-overlap zit verwarring | MEDIUM |

---

## 1. Strategische positie (beslist deze sessie)

### 1.1 De vraag
Transfer4Cars wordt: **B2C/B2B occasion-verkoop én B2B-veiling-platform, gelijkwaardig**.

### 1.2 Wat betekent dat concreet
- **Twee duidelijk gescheiden funnels** vanaf homepage:
  1. **"Kopen"** — leidt naar `/aanbod/` (voorraad-marketplace)
  2. **"Veilen"** — leidt naar `/veilingen/` (B2B-veiling-platform)
- **Eén gedeelde account-base**: 1 user kan zowel kopen als veilen (rol-based gating: dealer/koper/admin)
- **Veilingen mag NIET noindex** — wordt long-term een eigen SEO-funnel (eerder voorgesteld in SEO-doc was fout, dit overschrijft dat)
- **/verkoop pad uit fase**: duplicate mirror, mag weg
- **/admin/ blijft alleen voor T4C-medewerkers**, server-side auth-gate + noindex

### 1.3 URL-architectuur (na cleanup)
```
/                        homepage — twee CTA's: Kopen + Veilen
/aanbod/                 voorraad-lijst (publiek, fetcht /api/public/voorraad)
/auto/{slug}-{id}        per-auto detail-page (publiek, SSR meta + JSON-LD Vehicle)
/veilingen/              veiling-overzicht (publiek, indexeerbaar)
/veiling/{slug}-{id}     per-veiling detail (publiek voor listing, bod-actie vereist login)
/over-ons                statisch (P1)
/diensten                statisch (P1) — inkoop, verkoop, voorraadbeheer, transport
/transport               statisch (P1) — tarieven na login, publieke uitleg
/contact                 statisch (P1) — eigen pagina ipv anchor
/privacy                 statisch (P1)
/voorwaarden             statisch (P1)
/dealer-worden           statisch (P1) — funnel voor B2B-aanmelding
/login                   modal of pagina, redirect na success naar:
  /dashboard             unified dealer/koper dashboard (NIEUW — vervangt /m/dashboard.html)
/admin/                  X-Robots-Tag noindex + server-auth (alleen T4C-staff)

VERWIJDEREN:
/verkoop                 duplicate mirror, drop
/telex-inkoop            502-proxy, drop uit server.js (Autotelex-rule, memory)
/m/dashboard.html        wordt /dashboard (zie hierboven)
```

---

## 2. Implementatie-plan voor VANAVOND (gegroepeerd)

Geschat totaal: **2-3 uur** als alles in één run. Vertrek bij blok A.

### BLOK A — KAPOTTE FLOWS DICHTPLAKKEN (45 min)
Hoogste-impact: dit zijn de dingen waar Jurgen NU mee zit als hij naar de site kijkt.

**A1. Fix register-flow homepage + veilingen** (B2 + B13)
- Wijzig homepage `/opt/t4c/sites/transfer4cars/index.html` regel ~419: maak KvK-veld **required** met label "KvK-nummer (8 cijfers) *". Frontend-validatie vóór submit.
- Wijzig veilingen `/opt/t4c/sites/transfer4cars/veilingen/index.html` regel 213: laat `doReg()` posten naar `/api/register/koper` ipv `/api/register` — KvK is daar niet vereist (koper-self-reg).

**A2. Fix login-redirect** (B1)
- Homepage `index.html` regel 519: vervang `window.location.href='/m/dashboard.html'` door `window.location.href='/aanbod/'` voor nu (quick fix).
- Vervolg-stap (later): bouw echte `/dashboard` route die rol-based redirecten.

**A3. Verwijder /verkoop + /telex-inkoop duplicate mounts** (B8 + B12)
- `/opt/t4c/backend/server.js` regel 184: schrap `app.use("/verkoop", ...)`.
- server.js telex-inkoop blok (regel ~324-349): schrap of comment out (atx-pipeline is sowieso uit per `feedback_no_autotelex_bidding.md`).

**A4. Lang-buttons NL/EN/DE: verwijder of geef "binnenkort"-toast** (B9)
- Snelste: comment buttons uit topbar (`index.html` regel ~215-218) tot er echte i18n is.
- Bewust: vermijden valse functionaliteit aan user te tonen.

### BLOK B — SEO + INDEXATIE-FUNDAMENT (45 min)
Vervolg op SEO-doc § 2.A en 2.B.

**B1. Maak `/opt/t4c/backend/routes/seo.js`** met `sitemap.xml` + `robots.txt` (zie SEO-doc §2.A.1). NL-aanpassing:
- Sitemap bevat: 8 statische pagina's + 40 voertuigen + actieve veilingen (uit `veilingen` tabel WHERE status IN ('actief','gepland'))
- robots.txt: AI-bots geblokt (user-keuze), Sitemap-directive.

**B2. Mount route in server.js** vóór de wildcard-fallback (regel ~158).

**B3. Whitelist-only fallback ipv catch-all** (B5)
- Vervang `/opt/t4c/backend/server.js` lines 158-165 met whitelist-fallback (SEO-doc §2.A.4).
- Bouw `/opt/t4c/sites/transfer4cars/404.html` (kopie van homepage-shell met `<meta name="robots" content="noindex">` en H1 "Pagina niet gevonden").

**B4. X-Robots-Tag noindex op /admin/** (B7)
- server.js regel 155: voeg `setHeaders` toe met `X-Robots-Tag: noindex, nofollow, noarchive`.
- Voeg in `admin/index.html` regel 4 (na charset): `<meta name="robots" content="noindex,nofollow,noarchive">`.

**B5. Homepage `<head>` upgrade** (B17 + B18)
- Vervang title + description door langere versies (SEO-doc §2.B.3)
- Voeg toe: canonical, og:type/title/description/url/image, twitter:card, AutoDealer JSON-LD
- Maak `/opt/t4c/sites/transfer4cars/img/og-cover.jpg` (1200×630 crop van pand.jpg of hero-screenshot)

**B6. /veilingen/ `<head>` upgrade** (was 'noindex' in SEO-doc — STRATEGIE-WIJZIGING: nu juist indexeerbaar)
- Voeg meta description: "Live B2B-veilingen voor occasions bij Transfer4Cars. Bekijk actuele veilingen, plaats biedingen, win en koop direct."
- Voeg canonical + og:* + AutoDealer JSON-LD
- Bij 0 actieve veilingen: toon "Geen actieve veilingen op dit moment — bekijk komende veilingen of meld u aan voor notificaties" (vermijdt thin-content signaal)

### BLOK C — HYGIËNE + AVG (30 min)

**C1. Verwijder backup-files** (B15)
```bash
rm /opt/t4c/sites/transfer4cars/auto/index.htmlclear
rm /opt/t4c/sites/transfer4cars/veilingen/index.html.bak-pre-s4
rm /opt/t4c/backend/server.js.bak-pre-lyra-20260523-1218
rm /opt/t4c/backend/server.js.bak-pre-observer-20260523-1937
rm /opt/t4c/backend/routes/valuation.js.bak-pre-observer-20260523-1937
```

**C2. `app.disable("x-powered-by")` in server.js** (B16)
- Toevoegen direct na `const app = express()` (regel ~16).

**C3. Privacy + Voorwaarden pagina's** (B10)
- Maak `/opt/t4c/sites/transfer4cars/privacy/index.html` + `voorwaarden/index.html`
- Template: standaard NL-autohandel privacy + voorwaarden, T4C-naam + KvK-placeholder
- Footer-links: vervang `href="#"` door `href="/privacy"` en `href="/voorwaarden"`

### BLOK D — VEILINGEN VULLEN (30 min — alleen als BLOK A-C klaar)

**D1. Test-veiling aanmaken via DB** (B3 + B4)
- Maak 2-3 test-veilingen uit dv_vehicles-voorraad (actieve auto's met foto)
- INSERT veilingen-rows met realistische data: titel, merk, model, kenteken, minimumprijs (= dealer-inkoop-schatting), start_datum = nu, eind_datum = +7 dagen
- Status = 'actief'
- Maak 1 test-koper-account via `/api/register/koper` voor demo-doeleinden

**D2. Verifieer bod-flow werkt** (B3)
- Login als test-koper
- Plaats bod via `/api/veiling/:id/bied`
- Check `veiling_biedingen` tabel
- Check timer countdown in UI

**D3. Dealer-onboarding-pijplijn** (B14)
- Inventariseer 8 pending contact_requests
- Check email_queue status — werkt SMTP?
- Maak (later) admin-workflow om aanmeldingen te approven → maakt user-account → stuurt welkomstmail

### BLOK E — RESTART + VERIFICATIE (15 min)

**E1. Backup-DB**:
```bash
cp /opt/t4c/data/t4c.db /opt/t4c/data/SAFE-pre-cleanup-20260603.db
```

**E2. pm2 restart**:
```bash
pm2 restart t4c-server
pm2 logs t4c-server --lines 30
```

**E3. Smoke tests** (live):
- `curl -I https://transfer4cars.com/sitemap.xml` → 200 + Content-Type application/xml
- `curl -I https://transfer4cars.com/robots.txt` → 200 (let op Cloudflare-managed conflict)
- `curl -I https://transfer4cars.com/abc` → 404 (geen wildcard 200)
- `curl -I https://transfer4cars.com/admin/` → 200 + `X-Robots-Tag: noindex...`
- `curl https://transfer4cars.com/ | grep canonical` → 1 hit
- `curl https://transfer4cars.com/ | grep "application/ld+json"` → 1 hit
- Homepage in browser: open in incognito, klik B2B Inloggen, sluit modal, klik Registreren, vul KvK 8 cijfers in, verifieer success-toast
- Homepage → klik Veilingen-nav, verifieer /veilingen/ laadt + toont test-veilingen
- /admin/ in incognito: verifieer X-Robots-Tag header (DevTools Network)

### NIET VANAVOND
- Auto-detail SEO-URL `/auto/{slug}-{id}` met SSR-injectie (SEO-doc §2.B.1) — vereist client-link-updates + tests
- Merk-landings (SEO-doc §2.C.1)
- Server-side auth-gate op /admin/ (SEO-doc §2.A.3 optie B)
- Echte i18n (NL/EN/DE)
- Voorraad-tabel sanering (3 tabellen → 1 source of truth)
- Echte `/dashboard` rol-based redirect

---

## 3. Open vragen — antwoorden om vanavond mee verder te kunnen

| # | Vraag | Default als geen antwoord nu |
|---|---|---|
| Q1 | KvK + bedrijfsadres voor LocalBusiness JSON-LD + privacy-tekst? | `KvK: TBD` als placeholder; adres: "Ter Aar, Nederland" |
| Q2 | OG-cover image: crop pand.jpg, of nieuwe foto? | Crop pand.jpg → 1200×630 met sharp |
| Q3 | Veilingen test-data: welke 3 auto's uit dv_vehicles? | Top-3 active by updated_at met foto's, minimumprijs = €0.70 × vraag_prijs (verzonnen marge) |
| Q4 | Welke email moet contact-aanvragen ontvangen? Werkt SMTP überhaupt? | info@transfer4cars.com (huidige config). SMTP-status uitzoeken na BLOK A-C, niet blokkerend voor vanavond. |
| Q5 | Mag /telex-inkoop server.js-block volledig weg, of houden als comment? | Comment (sneller terug aan te zetten als beleid wijzigt) |
| Q6 | Privacy/voorwaarden teksten zelf schrijven of GPT-gegenereerd standaard NL-autohandel template? | GPT-template, Jurgen review-pass later |

---

## 4. Risico's + rollback-plan

### Risico's
- **R1 — sql.js + restart timing**: T4C draait op sql.js write-once-per-30s. Tijdens cleanup geen DB-mutaties tegelijk met server-restart (memory `feedback_t4c_sqljs_alter.md`). → BLOK E mitigeert: backup-DB eerst, dan restart.
- **R2 — Cloudflare managed robots.txt overschrijft Express**: zie SEO-doc §2.A.1. Na deploy in Cloudflare-dashboard bypass-regel zetten als robots-conflict optreedt.
- **R3 — Lyra observer-hook in valuation.js**: niet aanraken in deze sessie (`project_lyra_t4c_stack.md`).
- **R4 — Body-limit + STAAT_SAFETY_NET handpatches**: blijven staan, niet overschreven (zie `project_t4c_handpatches_to_keep.md`).
- **R5 — Email_queue 1 pending**: check `lib/state.js` of er een email-worker draait. Als niet → afzonderlijk uitzoeken.

### Rollback
- Backup `/opt/t4c/data/SAFE-pre-cleanup-20260603.db` overschrijven met live DB als veiling-data corrupt raakt.
- File-level backups: voor elke gewijzigde file `cp <file> <file>.bak-pre-cleanup-20260603` vóór wijziging.
- `pm2 restart t4c-server` om naar oude config terug te draaien als nieuwe routes crashen.

---

## 5. Sessie-handover state

**Wat is in audit-fase gedaan (geen code-wijzigingen)**:
- Volledige functionele live-audit (alle modals, forms, links, API's)
- DB-state geïnspecteerd: 0 veilingen, 0 biedingen, 0 facturen, 4 users, 30+40+74 voorraad-rows verspreid over 3 tabellen
- 20 bugs/issues geïdentificeerd met file:line refs
- Strategie-besluit: marketplace + veiling gelijkwaardig
- Dit document + SEO-document zijn de leidraad

**Wat moet als eerste in implementatie-fase**:
1. Antwoord Q1-Q6 (kan parallel met BLOK A)
2. BLOK A (kapotte flows) — meeste user-impact
3. BLOK B (SEO-fundament) — sales-traject start
4. BLOK C (hygiëne + AVG)
5. BLOK D (veilingen vullen) — alleen als A-C klaar
6. BLOK E (restart + smoke tests)

**Memory-files relevant**:
- `project_lyra_t4c_stack.md` — pm2 + paden
- `project_t4c_handpatches_to_keep.md` — handmatige patches re-apply checklist
- `feedback_lyra_zip_overwrites_fixes.md` — deploy-overschrijf-risico
- `feedback_t4c_sqljs_alter.md` — DB-mutatie-volgorde
- `feedback_no_autotelex_bidding.md` — atx-pipeline uit, geldt ook voor /telex-inkoop
- `reference_paths_credentials.md` — paden + JWT-test-token-recipe

---

## 6. Definition of Done vanavond

✅ Login-success leidt naar werkende pagina (geen 404 meer)
✅ Register-form geeft consistente UX (KvK-required + duidelijke validatie)
✅ /verkoop en /telex-inkoop niet meer publiek bereikbaar
✅ NL/EN/DE buttons verwijderd of stub-toast
✅ `/sitemap.xml` returnt 40+ voertuig-URLs + 8 statische
✅ `/robots.txt` returnt Express-versie met Sitemap-directive (geen Cloudflare-default)
✅ `/admin/` heeft X-Robots-Tag noindex header
✅ Random URLs returnen 404 (geen wildcard 200)
✅ Homepage + /veilingen/ hebben canonical + OG + JSON-LD
✅ /privacy + /voorwaarden bestaan en zijn gelinkt
✅ Backup-files weg uit static dirs
✅ x-powered-by header weg
✅ Minimaal 2 test-veilingen actief in DB
✅ pm2 restart geslaagd, geen errors in `pm2 logs`
✅ Smoke-test alle 12 punten groen

→ Volgende sessie pakt: auto-detail SSR-URLs, merk-landings, server-auth admin, echte /dashboard, voorraad-tabellen-sanering, SMTP-pipeline check.

---

*Einde document. Start implementatie nu bij §2 BLOK A.*
