# T4C uncommitted source patches

**Stand: 2026-05-28**
**Status: 9 live patches (T4C) + 2 atx-pipeline patches niet in git, allemaal in productie actief.**

Bij volgende T4C-deploy (via dev-team source-update): **check elke patch hieronder**. Als de patroon-regels (originele tekst) nog bestaan in de nieuwe source → re-apply. Als ze al weg zijn → de developers hebben de patch zelf in source gezet, dan niet opnieuw applien.

**Branch: `main`** (T4C werkt op één branch). **Remote**: `git@github.com:denizsenol1996-art/T4C.git`.

---

## PATCH 1 — 413-fix voor /api/extended-taxatie (atx-pipeline integratie)

**File**: `backend/server.js`
**Locatie**: regel 18 (na `app.use(cors())`, vóór `const PORT = ...`)
**Diff stats**: +5 / -1 = net +4 lines
**Live sinds**: 2026-05-24 ~11:18 (zie atx-pipeline fase 5 deploy)
**Toegevoegd door**: atx-pipeline integratie debug-sessie

### Originele tekst (was)
```js
app.use(express.json({ limit: '10mb' }))
```

### Nieuwe tekst (is)
```js
app.use((req, res, next) => {
  // Route-level parser handles /api/extended-taxatie with 50mb limit
  if (req.path === '/api/extended-taxatie') return next();
  return express.json({ limit: '10mb' })(req, res, next);
})
```

### Waarom
Globale `express.json({limit:'10mb'})` overschrijft de route-specifieke `express.json({limit:'50mb'})` in `routes/extended-taxatie.js:25`. Resultaat: HTTP 413 op grote photo-uploads (~11MB base64 bij 8 hi-res photos). Fix sluit `/api/extended-taxatie` uit van globale parser → route-specific 50mb wint.

### Pre-patch backup
`/tmp/t4c-server-pre-413-fix-1779621358.js` (kan inmiddels door tmp cleanup verdwenen zijn).

---

## PATCH 2 — Lyra Server proxy mount

**File**: `backend/server.js`
**Locatie**: regel ~249, ná `setupDVWebhookRoutes(app, ...)` block, vóór 404 catch-all
**Diff stats**: +36 / -0 = net +36 lines
**Live sinds**: onbekend (al aanwezig vóór atx-pipeline werk begon)
**Toegevoegd door**: onbekend, vermoedelijk eerdere Lyra v1.1 feature

### Originele tekst (was)
Niets — block is nieuw toegevoegd. Match-patroon vóór: regel die eindigt op `console.log("[DV] Not loaded:", e.message) }`. Het Lyra-block staat direct daarna.

### Nieuwe tekst (is)
```js
    // ═══ Lyra Server proxy — toegevoegd voor v1.1 ═══
    async function lyraProxy(req, res) {
      try {
        const url = `http://127.0.0.1:3100${req.originalUrl}`
        const headers = { ...req.headers }
        delete headers.host
        delete headers['content-length']

        const fetchOpts = { method: req.method, headers }
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
          fetchOpts.body = JSON.stringify(req.body)
          headers['content-type'] = 'application/json'
        }

        const lyraResp = await fetch(url, fetchOpts)

        res.status(lyraResp.status)
        lyraResp.headers.forEach((v, k) => {
          if (!['content-encoding','transfer-encoding','connection'].includes(k.toLowerCase())) {
            res.setHeader(k, v)
          }
        })

        const buf = Buffer.from(await lyraResp.arrayBuffer())
        res.send(buf)
      } catch (e) {
        console.error('[Lyra Proxy] Error:', e.message)
        res.status(502).json({ ok: false, error: 'Lyra niet bereikbaar' })
      }
    }

    app.use('/api/lyra', express.json({ limit: '500kb' }), lyraProxy)
    app.use('/lyra-ai', lyraProxy)
    // ═══ einde Lyra proxy ═══
