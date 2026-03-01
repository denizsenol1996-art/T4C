# T4C v10.3.0 — 18-Punten Fix

## LAAG 1 — Backend Logica & Data

### Fix #1: Admin Stats met echte DB tellingen
- `/api/admin/stats` geeft nu echte counts: taxaties, voorraad, users, biedingen, veilingen, portfolio, deals, inbox
- Dashboard toont geen 0's meer maar werkelijke aantallen
- DB bestandsgrootte wordt getoond

### Fix #2: Veldnamen gealiased
- Admin panel gebruikt nu correcte DB veldnamen: `make` (niet `merk`), `market_median` (niet `markt_mediaan`), `verkoopadviees` (niet `verkoop_advies`)
- Taxatie tabel toont nu werkelijke data

### Fix #3: Gecombineerd biedingen overzicht
- Nieuw endpoint: `GET /api/admin/biedingen` — retourneert directe + veiling biedingen
- Admin Biedingen pagina heeft tabs: Alle / Direct / Veiling
- Dashboard toont biedingen van beide systemen

### Fix #4: Voorraad-status sync
- Veiling aanmaken → voorraad status wordt `in_veiling`
- Veiling gewonnen → voorraad status wordt `verkocht`
- Veiling geannuleerd/verwijderd → voorraad terug naar `te_koop`

### Fix #5: Duplicate veiling check
- Zelfde auto (via `voorraad_id` of `kenteken`) kan niet in meerdere actieve veilingen

### Fix #6: Geplande veilingen
- Veiling met toekomstige `start_datum` krijgt status `gepland`
- Veiling checker activeert automatisch wanneer starttijd bereikt is
- Voorraad status sync bij activering

### Fix #7: Bod-validatie verbeterd
- Minimum verhoging: €50 per bod
- Self-outbid check: je kunt niet tegen jezelf opbieden
- Bod moet >= minimumprijs zijn
- Duidelijke foutmeldingen met bedragen

### Fix #8: Auto data via voorraad JOIN
- Veiling detail API stuurt nu volledig `auto` object mee uit voorraad
- Admin veilingen query JOINt met voorraad voor actuele data

## LAAG 2 — Admin Panel Rebuild

### Fix #9-13: Admin Panel opnieuw gebouwd
- **Portfolio pagina** toegevoegd — inkoop, reconditie, vraagprijs, marge zichtbaar
- **Deals pagina** toegevoegd — verkopen met marge berekening
- **Voorraad status filters** — tabs: Alle / Te Koop / In Veiling / Verkocht
- **Veiling vanuit voorraad** — "Veiling" knop per auto, selecteert automatisch data
- **Veiling modal met voorraad dropdown** — kies auto uit voorraad of vul handmatig in
- **Veilingen stats** — inclusief "Gepland" telling
- **Sidebar** — Portfolio en Deals als eigen menu-items onder "Handel" sectie

## LAAG 3 — Systeem Integratie

### Fix #14-16: Admin ↔ Taxatie koppeling
- Portfolio nu zichtbaar in admin met inkoop/reconditie/marge
- Deals/verkopen zichtbaar in admin
- Voorraad → Veiling flow werkt nu via admin

### Fix #17: Veiling checker verbeterd
- Gepland → Actief automatische activering
- Gewonnen veilingen zetten voorraad automatisch op verkocht
- Herstart rondes werken correct met voorraad status

### Fix #18: Zoeken in admin
- Zoekbalken in alle admin tabellen (inbox, biedingen, voorraad, taxaties, veilingen)

## Technisch
- Versie: 10.2.0 → 10.3.0
- server.js: 3292 → 3471 regels
- Admin panel: 318 → 209 regels (compacter, meer functionaliteit)
- Geen breaking changes in API
- Alle bestaande endpoints blijven werken
