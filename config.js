// UC Jurídico — config compartilhado.
// Sem segredos aqui — Client ID e firebaseConfig são públicos por design;
// quem protege os dados são as Security Rules do Firestore.
window.UC_CONFIG = {
  // Apps Script Web App — usado APENAS para upload/download de PDFs (Drive).
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycby1TCUDv9yb070adZdpYQAFDxz0K--tjJ-NrvlOE4g6qVXRdhpz17ceFcE0NG5-cqBd/exec',
  OAUTH_CLIENT_ID: '353399924339-m68p647osnb47mhurqc3ctpfkde2ig9h.apps.googleusercontent.com',
  DRIVE_FOLDER_ID: '1tAOYow447n9Ayw67SGqMOhhrvyGgWmf_',

  // Firebase — banco de dados rápido (Firestore) + Auth + Cloud Messaging.
  firebaseConfig: {
    apiKey: 'AIzaSyAWhscZQHNkMvBpUJIMEyXu9BMUiI1zy_s',
    authDomain: 'uc-juridico.firebaseapp.com',
    projectId: 'uc-juridico',
    storageBucket: 'uc-juridico.firebasestorage.app',
    messagingSenderId: '353399924339',
    appId: '1:353399924339:web:807117d770921597c6ac06'
  },

  // Chave pública VAPID — necessária para o navegador se inscrever em push (Web Push API).
  // Pública por design: usada pelo cliente para registrar o token FCM.
  // Pareada com a chave privada que vive no Firebase Console (não sai de lá).
  FCM_VAPID_PUBLIC_KEY: 'BE_IXmCqXjQZ7OQet6-QYDaMHkLuHV4dN6e_EKiiy5CsB7RwcbeewBXvKz5k6fYY9Gsx6NO9__fjkOK6f9E-9yM',

  // Mantido para histórico/backup; não é mais leitura ativa.
  SPREADSHEET_ID: '1cb55gysAgYXNyn25nvAqLi2qRypvIzCk69xM2J-Hl7U'
};
