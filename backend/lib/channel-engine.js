/* ============================================================================
 * CarDataX — CHANNEL ENGINE  (de "waar hoort deze auto thuis"-motor)
 * ----------------------------------------------------------------------------
 * Dit is de ontbrekende laag uit Jurgen's verhaal. De huidige /api/taxatie geeft
 * één plat bod + marktscore. Deze module ZET DAAR BOVENOP:
 *
 *   1. KANAAL   -> waar hoort deze auto thuis? (Dealer / Universeel / B2B /
 *                  Export / Outlet / Sloop)  -> staat BOVENAAN, vóór de prijs
 *   2. PRIJS    -> per kanaal een andere waarde (kanaal bepaalt de prijs,
 *                  niet andersom)
 *   3. ZEKERHEID-> hoeveel mag de inkoper de data vertrouwen? (+ redenen)
 *   4. BRON     -> welk vergelijk hoort bij dit kanaal? (Gaspedaal / Mobile.de /
 *                  Marktplaats / sloopwaarde)
 *
 * GEBRUIK (backend, na de bestaande taxatie):
 *   const { enrichTaxatie } = require('./channel-engine');
 *   const base = await berekenTaxatie(plate, km);   // jullie huidige logica
 *   const result = enrichTaxatie({ vehicle, market, base });
 *   res.json({ ok:true, ...base, ...result });      // frontend krijgt extra velden
 *
 * Pure functie, geen dependencies. Alle drempels staan in CONFIG -> tunebaar
 * zonder de logica aan te raken.
 * ========================================================================== */

'use strict';

/* ---------------------------------------------------------------------------
 * CONFIG — Jurgen's vuistregels, expliciet en aanpasbaar.
 * Pas deze getallen aan als de markt verandert; de logica blijft hetzelfde.
 * ------------------------------------------------------------------------- */
const CONFIG = {
  // Harde export-triggers (Jurgen): zodra één hiervan waar is -> export
  exportDieselMaxMassaKg: 3500,   // diesel zwaarder dan dit = export
  exportBenzineKm:        250000, // benzine boven deze km = export
  exportDieselKm:         280000, // diesel boven deze km = export
  exportLeeftijdJaar:     18,     // ouder dan dit + veel km kant op export/outlet

  // Dealer retail (de nette auto)
  dealerMaxLeeftijd:      8,
  dealerMaxKm:            150000,

  // Universele garage / Bosch / vakgarage
  univMaxLeeftijd:        12,
  univMaxKm:              220000,

  // Sloop / economisch einde
  sloopMinLeeftijd:       20,
  sloopMinKm:             300000,
  sloopWaardePerKg:       0.18,   // ~€0,18/kg leeggewicht als ruwe sloopwaarde
  sloopMin:               150,
  sloopMax:               1200,

  // Risico-motoren die in NL garantie-ellende geven (Jurgen: Ecoboost/THP)
  // -> niet "niet inkopen", maar wel afwaarderen + kanaal richting B2B/export
  risicoMotoren: [
    { match: /ecoboost/i,            label: 'Ford EcoBoost 1.0/1.6 — bekend distributie/koelvloeistof risico' },
    { match: /thp|1\.6\s*thp|prince/i, label: 'PSA/BMW 1.6 THP (Prince) — kettingrek & olieverbruik risico' },
    { match: /1\.2\s*puretech/i,     label: 'PSA 1.2 PureTech — natte distributieriem risico' },
    { match: /1\.4\s*tsi|1\.8\s*tsi|2\.0\s*tsi.*ea888.*gen1/i, label: 'VAG TSI eerste generatie — olieverbruik/ketting risico' },
    { match: /1\.6\s*hdi.*dpf|1\.6\s*dci/i, label: 'Kleine diesel met DPF — roetfilter/injectie risico' },
  ],
  risicoMotorAfwaardering: 0.06,  // 6% extra van de waarde af bij risicomotor

  // Per-kanaal afgeleide waarde t.o.v. de basis (retail = internetPrijs)
  // Deze factoren mappen retail -> kanaalwaarde. Tunebaar.
  kanaalFactor: {
    dealer:    { van: 0.93, tot: 0.97 },  // dealer-inkoop ligt dicht bij retail
    universeel:{ van: 0.86, tot: 0.91 },
    b2b:       { van: 0.80, tot: 0.86 },
    export:    { van: 0.74, tot: 0.82 },  // export rekent vanuit mobile.de, los van NL retail
    outlet:    { van: 0.70, tot: 0.78 },
  },

  // Marge die Transfer4Cars zelf wil pakken op het uiteindelijke bod
  t4cMargePct: 0.08,
};

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round50 = v => Math.round(v / 50) * 50;
const jaar = () => new Date().getFullYear();

