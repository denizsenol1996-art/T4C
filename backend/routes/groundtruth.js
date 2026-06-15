// ─────────────────────────────────────────────────────────────
// LEER-LUS — grondwaarheid-koppeling + accuratesse-meting. PUUR ADDITIEF.
// Koppelt dealer_feedback (echte uitkomsten: our_bod vs sold_price) aan taxaties
// op kenteken, en maakt accuratesse meetbaar. Schrijft via de app-db-laag
// (sql.js in-memory) + forceSave — nooit extern naar het .db-bestand.
// backfill/resolve alleen vanaf localhost. Faalt stil, raakt de taxatie nooit.
// ─────────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { queryAll, queryOne, run, forceSave } = require('../db');

const localOnly = (req, res, next) => {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
  return res.status(403).json({ error: 'alleen localhost' });
};
const plate = s => (s == null ? '' : String(s).toUpperCase().replace(/\s/g, ''));
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// GET accuratesse uit dealer_feedback (echte uitkomsten)
router.get('/api/groundtruth/stats', (req, res) => {
  try {
    const rows = queryAll("SELECT our_bod, sold_price FROM dealer_feedback WHERE our_bod>0 AND sold_price>0") || [];
    const errs = rows.map(r => (r.our_bod - r.sold_price) / r.sold_price * 100); // + = bod te hoog
    const abs = errs.map(e => Math.abs(e));
    const within = p => abs.length ? +(abs.filter(e => e <= p).length / abs.length * 100).toFixed(1) : 0;
    const resolved = queryOne("SELECT COUNT(*) n FROM accuracy_log WHERE actual_price>0");
    const kt = queryOne("SELECT SUM(kenteken IS NOT NULL AND kenteken!='') k, COUNT(*) n FROM dealer_feedback");
    res.json({
      bron: 'dealer_feedback (echte uitkomsten: our_bod vs sold_price)',
      n: rows.length,
      mediaan_fout_pct: median(abs) != null ? +median(abs).toFixed(1) : null,
      bias_pct: median(errs) != null ? +median(errs).toFixed(1) : null,
      binnen_5pct: within(5),
      binnen_10pct: within(10),
      gekoppeld_kenteken: kt ? `${kt.k || 0}/${kt.n}` : 'n/b',
      accuracy_log_resolved: resolved ? resolved.n : 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST eenmalige backfill — kenteken + taxatie_id uit JSON feedback vullen
router.post('/api/groundtruth/backfill', localOnly, (req, res) => {
  try {
    const rows = queryAll("SELECT id, kenteken, taxatie_id, feedback FROM dealer_feedback") || [];
    let kt = 0, tx = 0;
    for (const r of rows) {
      let p = plate(r.kenteken);
      if (!p && r.feedback) {
        try { const j = JSON.parse(r.feedback); if (j && j.kenteken) p = plate(j.kenteken); } catch (e) {}
        if (p) { run("UPDATE dealer_feedback SET kenteken=? WHERE id=?", [p, r.id]); kt++; }
      }
      if (p && !r.taxatie_id) {
        const t = queryOne("SELECT id FROM taxaties WHERE replace(upper(kenteken),' ','')=? ORDER BY id DESC LIMIT 1", [p]);
        if (t && t.id) { run("UPDATE dealer_feedback SET taxatie_id=? WHERE id=?", [t.id, r.id]); tx++; }
      }
    }
    forceSave();
    res.json({ ok: true, kenteken_gevuld: kt, taxatie_gekoppeld: tx, totaal: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST going-forward uitkomst → accuracy_log updaten op taxatie_id
router.post('/api/groundtruth/resolve', localOnly, (req, res) => {
  try {
    const b = req.body || {};
    let tid = b.taxatie_id;
    const actual = Number(b.actual_price);
    if (!tid && b.kenteken) {
      const t = queryOne("SELECT id FROM taxaties WHERE replace(upper(kenteken),' ','')=? ORDER BY id DESC LIMIT 1", [plate(b.kenteken)]);
      tid = t && t.id;
    }
    if (!tid || !(actual > 0)) return res.status(400).json({ error: 'taxatie_id of kenteken + actual_price>0 vereist' });
    const log = queryOne("SELECT id, our_price, gpt_price FROM accuracy_log WHERE taxatie_id=? ORDER BY id DESC LIMIT 1", [tid]);
    if (!log) return res.status(404).json({ error: 'geen accuracy_log-rij voor deze taxatie' });
    const oe = Math.abs(log.our_price - actual) / actual * 100;
    const ge = log.gpt_price > 0 ? Math.abs(log.gpt_price - actual) / actual * 100 : null;
    const winner = ge == null ? 'our' : (oe <= ge ? 'our' : 'gpt');
    run("UPDATE accuracy_log SET actual_price=?, our_error_pct=?, gpt_error_pct=?, winner=? WHERE id=?",
      [Math.round(actual), +oe.toFixed(2), ge != null ? +ge.toFixed(2) : null, winner, log.id]);
    forceSave();
    res.json({ ok: true, taxatie_id: tid, our_error_pct: +oe.toFixed(2), gpt_error_pct: ge != null ? +ge.toFixed(2) : null, winner });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
