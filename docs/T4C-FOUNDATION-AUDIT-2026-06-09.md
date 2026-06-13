# T4C Foundation Audit — wat staat er al

> **Doel** — vastleggen welke bouwblokken **al werken** vóór we veiling v2 bouwen. Voorkomt dat we dingen dubbel maken of slopen.

## 1. Auth-systeem (volledig werkend)

### Backend-routes
| Route | File | Wat |
|---|---|---|
| `POST /api/login` | server.js:131 | Login met username+password, retourneert JWT (7 dagen) |
| `GET  /api/me` | server.js:143 | Huidige user uit JWT |
| `POST /api/register` | routes/misc.js:11 | Algemene registratie (legacy) |
| **`POST /api/register/koper`** | routes/misc.js:38 | **Klant-registratie** — checks dupes, bcrypt-hash, role='koper', queue welkomstmail |
| `POST /api/me/password` | routes/misc.js:114 | Wachtwoord wijzigen |
| `GET  /api/profiel` + `PUT /api/profiel` | routes/misc.js | Profiel ophalen/bewerken |

### Users-tabel (kolommen)
`id, username, password (bcrypt), name, role, created_at, last_login, email, phone, active, company`

### Roles in DB nu
| Role | Aantal | Wie |
|---|---|---|
| admin | 2 | interne | 
| t4c | 1 | service-account |
| inkoper | 1 | inkoop |
| koper | 0 | *(nieuwe klanten krijgen deze rol via /api/register/koper)* |
| dealer | 0 | *(default in schema, niet meer gebruikt)* |

### Wat ontbreekt op de **frontend**
- ❌ Geen `/aanmelden/` page op transfer4cars (backend kan registreren, geen form)
- ❌ Geen `/login/` page op transfer4cars (backend werkt, geen form)
- → **Bouwen** als onderdeel van v2

## 2. Veiling-systeem (volledig werkend backend)

### Bestaande API-routes (`routes/veilingen.js`)
| Methode | Route | Doel |
|---|---|---|
| GET | `/api/veilingen` | Overzicht (auth) |
| GET | `/api/veiling/:id` | Detail (publiek) |
| GET | `/api/veilingen/stats` | Statistieken |
| POST | `/api/veiling/:id/bied` | Bod plaatsen |
| POST | `/api/veiling/watch` | Watchlist |
| POST | `/api/veiling/:id/transport` | Transport boeken na win |
| POST | `/api/veiling/:id/afrekening` | Afrekening |
| POST | `/api/veiling/:id/betaal` | Betaling |
| GET | `/api/factuur/:id`, `/api/factuur/nr/:nr` | Factuur |
| GET | `/api/mijn-veilingen`, `/api/mijn-facturen` | Eigen overzicht |
| **Admin/staff:** | | |
| POST | `/api/veiling` | Nieuwe veiling (staffOnly) |
| PUT | `/api/veiling/:id` | Veiling bewerken (staffOnly) |
| DELETE | `/api/veiling/:id` | Veiling verwijderen (adminOnly) |
| GET | `/api/admin/veilingen`, `/admin/biedingen`, `/admin/verkopen`, `/admin/facturen` | Admin overzichten |
| PUT | `/api/admin/factuur/:id` | Factuur admin-update |

### Veilingen-tabel kolommen
| Kolom | Type | Doel |
|---|---|---|
| id | INTEGER PK | |
| voorraad_id | INTEGER | link naar `voorraad` (auto) |
| kenteken, titel, beschrijving | TEXT | |
| merk, model, bouwjaar | | |
| km, brandstof, kleur | | |
| **minimumprijs** | REAL | **reserve-prijs** (verbergen tot bereikt) |
| **startprijs** | REAL | **start-bod** |
| huidige_bod, aantal_biedingen | REAL/INT | live state |
| **start_datum + eind_datum** | TEXT | **looptijd** (looptijd = eind - start) |
| ronde | INTEGER | multi-ronde support |
| status | TEXT | 'actief', 'afgelopen', etc. |
| winnaar_user_id, winnaar_bod | | wie won + voor hoeveel |
| **transport_status, transport_keuze, transport_kosten, leverdatum** | | **transport-integratie na win** |
| created_by, created_at, updated_at | | |

