# Cloudflare — www & HTTPS redirect handleiding

> **Doel:** SEO-blocker uit Seobility (Server-config 0%) fixen: `www.transfer4cars.com` en `http://*` moeten 301-redirecten naar `https://transfer4cars.com/` (non-www canonical, jouw keuze 2026-06-10).
>
> **Wie:** jij doet dit in Cloudflare-dashboard (geen API-token in mijn omgeving). Duurt ~5 min, geen impact op live verkeer (alleen extra redirect-regel toegevoegd, originele DNS ongewijzigd).

## Stap 1 — Inloggen Cloudflare

1. Ga naar https://dash.cloudflare.com/
2. Selecteer `transfer4cars.com` zone
3. Linker-menu: **Rules** → **Redirect Rules**

## Stap 2 — Maak redirect-regel "www → non-www + force HTTPS"

Klik **Create rule**:

| Veld | Waarde |
|---|---|
| Rule name | `www → non-www + HTTPS` |
| If incoming requests match | Custom filter expression |
| Field | Hostname |
| Operator | equals |
| Value | `www.transfer4cars.com` |

Of via expression-editor: `(http.host eq "www.transfer4cars.com")`

**Then**:
| Veld | Waarde |
|---|---|
| Type | Dynamic |
| Expression | `concat("https://transfer4cars.com", http.request.uri.path)` |
| Status code | 301 |
| Preserve query string | ✅ Aan |

**Save and Deploy**.

## Stap 3 — Maak tweede regel "HTTP → HTTPS" (als nog niet actief)

Cloudflare heeft hier vaak al een Automatic HTTPS Rewrites + "Always Use HTTPS" voor. Check:
- Linker-menu: **SSL/TLS** → **Edge Certificates**
- Scroll naar **Always Use HTTPS** — moet **ON** staan
- Scroll naar **Automatic HTTPS Rewrites** — moet **ON** staan

Als ze al aan staan: niets te doen. Anders: aanzetten.

## Stap 4 — Verificatie (5 min na deploy)

Test 4 cases:

```bash
# verwacht 301 → https://transfer4cars.com/
curl -sI https://www.transfer4cars.com/ | head -3
curl -sI http://transfer4cars.com/ | head -3
curl -sI http://www.transfer4cars.com/ | head -3

# verwacht 200 (= canonical, geen redirect)
curl -sI https://transfer4cars.com/ | head -3
```

**Verwachte output**:
```
HTTP/2 301
location: https://transfer4cars.com/
```
voor de eerste 3, en `HTTP/2 200` voor de laatste.

## Stap 5 — Subdomains (optioneel maar aanbevolen)

Heb je `dev.transfer4cars.com` of andere subdomeinen? Die mogen niet redirecten naar non-www. Bovenstaande regel filtert alleen op `www.` dus is veilig — maar bevestig dat de filter exact `equals` is, niet `contains`.

## Veiligheid

- **Rollback**: in CF dashboard → Rules → Redirect Rules → klik de rule → **Disable**. Effect binnen 30 seconden.
- **Geen breaking**: cookies/sessies overleven 301-redirect, GA4-tracking blijft werken.
- **SEO impact**: Google merkt dit binnen 1-2 weken, ranking-overdracht is automatisch.

## Status na deze stap

Dit fixt **Seobility item "Server-config 0% → 100%"** (de critical SEO-blocker uit het rapport).
