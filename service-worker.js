// Service Worker — UC Jurídico v6.90.0 (feat B4+B5: 💬 botão "WhatsApp pro cliente" no processo — modal com telefone do cliente vinculado + mensagem de atualização pré-preenchida e editável [último andamento], abre wa.me, nada é enviado sem revisão; B5.1 contagem de dias dos prazos alinhada ao dia-calendário [_diaFatalLocal] em lista/processo/agenda/status visual — fatal hoje ao meio-dia não aparece mais como "1d"; B5.3 toggle "lembretes do Google no evento do prazo" em Settings→Sincronização [desligar evita alerta em dobro; Calendar.gs aceita lembretes vazio = evento sem alarme]; B5.2 decisão: push permanece por prazo [deep-link individual]. Anterior v6.89.0 (feat B2+B3: 🔔 painel de notificações no app [Configurações→Sincronização] editando settings/notifConfig no Firestore — kill-switch de e-mail vira um clique, modo digest/porMarco, hora do digest, marcos com e-mail, opt-out push/e-mail por advogado; backend Lembretes.gs lê o config a cada ciclo [vale em ≤30min sem recolar código]; ☕ digest diário: um resumo por advogado após a hora configurada, agrupado por processo com Parte·Providência·Situação·Prazo + sem-ACK, anti-dup por dia em settings/digestStatus; no modo digest e-mails individuais só T-0/FATAL/escalonamento e o fallback sem-token não flooda. Anterior v6.88.0 — feat B1: 🛰 varredura DataJud da carteira — API pública do CNJ [91 tribunais, grátis] consultada pra cada processo ativo há >7 dias sem sync; movimentos dos últimos 90 dias viram eventos na linha do tempo [reusa merge+dedupe do mniAplicarMudancasFlow, idempotente]; lotes de 150 mais-antigos-primeiro, delay 700ms [~85 req/min, sob o limite do CNJ], falha/não-encontrado marca datajudTentativaEm e respeita o ciclo; roda no boot [silencioso, máx 1x/20h, toast se houver novidade] + botão "🛰 Varrer carteira agora" em Configurações→MNI com progresso/cancelamento e relatório clicável. DataJud tem defasagem — prazos continuam nascendo do DJEN)
const CACHE_NAME = 'uc-juridico-v6-90-0';
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