### Live veilingen NU
| ID | Auto | Reserve | Eindigt | Status |
|---|---|---|---|---|
| 1 | BMW X1 | €14.000 | 2026-06-10 10:31 | actief |
| 2 | Suzuki Vitara | €13.500 | 2026-06-09 00:00 | **actief (al voorbij — bug?)** |
| 3 | VW T-Roc | €12.500 | 2026-06-10 10:31 | actief |

### Wat ontbreekt voor Auto1-stijl v2
- ❌ `channel_type` kolom ('24h' | 'batch' | 'free')
- ❌ `verwachte_prijs` kolom (Auto1's expectation indicator)
- ❌ Frontend admin-page `/admin/veilingen` voor CRUD (cardatax-admin/index.html is voor cardatax, niet transfer4cars)
- ❌ Frontend filter-sidebar + channel-tabs op `/veilingen` page

### Bug-signaal
- Veiling 2 (Suzuki Vitara) eind_datum = vandaag 00:00 maar status nog 'actief'. Cleanup-cron of veiling-afsluit-logica werkt niet automatisch?

## 3. Sub-systemen

### Email queue (werkend)
- Tabel `email_queue (to_email, subject, body, type, status, attempts, sent_at)`
- `lib/mailer.js` met nodemailer transporter
- `db.js` stmts: `addEmailQueue`, `getPendingEmails`, `markEmailSent`
- Welkomstmail wordt al gequeued bij /api/register/koper
- → V2 kan gewoon `addEmailQueue` callen voor bid-confirmations, win-notificaties, transport-bevestiging

### Bestanden + sites
| Pad | Inhoud |
|---|---|
| `/opt/t4c/sites/transfer4cars/` | publieke marketing-site (multi-tenant via Host-header) |
| `/opt/t4c/sites/transfer4cars/veilingen/index.html` | basis veiling-page (35KB) — wordt vervangen door v2 |
| `/opt/t4c/sites/transfer4cars/index.html` | homepage (60KB — 1 file, splitsen) |
| `/opt/t4c/sites/transfer4cars/admin/` | **bestaat niet — bouwen** |
| `/opt/t4c/sites/transfer4cars/aanmelden/` | **bestaat niet — bouwen** |
| `/opt/t4c/sites/transfer4cars/login/` | **bestaat niet — bouwen** |
| `/opt/t4c/sites/cardatax/admin/index.html` (68KB) | cardatax-admin, NIET aanraken |

### Host-routing in server.js
- regel 165: `if (host.includes("transfer4cars")) req.site = "transfer4cars"` 
- `T4C_SALES_DIR = path.join(SITES_DIR, "transfer4cars")`
- Cloudflare-tunnel via Coolify-container routeert transfer4cars.com → port 3000

## 4. Implementatie-plan voor v2 (concreet, op deze fundering)

| # | Stap | Wijzigt | Risico |
|---|---|---|---|
| A | DB-migratie: ALTER veilingen ADD channel_type + verwachte_prijs | data | klein — stop pm2 vóór ALTER |
| B | Frontend: `/sites/transfer4cars/aanmelden/index.html` form → POST `/api/register/koper` | nieuw | geen |
| C | Frontend: `/sites/transfer4cars/login/index.html` form → POST `/api/login` | nieuw | geen |
| D | Frontend: `/sites/transfer4cars/admin/index.html` — CRUD veilingen voor Deniz + Jurgen | nieuw | geen |
| E | Backend uitbreiden: `/api/veilingen?channel=24h&merk=BMW&prijs_min=10000` | wijzig veilingen.js | klein |
| F | Frontend: `/veilingen/index.html` herbouwen met tabs + filter-sidebar + car-cards v2 | vervang | medium |
| G | Frontend: `/veilingen/[id]/index.html` detail met live bieden (SSE) | nieuw | medium |
| H | Cleanup-bug: veiling status auto-update bij eind_datum verlopen | wijzig | klein |
| I | Homepage split (`/index.html` 60KB → componenten) | refactor | medium |
| J | Transport-planner integratie (eigen module, gebruikt veiling transport_*) | nieuw | groot |

## 5. Hardcoded business-info

- KvK 88503925 (T4C / JHVT)
- Domain transfer4cars.com
- Welkomstmail subject: "Welkom bij Transfer4Cars!"
- JWT-token 7 dagen geldig
- Min password length 6 (mogelijk verhogen?)
