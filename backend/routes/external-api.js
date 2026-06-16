// ─────────────────────────────────────────────────────────────
// EXTERNE API — key-beveiligde taxatie voor eigen programma's/koppelingen.
// POST /api/v1/taxatie  (header: X-API-Key: <sleutel>)  → JSON-taxatie.
// Hergebruikt de bestaande pricing (forward naar interne /api/dealer/price),
// dus identieke uitkomst als de website. Raakt de publieke taxatie niet.
// Sleutel uit env T4C_API_KEY; ontbreekt die → endpoint uit (503).
// ─────────────────────────────────────────────────────────────
const express = require('express');
const http = require('http');
const router = express.Router();

const API_KEY = process.env.T4C_API_KEY || '';

router.post('/api/v1/taxatie', express.json({ limit: '256kb' }), (req, res) => {
  if (!API_KEY) return res.status(503).json({ error: 'externe API niet geconfigureerd (T4C_API_KEY ontbreekt)' });
  const given = req.headers['x-api-key'] || (req.headers.authorization || '').replace('Bearer ', '');
  if (!given || given !== API_KEY) {
    return res.status(401).json({ error: 'ongeldige of ontbrekende API-key (stuur header X-API-Key)' });
  }
  const payload = JSON.stringify(req.body || {});
  const fwd = http.request({
    host: '127.0.0.1', port: 3000, path: '/api/dealer/price', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 90000,
  }, ir => {
    let d = ''; ir.on('data', c => d += c); ir.on('end', () => {
      res.status(ir.statusCode || 200).type('application/json').send(d);
    });
  });
  fwd.on('error', e => res.status(502).json({ error: 'pricing onbereikbaar: ' + e.message }));
  fwd.on('timeout', () => { fwd.destroy(); res.status(504).json({ error: 'timeout' }); });
  fwd.write(payload); fwd.end();
});

module.exports = router;
