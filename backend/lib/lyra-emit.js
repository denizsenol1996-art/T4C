/**
 * Lyra observation emitter — fire-and-forget.
 * Stuurt taxatie-observation naar Lyra via lokale proxy.
 * BLOKKEERT NIET de response naar dealer.
 */

async function emitObservation(payload) {
  try {
    // Geen await op response — fire-and-forget
    fetch('http://127.0.0.1:3100/api/lyra/observe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Source': 't4c-observer',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000), // 3s max
    }).catch(e => {
      console.warn('[Lyra-emit] failed:', e.message);
    });
  } catch (e) {
    console.warn('[Lyra-emit] error:', e.message);
  }
}

module.exports = { emitObservation };
