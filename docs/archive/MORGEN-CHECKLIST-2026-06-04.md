# Transfer4Cars — Morgen-checklist (2026-06-04)

**Status server-side**: ✅ alles live. Wat hier staat is alles wat JIJ handmatig moet doen — niks meer in code.
**Tijd-inschatting totaal**: 60–90 min.
**Volgorde**: 1 → 2 → 3 (Cloudflare eerst zodat Google de juiste robots.txt ziet).

---

## 1. Cloudflare-dashboard (15 min)

Login op `dash.cloudflare.com` → kies domain `transfer4cars.com`.

### 1a. Robots.txt origin doorlaten
Cloudflare overschrijft nu onze `/robots.txt` met hun default content-signals.

- Ga naar **Rules → Page Rules** (of nieuwe "Configuration Rules")
- Maak rule:
  - URL match: `transfer4cars.com/robots.txt`
  - Settings: **Cache Level: Bypass**, **Disable Apps**, **Disable Performance**
- Save + Deploy

### 1b. Cache purge voor og-cover
- Caching → Configuration → **Purge Cache → Custom Purge**
- URL: `https://transfer4cars.com/img/og-cover.jpg`
- Save
- (Anders zien Facebook/LinkedIn 4 uur lang de oude 404)

### 1c. Bot Fight Mode check
- Security → Bots → Bot Fight Mode: zet **UIT** (of "Configured")
- Anders kan Google-crawler zelf ook geblokkeerd worden

### Verificatie (knip-en-plak in terminal)
```bash
curl -sS https://transfer4cars.com/robots.txt | head -5
# Moet beginnen met: "User-agent: *" gevolgd door onze Allow/Disallow regels.
# Als je nog "# As a condition of accessing..." ziet, is rule nog niet actief.

curl -sSI https://transfer4cars.com/img/og-cover.jpg | grep -iE "cf-cache|HTTP"
# Moet "HTTP/2 200" + "cf-cache-status: MISS" of "HIT" zonder query-string.
```

---

## 2. Google Search Console (20 min)

URL: `https://search.google.com/search-console`

### 2a. Property toevoegen (sla over als al gedaan)
- "Add property" → **URL prefix** → `https://transfer4cars.com/`
- Verificatie: kies **DNS TXT record** of **HTML tag** (HTML tag is sneller — copy/paste in `index.html` `<head>`)

### 2b. Sitemap submit
- Linker menu → **Sitemaps**
- Voeg toe: `sitemap.xml` (Google plakt zelf het domein ervoor)
- Submit
- Status moet binnen 24u "Geslaagd" worden, "Aantal ontdekte URL's" = 48

### 2c. URL Inspection — 3 hoofdpagina's
Voor elke URL hieronder:
1. Top zoekbalk → URL plakken → Enter
2. Wacht op resultaat ("URL is niet op Google" is normaal nu)
3. Klik **"Indexering aanvragen"**

URLs:
- `https://transfer4cars.com/`
- `https://transfer4cars.com/aanbod/`
- `https://transfer4cars.com/veilingen/`

### 2d. Bing Webmaster Tools (extra 5 min — optioneel maar gratis)
URL: `https://www.bing.com/webmasters` → property aanmaken → sitemap submitten. Bing-traffic = vaak 5–10% van Google in NL.

---

## 3. Socials aanmaken/optimaliseren (30 min)

### 3a. Google Business Profile ⭐ (hoogste ROI)
URL: `https://business.google.com`

