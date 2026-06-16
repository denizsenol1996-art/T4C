# T4C Taxatie-API — koppel-handoff
*Self-contained spec voor een koppeling met de transfer4cars taxatie-API. Alles wat je nodig hebt staat hieronder. (2026-06-16)*

## Wat het is
Een key-beveiligde HTTP-API die een auto-taxatie teruggeeft (verkoopadvies, handelswaarde, bod/inkoop). Achter de schermen: GPT-5.4 + comp-data + een datagedreven bod-curve (gekalibreerd op echte dealer-bods). Identiek aan wat de website-taxatie doet.

## Endpoint
```
POST https://transfer4cars.com/api/v1/taxatie
Content-Type: application/json
X-API-Key: t4c_live_9fac19d7b1cef29d1d1286a49154ffe49222425ad1135a84
```
- Auth: header `X-API-Key` (of `Authorization: Bearer <key>`). Zonder/fout → **401**.
- Latency: **~8-12s per call** (live GPT + web-search). Bouw hier op (timeout ≥ 30s).
- Elke call kost een GPT-call (≈ €0,01-0,05). Niet in een tight loop hameren; cache waar kan.

## Request body
| veld | type | verplicht | voorbeeld |
|---|---|---|---|
| `make` | string | ja | "BMW" |
| `model` | string | ja | "5er reihe" |
| `year` | int | ja | 2005 |
| `km` | int | ja | 295000 |
| `fuel` | string | aanbevolen | "Benzine" / "Diesel" / "Elektrisch" |
| `transmission` | string | optioneel | "Automaat" / "Handgeschakeld" |
| `catalogPrice` | int | optioneel | 65960 (nieuwprijs; verbetert nauwkeurigheid) |
| `plate` | string | optioneel | "41-RH-GN" |
| `engineLabel` | string | optioneel | "525i" |
| `subModel` | string | optioneel | "Touring" |

## Response (JSON) — belangrijkste velden
| veld | betekenis |
|---|---|
| `verkoopadviees` | vraagprijs / verkoopadvies (B2C) |
| `handelswaarde` | handelswaarde (B2B) |
| `inkoopLow` / `inkoopHigh` | **het bod (inkoop-range)** ← meestal wat je wilt |
| `t4cBod` | het bod |
| `internetPrijs` | richt internet-vraagprijs |
| `margin` / `marginPct` | marge |
| `confidence` / `confidenceLabel` | betrouwbaarheid van de taxatie |
| `smartSummary` | korte tekstuele samenvatting |
| `priceSource` | "ai" / "comp" / "comp_blend" (waar de prijs vandaan kwam) |
*(Response bevat ~40 velden incl. scores/channel/lifecycle — bovenstaande zijn de praktische.)*

## Fout-codes
- `401` — key ontbreekt/fout
- `503` — API niet geconfigureerd (server-kant)
- `502` / `504` — pricing-engine onbereikbaar / timeout (retry met backoff)
- `200` — OK, body = taxatie-JSON

## Voorbeelden

### curl
```bash
curl -X POST https://transfer4cars.com/api/v1/taxatie \
  -H "X-API-Key: t4c_live_9fac19d7b1cef29d1d1286a49154ffe49222425ad1135a84" \
  -H "Content-Type: application/json" \
  -d '{"make":"BMW","model":"5er reihe","year":2005,"km":295000,"fuel":"Benzine"}'
```

### Python
```python
import requests
KEY = "t4c_live_9fac19d7b1cef29d1d1286a49154ffe49222425ad1135a84"
r = requests.post("https://transfer4cars.com/api/v1/taxatie",
    headers={"X-API-Key": KEY},
    json={"make":"BMW","model":"5er reihe","year":2005,"km":295000,"fuel":"Benzine"},
    timeout=60)
r.raise_for_status()
d = r.json()
print("verkoop:", d["verkoopadviees"], "| bod:", d["inkoopLow"], "-", d["inkoopHigh"])
```

### Node.js
```js
const res = await fetch("https://transfer4cars.com/api/v1/taxatie", {
  method: "POST",
  headers: { "X-API-Key": "t4c_live_9fac19d7b1cef29d1d1286a49154ffe49222425ad1135a84",
             "Content-Type": "application/json" },
  body: JSON.stringify({ make:"BMW", model:"5er reihe", year:2005, km:295000, fuel:"Benzine" }),
});
const d = await res.json();
console.log(d.verkoopadviees, d.inkoopLow, d.inkoopHigh);
```

### Google Sheets (Apps Script)
```js
function taxatie(make, model, year, km, fuel) {
  const res = UrlFetchApp.fetch("https://transfer4cars.com/api/v1/taxatie", {
    method: "post", contentType: "application/json",
    headers: { "X-API-Key": "t4c_live_9fac19d7b1cef29d1d1286a49154ffe49222425ad1135a84" },
    payload: JSON.stringify({ make, model, year, km, fuel }), muteHttpExceptions: true
  });
  const d = JSON.parse(res.getContentText());
  return [[d.verkoopadviees, d.handelswaarde, d.inkoopLow, d.inkoopHigh]];
}
// In een cel:  =taxatie("BMW";"5er reihe";2005;295000;"Benzine")
```

## Beveiliging / beheer
- **Houd de key geheim** (niet in client-side/browser code; alleen server-side / Apps Script / backend).
- Intrekken/roteren: server `/opt/t4c/backend/.env` → `T4C_API_KEY=` wijzigen + `pm2 restart t4c-server --update-env`.
- De publieke website-taxatie staat los en blijft werken; deze keyed-API is een aparte ingang.
