// ─────────────────────────────────────────────────────────────
// LEER-LUS — voorspelling-kant. Logt bij ELKE taxatie meteen de voorspelling in accuracy_log
// (uitkomst nog leeg). De UITKOMST-kant bestaat al in routes/misc.js (/api/taxatie/feedback) —
// die moet deze rij later UPDATE-n op taxatie_id (i.p.v. een nieuwe rij). NIET dupliceren.
// PUUR ADDITIEF + faalt stil: kan de taxatie nooit breken.
// ─────────────────────────────────────────────────────────────
const { run } = require('../db');

function logPrediction({ taxatie_id, our_price, gpt_price }) {
  if (!taxatie_id || !(our_price > 0)) return;
  try {
    run("INSERT INTO accuracy_log (taxatie_id, our_price, gpt_price, created_at) VALUES (?,?,?,datetime('now'))",
      [taxatie_id, Math.round(our_price), gpt_price > 0 ? Math.round(gpt_price) : null]);
  } catch (e) { /* leer-lus mag taxatie nooit breken */ }
}

module.exports = { logPrediction };
