// firebase-messaging-sw.js — Service Worker dedicado para FCM (Sprint 3 B.2)
// Vive separado do service-worker.js (PWA shell cache) por exigência da
// arquitetura do Firebase Messaging. Quando a página está em background ou
// fechada, é ESTE SW que recebe os pushes e mostra Notification.

// Força ativação imediata sem esperar todas as abas fecharem.
// Sem isso, o SW fica em estado "Installed" (waiting) e o onBackgroundMessage
// não dispara — pushes em background não chegam.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// firebaseConfig é público por design (mesmo do config.js do client).
// Manter sincronizado se algum dia rodar.
firebase.initializeApp({
  apiKey: 'AIzaSyAWhscZQHNkMvBpUJIMEyXu9BMUiI1zy_s',
  authDomain: 'uc-juridico.firebaseapp.com',
  projectId: 'uc-juridico',
  storageBucket: 'uc-juridico.firebasestorage.app',
  messagingSenderId: '353399924339',
  appId: '1:353399924339:web:807117d770921597c6ac06'
});

const messaging = firebase.messaging();

// Background message handler — payload do servidor contém apenas 'data'
// (sem 'notification'), então temos controle total da UI da Notification.
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM SW] background message', payload);
  const data = payload.data || {};
  const title = data.title || 'UC Jurídico — Prazo';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'favicon-32.png',
    tag: data.tag || 'uc-juridico-prazo',
    requireInteraction: data.requireInteraction === 'true',
    data: data
  };
  return self.registration.showNotification(title, options);
});

// Click handler — abre/foca o app no link recebido (ex.: #process/abc123).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/uc-juridico/';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Tenta focar uma janela já aberta do UC Jurídico
    for (const c of all) {
      if (c.url.includes('uc-juridico') && 'focus' in c) {
        try { await c.focus(); } catch (_) {}
        // Pede ao client pra navegar via postMessage (a função é tratada em index.html)
        try {
          c.postMessage({ type: 'uc-navigate', url });
        } catch (_) {}
        return;
      }
    }
    // Senão, abre nova janela
    return clients.openWindow(url);
  })());
});
