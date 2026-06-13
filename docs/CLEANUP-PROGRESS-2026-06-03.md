# T4C Cleanup — Live Progress Log (sessie 2026-06-03)

**Doel**: na verbroken verbinding direct kunnen oppakken zonder fouten te herhalen.
**Companion-documenten**:
- `SEO-AUDIT-2026-06-03.md` — audit-bevindingen
- `CLEANUP-EN-STRATEGIE-2026-06-03.md` — strategie + plan A-E

**Status**: BLOK A + B + C voltooid. BLOK D (test-veilingen) onderbroken. BLOK E (pm2 restart + smoke) nog niet gedaan.
**Belangrijk**: pm2 t4c-server is **NIET** herstart — alle server.js-edits zitten op disk maar zijn nog niet live.

---

## Backup-locaties (rollback-anker)

```
/opt/t4c/backend/server.js.bak-pre-cleanup-20260603              24116 bytes
/opt/t4c/sites/transfer4cars/index.html.bak-pre-cleanup-20260603 57465 bytes
/opt/t4c/sites/transfer4cars/veilingen/index.html.bak-pre-cleanup-20260603
```

Rollback voor één file:
```bash
cp /opt/t4c/backend/server.js.bak-pre-cleanup-20260603 /opt/t4c/backend/server.js
pm2 restart t4c-server
```

---

## BLOK A — Kapotte flows dichtplakken ✅ KLAAR (op disk, niet live)

| # | Wijziging | File | Status |
|---|-----------|------|--------|
| A1 | KvK-veld `pattern="\d{8}"` + `inputmode="numeric"` + title | `sites/transfer4cars/index.html:425` | ✅ |
| A2 | Login-redirect rolgebaseerd (admin/staff→/admin/, koper→/veilingen/, rest→/aanbod/) i.p.v. `/m/dashboard.html` (404) | `sites/transfer4cars/index.html:519` | ✅ |
| A3 | NL/EN/DE lang-buttons verborgen (deden alleen localStorage, geen i18n) | `sites/transfer4cars/index.html:215` | ✅ |
| A4 | `/verkoop` static-mount verwijderd (duplicate-content mirror) | `backend/server.js` ~r183 | ✅ |
| A5 | `/telex-inkoop`-proxyroutes verwijderd (atx-pipeline gestopt, gaven 502) | `backend/server.js` ~r322 | ✅ |

---

## BLOK B — SEO-fundament ✅ KLAAR (op disk, niet live)

| # | Wijziging | File | Status |
|---|-----------|------|--------|
| B1 | `routes/seo.js` aangemaakt: dynamische sitemap.xml + robots.txt + AI-blok (GPTBot, CCBot, ClaudeBot, Google-Extended) | `backend/routes/seo.js` (97 regels) | ✅ |
| B2 | seo-route gemount vóór T4C catch-all (anders hapt static fallback `/sitemap.xml`) | `backend/server.js` ~r155 | ✅ |
| B3 | T4C catch-all vervangen door whitelist: random URL → 404 i.p.v. homepage 200 | `backend/server.js` ~r165 | ✅ |
| B4 | `/admin` static-mount: `X-Robots-Tag: noindex, nofollow, noarchive` | `backend/server.js` ~r155 | ✅ |
| B5 | Admin-HTML meta-robots `noindex,nofollow,noarchive` | `sites/cardatax/admin/index.html:6` | ✅ |
| B6 | Homepage head: title+desc+canonical+OG+Twitter+JSON-LD (AutoDealer + JHVT-data) | `sites/transfer4cars/index.html:7-63` | ✅ |
| B7 | Veilingen-pagina head: title+desc+canonical+OG+JSON-LD | `sites/transfer4cars/veilingen/index.html:6-19` | ✅ |
| B8 | Aanbod-pagina head: title+desc+canonical+OG | `sites/transfer4cars/aanbod/index.html:7-17` | ✅ |
| B9 | OG-image gegenereerd uit pand.jpg (1200×630, 106 KB) | `sites/transfer4cars/img/og-cover.jpg` | ✅ |
| B10 | 404-pagina met `noindex,follow` | `sites/transfer4cars/404.html` | ✅ |

**JHVT-data gebruikt in JSON-LD** (afkomstig uit `/opt/cardatax/public/index.html`):
- KvK 88503925
- BTW NL864657079B01
- JHVT Holding B.V., Prins Hendrikstraat 58a, 2405 AK Alphen aan den Rijn
- Telefoon +31687997168 (Jurgen) / +31642208084
- E-mail info@transfer4cars.com

