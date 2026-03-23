const CACHE = 'cdx-v10.16.0';
const URLS = ['/m/', '/m/manifest.json', '/m/icon-192.png', '/m/logo-cardatax.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS))) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // JS files: altijd netwerk-first
  if (e.request.url.includes('.js')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && e.request.url.includes('/m/')) {
      const clone = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
    }
    return r;
  }).catch(() => caches.match(e.request)));
});
