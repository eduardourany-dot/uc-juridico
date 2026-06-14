// Service Worker — UC Jurídico v6.87.1 (refac UX: prazos auto-agendados não geram mais banner/fila 🤖 separado na página Publicações — eram confusos. Agora vivem só no Kanban [coluna Atribuído, badge "🤖 revisar"] e na Agenda. Revisão acontece no lugar: dar ciência no Kanban OU "🤖 revisar" na Agenda confirma a leitura do parser e limpa o marcador. Card da Agenda ganha 🤖 revisar + ajustar fatal 🗓. Removida _secaoRevisaoAutoHtml; mensagens do relatório atualizadas)
const CACHE_NAME = 'uc-juridico-v6-87-1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './api.js',
  './messaging.js',
  './logo.png',
  './logo.mp4',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon-32.png'
];

// firebase-messaging-sw.js NÃO entra no APP_SHELL nem é interceptado por
// este SW — o Firebase SDK gerencia o registro/atualização separadamente.

const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Permite o app perguntar a versão do SW (rodapé exibe dinamicamente, sem
// precisar atualizar string hardcoded no index.html a cada bump).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ cacheName: CACHE_NAME });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // firebase-messaging-sw.js é gerenciado pelo Firebase SDK — NÃO interceptar
  // (sempre buscar fresh, sem cachear) pra evitar versão antiga colada.
  if (url.pathname.endsWith('/firebase-messaging-sw.js')) return;

  // App shell — cache first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return resp;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // CDNs — stale-while-revalidate
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
