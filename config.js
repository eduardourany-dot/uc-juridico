// UC Jurídico — config compartilhado (prod + staging).
//
// Sem segredos aqui — Client ID e firebaseConfig são públicos por design;
// quem protege os dados são as Security Rules do Firestore.
//
// Ambiente escolhido automaticamente pelo hostname:
//   - localhost / 127.0.0.1            → staging (banco isolado)
//   - *.pages.dev                      → staging (Cloudflare Pages = sandbox compartilhável)
//   - eduardourany-dot.github.io       → produção
//   - qualquer URL com ?staging        → força staging (escape hatch)
//
// Banner visual no topo do app indica quando staging está ativo.

(function() {
  const isStaging =
       location.hostname === 'localhost'
    || location.hostname === '127.0.0.1'
    || location.hostname.startsWith('192.168.')
    || location.hostname.startsWith('10.')
    || location.hostname.endsWith('.local')
    || location.hostname.endsWith('.pages.dev')  // Cloudflare Pages → ambiente sandbox compartilhado
    || new URLSearchParams(location.search).has('staging');

  // ============ STAGING — projeto Firebase isolado pra testes ============
  // Apps Script (PDFs, cron lembretes, cron backup, Claude API) NÃO está
  // configurado — funcionalidades dependentes ficam desabilitadas em
  // staging. Foco do staging: testar fluxo de cadastro / UI sem afetar
  // dados reais do escritório.
  const STAGING = {
    firebaseConfig: {
      apiKey: 'AIzaSyBXt1rV9aLX_vWdQPIPBrqUscWhysFUK-M',
      authDomain: 'uc-juridico-staging.firebaseapp.com',
      projectId: 'uc-juridico-staging',
      storageBucket: 'uc-juridico-staging.firebasestorage.app',
      messagingSenderId: '228970789029',
      appId: '1:228970789029:web:37122d09a35d67df25354c'
    },
    // Apps Script Web App — não configurado pra staging. PDFs ficam desabilitados.
    WEB_APP_URL: '',
    OAUTH_CLIENT_ID: '',
    DRIVE_FOLDER_ID: '',
    // Push notifications — staging não usa FCM.
    FCM_VAPID_PUBLIC_KEY: '',
    SPREADSHEET_ID: ''
  };

  // ============ PRODUÇÃO — escritório UC Jurídico ============
  const PROD = {
    WEB_APP_URL: 'https://script.google.com/macros/s/AKfycby1TCUDv9yb070adZdpYQAFDxz0K--tjJ-NrvlOE4g6qVXRdhpz17ceFcE0NG5-cqBd/exec',
    OAUTH_CLIENT_ID: '353399924339-m68p647osnb47mhurqc3ctpfkde2ig9h.apps.googleusercontent.com',
    DRIVE_FOLDER_ID: '1tAOYow447n9Ayw67SGqMOhhrvyGgWmf_',
    firebaseConfig: {
      apiKey: 'AIzaSyAWhscZQHNkMvBpUJIMEyXu9BMUiI1zy_s',
      authDomain: 'uc-juridico.firebaseapp.com',
      projectId: 'uc-juridico',
      storageBucket: 'uc-juridico.firebasestorage.app',
      messagingSenderId: '353399924339',
      appId: '1:353399924339:web:807117d770921597c6ac06'
    },
    FCM_VAPID_PUBLIC_KEY: 'BE_IXmCqXjQZ7OQet6-QYDaMHkLuHV4dN6e_EKiiy5CsB7RwcbeewBXvKz5k6fYY9Gsx6NO9__fjkOK6f9E-9yM',
    SPREADSHEET_ID: '1cb55gysAgYXNyn25nvAqLi2qRypvIzCk69xM2J-Hl7U'
  };

  window.UC_CONFIG = isStaging ? STAGING : PROD;
  window.UC_CONFIG_ENV = isStaging ? 'staging' : 'production';

  // Banner visual quando em staging — injetado quando body existir.
  if (isStaging) {
    const inject = () => {
      if (document.getElementById('uc-staging-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'uc-staging-banner';
      banner.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0',
        'background:#b87f1c', 'color:#fff', 'padding:6px 12px',
        'font:600 11px/1.4 system-ui,sans-serif', 'text-align:center',
        'letter-spacing:0.08em', 'text-transform:uppercase',
        'z-index:1000', 'box-shadow:0 1px 4px rgba(0,0,0,0.2)'
      ].join(';');
      banner.innerHTML = '⚠ Ambiente STAGING · dados isolados de produção · projeto Firebase: <code style="background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:3px;font-family:ui-monospace,monospace;">' + STAGING.firebaseConfig.projectId + '</code>';
      document.body.prepend(banner);
      // Compensa altura do banner empurrando o conteúdo
      document.body.style.paddingTop = '28px';
    };
    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject);
  }

  console.log('[UC Jurídico] Environment:', window.UC_CONFIG_ENV, '·', window.UC_CONFIG.firebaseConfig.projectId);
})();
