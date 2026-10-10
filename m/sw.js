// Service worker de la app móvil de fallas.
// - Archivos propios de la app: red primero (así las actualizaciones llegan de inmediato) y copia guardada de respaldo.
// - Leaflet (CDN): copia guardada tras la primera carga.
// - Supabase y mapas: siempre por red, nunca se guardan (datos siempre al día).
const VERSION = 'fm-v20';
const APP = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(APP.map((u) => fetch(u, { cache: 'reload' }).then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== 'fm-aviso').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Consulta de versión (app.js?v=…): directo a la red, sin guardar
  if (url.searchParams.has('v')) return;

  // Nunca interceptar datos ni mapas
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('openstreetmap.org')) return;

  // Archivos de la app: red primero
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
    );
    return;
  }

  // Leaflet y otros recursos de CDN: caché primero
  if (url.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith(
      caches.match(req).then((r) => r || fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copia));
        return res;
      }))
    );
  }
});

// Notificaciones push
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Fallas Alumbrado', {
    body: d.cuerpo || '', icon: 'icon-192.png', badge: 'badge-96.png', tag: d.tag || undefined, data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  const id = destino.searchParams.get('falla');
  e.waitUntil((async () => {
    // Se deja anotada la falla del aviso: si el mensaje directo se pierde (app congelada o en segundo plano),
    // la app la recoge sola al volver a primer plano.
    if (id) {
      try { const c = await caches.open('fm-aviso'); await c.put('pendiente', new Response(JSON.stringify({ id, t: Date.now() }))); } catch (err) { /* */ }
    }
    const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of cs) {
      if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
        try { await c.focus(); } catch (err) { /* */ }
        if (id) c.postMessage({ tipo: 'abrir-falla', id });
        return;
      }
    }
    return self.clients.openWindow(destino.href);
  })());
});
