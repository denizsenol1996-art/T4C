// ─────────────────────────────────────────────────────────────
// BOD-CURVE — datagedreven bod = verkoopadvies x ratio(prijsklasse, leeftijd).
// Vervangt de platte ~0.70-omrekening (die op goedkoop/oud +100% te hoog bood).
// Ratio's geleerd uit 661 echte Jurgen-deals; held-out bias +11% -> -1%.
// Faalt veilig: bij twijfel valt 'ie terug op de meegegeven fallback-bod.
// ─────────────────────────────────────────────────────────────
let CURVE = null;
try { CURVE = require('../config/bod-ratio-curve.json'); } catch (e) { CURVE = null; }

function priceBucket(retail) {
  if (retail < 2000) return 'lt2000';
  if (retail < 5000) return '2000_5000';
  if (retail < 10000) return '5000_10000';
  return 'gte10000';
}
function ageBucket(year) {
  const a = (new Date().getFullYear()) - (year || 2015);
  if (a <= 5) return 'y0_5';
  if (a <= 10) return 'y6_10';
  if (a <= 15) return 'y11_15';
  return 'y16plus';
}

// Geeft het bod (afgerond op 50) o.b.v. verkoopadvies + bouwjaar.
// fallbackBod = de bestaande bod als de curve niet beschikbaar is.
function curveBod(retail, year, fallbackBod) {
  if (!CURVE || !CURVE.table || !(retail > 0)) return fallbackBod;
  const row = CURVE.table[priceBucket(retail)];
  if (!row) return fallbackBod;
  let ratio = row[ageBucket(year)];
  if (!(ratio > 0)) return fallbackBod;
  ratio = Math.max(CURVE.min || 0.15, Math.min(CURVE.max || 0.85, ratio));
  return Math.round((retail * ratio) / 50) * 50;
}

function curveRatio(retail, year) {
  if (!CURVE || !CURVE.table) return null;
  const row = CURVE.table[priceBucket(retail)];
  return row ? row[ageBucket(year)] : null;
}

module.exports = { curveBod, curveRatio, enabled: () => !!CURVE };
