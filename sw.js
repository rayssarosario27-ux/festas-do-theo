// Festas do Théo — service worker mínimo
// Cacheia só os arquivos estáticos do próprio site.
// NUNCA cacheia a API (script.google.com) nem mídia (drive.google.com):
// esses pedidos vão sempre direto para a rede.
const CACHE = 'festas-theo-v1';
const ASSETS = [
  './',
  './index.html',
  './catalogo.html',
  './aniversarios.html',
  './crescendo.html',
  './album.html',
  './ano.html',
  './conta.html',
  './aguardando.html',
  './admin.html',
  './assets/style.css',
  './assets/api.js',
  './assets/auth.js',
  './assets/theo-photo.css',
  './manifest.webmanifest',
  './manifest-admin.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Só arquivos do próprio site, método GET. API e Drive passam direto.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // HTML: rede primeiro (conteúdo sempre fresco), cache como reserva offline.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // CSS/JS/ícones: cache primeiro, atualiza em segundo plano.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetcher = fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || fetcher;
    })
  );
});
