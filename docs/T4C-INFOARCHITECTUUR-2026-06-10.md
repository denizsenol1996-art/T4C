# Transfer4cars — Info-architectuur

> **Gemaakt:** 2026-06-10
> **Doel:** "wat is wat / wat hoort waar" — referentie bij elke nav-, page- of API-keuze.
> **Buiten scope:** dev.cardatax.com / `/opt/cardatax-app` (apart spoor).
> **Cross-link:** `T4C-MAP-COMPLEET-2026-06-10.md` (technische scan) + `T4C-FIX-LOG-2026-06-10.md` (uitgevoerde fixes).

---

## 1 · Twee werelden, scherp gescheiden

### 1A — Publiek / klant-laag (B2B-dealers + kopers)
Wat **buitenwereld** ziet. Hier mag **geen** beheer-functie zichtbaar zijn voor non-staff.

| Page | Doel | Wie | Auth |
|---|---|---|---|
| `/` (index) | Marketing-landing + login-entry | iedereen | publiek |
| `/aanmelden/` | B2B-aanvraag of koper-signup | iedereen | publiek |
| `/aanmelden/ontvangen/` | Bevestiging na signup | iedereen | publiek |
| `/login/` | Inloggen | iedereen | publiek |
| `/veilingen/` | Veiling-overzicht (24h/batch/free) | iedereen ziet hero; bieden = login | guest-wall |
| `/veilingen/detail/?id=X` | Veiling + bieden + watchlist | login + role∈{koper,dealer,admin,...} | login |
| `/aanbod/` | Voorraad-overzicht | login | login |
| `/auto/?id=X` | Auto-detail + contact | login | login |
| `/account/` | Eigen account (biedingen, gewonnen, facturen, profiel, AVG) | login | login |
| `/transport/` | Transport-info + tarieven | iedereen | publiek |
| `/verkoop/` | B2C verkoop-info ("Verkoop jouw auto") | iedereen | publiek |
| `/verkoop/aanbod/` + `/verkoop/auto/` | (legacy dubbel-spoor — beslis-punt) | onduidelijk | onduidelijk |
| `/privacy/`, `/voorwaarden/` | Juridisch | iedereen | publiek |
| `/404.html` | Fallback | iedereen | publiek |

### 1B — Beheer-laag (staff: admin/staff/t4c/inkoper)
Wat **operators** doen. Alleen voor `role ∈ {admin, staff, t4c, inkoper}`. **Niet** zichtbaar voor klanten in nav.

| Page | Doel | Status |
|---|---|---|
| `/admin/` | Veiling-CRUD | live |
| `/admin/inbox/` | Contact-requests (B2B-aanvragen + meldingen) | live |
| `/admin/transport/` | Transport-planning + leverstatus | live |
| `/admin/analytics/` | GA4-iframe + eigen stats | live (GA4 wacht op SA-fix) |
| `/admin/atx/` *(= proxy → 3200)* | Server-monitor (CPU/RAM/DB/PM2) | live; her-labelen als **"Server-monitor"** |
| `/telex-inkoop/` *(= proxy → 3110)* | ATX-taxatie-rapporten-overzicht | live; nav-link toevoegen als **"Taxatie-rapporten"** |
| `/admin/inbound/:id` *(= alias /telex-inkoop/:id)* | Eén rapport | live |
| `/admin/klassiek/` | Legacy static (oude cardatax-admin) | **verwijderen** uit nav (zie FIX-LOG) |
| `/app/` *(= cardatax PWA op /opt/t4c/sites/cardatax/app)* | Dealer-toolkit PWA op T4C-host | beslis-punt: laten of weghalen uit T4C-nav |
| **Te bouwen:** `/admin/voorraad/` | Voorraad-CRUD UI | backend bestaat (`/api/voorraad/*`), UI mist |
| **Te bouwen:** `/admin/inkoop/` | Inkoop-pipeline-UI | backend bestaat (`/api/inkoop_pipeline`), UI mist |
| **Te bouwen:** `/admin/taxaties/` | Taxatie-historiek-viewer | backend bestaat (`/api/taxaties` — 4261 rows), UI mist |
| **Te bouwen:** `/admin/users/` | User-management | backend bestaat (`/api/users/*`), UI mist |
| **Beleid:** logs/api-keys/scraper-test | Dev-only-tools | overweeg geen UI; via SSH |

---

## 2 · Canonieke admin-nav (na fix-groep A)

Alle admin-pages krijgen **dezelfde** horizontale nav, in deze volgorde:

```
Veilingen | Inbox | Transport | Analytics | Taxatie-rapporten | Server-monitor | Site
```

- "Veilingen" = `/admin/`
- "Inbox" = `/admin/inbox/` (met badge)
- "Transport" = `/admin/transport/`
- "Analytics" = `/admin/analytics/`
- "Taxatie-rapporten" = `/telex-inkoop/`
- "Server-monitor" = `/admin/atx/`
- "Site" = `/` (terug naar publiek)

**Verwijderd:** "Klassiek" (legacy, geen log-evidence van gebruik), "ATX Pipeline" (vervangen door 2 specifiekere items), "CarDatax" (`/app/` PWA — niet voor T4C-admin-context; toegankelijk via aparte bookmark).

Toekomstige items (na bouw):
- "Voorraad", "Inkoop", "Taxaties", "Users" — als de UI's er zijn

---

## 3 · Canonieke klant-nav (publiek)

Niet-staff pages tonen consistent:

```
Voorraad | Veilingen | Transport | Verkoop | (Account|Inloggen)
```

`/index.html` mag hero-nav houden (Over ons / B2B / Contact) maar onder de hero komt dezelfde primaire nav.

---

## 4 · Wie hoort waar — beslis-regels

1. **Veiling-CRUD** = `/admin/` (admin). Klant ziet alleen lees-zijde op `/veilingen/`. Voor staff: shortcut "+ Nieuwe veiling" op `/veilingen/` topbar (NL1 ✅ done).
2. **Taxatie-rapporten** = `/telex-inkoop/...` (atx-admin proxy). Apart van veiling. Apart van monitoring.
3. **Server-monitor** = `/admin/atx/` (admin-dashboard proxy). Alleen voor admin-rol; niet voor staff/inkoper.
4. **Voorraad/Inkoop/Taxaties-historiek** = nieuwe `/admin/voorraad/`, `/admin/inkoop/`, `/admin/taxaties/`. Pas bouwen na nav-fixes.
5. **Klant-betaling** = ontbreekt volledig — `facturen`-tabel leeg, geen iDEAL/Mollie/Stripe-knop. Apart traject (FL1/FL3/FL4).
6. **Verkoop-flow `/verkoop/aanbod/` + `/verkoop/auto/`** = beslis-punt: ofwel verwijderen (legacy dubbel), ofwel doel verhelderen.

---

## 5 · Wat NIET in transfer4cars-scope hoort
- `dev.cardatax.com` / `/opt/cardatax-app/dev` of `live` — apart project, eigen Coolify-stack
- `/opt/cardatax/docs/*` — referentie, niet werk-input voor T4C

---

**Volgende fixes**: zie `T4C-FIX-LOG-2026-06-10.md` voor stand + planning.