---

## BLOK C — Hygiëne + privacy/voorwaarden ✅ KLAAR (op disk, niet live)

| # | Wijziging | File | Status |
|---|-----------|------|--------|
| C1 | 20 backup/oude HTML-files verwijderd uit `sites/transfer4cars/` (waaronder `index.htmlclear`, `*.bak-*`, oude `veiling.html`) | meerdere | ✅ |
| C2 | `app.disable("x-powered-by")` | `backend/server.js:17` | ✅ |
| C3 | Privacyverklaring NL (GPT-template, jurist-disclaimer in voet) | `sites/transfer4cars/privacy/index.html` | ✅ |
| C4 | Algemene voorwaarden NL (GPT-template, jurist-disclaimer in voet) | `sites/transfer4cars/voorwaarden/index.html` | ✅ |
| C5 | Footer-links homepage: `href="#"` → `/privacy` en `/voorwaarden` + KvK in copyright-regel | `sites/transfer4cars/index.html:442` | ✅ |

---

## BLOK D — Veilingen vullen met test-data ✅ KLAAR (live)

**Resultaat**: 3 actieve veilingen op disk, voorraad-status correct geüpdatet.

| Veiling-id | voorraad_id | Auto | Minimumprijs | Eind |
|------------|-------------|------|--------------|------|
| 1 | 31 | BMW X1 2015 (176k km) | €14.000 | +72u |
| 2 | 12 | Suzuki Vitara 2018 (99k km) | €13.500 | +48u |
| 3 | 30 | VW T-Roc 2018 (94k km) | €12.500 | +24u |

**Belangrijk geleerd**:
- Backend gebruikt `voorraad`-tabel (30 rows), NIET `dv_vehicles` — UI op `/veilingen/` join't via voorraad_id
- Alle voorraad-rows hebben `kenteken=NULL` en `photos=0` — UI zal mager ogen, maar route accepteert dit
- JWT-secret komt uit `settings.jwt_secret` (NIET de hardcoded fallback in lib/auth.js)
- POST gebruikte `duur_uren` zodat we niet zelf datetimes hoeven te bouwen
- better-sqlite3 schrijft sync naar disk — geen WAL/sql.js conflict bij restart

**Followup (niet blocker, wel TODO voor sales)**:
- Foto's koppelen aan voorraad-rows (nu 0 photos in `car_photos` voor id 12/30/31)
- Kentekens invullen in voorraad-tabel (anders kan veiling-detail niet "VOLVO 1-XX-XX" tonen)

---

## BLOK E — Restart + smoke ✅ KLAAR — LIVE

**pm2 t4c-server**: 2× restart (PID 1110337). Geen startup-errors, DB-integrity OK.
**Pre-restart DB-snapshot**: `/opt/t4c/data/t4c.db.bak-pre-cleanup-20260603` (170 MB).

### Smoke-results (12/12)

| # | Test | Status | Detail |
|---|------|--------|--------|
| 1 | Homepage title + canonical + JSON-LD | ✅ | "B2B Autohandel, Kwaliteitsoccasions & Veilingen \| Langeraar" + AutoDealer schema |
| 2 | sitemap.xml | ✅ | 200, 48 URLs, valid XML |
| 3 | robots.txt | ⚠️ | **Cloudflare Managed Bots overschrijft onze output**. Lokaal serveert /robots.txt correct. CF-dashboard moet rule krijgen om onze versie door te laten. |
| 4 | /admin/ X-Robots-Tag | ✅ | `noindex, nofollow, noarchive` |
| 5 | Wildcard 404 (was 200) | ✅ | /foo/bar, /occasions, /tweedehands → 404 met eigen 404.html |
| 6 | /verkoop + /telex-inkoop | ✅ | 404 (mirror weg, proxy weg) |
| 7 | /privacy | ✅ | 301→/privacy/→200 (Express trailing-slash redirect, harmless) |
| 8 | /voorwaarden | ✅ | 301→/voorwaarden/→200 |
| 9 | /aanbod/ title | ✅ | "Voorraad occasions \| 40+ kwaliteitsauto's" |
| 10 | /veilingen/ + 3 actieve veilingen | ✅ | UI laadt + API toont 3 veilingen (BMW X1, Suzuki Vitara, VW T-Roc) |
| 11 | /img/og-cover.jpg | ✅ | 200, 106712 bytes. Eerste call had stale CF-cache (oude 404), cache-bust werkt direct |
| 12 | x-powered-by header | ✅ | weg (alleen `server: cloudflare`) |

