#!/usr/bin/env node
/*
 * analyze-engine-shadow.js — RSPP engine-blacklist Gate 5 shadow-analyse
 *
 * READ-ONLY. Leest /opt/t4c/data/bench/engine-shadow.jsonl, vat samen
 * (per rule / per path / aftrek-spreiding) en schrijft een markdown-rapport
 * naar docs/specs/. Past NIETS aan de pricing-pipeline of DB aan.
 *
 * Seed-detectie: de smoke-calls van het aanzetten (17-06 11:47-11:48, plate
 * 7-ZJB-72) worden apart geteld zodat ze de echte-traffic-cijfers niet vervuilen.
 * Drempel = alles vóór REAL_WINDOW_START telt als seed/smoke.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOG = process.env.SHADOW_LOG || '/opt/t4c/data/bench/engine-shadow.jsonl';
const OUT_DIR = '/opt/t4c/docs/specs';
const REAL_WINDOW_START = Date.parse('2026-06-17T12:00:00Z'); // seeds zaten 11:47-11:48

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function fmtE(n) { return n == null ? 'n/a' : '€' + Math.round(n).toLocaleString('nl-NL'); }

if (!fs.existsSync(LOG)) {
  console.error('[shadow-analyse] log bestaat niet: ' + LOG);
  process.exit(1);
}

const lines = fs.readFileSync(LOG, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
const rows = [];
let parseErrors = 0;
for (const l of lines) {
  try { rows.push(JSON.parse(l)); } catch (_e) { parseErrors++; }
}

const seeds = rows.filter(r => Date.parse(r.ts) < REAL_WINDOW_START);
const real = rows.filter(r => Date.parse(r.ts) >= REAL_WINDOW_START);

function summarize(set) {
  const byRule = {}, byPath = {};
  const aftrekken = [], pcts = [];
  const cars = new Set();
  for (const r of set) {
    byRule[r.rule] = (byRule[r.rule] || 0) + 1;
    byPath[r.path] = (byPath[r.path] || 0) + 1;
    if (typeof r.shadow_aftrek === 'number') aftrekken.push(r.shadow_aftrek);
    if (typeof r.shadow_aftrek === 'number' && r.live_bod) pcts.push(100 * r.shadow_aftrek / r.live_bod);
    cars.add((r.plate || '').replace(/[-\s]/g, '').toUpperCase());
  }
  return { n: set.length, byRule, byPath, aftrekken, pcts, uniekeAutos: cars.size };
}

const R = summarize(real);
const S = summarize(seeds);

function table(obj) {
  const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]);
  if (!keys.length) return '_(geen)_';
  return keys.map(k => `| ${k} | ${obj[k]} |`).join('\n');
}

const now = new Date().toISOString();
const md = `# RSPP engine-blacklist — Gate 5 shadow-analyse

*Auto-gegenereerd: ${now} · script: \`scripts/analyze-engine-shadow.js\` · bron: \`${LOG}\`*

> READ-ONLY analyse. Geen pricing-mutatie. Volgende stap is **Gate 6** (Jurgen sign-off op spread-cases), niet automatisch promoten.

## Samenvatting
- Totaal log-regels: **${rows.length}** (parse-errors: ${parseErrors})
- Seed/smoke (vóór 17-06 12:00 UTC): **${S.n}**
- **Echte traffic (Gate 5-venster): ${R.n}** hits, ${R.uniekeAutos} unieke auto's

${R.n === 0 ? `> ⚠️ **Nul echte hits in 24u.** De blacklist-engine vuurde niet op echt klant-verkeer. Mogelijke verklaringen: weinig THP/EcoBoost/PureTech/TCe-auto's getaxeerd, óf footprint is klein (Gate 4 noemde al ~3 nieuwe cases in 662). Conclusie: te weinig signaal voor Gate 6 — overweeg shadow-venster te verlengen of Gate 6 op Gate 4-replay-cases te doen.\n` : ''}
## Echte traffic — per rule
| rule | hits |
|---|---|
${table(R.byRule)}

## Echte traffic — per pad
| path | hits |
|---|---|
${table(R.byPath)}

## Aftrek-spreiding (echte traffic)
- Aantal met aftrek: ${R.aftrekken.length}
- Min / mediaan / max: ${fmtE(R.aftrekken.length ? Math.min(...R.aftrekken) : null)} / ${fmtE(median(R.aftrekken))} / ${fmtE(R.aftrekken.length ? Math.max(...R.aftrekken) : null)}
- Aftrek als % van live_bod (mediaan): ${R.pcts.length ? median(R.pcts).toFixed(1) + '%' : 'n/a'}

## Alle echte hits (voor Gate 6 spread-selectie)
${real.length ? '| ts | path | plate | auto | motorCode | rule | live_bod | aftrek | shadow_bod |\n|---|---|---|---|---|---|---|---|---|\n' + real.map(r => `| ${r.ts} | ${r.path} | ${r.plate} | ${r.make} ${r.model} ${r.year} | ${r.motorCode || ''} | ${r.rule} | ${fmtE(r.live_bod)} | ${fmtE(r.shadow_aftrek)} | ${fmtE(r.shadow_bod)} |`).join('\n') : '_(geen echte hits)_'}

## Seed/smoke-regels (ter referentie, NIET meetellen)
${seeds.length ? seeds.map(r => `- ${r.ts} ${r.path} ${r.plate} ${r.rule} aftrek ${fmtE(r.shadow_aftrek)}`).join('\n') : '_(geen)_'}

---
## Gate 6 — handmatige vervolgstappen (mens)
1. Kies 10 spread-cases uit "Alle echte hits" (laag/midden/hoog bod + verschillende rules).
2. Leg voor aan Jurgen: klopt de aftrek per case? Specifiek de open vraag uit SESSION-STATE — betaalt Jurgen écht −€500 op budget-Dacia (TCe), of alleen op duurdere TCe?
3. Bij akkoord: promote via \`T4C_ENGINE_BLACKLIST=1\` + shadow-flag eruit, één commit. (Buiten dit script — pricing-mutatie volgt RSPP.)
`;

const outPath = path.join(OUT_DIR, 'RSPP-2026-06-18-engine-blacklist-GATE5-SHADOW-ANALYSIS.md');
fs.writeFileSync(outPath, md);
console.log('[shadow-analyse] rapport geschreven: ' + outPath);
console.log(`[shadow-analyse] echte hits: ${R.n} · seeds: ${S.n} · totaal: ${rows.length}`);
