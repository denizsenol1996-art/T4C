# T4C Veilingsysteem v2 — ontwerpdoc

> **Doel** — een schoner en overzichtelijker veilingsysteem dan Auto1, geïntegreerd in transfer4cars, modulair opgebouwd (geen spaghetti). Login: klanten via email, intern team via Google.

## 1. Wat Auto1 doet (uit auto1.com/nl/app/merchant analyse)

| Feature | Wat | Class/route hint |
|---|---|---|
| **Auction channels** | Meerdere veiling-modi: 24h (direct), batch (verzamelde rondes), free search | `AuctionTabNavigationMFE_*`, URL `?channel=24h` |
| **Filter-sidebar** | Manufacturers (merk-boom met sub-items), range-sliders (jaar/km/prijs), state-checkboxes | `carFilters__box`, `carFilters__rangeBoxes--item` |
| **Car-card met statusbar** | Visuele kanaal-indicator per auto (24h = kleur X, batch = kleur Y) | `carCard__statusBar--24h` |
| **Price + expectation** | Toont huidig bod náást verwachte prijs | `bigSearchCard__status--price/--expectation` |
| **Account-status banner** | Outstanding balance warning bovenaan bij betalingsproblemen | `OutstandingBalanceMFE_*` |
| **Multi-country** | NL/DE/etc, land-selector | `<button>Kies een land</button>` |
| **Microfrontend-architectuur** | Elk feature = eigen module (MFE) | `AuctionTabNavigationMFE`, `BatchAuctionsSearchApp`, etc. |
| **Routes** | `/nl/app/dashboard`, `/merchant/cars`, `/inventory`, `/search`, `/help` | Logische opdeling per concern |

## 2. Wat T4C al heeft (per 2026-06-09)

**Backend** (`/opt/t4c/backend/routes/veilingen.js`, 22KB, 16 routes):
- `GET  /api/veilingen` — overzicht (auth required)
- `GET  /api/veiling/:id` — detail (publiek)
- `POST /api/veiling/:id/bied` — bieden
- `POST /api/veiling/watch` — watchlist
- `POST /api/veiling/:id/transport` — transport boeken na win **✓ al integratiepunt!**
- `POST /api/veiling/:id/afrekening` — afrekening
- `POST /api/veiling/:id/betaal` — betaling
- `GET  /api/factuur/:id`, `/api/factuur/nr/:nr` — factuur ophalen
- `GET  /api/mijn-facturen`, `/api/mijn-veilingen` — eigen overzicht
- Admin/staff: POST/PUT/DELETE veiling, GET veilingen/biedingen/verkopen/facturen, PUT factuur

**Database** (5 tabellen):
- `veilingen` — hoofdtabel (status, eind_datum, winnaar_user_id, indexen op alle drie)
- `veiling_biedingen` — biedingen + index op veiling_id en user_id
- `veiling_biedingen_archief` — historische biedingen per ronde
- `veiling_watchers` — watchlist (UNIQUE veiling_id + user_id)
- `facturen` — gelinkt aan veiling_id

**Frontend** (`/opt/t4c/sites/transfer4cars/veilingen/index.html`, 363 regels, 35KB):
- Basis-page met "Live Veilingen" + "Mijn Account"-blok
- Eigen page (niet de homepage) — al gescheiden ✓

## 3. Gap-analyse (wat ontbreekt vs Auto1)

| # | Feature | Backend nodig? | Frontend nodig? |
|---|---|---|---|
| 1 | Auction channels (24h/batch/free) | ✓ veiling-type kolom + filter-API | ✓ Tab-navigatie component |
| 2 | Filter-sidebar (merk-boom, range, state) | ✓ filter-params op `/api/veilingen` | ✓ Filter-component |
| 3 | Visuele statusbar per car-card | — (frontend only) | ✓ CSS per channel-type |
| 4 | Price + expectation indicator | ✓ `verwachte_prijs` kolom op veiling | ✓ Card-component |
| 5 | Account-status banner | ✓ `/api/account/balance` + flag | ✓ Banner-component |
| 6 | Modulair frontend (page-per-feature) | — | ✓ **Splitsing index.html (60KB)** |
| 7 | Email-login klanten | ✓ `/api/auth/email-magic-link` | ✓ Login-form |
| 8 | Google-login intern | ✓ OAuth-flow `/api/auth/google` | ✓ Intern button |