function leeftijd(vehicle) {
  const y = parseInt(vehicle.year || vehicle.bouwjaar || 0, 10);
  return y > 1950 ? jaar() - y : 0;
}
function isDiesel(vehicle) { return /diesel/i.test(vehicle.fuel || vehicle.brandstof || ''); }
function isBenzine(vehicle){ return /benz|petrol|essence/i.test(vehicle.fuel || vehicle.brandstof || ''); }
function isElektrisch(vehicle){ return /elektr|electric|ev\b/i.test(vehicle.fuel || vehicle.brandstof || ''); }

// Leeggewicht in kg — map dit naar jullie RDW-veld (massa_ledig_voertuig)
function massaKg(vehicle) {
  return parseInt(vehicle.massaLedig || vehicle.massa_ledig_voertuig || vehicle.weight || 0, 10);
}

/* ---------------------------------------------------------------------------
 * 1. DATAZEKERHEID — kenteken niet vertrouwen, maar verifiëren.
 *    Geeft 0-100 score + leesbare redenen waarom het géén 100% is.
 * ------------------------------------------------------------------------- */
function datazekerheid(vehicle) {
  let score = 100;
  const redenen = [];
  const trek = (pts, reden) => { score -= pts; redenen.push(reden); };

  // Import: eerste toelating buitenland / datum_eerste_toelating != datum_eerste_tenaamstelling_in_nl
  if (vehicle.isImport || vehicle.import) trek(12, 'Importauto — uitvoering & opties kunnen afwijken van NL-data');

  // Handelsbenaming/uitvoering onzeker (geen Vinacles-match)
  if (!vehicle.modelVariant && !vehicle.uitvoering) trek(10, 'Uitvoering niet bevestigd — alleen RDW-handelsbenaming bekend');

  // Geen opties/pakketten bekend
  if (!vehicle.opties || (Array.isArray(vehicle.opties) && vehicle.opties.length === 0)) trek(5, 'Opties/pakketten onbekend — waarde-impact niet meegerekend');

  // Tellerstand: NAP onlogisch of onbekend
  if (vehicle.napOordeel && /onlogisch/i.test(vehicle.napOordeel)) trek(20, 'Tellerstand ONLOGISCH (NAP) — km niet betrouwbaar');
  else if (!vehicle.napOordeel) trek(6, 'NAP-oordeel niet opgehaald — tellerstand niet geverifieerd');

  // Ex-taxi / ex-lease / verhuur
  if (vehicle.exTaxi || /taxi/i.test(vehicle.history || '')) trek(8, 'Taxi-verleden — hoge slijtage, beperkte courantheid');

  // Grijs kenteken / bedrijfsvoertuig zonder L/H-aanduiding
  if (/grijs/i.test(vehicle.kentekenSoort || '') && !vehicle.modelVariant) trek(5, 'Grijs kenteken zonder uitvoeringsdetail (L1H1/L2H2 onbekend)');

  // BTW/marge onduidelijk -> grote waarde-impact
  if (!vehicle.btwMarge && vehicle.btwMarge !== false) trek(6, 'BTW/marge-status onbekend — beïnvloedt inkoopwaarde sterk');

  // Weinig vergelijkbare advertenties (vult enrich later aan)
  return { score: clamp(Math.round(score), 35, 100), redenen };
}

/* ---------------------------------------------------------------------------
 * 2. RISICO — motorrisico's die in NL garantie kosten.
 * ------------------------------------------------------------------------- */
function motorRisico(vehicle) {
  const hay = `${vehicle.engineLabel || ''} ${vehicle.modelVariant || ''} ${vehicle.model || ''} ${vehicle.type || ''}`;
  for (const r of CONFIG.risicoMotoren) {
    if (r.match.test(hay)) return { risico: true, label: r.label };
  }
  return { risico: false, label: null };
}

/* ---------------------------------------------------------------------------
 * 3. KANAAL — waar hoort deze auto thuis? Volgorde = belangrijk (eerst de
 *    harde uitsluiters, dan de nette kanalen).
 * ------------------------------------------------------------------------- */
