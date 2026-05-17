// lib/enrich-cache.js — In-memory cache voor /api/vehicle/enriched
// TTL 24h, max 5000 entries, LRU evictie

const TTL_MS = 24 * 60 * 60 * 1000  // 24h
const MAX_ENTRIES = 5000

const _store = new Map()
const _stats = { hits: 0, misses: 0, stores: 0, evictions: 0, expirations: 0 }

function _normKey(kenteken) {
  return String(kenteken || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function get(kenteken) {
  const k = _normKey(kenteken)
  if (!k) { _stats.misses++; return null }
  const e = _store.get(k)
  if (!e) { _stats.misses++; console.log("[ENRICH-CACHE] MISS", k); return null }
  if (Date.now() > e.expiresAt) {
    _store.delete(k)
    _stats.expirations++
    _stats.misses++
    console.log("[ENRICH-CACHE] EXPIRED", k)
    return null
  }
  e.hitCount = (e.hitCount || 0) + 1
  e.lastHit = Date.now()
  _stats.hits++
  console.log("[ENRICH-CACHE] HIT", k, "(hits:" + e.hitCount + ")")
  return e.data
}

function set(kenteken, data) {
  const k = _normKey(kenteken)
  if (!k || !data) return false
  _store.set(k, {
    data,
    expiresAt: Date.now() + TTL_MS,
    storedAt: Date.now(),
    lastHit: Date.now(),
    hitCount: 0
  })
  _stats.stores++
  console.log("[ENRICH-CACHE] STORE", k, "(size:" + _store.size + ")")
  if (_store.size > MAX_ENTRIES) _evictLRU(Math.ceil(MAX_ENTRIES * 0.1))
  return true
}

function invalidate(kenteken) {
  const k = _normKey(kenteken)
  const had = _store.delete(k)
  if (had) console.log("[ENRICH-CACHE] INVALIDATE", k)
  return had
}

function _evictLRU(count) {
  const sorted = [..._store.entries()].sort((a, b) => (a[1].lastHit || 0) - (b[1].lastHit || 0))
  for (let i = 0; i < Math.min(count, sorted.length); i++) {
    _store.delete(sorted[i][0])
    _stats.evictions++
    console.log("[ENRICH-CACHE] EVICT", sorted[i][0])
  }
}

function clear() {
  const n = _store.size
  _store.clear()
  console.log("[ENRICH-CACHE] CLEAR (" + n + " entries removed)")
  return n
}

function stats() {
  const total = _stats.hits + _stats.misses
  let oldestEntry = null
  let newestEntry = null
  for (const [k, v] of _store.entries()) {
    if (!oldestEntry || v.storedAt < oldestEntry.storedAt) oldestEntry = { kenteken: k, storedAt: v.storedAt, ageMs: Date.now() - v.storedAt }
    if (!newestEntry || v.storedAt > newestEntry.storedAt) newestEntry = { kenteken: k, storedAt: v.storedAt, ageMs: Date.now() - v.storedAt }
  }
  return {
    size: _store.size,
    maxEntries: MAX_ENTRIES,
    ttlMs: TTL_MS,
    hits: _stats.hits,
    misses: _stats.misses,
    stores: _stats.stores,
    evictions: _stats.evictions,
    expirations: _stats.expirations,
    hitRate: total > 0 ? Math.round(_stats.hits / total * 10000) / 100 : 0,
    oldestEntry,
    newestEntry
  }
}

module.exports = { get, set, invalidate, clear, stats }