## 4. Voorgestelde architectuur

### Routes (publiek + ingelogd)

```
/                          → homepage (gesplitst tov huidige 60KB)
/aanbod                    → publiek overzicht (geen auth nodig)
/auto/[slug]               → publiek auto-detail
/veilingen                 → veiling-hub met channel-tabs
  /veilingen/24h           → directe rondes
  /veilingen/batch         → batch-rondes
  /veilingen/zoek          → free-search
  /veilingen/[id]          → detail + bieden
  /veilingen/mijn          → eigen veilingen (auth)
/transport                 → transport-planner (eigen module — Fase 4)
/account                   → klant-dashboard
  /account/orders          → orders + facturen
  /account/saldo           → openstaand saldo + betaalmethodes
  /account/instellingen    → profiel, email, voorkeuren
/login                     → email magic-link
/verkoop/...               → bestaand, geen wijziging
/admin                     → intern, Google-login alleen
  /admin/veilingen
  /admin/klanten
  /admin/biedingen
```

### Architectuur-principes

1. **Eén page per feature** — geen 60KB pages meer. Header/footer als shared partials (server-side include of build-time inline).
2. **Component-bestanden** — `/opt/t4c/sites/transfer4cars/_components/` voor herbruikbare blokken (car-card, filter-box, tab-nav, banner).
3. **Inline CSS per page beperken** — gedeelde stylesheet `/css/transfer4cars.css` voor base, page-specifieke CSS inline.
4. **Geen SPA-framework verplicht** — server-rendered HTML + sprinkles van vanilla JS waar interactief. Vermijdt React/Vue-overhead op publieke pages (SEO + snelheid).
5. **Veiling-detail-pagina interactief** — daar mag wel een mini-app (live biedingen via SSE/WebSocket).

### Auth-strategie

**Klanten — email magic-link** (geen wachtwoord):
- POST `/api/auth/request-link` → email naar klant met token-link (15 min geldig)
- Klik link → GET `/api/auth/verify?token=...` → set session-cookie → redirect naar `/account`
- Voordeel: geen wachtwoord-reset-flow, lagere drempel, GDPR-light.

**Intern team — Google OAuth**:
- `/admin/login` → "Login met Google" knop → Google OAuth flow
- Whitelist op email-domain `@transfer4cars.nl` of expliciete user-id allowlist
- Sessie-cookie met `admin`-role.

Bestaande `users` tabel uitbreiden met `auth_method` enum (`email`, `google`, `legacy`).

## 5. Stappenplan implementatie (volgorde, niet bouwen tot bevestigd)

| # | Stap | Inschatting |
|---|---|---|
| A | DB-migratie: `auth_method` op users, `channel_type` op veilingen, `verwachte_prijs` op veilingen | klein |
| B | Auth: email magic-link backend + login-page | medium |
| C | Auth: Google OAuth voor admin | medium |
| D | Frontend split: `_components/` (header, footer, car-card, filter-box, tab-nav, banner) | medium |
| E | Veilingen-hub: kanaal-tabs + filter-sidebar | medium |
| F | Car-card v2: statusbar + expectation-prijs | klein |
| G | Veiling-detail: live bieden via SSE | groot |
| H | Account-dashboard met orders/saldo | medium |
| I | Homepage split (60KB → ≤15KB met components) | medium |
| J | Transport-planner integratie (Fase 4) | parallel-spoor |

## 6. Risico's & beslispunten

- **R1**: Bestaande veilingen.js routes blijven werken — v2 moet **backwards-compatible** uitrollen, geen big-bang.
- **R2**: Live testveiling (`veilingen` heeft 1 record) niet kapot maken tijdens migratie.
- **R3**: SEO-sprint 06-03 (sitemap+OG+admin-noindex) blijft behouden.
- **R4**: Cardatax-mount op `/m`, `/admin`, `/app` blijft onaangetast — wij raken alleen `/opt/t4c/sites/transfer4cars/` aan.

**Beslispunten voor user:**
1. Akkoord met routes-structuur in §4?
2. Akkoord met email magic-link voor klanten (geen wachtwoord) en Google voor intern?
3. Volgorde A→J akkoord? Of eerst frontend split (D, I), dan auth (B, C), dan veilingen (E, F, G)?
4. Vandaag nog beginnen met stap A (DB-migratie) of eerst de volledige doc reviewen?