function bepaalKanaal(vehicle, ctx) {
  const km   = parseInt(vehicle.km || 0, 10);
  const lft  = leeftijd(vehicle);
  const massa = massaKg(vehicle);
  const schade = (vehicle.schadeScore || ctx.schadeScore || 0); // 0=geen .. 100=sloop
  const reden = [];

  // --- SLOOP: economisch/technisch einde -------------------------------
  if ((lft >= CONFIG.sloopMinLeeftijd && km >= CONFIG.sloopMinKm) || schade >= 85 || vehicle.wok) {
    reden.push(lft >= CONFIG.sloopMinLeeftijd && km >= CONFIG.sloopMinKm ? `oud (${lft}j) + veel km (${km.toLocaleString('nl')})` : 'zware schade / WOK');
    return { kanaal: 'sloop', reden };
  }

  // --- EXPORT: Jurgen's harde regels -----------------------------------
  if (isDiesel(vehicle) && massa > CONFIG.exportDieselMaxMassaKg) { reden.push(`diesel > ${CONFIG.exportDieselMaxMassaKg} kg`); return { kanaal:'export', reden }; }
  if (isBenzine(vehicle) && km > CONFIG.exportBenzineKm)          { reden.push(`benzine boven ${CONFIG.exportBenzineKm.toLocaleString('nl')} km`); return { kanaal:'export', reden }; }
  if (isDiesel(vehicle)  && km > CONFIG.exportDieselKm)           { reden.push(`diesel boven ${CONFIG.exportDieselKm.toLocaleString('nl')} km`); return { kanaal:'export', reden }; }
  if (schade >= 55)                                              { reden.push('te veel schade voor NL-verkoop'); return { kanaal:'export', reden }; }
  if (/bus|bestel/i.test(vehicle.body||'') && (km > 200000 || schade >= 40)) { reden.push('bestelbus met hoge km/schade'); return { kanaal:'export', reden }; }

  // --- DEALER RETAIL: de nette auto ------------------------------------
  if (lft <= CONFIG.dealerMaxLeeftijd && km <= CONFIG.dealerMaxKm && schade <= 20) {
    reden.push(`jong (${lft}j), ${km.toLocaleString('nl')} km, nette staat`);
    // extra: heel jong + lage km -> hard naar merkdealer
    if (lft <= 4 && km <= 60000 && schade <= 10) reden.push('smetteloos — geschikt voor merkdealer');
    return { kanaal: 'dealer', reden };
  }

  // --- UNIVERSELE / VAKGARAGE ------------------------------------------
  if (lft <= CONFIG.univMaxLeeftijd && km <= CONFIG.univMaxKm && schade <= 40) {
    reden.push(`vakgarage-segment (${lft}j, ${km.toLocaleString('nl')} km)`);
    return { kanaal: 'universeel', reden };
  }

  // --- OUTLET: oud/veel km maar nog verkoopbaar in NL ------------------
  if (km >= CONFIG.univMaxKm || lft >= CONFIG.univMaxLeeftijd) {
    reden.push('hoge km / leeftijd, beperkt risico — Outlet for Cars');
    return { kanaal: 'outlet', reden };
  }

  // --- REST: B2B handel -------------------------------------------------
  reden.push('handelsauto — minder courant, kleine schades');
  return { kanaal: 'b2b', reden };
}

/* ---------------------------------------------------------------------------
 * 4. BRON per kanaal — waar moet de verkoper vergelijken?
 * ------------------------------------------------------------------------- */
const KANAAL_META = {
  dealer:    { label: 'Dealer Retail',     kleur:'#16a34a', bron:'Gaspedaal · AutoScout24 · merkdealerprijzen', emoji:'🟢' },
  universeel:{ label: 'Universele Garage',  kleur:'#65a30d', bron:'Gaspedaal · Marktplaats · lokale handel',     emoji:'🟢' },
  b2b:       { label: 'B2B Handel',         kleur:'#d97706', bron:'Marktplaats · handelsnetwerk · particulier vergelijk', emoji:'🟠' },
  export:    { label: 'Export',             kleur:'#2563eb', bron:'Mobile.de · export-kanalen · Oost-Europa',     emoji:'🔵' },
  outlet:    { label: 'Outlet for Cars',    kleur:'#7c3aed', bron:'Marktplaats · Outlet for Cars',               emoji:'🟣' },
  sloop:     { label: 'Sloop / Demontage',  kleur:'#dc2626', bron:'onderdelen- & metaalwaarde',                  emoji:'🔴' },
};