- **Bedrijfsnaam**: Transfer4Cars
- **Categorie**: "Autodealer" + secundair "Tweedehandsautodealer"
- **Adres**: Prins Hendrikstraat 58a, 2405 AK Alphen aan den Rijn (of operationele plek Langeraar — bedenk welke)
- **Servicegebied**: Nederland + België + Duitsland
- **Openingstijden**: ma–vr 09:00–18:00 (komt overeen met JSON-LD)
- **Telefoon**: +31 6 87 99 71 68
- **Website**: `https://transfer4cars.com`
- **Foto's**: minstens 5 (auto's + buitenkant pand + interieur showroom als beschikbaar)
- **Beschrijving** (max 750 tekens, suggestie):
  > Transfer4Cars verkoopt kwaliteitsoccasions aan particulieren én organiseert B2B-veilingen voor handelaren. Vanuit Alphen aan den Rijn regelen wij EU-import, transport en levering door heel Nederland. Onderdeel van JHVT Holding B.V.

**Belangrijk**: Google checkt het adres met een fysieke postkaart-verificatie (5–14 dagen). Zonder verificatie geen Google Maps + lokale rankings.

### 3b. Instagram Business
URL: `instagram.com` → Profile → Settings → "Switch to Professional Account" → Business
- Username: `@transfer4cars` (check beschikbaarheid eerst)
- Categorie: "Autodealer" of "Used Car Dealer"
- Contact-knoppen: telefoon + WhatsApp + e-mail
- Bio (suggestie):
  > 🚗 B2B-autohandel + veilingen
  > 📍 Alphen a/d Rijn
  > 🇳🇱🇧🇪🇩🇪 EU-import & transport
  > 🔗 transfer4cars.com
- Link toevoegen: `https://transfer4cars.com`
- **OG-cover die wij maakten**: `https://transfer4cars.com/img/og-cover.jpg` → kan als feed-tile.

### 3c. Marktplaats Pro-account
URL: `https://www.marktplaats.nl/u/transfer4cars/17478300/` (volgens JSON-LD heb je al een profiel)
- Inloggen, profiel updaten met juiste contact-data
- Voorraad-feed checken: zijn de 30 voorraad-auto's hier ook aktief? Zo niet → grootste verkoop-blocker.

### 3d. AutoScout24 Dealer-account
URL: `https://www.autoscout24.nl/dealerportal`
- Dealer-account aanvragen als je dat nog niet hebt
- Voorraad-feed instellen (kan vaak XML-import vanuit T4C-API)

### 3e. LinkedIn Company Page (5 min, lage prio)
- `linkedin.com/company/setup/new`
- Voor B2B-veilingen relevant: handelaren zien hier dat T4C bestaat

---

## 4. Snelle wins die ik morgen voor je kan oplossen

Als je morgen een sessie start, ik kan:
- Voorraad-kentekens invullen (nu allemaal NULL → blokt veiling-detail-UX)
- Foto's koppelen aan voorraad id 12/30/31 (de 3 test-veilingen)
- Per-kenteken auto-detail pagina's bouwen (`/auto/{kenteken}`) met SSR + JSON-LD Vehicle schema = Google long-tail rankings
- Marktplaats/AutoScout XML-feed bouwen vanuit `/api/public/voorraad`

Begin de sessie met: `cat /opt/t4c/docs/MORGEN-CHECKLIST-2026-06-04.md | head -40` zodat de assistent direct ziet waar je staat.

---

## 5. Resultaten checken (vanaf morgenochtend)

| Wanneer | Wat verwachten |
|---------|----------------|
| Vanavond +4u | OG-cover is overal vers geserveerd (CF-cache expired) |
| Morgen | Robots.txt rule actief, GSC sitemap "Geslaagd" |
| Dag 2–7 | Eerste pagina's komen in Google-index, GSC "Pagina's" stijgt van 0 naar ~10 |
| Week 2–4 | Long-tail searches beginnen impressies te geven |
| Maand 2–3 | Eerste organic-leads (mits voorraad-detail-URLs + Marktplaats actief) |

**Belangrijk**: organic-uplift is traagheidskanaal. Snelle sales-versnelling deze maand komt van **Marktplaats voorraad-actief** + **Google Business Profile geverifieerd** + **Instagram dagelijks 1 post**. SEO bouwt onder dat heen op.
