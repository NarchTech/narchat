// NarChat Service Worker (Faz-1 iskelet) — kabuk önbelleği (offline aç).
// NOT: API/mesaj istekleri ASLA önbelleğe alınmaz (gerçek-zaman + gizlilik).
const CACHE = 'narchat-kabuk-v61';
const KABUK = ['/', '/index.html', '/app.js?v=61', '/auth.js?v=2', '/kok.js?v=1', '/kurulum.js?v=1', '/vendor/libsodium-sumo.js', '/arama.js?v=12', '/grup-arama.js?v=3', '/tokens.css?v=44', '/manifest.webmanifest',
               '/logo.svg', '/favicon.svg', '/bos-durum.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// NETWORK-FIRST (kabuk): online'da HER ZAMAN taze kod (güvenlik güncellemesi anında ulaşır),
// offline'da cache'e düşer. API istekleri SW'ye uğramaz (gerçek-zaman + gizlilik).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp.ok) { const kopya = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, kopya)); }
      return resp;
    }).catch(() => caches.match(e.request))   // ağ yoksa → offline kabuk
  );
});
// ── Web Push (kendi VAPID; 3.parti servis YOK). Gövde RFC8291 ile şifreli gelir;
//    içerik genel ("Yeni mesaj") — gerçek mesaj E2E olduğu için sunucu zaten bilmez. ──
// N7: sessize-alınmış odaların kümesini IndexedDB'den oku (sayfa buraya aynalıyor; SW localStorage okuyamaz).
function _sessizKume(){
  return new Promise((res) => {
    try {
      const r = indexedDB.open('narchat', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('anahtarlar'); } catch (_) {} };
      r.onerror = () => res(new Set());
      r.onsuccess = () => {
        try {
          const db = r.result;
          if (!db.objectStoreNames.contains('anahtarlar')) return res(new Set());
          const rq = db.transaction('anahtarlar', 'readonly').objectStore('anahtarlar').get('sessiz');
          rq.onsuccess = () => res(new Set(Array.isArray(rq.result) ? rq.result : []));
          rq.onerror = () => res(new Set());
        } catch (_) { res(new Set()); }
      };
    } catch (_) { res(new Set()); }
  });
}
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let veri = {};
    try { veri = e.data ? e.data.json() : {}; } catch (_) { veri = { body: 'Yeni mesaj' }; }
    const arama = veri.tip === 'arama';   // gelen arama → zil hissi: kalıcı + titreşim, mesajdan ayrı tag
    // N7: sessize alınmış oda mesajı → bildirim SESSİZ (ses/titreşim yok). ARAMA mute'u ATLAR (acil).
    let sessiz = false;
    if (!arama && veri.oda){ try { sessiz = (await _sessizKume()).has(veri.oda); } catch (_) {} }
    await self.registration.showNotification(veri.title || '📡 NarChat', {
      body: veri.body || 'Yeni mesaj',
      icon: '/ikon.svg', badge: '/ikon.svg',
      tag: arama ? 'narchat-arama' : 'narchat-mesaj',
      renotify: arama || undefined,
      requireInteraction: arama || undefined,   // arama bildirimi dokunana dek kalır
      // arama = güçlü, "telefon çalıyor" hissi veren uzun titreşim deseni (Android uygular; iOS web push titreşimi yok sayar)
      vibrate: arama ? [600, 200, 600, 200, 600, 200, 800] : undefined,
      silent: sessiz,   // sessize alınmış oda → ses/titreşim yok (banner yine de kısaca görünebilir)
      data: { url: veri.url || '/' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hedef = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((liste) => {
      for (const c of liste) {
        if ('focus' in c) {
          if (c.url && 'navigate' in c && hedef !== '/') { try { c.navigate(hedef); } catch (_) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(hedef);
    })
  );
});