/* ---------------------------------------------------------------------------
 * 5. PRIJS per kanaal — kanaal bepaalt de prijs.
 * ------------------------------------------------------------------------- */
function kanaalWaardes(vehicle, base, risico) {
  // retail-anker: hoogste betrouwbare marktprijs
  const retail = base.internetPrijs || base.verkoopadviees || base.handelswaarde || 0;
  const out = {};
  for (const [k, f] of Object.entries(CONFIG.kanaalFactor)) {
    let mid = retail * ((f.van + f.tot) / 2);
    if (risico.risico) mid *= (1 - CONFIG.risicoMotorAfwaardering);
    out[k] = round50(mid);
  }
  // sloop apart: gewicht-gebaseerd
  const massa = massaKg(vehicle) || 1100;
  out.sloop = clamp(round50(massa * CONFIG.sloopWaardePerKg), CONFIG.sloopMin, CONFIG.sloopMax);
  return out;
}

/* ---------------------------------------------------------------------------
 * HOOFD-FUNCTIE
 * ------------------------------------------------------------------------- */
function enrichTaxatie({ vehicle = {}, market = {}, base = {} }) {
  // schade uit walk-around module (0-100); val terug op 0
  const ctx = { schadeScore: vehicle.schadeScore || 0 };

  const zekerheid = datazekerheid(vehicle);
  // markt-zekerheid bijstellen op aantal vergelijkbare advertenties
  const nListings = (market.listings || []).length;
  if (nListings < 3) { zekerheid.score = clamp(zekerheid.score - 10, 35, 100); zekerheid.redenen.push(`weinig vergelijkbare advertenties (${nListings})`); }

  const risico   = motorRisico(vehicle);
  const kanaalR  = bepaalKanaal(vehicle, ctx);
  const meta     = KANAAL_META[kanaalR.kanaal];
  const waardes  = kanaalWaardes(vehicle, base, risico);

  // Het bod dat past bij HET GEKOZEN kanaal (Jurgen: kanaal -> prijs -> bod)
  const kanaalWaarde = waardes[kanaalR.kanaal] ?? waardes.b2b;
  const t4cBod = round50(kanaalWaarde * (1 - CONFIG.t4cMargePct));

  // courantheid 0-10: jong + lage km + veel listings + dealer-kanaal = hoog
  const lft = leeftijd(vehicle), km = parseInt(vehicle.km||0,10);
  let courant = 10;
  courant -= clamp(lft * 0.25, 0, 4);
  courant -= clamp((km/50000) * 0.6, 0, 3);
  if (risico.risico) courant -= 1.5;
  if (kanaalR.kanaal === 'export') courant -= 1;
  if (kanaalR.kanaal === 'sloop')  courant = 1;
  courant = Math.round(clamp(courant, 1, 10) * 10) / 10;

  // verwachte verkooptijd (dagen) — ruwe indicatie uit courantheid
  const verkooptijdDagen = Math.round(clamp(60 - courant * 5, 7, 90));

  return {
    // ── KANAAL (bovenaan in de UI) ──
    afzetkanaal: {
      key:    kanaalR.kanaal,
      label:  meta.label,
      kleur:  meta.kleur,
      emoji:  meta.emoji,
      bron:   meta.bron,
      redenen: kanaalR.reden,
    },
    // ── ZEKERHEID ──
    datazekerheid: zekerheid.score,
    datazekerheidRedenen: zekerheid.redenen,
    // ── COURANTHEID & TIJD ──
    courantheid: courant,
    verwachteVerkooptijdDagen: verkooptijdDagen,
    // ── RISICO ──
    motorRisico: risico.risico ? risico.label : null,
    // ── WAARDES PER KANAAL ──
    kanaalWaardes: {
      dealer:    waardes.dealer,
      universeel:waardes.universeel,
      b2b:       waardes.b2b,
      export:    waardes.export,
      outlet:    waardes.outlet,
      sloop:     waardes.sloop,
    },
    // ── DEFINITIEF BOD (past bij gekozen kanaal) ──
    t4cBod,
    inkoopAdvies: t4cBod,
  };
}

module.exports = { enrichTaxatie, datazekerheid, bepaalKanaal, motorRisico, CONFIG };
