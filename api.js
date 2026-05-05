// UC Jurídico — camada de auth (Firebase Auth) + RemoteDB (Firestore).
// Carregado como ESM. Expõe window.UC_Auth e window.UC_RemoteDB para o
// código inline de index.html, que faz Object.assign(DB, UC_RemoteDB).
//
// PDFs continuam via Apps Script (Drive) — usamos o Google ID token capturado
// no sign-in (válido por ~1h). Se expirar, re-autenticamos via popup.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc,
  getDoc, getDocs, setDoc, updateDoc,
  query, where, writeBatch, addDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const cfg = window.UC_CONFIG;
if (!cfg || !cfg.firebaseConfig) throw new Error('UC_CONFIG.firebaseConfig faltando');

const app = initializeApp(cfg.firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Persistência local: usuário continua logado entre reloads
setPersistence(auth, browserLocalPersistence).catch(() => {});

// ============================================================
// Estado
// ============================================================

const STATE_KEY = 'uc_state';     // { userEmail, googleIdToken, googleIdTokenExp }

let currentUser = null;           // Firebase User
let currentUserDoc = null;        // doc do allowlist (com role, ativo, nome)
let googleIdToken = null;         // Google ID token (para Apps Script)
let googleIdTokenExp = 0;         // ms epoch

let signInResolver = null;
let signInRejecter = null;

function loadStoredState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    googleIdToken = s.googleIdToken || null;
    googleIdTokenExp = Number(s.googleIdTokenExp || 0);
  } catch (_) {}
}
function saveStoredState() {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    userEmail: currentUser ? currentUser.email : null,
    googleIdToken, googleIdTokenExp
  }));
}
function clearStoredState() {
  localStorage.removeItem(STATE_KEY);
  googleIdToken = null; googleIdTokenExp = 0;
}
loadStoredState();

// ============================================================
// Login overlay
// ============================================================

const OVERLAY_ID = 'uc-login-overlay';

function showLoginOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) { overlay.style.display = 'flex'; return; }
  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:#FAF7F0',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'z-index:99999', 'padding:24px',
    'font-family:"EB Garamond","Times New Roman",serif'
  ].join(';');
  overlay.innerHTML = `
    <div style="text-align:center;max-width:420px;">
      <h1 style="font-family:'EB Garamond',serif;font-size:42px;color:#1a1a1a;letter-spacing:0.08em;margin:0 0 8px;font-variant:small-caps;">UC Jurídico</h1>
      <p style="color:#6b6b68;font-size:15px;font-style:italic;margin:0 0 36px;">Acesso restrito · entre com sua conta Google</p>
      <button id="uc-login-btn" style="display:inline-flex;align-items:center;gap:12px;padding:12px 24px;border:1px solid #d4cfc0;border-radius:6px;background:#fff;font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a;cursor:pointer;font-weight:500;">
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
        Entrar com Google
      </button>
      <p id="uc-login-error" style="color:#a33;margin:24px 0 0;font-size:13px;display:none;font-family:system-ui,sans-serif;"></p>
      <p id="uc-login-loading" style="color:#888;margin:24px 0 0;font-size:13px;display:none;font-family:system-ui,sans-serif;">Verificando…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('uc-login-btn').onclick = () => {
    setLoginError('');
    setLoginLoading(true);
    doSignIn().catch(err => {
      setLoginLoading(false);
      setLoginError('Falha no login: ' + (err && err.message || err));
    });
  };
}
function hideLoginOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.style.display = 'none';
}
function setLoginError(msg) {
  const err = document.getElementById('uc-login-error');
  const loading = document.getElementById('uc-login-loading');
  if (loading) loading.style.display = 'none';
  if (err) {
    err.textContent = msg || '';
    err.style.display = msg ? 'block' : 'none';
  }
}
function setLoginLoading(on) {
  const loading = document.getElementById('uc-login-loading');
  if (loading) loading.style.display = on ? 'block' : 'none';
  if (on) setLoginError('');
}

// ============================================================
// Auth flow
// ============================================================

async function doSignIn(silent = false) {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  // Sempre reconfirmar conta — garante que o user cookie corresponde ao escolhido
  provider.setCustomParameters({ prompt: silent ? 'none' : 'select_account' });

  const result = await signInWithPopup(auth, provider);
  // Capturar Google ID token (válido ~1h, usado no Apps Script para PDFs)
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential && credential.idToken) {
    googleIdToken = credential.idToken;
    // ID tokens Google têm exp ~1h; deduzir a partir do JWT
    try {
      const payload = JSON.parse(atob(credential.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      googleIdTokenExp = Number(payload.exp) * 1000;
    } catch (_) { googleIdTokenExp = Date.now() + 55 * 60 * 1000; }
  }
  saveStoredState();
  // checkAllowlist é chamado pelo onAuthStateChanged
  return result.user;
}

async function checkAllowlistAndProceed(user) {
  const email = (user.email || '').toLowerCase();
  if (!user.emailVerified) {
    await signOut(auth);
    setLoginError('Email do Google não verificado.');
    return null;
  }
  let snap;
  try {
    snap = await getDoc(doc(db, 'users', email));
  } catch (err) {
    setLoginError('Erro ao verificar permissão: ' + err.message);
    return null;
  }
  if (!snap.exists() || snap.data().ativo !== true) {
    await signOut(auth);
    clearStoredState();
    setLoginError(`${email} não tem acesso a este sistema. Peça ao administrador para liberar.`);
    return null;
  }
  currentUserDoc = { email, ...snap.data() };
  return currentUserDoc;
}

// onAuthStateChanged é chamado: (a) na carga inicial se há sessão, (b) após signIn, (c) após signOut
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentUserDoc = null;
    return;
  }
  currentUser = user;
  setLoginLoading(true);
  const u = await checkAllowlistAndProceed(user);
  setLoginLoading(false);
  if (u) {
    hideLoginOverlay();
    if (signInResolver) {
      const r = signInResolver;
      signInResolver = null;
      signInRejecter = null;
      r(u);
    }
  }
});

async function requireSignIn() {
  if (currentUser && currentUserDoc) return currentUserDoc;
  showLoginOverlay();
  return new Promise((resolve, reject) => {
    signInResolver = resolve;
    signInRejecter = reject;
  });
}

async function doSignOut() {
  await signOut(auth);
  clearStoredState();
  window.location.reload();
}

function getUser() {
  return currentUserDoc;
}

window.UC_Auth = {
  requireSignIn,
  signOut: doSignOut,
  getUser,
  // legacy compat: getToken returned a string (used nowhere now)
  getToken: () => googleIdToken
};

// ============================================================
// RemoteDB — Firestore
// ============================================================

async function getAll_(collectionName, includeDeleted = false) {
  const snap = await getDocs(collection(db, collectionName));
  const out = [];
  snap.forEach(d => {
    const v = d.data();
    if (!includeDeleted && v.deletedAt) return;
    out.push(v);
  });
  return out;
}

async function getById_(collectionName, id) {
  if (!id) return null;
  const snap = await getDoc(doc(db, collectionName, String(id)));
  if (!snap.exists()) return null;
  const v = snap.data();
  return v.deletedAt ? null : v;
}

async function upsert_(collectionName, record, idField = 'id') {
  const id = record[idField];
  if (!id) throw new Error('upsert_: missing ' + idField);
  const now = Date.now();
  if (!record.createdAt) record.createdAt = now;
  record.updatedAt = now;
  record.updatedBy = (currentUser && currentUser.email) || null;
  if (record.deletedAt === undefined) record.deletedAt = null;
  await setDoc(doc(db, collectionName, String(id)), record, { merge: true });
  return record;
}

async function softDelete_(collectionName, id) {
  await updateDoc(doc(db, collectionName, String(id)), {
    deletedAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: (currentUser && currentUser.email) || null
  });
}

async function cascadeSoftDelete_(collectionName, fieldName, fieldValue) {
  const q = query(collection(db, collectionName), where(fieldName, '==', fieldValue));
  const snap = await getDocs(q);
  if (snap.empty) return;
  const batch = writeBatch(db);
  const now = Date.now();
  const by = (currentUser && currentUser.email) || null;
  snap.forEach(d => {
    if (!d.data().deletedAt) {
      batch.update(d.ref, { deletedAt: now, updatedAt: now, updatedBy: by });
    }
  });
  await batch.commit();
}

// PDFs via Apps Script (Drive). Usa o Google ID token capturado no sign-in.
async function ensureGoogleIdToken() {
  if (googleIdToken && Date.now() < googleIdTokenExp - 60000) return googleIdToken;
  // Token expirou — re-auth silencioso via popup
  await doSignIn(false);
  if (!googleIdToken) throw new Error('no_google_id_token');
  return googleIdToken;
}

async function callAppsScript(action, params, body) {
  const token = await ensureGoogleIdToken();
  const url = new URL(cfg.WEB_APP_URL);
  url.searchParams.set('action', action);
  if (params) for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set('token', token);
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token }) }
    : { method: 'GET' };
  const resp = await fetch(url.toString(), opts);
  if (!resp.ok) throw new Error('http_' + resp.status);
  const data = await resp.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

const RemoteDB = {
  // Processos
  async getAllProcesses()    { return await getAll_('processos'); },
  async getProcess(id)       { return await getById_('processos', id); },
  async saveProcess(p)       { return await upsert_('processos', p); },
  async deleteProcess(id) {
    await softDelete_('processos', id);
    for (const col of ['eventos', 'prazos', 'notas', 'jurisprudencia']) {
      await cascadeSoftDelete_(col, 'processId', id);
    }
  },

  // Eventos
  async getEventsByProcess(pid) {
    return (await getAll_('eventos')).filter(e => e.processId === pid);
  },
  async saveEvent(e)  { return await upsert_('eventos', e); },
  async deleteEvent(id) { return await softDelete_('eventos', id); },

  // Prazos
  async getAllDeadlines() { return await getAll_('prazos'); },
  async getDeadlinesByProcess(pid) {
    return (await getAll_('prazos')).filter(d => d.processId === pid);
  },
  async saveDeadline(d) { return await upsert_('prazos', d); },
  async deleteDeadline(id) { return await softDelete_('prazos', id); },

  // Notas
  async getNotesByProcess(pid) {
    return (await getAll_('notas')).filter(n => n.processId === pid);
  },
  async saveNote(n)  { return await upsert_('notas', n); },
  async deleteNote(id) { return await softDelete_('notas', id); },

  // Jurisprudência
  async getJurisprudenceByProcess(pid) {
    return (await getAll_('jurisprudencia')).filter(j => j.processId === pid);
  },
  async saveJurisprudence(j) { return await upsert_('jurisprudencia', j); },

  // PDFs (Drive via Apps Script)
  async getPdf(id) {
    try {
      const r = await callAppsScript('getPdfUrl', { pdfId: id });
      if (!r || !r.downloadUrl) return null;
      return { id, name: r.name, fileId: r.fileId, downloadUrl: r.downloadUrl };
    } catch (_) { return null; }
  },
  async savePdf(pdf) {
    const base64 = await blobToBase64(pdf.blob);
    const r = await callAppsScript('uploadPdf', null, {
      pdfId: pdf.id,
      filename: pdf.name || (pdf.id + '.pdf'),
      base64,
      processId: pdf.processId || null
    });
    return { ...pdf, fileId: r.fileId };
  },
  async deletePdf(_id) { /* sem endpoint dedicado por enquanto */ },

  // Prompts — locais (templates de IA, per-browser, IndexedDB existente)
  async getAllPrompts() {
    return await dbPromise('prompts', 'readonly', s => new Promise(res => {
      const r = s.getAll(); r.onsuccess = () => res(r.result);
    }));
  },
  async savePrompt(p) {
    await dbPromise('prompts', 'readwrite', s => s.put(p));
    return p;
  },
  async deletePrompt(id) { await dbPromise('prompts', 'readwrite', s => s.delete(id)); },

  // Settings
  async getSetting(key, defaultVal = null) {
    const snap = await getDoc(doc(db, 'settings', String(key)));
    if (!snap.exists()) return defaultVal;
    const v = snap.data();
    return v.value !== undefined ? v.value : defaultVal;
  },
  async setSetting(key, value) {
    const now = Date.now();
    await setDoc(doc(db, 'settings', String(key)), {
      chave: key, value,
      updatedAt: now,
      updatedBy: (currentUser && currentUser.email) || null
    }, { merge: true });
  },

  // History — server-side via collection `audit`. Frontend grava cada ação.
  async getHistory(_limit) { return []; },
  async addHistoryEntry(action, data) {
    if (!currentUser) return;
    try {
      await addDoc(collection(db, 'audit'), {
        timestamp: Date.now(),
        userEmail: currentUser.email,
        action: String(action),
        payload: data ? JSON.stringify(data).slice(0, 5000) : ''
      });
    } catch (_) { /* swallow */ }
  },

  // DJEN
  async getAllDjenPublications() { return await getAll_('djen'); },
  async getDjenPublication(hash) { return await getById_('djen', hash); },
  async saveDjenPublication(pub) { return await upsert_('djen', pub, 'hash'); },
  async getDjenPublicationsByProcess(processId) {
    return (await getAll_('djen')).filter(p => p.processId === processId);
  },
  async hasDjenPublication(hash) {
    return !!(await this.getDjenPublication(hash));
  }
};

window.UC_RemoteDB = RemoteDB;

// Sinaliza para index.html que o módulo está pronto (caso ele queira esperar)
window.dispatchEvent(new CustomEvent('uc:ready'));