### Body-limit handpatch ✅ intact
- `server.js:20-22` bypass voor /api/extended-taxatie
- `routes/extended-taxatie.js:172` eigen 50mb limit
- POST test → 401 (auth-blocker), body-parser werkt

### Extra-edit tijdens BLOK E
`server.js:183` — `/img/` per ongeluk in skip-list gezet, verwijderd zodat T4C-static-mount og-cover/nap-logo/etc serveert.

---

## TODO buiten deze sessie

### Cloudflare-dashboard (handmatig, jij/Jurgen)
1. **Robots.txt bypass-rule**: Page Rules → match `transfer4cars.com/robots.txt` → "Disable Performance" + "Disable Apps" + "Bypass Cache" zodat origin-versie geserveerd wordt
2. **Cache-purge** voor `/img/og-cover.jpg` (anders zien Google/Facebook 4 uur lang de oude 404)
3. **Bot Fight Mode**: check of die nog actief is — kan robots.txt content overschrijven

### Google Search Console
1. Property `transfer4cars.com` openen / aanmaken
2. Sitemap submit: `https://transfer4cars.com/sitemap.xml`
3. URL Inspection → 3 hoofdpagina's "Indexering aanvragen": `/`, `/aanbod/`, `/veilingen/`

### Volgende sessie pickup
1. Cloudflare-rules instellen (zie boven)
2. Voorraad-items kentekens invullen (anders blijft veiling-detail "" kenteken)
3. Foto's uploaden voor voorraad id 12/30/31 (anders zien dealers lege veiling-tegels)
4. P1-items uit `SEO-AUDIT-2026-06-03.md`: auto-detail per kenteken (SSR met JSON-LD Vehicle schema)
5. Marktplaats/AutoScout24-presence checken (memory zegt: sales-versnelling komt éérst van Marktplaats, daarna pas organic)

**12 smoke tests die moeten draaien na pm2 restart**:

1. `curl -I https://transfer4cars.com/` → 200 + nieuwe title/canonical in head
2. `curl https://transfer4cars.com/sitemap.xml | head -20` → XML met 40+ URLs
3. `curl https://transfer4cars.com/robots.txt | head -30` → ons robots, niet Cloudflare-default
4. `curl -I https://transfer4cars.com/admin/` → 200 + `X-Robots-Tag: noindex, nofollow, noarchive`
5. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/foo/bar` → 404 (geen wildcard 200 meer)
6. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/verkoop/` → 404
7. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/privacy` → 200
8. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/voorwaarden` → 200
9. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/aanbod/` → 200
10. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/veilingen/` → 200
11. `curl -o /dev/null -w "%{http_code}\n" https://transfer4cars.com/img/og-cover.jpg` → 200
12. POST `/api/login` met test-account → token + correcte role-redirect

**Search Console submit** (handmatig in browser):
- `https://transfer4cars.com/sitemap.xml` toevoegen aan property
- Indexering aanvragen voor 3 hoofdpagina's

---

## Critical pending — niet vergeten

| Item | Waarom | Wanneer |
|------|--------|---------|
| Manual patches re-applien | Memory `project_t4c_handpatches_to_keep.md` — body-limit op /api/extended-taxatie. Onze server.js-edit raakt body-parsers NIET, dus deze patch zit nog. **Wel verifiëren na restart.** | Na BLOK E smoke |
| Lyra zip-deploys check | Memory `feedback_lyra_zip_overwrites_fixes.md` — niet relevant nu, maar bij volgende Lyra-deploy meteen weer applien | Bij volgende Lyra-werk |
| Privacy/voorwaarden jurist-review | GPT-template, disclaimer in voet | Vóór "live productie-claim" |
| `/img/` whitelist toevoegen | Whitelist in catch-all heeft `img/` als path-start, maar test of `og-cover.jpg` daadwerkelijk wordt geserveerd | BLOK E test #11 |

---

## Hervat-instructie voor volgende sessie

Als verbinding nu opnieuw breekt of nieuwe sessie:

```bash
ssh t4c
cd /opt/t4c
cat /opt/t4c/docs/CLEANUP-PROGRESS-2026-06-03.md | head -40
# → zie laatste ✅ vs 🔄 vs 🔲 marker
```

Status nu: **klaar voor BLOK D test-veilingen, daarna BLOK E restart+smoke.**

Eerst doen vóór restart: deze progress-log bijwerken na elke stap.
