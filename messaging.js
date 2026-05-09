// UC Jurídico — Firebase Cloud Messaging (Sprint 3 Fase B.2).
// Carrega como ESM via <script type="module">. Expõe window.UC_Messaging.
//
// O backend (Apps Script, ver Lembretes.gs) dispara pushes via FCM HTTP v1
// para o token registrado aqui. Quando o app está em foreground, o handler
// onForegroundMessage decide o que fazer; quando em background, é o
// firebase-messaging-sw.js que recebe (sem JS rodando no documento).

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as messagingIsSupported
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

const cfg = window.UC_CONFIG;
if (!cfg || !cfg.firebaseConfig) throw new Error('UC_CONFIG.firebaseConfig faltando');

// api.js já chama initializeApp; o SDK retorna o app singleton via getApp().
let app;
try { app = getApp(); } catch (_) { app = initializeApp(cfg.firebaseConfig); }

let messagingInstance = null;
async function _getMessaging() {
  if (messagingInstance) return messagingInstance;
  const supported = await messagingIsSupported().catch(() => false);
  if (!supported) return null;
  messagingInstance = getMessaging(app);
  return messagingInstance;
}

window.UC_Messaging = {
  /**
   * Pede token FCM. Requer:
   *  - Notification.permission === 'granted'
   *  - VAPID public key em UC_CONFIG.FCM_VAPID_PUBLIC_KEY
   *  - firebase-messaging-sw.js servido na raiz
   * Retorna string (token) ou null em caso de falha/ambiente sem suporte.
   */
  async getFcmToken() {
    if (!cfg.FCM_VAPID_PUBLIC_KEY) {
      console.warn('[UC_Messaging] FCM_VAPID_PUBLIC_KEY ausente em UC_CONFIG');
      return null;
    }
    const messaging = await _getMessaging();
    if (!messaging) {
      console.warn('[UC_Messaging] FCM não suportado neste ambiente');
      return null;
    }
    try {
      // Registra explicitamente o SW dedicado (evita Firebase tentar /firebase-messaging-sw.js
      // na raiz absoluta, que falha em GitHub Pages /uc-juridico/)
      const sw = await navigator.serviceWorker.register('firebase-messaging-sw.js');
      const token = await getToken(messaging, {
        vapidKey: cfg.FCM_VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: sw
      });
      return token || null;
    } catch (e) {
      console.warn('[UC_Messaging] getFcmToken falhou', e);
      return null;
    }
  },

  /**
   * Registra handler de mensagens em foreground (app aberto e ativo).
   * Em background, quem recebe é o firebase-messaging-sw.js.
   * Retorna a função de unsubscribe.
   */
  onForegroundMessage(handler) {
    return _getMessaging().then(messaging => {
      if (!messaging) return () => {};
      return onMessage(messaging, handler);
    });
  },

  /**
   * Indica se o navegador suporta FCM (Web Push API + Service Worker).
   * Retorna boolean. Útil pra UI esconder botões em ambientes sem suporte.
   */
  async isSupported() {
    return await messagingIsSupported().catch(() => false);
  }
};