```

### Waarom
T4C proxiet alle `/api/lyra/*` en `/lyra-ai/*` requests door naar `lyra-server` op poort 3100. Zonder deze mount falen Lyra-frontend calls met 404.

### Risico bij verwijderen
Lyra UI breekt (`lyra-ai.html` kan geen API calls doen). Memory `project_lyra_t4c_stack.md` documenteert de stack-koppeling.

---

## PATCH 3 — Lyra observation emit in pricing flow

**File**: `backend/routes/valuation.js`
**Locatie**: 2 hunks rond regel 1025 (auto-save) en regel 1095 (na `await _lifecyclePromise`)
**Diff stats**: +35 / -1 = net +34 lines
**Live sinds**: onbekend (al aanwezig vóór atx-pipeline werk begon)
**Toegevoegd door**: onbekend, vermoedelijk eerdere Lyra feedback-loop setup

### Hunk 3a — _saveResult capture (regel 1025-1027)

Was:
```js
    try {
      stmts.saveTaxatie.run({
```

Is:
```js
    let _saveResult = null;
    try {
      _saveResult = stmts.saveTaxatie.run({
```

### Hunk 3b — emitObservation call (regel 1095, na `await _lifecyclePromise`)

Toegevoegd na de regel `const modelLifecycle = await _lifecyclePromise`, vóór de bestaande `res.json({modelLifecycle, ...})`:

```js
    // ═══ Lyra observation (async, non-blocking) ═══
    try {
      const { emitObservation } = require('../lib/lyra-emit');
      emitObservation({
        taxatie_id: _saveResult?.lastInsertRowid || null,
        user_id: _userId,
        kenteken: d.plate || null,
        make: d.make || null,
        model: d.model || null,
        year: d.year || null,
        km: d.km || null,
        staat: null,
        rijdt: null,
        gpt_verkoop: finalVerkoop,
        gpt_inkoop_low: finalInkoopLow,
        gpt_inkoop_high: finalInkoopHigh,
        gpt_handelswaarde: finalHandel,
        gpt_max_bod: finalBod,
        blend_source: priceSource,
        data_weight: _auditDataWeight,
        comp_count: compResult?.cleanCount || null,
        comp_median: compResult?.marketMedian || null,
        input_json: JSON.stringify(req.body || {}).substring(0, 4000),
        output_json: JSON.stringify({
          finalVerkoop, finalInkoopLow, finalInkoopHigh,
          finalHandel, finalBod, priceSource, _auditDataWeight,
        }).substring(0, 4000),
      });
    } catch (e) {
      console.warn('[Lyra-emit] non-fatal:', e.message);
    }
    // ═══ einde Lyra observation ═══
```

### Waarom
Elke taxatie wordt non-blocking doorgeschoten naar `lib/lyra-emit.js` voor de Lyra learning-loop. Capture van GPT-prijzen + comp-engine output + raw input/output JSON.

### Risico bij verwijderen
Lyra mist taxatie-observaties → learning-loop stilt. Niet acuut breekt productie maar wel waarde-loss voor analyses.

---

---

## PATCH 4 — Vision call switch naar gpt-5.4 + Responses API + per-foto classification + detail:high

**File**: `backend/routes/extended-taxatie.js`
**Locatie**: regels 43-59 (vision call block) + regels 76-80 (response parsing)
**Diff stats**: ~25 lines gewijzigd (endpoint switch + multiple field renames)
**Live sinds**: 2026-05-24 ~15:27 (atx-pipeline fase 9 — quality upgrade)
**Toegevoegd door**: atx-pipeline fase 9 sessie

### Samenvatting
Vision-call upgegrade van gpt-4o (Chat Completions, detail:low) naar gpt-5.4 (Responses API, detail:high) met aangevulde prompt voor specifiekere foto-classificatie.

### Hunk 4a (oud) — prompt regel 6 voor foto-classificatie

In de system-prompt string, ná `"5. OPTIES: welke opties zie je?\n"` en vóór `"Antwoord ALLEEN in JSON"`, toegevoegd:

```
6. FOTO-CLASSIFICATIE: voor ELKE meegestuurde foto in de volgorde 0 t/m N-1,
identificeer het type. Mogelijke types: exterieur_voor, exterieur_achter,
exterieur_links, exterieur_rechts, exterieur_3kwart, interieur, dashboard,
instrumentenpaneel, motorruimte, laadruimte, kofferbak, kenteken, velg,
detail, overig. Confidence: high (duidelijk zichtbaar), medium (twijfel),
low (gedeeltelijk afgesneden of slechte foto).
```

### Hunk 4b — JSON response schema uitgebreid

In de prompt-instructie, ná `"algehele_staat":"goed|redelijk|matig|slecht"` toegevoegd:

```
,"per_foto":[{"index":0,"type":"exterieur_voor","confidence":"high"}]
```

### Hunk 4c (oud) — max_tokens 800 → 1200 → 2000 (zie hunk 4e)

### Hunk 4d (nieuw, patch v2) — prompt aanscherpen tegen 3kwart-bias

In de FOTO-CLASSIFICATIE regel toegevoegd ná `"low (gedeeltelijk afgesneden of slechte foto)."`:

```
Wees specifiek; gebruik exterieur_3kwart ALLEEN voor duidelijke 3/4-views,
niet als safe default. Bij twijfel: kies specifieker type (voor/achter/links/rechts)
of zet confidence:low. Als foto duidelijk binnenkant toont
(stuur, dashboard, stoelen, kofferbak): NIET classificeren als exterieur.
```

### Hunk 4e (nieuw, patch v2) — vision call: Responses API + gpt-5.4 + detail:high

Was (Chat Completions API):
```js
const imageContent = photos.slice(0, 8).map(p => ({
  type: "image_url",
  image_url: { url: ..., detail: "low" }
}))
visionPromise = axios.post("https://api.openai.com/v1/chat/completions", {
  model: "gpt-4o",
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: [
      { type: "text", text: "..." },
      ...imageContent
    ]}
  ],
  max_tokens: 1200,
  temperature: 0
}, {...}).catch(...)
```

Is (Responses API):
```js
const imageContent = photos.slice(0, 8).map(p => ({
  type: "input_image",
  image_url: p.startsWith("data:") ? p : "data:image/jpeg;base64," + p,
  detail: "high"
}))
visionPromise = axios.post("https://api.openai.com/v1/responses", {
  model: "gpt-5.4",
  input: [
    { role: "system", content: "..." },
    { role: "user", content: [
      { type: "input_text", text: "..." },
      ...imageContent
    ]}
  ],
  max_output_tokens: 2000,
  temperature: 0
}, {...}).catch(...)
```

Key wijzigingen:
- Endpoint: `/v1/chat/completions` → `/v1/responses`
- Model: `gpt-4o` → `gpt-5.4`
- `messages` → `input`
- `type:"image_url" + image_url:{url, detail}` → `type:"input_image" + image_url:string + detail:string`
- `detail: "low"` → `detail: "high"`
- `type:"text"` → `type:"input_text"`
- `max_tokens: 1200` → `max_output_tokens: 2000`

### Hunk 4f (nieuw, patch v2) — response parsing voor Responses API

Was:
```js
const visionText = visionResult.data.choices[0].message.content || "{}"
const clean = visionText.replace(/```json|```/g, "").trim()
```

Is:
```js
const _outBlocks = visionResult.data.output || []
const _textBlock = _outBlocks.find(b => b.type === 'message')
const visionText = (_textBlock && _textBlock.content ? (_textBlock.content.find(c => c.type === 'output_text') || _textBlock.content[0] || {}).text : null) || '{}'
const clean = String(visionText).replace(/```json|```/g, "").trim()
```

### Waarom (v2)
Verhogen van vision-accuratesse via:
1. Sterker model (gpt-5.4 → identiek model als T4C voor pricing al gebruikt)
2. Hogere foto-resolutie (detail:high) zodat fijne details + labels op interieur herkenbaar zijn
3. Anti-default-bias prompt (voorkomt dat GPT alle exterieur-foto's safe op "3kwart" zet)

Token-cost: van ~1180 tokens (~$0.003) naar ~5000 tokens (~$0.025-0.04) per taxatie.

### Risico bij verwijderen
atx-pipeline renderPhotos faalt terug op `inbound_photos.positie` (= Autotelex's labels) → foto-labels mismatch.

### Pre-patch backups
- v1 (gpt-4o): `/tmp/t4c-extended-taxatie-pre-patch4-1779635434.js`
- v2 (gpt-5.4): `/tmp/t4c-extended-taxatie-pre-patch5-1779636426.js`

---

---

## PATCH 5 — extended-taxatie body-overrides + full_pricing response passthrough

**File**: `backend/routes/extended-taxatie.js`
**Locatie**: regel 27 (destructure) + regel 34 (basePromise body) + res.json
**Diff stats**: 3 hunks, +~5 lines net
**Live sinds**: 2026-05-24 (fase 9 finalisatie)

### Hunk 5a — body destructure
Was:
```js
const { plate, km, corrections, photos } = req.body
```
Is:
```js
const { plate, km, corrections, photos, ...overrides } = req.body
```

### Hunk 5b — forward overrides naar interne dealer/price call
Was:
```js
const basePromise = axios.post("http://localhost:3000/api/dealer/price",
  { plate, km: Number(km) || 0 },
  { ... }
)
```
Is:
```js
const basePromise = axios.post("http://localhost:3000/api/dealer/price",
  { plate, km: Number(km) || 0, ...overrides },
  { ... }
)
```

### Hunk 5c — response uitbreiden met full_pricing
In res.json toegevoegd als eerste veld:
```js
res.json({
  full_pricing: base,    // ← NIEUW: hele dealer/price response (~50 velden)
  basis: { ... },
  gecorrigeerd: { ... },
  ...
})
```

### Waarom
atx-pipeline stuurt Autotelex-vehicle-data als overrides → T4C dealer/price runt pricing op Autotelex-realiteit (niet RDW). Response geeft volledige pricing-output door zodat T4C app V-01-PFS rapport kan renderen.

### Risico bij verwijderen
atx-pipeline taxatie-worker krijgt 'oude' 5-veld response → T4C app /app/?atx_job=N kan rapport niet vullen met Autotelex-pricing.

### Pre-patch backup
`/tmp/t4c-ext-pre-step12-1779638xxx.js`

---

## PATCH 6 — atx-pipeline proxy mount in T4C server + auto-trigger doTax

**Files**:
- `backend/server.js` — proxy mount (~50 lines)
- `sites/cardatax/app/index.html` — doTax atx_job branch + auto-trigger

**Locatie server.js**: regel ~285, direct ná Lyra-proxy block
**Live sinds**: 2026-05-24 fase 9 finalisatie

### Server.js — atx-pipeline proxy
Toegevoegd na de bestaande Lyra-proxy block:
```js
// ═══ ATX-pipeline proxy (telex-inkoop portaal) ═══
async function atxProxy(req, res) {
  // standaard fetch-proxy naar 127.0.0.1:3110 (zelfde pattern als lyraProxy)
}
app.get('/telex-inkoop', → /admin/inbound proxied)
app.get('/telex-inkoop/:id', → /admin/inbound/:id proxied)
app.use('/admin/inbound', atxProxy)
app.use('/api/inbound', express.json({limit:'5mb'}), atxProxy)
app.use('/api/scraper/photos', atxProxy)
app.use('/inbound.css', atxProxy)
app.use('/inbound.js', atxProxy)
app.use('/inbound-detail.css', atxProxy)
app.use('/inbound-detail.js', atxProxy)
```

### app/index.html — doTax atx_job branch
- Detecteert `?atx_job=N` URL-param op page-load
- Fetcht `/api/inbound/context/N` (via dezelfde T4C-host nu, geen CORS issue)
- Prefil plate + km, auto-trigger doTax
- Na pricing-call: `r = { ...r, ...full_pricing }` overlay

### Waarom
Publieke toegang via `transfer4cars.com/telex-inkoop` zonder SSH tunnel. Cloudflared tunnel exposeert al T4C → onze proxy zet door naar atx-pipeline localhost:3110.

### Risico bij verwijderen
`transfer4cars.com/telex-inkoop` 404 → admin moet via SSH tunnel werken.

### Pre-patch backup
`/tmp/t4c-server-pre-patch6-1779638xxx.js`

---

## PATCH 7 — Vision-prompt herziening (anti-hallucinatie + Autotelex-prior)

**File**: `backend/routes/extended-taxatie.js`
**Locatie**: regel 39-71 (visionPromise constructie binnen `router.post("/api/extended-taxatie", …)`)
**Diff stats**: +37 / -11 = net +26 lines
**Live sinds**: 2026-05-25 ~00:18
**Toegevoegd door**: atx-pipeline vision-audit (Mercedes R621VV id 24 → 3 ruimtelijk onmogelijke kras-claims op schadevrij-gemelde auto, bij temp=0 deterministisch reproduceerbaar)

### Originele tekst (was)
System-prompt begon met `"Beoordeel STRENG"`, bevatte `"Markeer ELKE schade … Bij twijfel: kies zwaar."` en miste per-item confidence + dedup over foto's. User-text was statisch `"Analyseer deze foto's … Beoordeel streng — elke deuk, kras of schade telt."` — geen Autotelex-context.

### Nieuwe tekst (is)
System-prompt opent met `"Je bent een voorzichtige voertuig-inspecteur. Accuracy boven volume."`. Vier inhoudelijke wijzigingen:

1. **Bias gekanteld**: `"Bij twijfel: NIET rapporteren"`, `"Markeer ALLEEN duidelijk zichtbare schade (≥1 cm of substantieel)"`. Verwijderd: `"ELKE"`, `"kies zwaar"`.
2. **Per-item confidence**: `"Geef per item een confidence 0-100. Rapporteer GEEN items met confidence < 70."` JSON-schema breidt uit met `"confidence":85`.
3. **Dedup over foto's**: `"Als dezelfde schade vanuit meerdere foto's zichtbaar is, rapporteer als ÉÉN item met 'ook_zichtbaar_op': [foto-nrs]"`. JSON-schema breidt uit met `"ook_zichtbaar_op":[]`.
4. **Autotelex-prior in user-text** (dynamisch op basis van body):
   - `overrides.autotelex_schadevrij === true` → "Officiële Autotelex-inspecteur status: SCHADEVRIJ. Verwacht GEEN schade-items tenzij zeer duidelijk zichtbaar bewijs…"
   - `overrides.defects.length > 0` → lijst gemelde items + "Verifieer deze items. Zoek GEEN extra schade buiten deze lijst tenzij zeer duidelijk zichtbaar."
   - anders → "niet meegestuurd. Beoordeel voorzichtig."

### Waarom
Vision-prompt produceerde systematisch overrapportage: **100%** van schadevrij-gemelde Autotelex-cars (6/6) kregen toch vision-items, **52%** records (12/23) hadden duplicate-suspect items binnen 5%-xy van elkaar. Test op Mercedes id 24 (schadevrij=true) gaf 3 ruimtelijk onmogelijke kras-claims (Voorzijde-foto claimde achterbumper). GPT-5.4 met temp=0 reproduceerde exact dezelfde 3 items → geen random hallucinatie maar **prompt-induced bias**. Patch herijkt prompt richting voorzichtigheid + benut Autotelex-inspecteur als prior.

### Caller-zijde dependency
`atx-pipeline/lib/taxatie-worker.js` `buildT4cOverrides()` regel ~410 stuurt nu `autotelex_schadevrij: summary.schadevrij` mee. `defects` was al present. Synchroon gefixt in atx-pipeline commit.

### Risico bij verwijderen
- Vision keert terug naar STRENG-modus → overrapportage hervat (6/6 schadevrije auto's krijgen false-positive schade-items)
- Autotelex-prior wordt genegeerd
- Geen dedup → dezelfde schade dubbel zichtbaar in detail-page schade-block

### Pre-patch backup
`/tmp/extended-taxatie-pre-patch7-1779668306.js`

---

## PATCH 9 — 2-pass vision architectuur

**File**: `backend/routes/extended-taxatie.js`
**Locatie**: helper `runVisionTwoPass()` direct boven `router.post(...)` (~100 regels) + vereenvoudigde visionPromise call + vereenvoudigde visionResult parsing in route-body
**Diff stats**: +110 / -68 = net +42 lines
**Live sinds**: 2026-05-25 ~01:00
**Toegevoegd door**: atx-pipeline foto-labeling onderzoek (Mercedes id 24 had verkeerde positie-mapping bij 1-pass — overgestapt naar 2-pass om GPT z'n taken te scheiden + bewezen dat Autotelex-scraper verkeerde filenamen aan beeldinhoud koppelt)

### Originele tekst (was)
Eén axios.post-call met `detail:"high"` op alle foto's, vroeg GPT 7 taken tegelijk (schade + classificatie + positie-selectie). Bij grote foto-sets (19+) gaf GPT consistent verkeerde indices als selected_photos — "lost in the middle" failure of overload.

### Nieuwe tekst (is)
Helper `runVisionTwoPass(photos, overrides, apiKey)` boven de route:

**Pass 1** (lo-detail, alle foto's):
- Classify per_foto: `{index, type, confidence, bruikbaar}`
- Types: voor, linksvoor, linksachter, achter, rechtsachter, rechtsvoor, interieur, dashboard, motorruimte, kofferbak, laadruimte, detail, rotzooi
- `selected_photos` per van de 7 standaard-posities (geen geschikte match OF conf<0.7 → null, max 1 foto-index per positie)
- Output JSON-only

**Pass 2** (hi-detail, alleen geselecteerde foto's, in `POS_ORDER` volgorde):
- Schade-detection met Autotelex-prior (patch-7 logica)
- foto_nr verwijst naar positie binnen geselecteerde set (0..N-1), max 7
- Per-item confidence ≥70, dedup via `ook_zichtbaar_op[]`
- Helper mapt achteraf `foto_nr` en `ook_zichtbaar_op[]` terug naar oorspronkelijke `photos[]`-index

Helper geeft direct het `photoAnalysis`-object terug (geen axios shell). Route-body `if (visionResult && !visionResult.error)` werkt nu zonder `.data.output[]`-parsing.

### Waarom
1-pass test op Mercedes (19 foto's) → GPT's selected_photos consistent fout (0.97 conf "voor" → file `08_dashboard.jpg`, etc.). Visuele check door Jurgen bevestigde dat **Autotelex-scraper foute filenames levert** (`08_dashboard.jpg` = voorkant-foto, `02_linker-achterzijde.jpg` = schoen op stoep). GPT's classificaties zijn correct; Autotelex-positie-metadata is onbetrouwbaar.

2-pass voordeel: pass 1 doet één simpele taak goed (classificatie); pass 2 ziet alleen relevante foto's en kan zich op schade-detectie concentreren. Geen "lost in the middle". Hi-detail tokens alleen op 7 foto's i.p.v. 19 → kostenneutraal ondanks extra pass.

### Kostenoverweging
~$0.005 (pass 1 lo-detail × 19) + ~$0.04 (pass 2 hi-detail × 7) ≈ $0.045 per car. Ongeveer gelijk aan oude 1-pass × 8 hi-detail ($0.04).

### Caller-zijde dependency
Geen — atx-pipeline blijft 1× `POST /api/extended-taxatie` doen. Response-shape `photo_analysis_json` heeft nieuwe top-level keys `selected_photos` en `_pass1_indices_used` toegevoegd; bestaande keys (`schade`, `schade_items`, `per_foto`, etc.) ongewijzigd.

### Risico bij verwijderen
- 1-pass komt terug → "lost in the middle" probleem hervat op cars met >10 foto's
- selected_photos verdwijnt → atx-pipeline detail-page kan geen carousel renderen
- Pass 2's foto_nr-mapping vervalt → schade-items verwijzen naar verkeerde indices

### Pre-patch backup
`/tmp/extended-taxatie-pre-2pass-1779670782.js` (= post-patch7, pre-2pass)
`/tmp/extended-taxatie-pre-patch7-1779668306.js` (= origineel pre-prompt-rewrite, voor volledige rollback van alle vision-werk)

---

## PATCH 10 — Sidebar-nav "Telex Inkoop" in admin panel

**File**: `sites/cardatax/admin/index.html`
**Locatie**: regel ~214 (na "Dealers" nav-item, vóór "Systeem" sb-section)
**Diff stats**: +6 / -0
**Live sinds**: 2026-05-25 ~10:30
**Toegevoegd door**: Jurgen request — geen navigatie naar /admin/inbound vanuit admin panel

### Originele tekst (was)
Geen sb-section "Atx-pipeline", geen link naar `/telex-inkoop`.

### Nieuwe tekst (is)
Direct na de "Dealers" nav-item:
```html
<div class="sb-section">Atx-pipeline</div>
<a class="nav-item" href="/telex-inkoop">
  <svg width="14" height="14" ...>(inbox icoon)</svg>
  Telex Inkoop
</a>
```

`href`-based (geen `onclick="go(...)"`) want het is een externe route die via T4C-server proxiet naar atx-pipeline `/admin/inbound` (zie patch 6).

---

## PATCH 11 — Security: authMiddleware op atx-pipeline-proxy API-routes

**File**: `backend/server.js`
**Locatie**: regel ~287-340 (patch 6 atx-proxy block — vervangt voorgaande versie)
**Diff stats**: +6 / -1 (require + authMiddleware op /api/inbound + comment-block)
**Live sinds**: 2026-05-25 ~11:45
**Toegevoegd door**: Jurgen — security-issue: /admin/inbound + /api/inbound/* + /api/scraper/photos waren publiek bereikbaar via Cloudflare-tunnel zonder auth

### Probleem
Patch 6 proxy-routes (atx-pipeline → externe Cloudflare) hadden geen auth-check. Iedereen kon `transfer4cars.com/admin/inbound`, `/api/inbound/list`, `/api/inbound/context/{id}`, `/api/scraper/photos/{job}/{file}` opvragen zonder login. Volledig rapport per car (bod-advies, marge, schade, foto's) plus raw JSON van alle 23 taxaties publiek leesbaar. Lek aanwezig sinds patch 6 deploy (~24-05). Geconstateerd 25-05 ~11:30 door Jurgen via incognito-check.

### Fix (3 lagen)

1. **T4C-proxy** (`backend/server.js`): `authMiddleware` op data-API:
```js
const { authMiddleware } = require('./lib/auth')
app.use('/api/inbound', authMiddleware, express.json({ limit: '5mb' }), atxProxy)
```
HTML/CSS/JS routes blijven open (skeleton bevat geen data). `/api/scraper/photos` blijft open (foto-URLs zijn opaque + `<img>` kan geen Bearer-header sturen — TODO pre-signed URLs).

2. **Atx-pipeline frontend JS** (`/opt/atx-pipeline/public/inbound.js` + `inbound-detail.js`): client-side token-check + Bearer header:
```js
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const TOKEN = IS_LOCAL ? null : localStorage.getItem('t4c_token');
if (!IS_LOCAL && !TOKEN) { location.href = '/login/'; return; }
const AUTH_HEADERS = TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {};
// elke fetch:
await fetch('/api/inbound/context/' + ID, { headers: AUTH_HEADERS });
// 401-handling: redirect naar /login/
```
Lokale SSH-tunnel toegang (`localhost:3110`) blijft auth-vrij — SSH-tunnel zelf is de auth-laag.

3. **Quick-win** (eerste 7 minuten van de fix): patch 6 routes ge-uitgecommentarieerd → publieke routes 404. Lek dicht in 30s, Jurgen via SSH-tunnel tijdelijk. Direct daarna patch 11 geïmplementeerd.

### Verificatie (publiek via transfer4cars.com, 11:45)

| Route | Voor patch 11 | Na patch 11 |
|---|---|---|
| `/api/inbound/list` | 200 + JSON van alle 23 taxaties | **401** (zonder Bearer) / 200 (met valid JWT) |
| `/api/inbound/context/24` | 200 + volledig rapport | **401** / 200 |
| `/admin/inbound` (HTML) | 200 + rapport zichtbaar | 200 (skeleton) — JS redirect naar /login als geen token |
| `/telex-inkoop` (HTML) | 200 | 200 (skeleton) — idem |
| `/inbound.js`, `/admin.css` etc | 200 | 200 (no data) |
| `/api/scraper/photos/{job}/{file}` | 200 | 200 (TODO pre-signed) |

### Risico bij verwijderen
Lek opnieuw open — alle inbound-data publiek leesbaar via transfer4cars.com.

### TODO (niet vandaag)
- **Pre-signed URLs voor `/api/scraper/photos`**: server-side token in query-param met short TTL, gevalideerd in proxy. Verwijdert obscurity-only-security op foto's.
- **httpOnly cookie-based session** (naast Bearer-header) voor schonere browser-flow zonder localStorage-dependency.

### Pre-patch backup
`/tmp/t4c-server-pre-security-fix-1779709093.js`

### Waarom
Snelle navigatie naar atx-pipeline-portaal vanuit T4C admin. Voorheen moest Jurgen handmatig `/telex-inkoop` intikken.

### Risico bij verwijderen
Klein — geen functionaliteitsverlies, alleen extra muis-klik om in atx-pipeline te komen.

### Pre-patch backup
`/tmp/admin-index-pre-telex-nav-1779703140.html`

---

## Actie nodig (voor Jurgen)

1. **Alle 4 patches zijn productiekritiek** (atx-pipeline + Lyra) en moeten gecommit naar git
2. **Aanbevolen split**:
   - Commit A: "feat: Lyra proxy mount + observation emit" (patches 2+3 — Lyra-feature)
   - Commit B: "fix(extended-taxatie): exclude from global 10mb body parser + add per-foto vision classification" (patches 1+4 — atx-pipeline integratie)
3. **Pushen naar GitHub**

### Tot die tijd
- **GEEN** `git checkout backend/server.js` of `git checkout backend/routes/valuation.js` doen — patches verloren
- Bij T4C-deploys van het dev-team: eerst dit document checken vóór `git pull` of source-replace
- Als patches uit deze lijst al in een nieuwe T4C-deploy zitten (i.e. dev-team heeft ze in source gezet), de betreffende sectie strepen


---

## PATCH 12 — Comp-engine fuel-fix (3 sub-fixes)

**Files**: `backend/routes/valuation.js`, `backend/lib/comparable-engine/score-comparable.js`
**Diff stats**: valuation.js +12/-2, score-comparable.js +6/-3 = net +13 lines
**Live sinds**: 2026-05-26 ~13:35
**Toegevoegd door**: comp-engine fuel-mismatch diagnose sessie

### Root cause

Bij hybride taxaties (Yaris Hybrid, RAV4 Hybrid, Corolla Hybrid, IONIQ, Mercedes A250e) leverde de comp-engine 0 hybride matches op. Drie oorzaken:

1. **Fuel-mapping volgorde (Fix A)**: `_fuel.includes('benzine')` werd eerder gecheckt dan `_fuel.includes('hybri')`. RDW rapporteert "Hybride Benzine" -> `includes('benzine')` = true -> compTarget.fuel = 'Benzine'. Hybride auto werd getaxeerd als benzine.
2. **DB-query zonder fuel-filter (Fix B)**: `SELECT ... FROM market_listings WHERE make=? AND model LIKE ?` haalde alle brandstoftypes. Bij Toyota Yaris: 131 benzine + 87 hybride in DB. LIMIT 50 -> overwegend benzine. Comp-engine vergeleek hybride Yaris met benzine Yarissen.
3. **Soft penalty (Fix C)**: Fuel-mismatch gaf -12 score-punten maar kon nog steeds in 'usable' of 'secondary' band landen. Benzine-listings vervuilden de mediaan.

### Fix A — valuation.js:203 (fuel-mapping volgorde)

Origineel:
```js
fuel: _fuel.includes('diesel') ? 'Diesel' : _fuel.includes('benzine') ? 'Benzine' : _fuel.includes('elektr') ? 'Elektrisch' : d.fuel || '',
```

Nieuw:
```js
fuel: _fuel.includes('hybri') ? 'Hybride' : _fuel.includes('elektr') ? 'Elektrisch' : _fuel.includes('diesel') ? 'Diesel' : _fuel.includes('benzine') ? 'Benzine' : d.fuel || '',
```

### Fix B — valuation.js:141-150 (DB-query fuel-filter)

Toegevoegd boven de DB-queries (3 plekken: hoofdquery + fallback 1 + fallback 2):
```js
const _dbFuel = (d.fuel||'').toLowerCase()
const _fuelKey = _dbFuel.includes('hybri') ? 'hybri' : _dbFuel.includes('elektr') ? 'elektr' : _dbFuel.includes('diesel') ? 'diesel' : _dbFuel.includes('benzine') ? 'benzine' : null
const _fuelClause = _fuelKey ? ' AND LOWER(fuel) LIKE ?' : ''
const _fuelParam = _fuelKey ? ['%' + _fuelKey + '%'] : []
```

Alle 3 DB-queries uitgebreid met `+ _fuelClause` en `..._fuelParam`. LIMIT verhoogd van 50 naar 80.

Bij fuel=null (niet RDW-verrijkt): query draait zonder fuel-filter (backward compatible).

### Fix C — score-comparable.js:22-29 (hard-reject)

Origineel:
```js
if (tf.fuel && lf.fuel) {
  if (tf.fuel === lf.fuel) { score += 10 }
  else { score = Math.max(0, score - 12) }  // soft penalty
}
```

Nieuw:
```js
if (tf.fuel && lf.fuel) {
  if (tf.fuel === lf.fuel) { score += 10 }
  else { return { score: 0, band: 'ignore', reasons: ['fuel_hard_reject'] } }
} else if (tf.fuel && !lf.fuel) {
  score = Math.max(0, score - 5); reasons.push('fuel_unknown')
}
```

### Resultaat (Toyota Yaris 1.5 Hybrid NB-212-X)

| Metriek | Voor | Na |
|---------|------|----|
| Fuel in comps | 0% hybride | 100% hybride |
| strongCount | 0 | 10 |
| cleanCount | 12 | 68 |
| marketMedian | EUR8.575 | EUR11.800 |
| Pricing source | ai_primary (100% GPT) | ai_comp_blend (68% comp + 32% GPT) |
| Handelswaarde | EUR10.100 | EUR10.000 |

### Rollback

```bash
# Volledige rollback naar pre-patch staat:
cp /tmp/valuation-pre-fuel-fix-1779802459.js /opt/t4c/backend/routes/valuation.js
cp /tmp/score-comparable-pre-fix-1779802460.js /opt/t4c/backend/lib/comparable-engine/score-comparable.js
pm2 restart t4c-server --update-env

# Alleen Fix C rollback (behoud A+B):
cp /tmp/score-comparable-pre-fixC-1779803234.js /opt/t4c/backend/lib/comparable-engine/score-comparable.js
pm2 restart t4c-server --update-env

# Alleen Fix B rollback (behoud A):
cp /tmp/valuation-post-fixA-1779802741.js /opt/t4c/backend/routes/valuation.js
pm2 restart t4c-server --update-env
```

### Risico bij verwijderen

Hybride/EV taxaties vallen terug op 100% GPT-pricing (geen marktdata-anker). Structurele overschatting van ~20-35% bij hybrides. Benzine taxaties ongewijzigd.


---

## PATCH 13 — Comp-engine freshness filter

**File**: `backend/routes/valuation.js`
**Diff stats**: +25/-3 lines (3 query-paden)
**Live sinds**: 2026-05-27 ~14:30
**Toegevoegd door**: corpus health diagnose — 48% listings 30-90d oud

### Wijziging

DB-queries voor comp-engine listings krijgen progressieve freshness filter:
```
1. WHERE ... AND last_seen > datetime('now', '-30 days')  [verse data]
2. Indien <5: ... '-60 days'
3. Indien <5: ... '-90 days'
4. Indien <5: alle data (huidige gedrag)
```

Logging: `[COMP-FRESH] {make} {model} 30d=X, 60d=Y, 90d=Z, all=W | used: {window}`

### Impact

- Toyota Yaris: comp strong 10->26, mediaan +EUR922
- Alto: HW EUR3.050->EUR2.500 (-EUR550, richting goed)
- Alle populaire modellen gebruiken 30d window (voldoende data)
- Niche modellen (CX-9) vallen graceful terug naar all

### Rollback

```bash
cp /tmp/valuation-pre-freshness-*.js /opt/t4c/backend/routes/valuation.js
pm2 restart t4c-server --update-env
```


---

## ATX-PIPELINE PATCH — Race-condition fix taxatie/markt-worker

**Files**: `lib/taxatie-worker.js`, `lib/markt-worker.js`
**Diff stats**: taxatie-worker +10 lines, markt-worker +8 lines
**Live sinds**: 2026-05-27 ~17:00

### Wijziging

1. `taxatie-worker.processJob()` retourneert `t4cForBod` object met T4C waarden
2. `markt-worker.processTaxatie(taxId, { t4cResult })` accepteert T4C als parameter
3. Bod-adviseur leest T4C data uit in-memory, niet uit DB (voorkomt race-condition)
4. `ATX_BATCH_MODE=1` env flag pauzeerd background worker polling

### Rollback

```bash
cp /tmp/taxatie-worker-pre-racefix-*.js /opt/atx-pipeline/lib/taxatie-worker.js
cp /tmp/markt-worker-pre-racefix-*.js /opt/atx-pipeline/lib/markt-worker.js
pm2 restart atx-admin --update-env
```


---

## T4C PATCH 14 — GPT prompt V3 (variantFactor + recon + regionaal)

**File**: `backend/routes/valuation.js`
**Live sinds**: 2026-05-28
**Wijziging**: GPT response uitgebreid met variantFactor, variantPositie, webReferenties. reconEstimate instructie realistischer. Regionale pricing hints toegevoegd.

## ATX-PIPELINE — V3 Redesign modules

**Nieuwe files**: `lib/auto-categorie.js`, `lib/bod-adviseur-v3.js`
**Gewijzigde files**: `lib/markt-worker.js`, `public/inbound-detail.js`, `public/inbound-detail.html`
**Live sinds**: 2026-05-28
