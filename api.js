// UC Jurídico — camada de auth (Firebase Auth) + RemoteDB (Firestore).
// Carregado como ESM. Expõe window.UC_Auth e window.UC_RemoteDB para o
// código inline de index.html, que faz Object.assign(DB, UC_RemoteDB).
//
// PDFs continuam via Apps Script (Drive) — usamos o Google ID token capturado
// no sign-in (válido por ~1h). Se expirar, re-autenticamos via popup.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc,
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
  // Mensagem específica pra iOS Safari fora de modo standalone (não instalado
  // como PWA na home). O storage isolation do Safari quebra OAuth de
  // signInWithRedirect/Popup quando authDomain (firebaseapp.com) é diferente
  // do domínio do app. Solução real = custom auth domain. Paliativo = PWA.
  const isStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const iosWarning = (_isIosOrIpad() && !isStandalone) ? `
    <div style="background:#fff7e6;border:1px solid #b87f1c;border-radius:6px;padding:12px 14px;margin:0 0 20px;text-align:left;font-family:system-ui,sans-serif;font-size:12px;line-height:1.5;color:#5a4118;">
      <strong>📱 Você está no iPhone/iPad</strong><br>
      O Safari bloqueia o login do Google por questões de privacidade.<br>
      <strong>Instale o app na tela inicial:</strong> toque no botão de compartilhar
      <span style="display:inline-block;border:1px solid #999;border-radius:3px;padding:0 3px;">↑</span>
      → <em>"Adicionar à Tela de Início"</em> → abrir o app pelo ícone instalado e fazer login lá.
    </div>
  ` : '';
  overlay.innerHTML = `
    <div style="text-align:center;max-width:420px;">
      <h1 style="font-family:'EB Garamond',serif;font-size:42px;color:#1a1a1a;letter-spacing:0.08em;margin:0 0 8px;font-variant:small-caps;">UC Jurídico</h1>
      <p style="color:#6b6b68;font-size:15px;font-style:italic;margin:0 0 24px;">Acesso restrito · entre com sua conta Google</p>
      ${iosWarning}
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

// Detecção: Safari iOS bloqueia popups OAuth de forma que o sessionStorage
// fica isolado, quebrando signInWithPopup com "missing initial state".
// Para iOS (Safari, Chrome, Firefox — todos usam WebKit lá), usar
// signInWithRedirect que sobrevive ao isolamento de storage.
// Detecta também iPadOS 13+ que reporta MacIntel mas tem touch screen.
function _isIosOrIpad() {
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIpadDesktop = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return isIos || isIpadDesktop;
}

// Helper: captura Google ID token de um result e persiste
function _capturarIdToken(result) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential && credential.idToken) {
    googleIdToken = credential.idToken;
    try {
      const payload = JSON.parse(atob(credential.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      googleIdTokenExp = Number(payload.exp) * 1000;
    } catch (_) { googleIdTokenExp = Date.now() + 55 * 60 * 1000; }
    saveStoredState();
  }
}

async function doSignIn(silent = false) {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  // Sempre reconfirmar conta — garante que o user cookie corresponde ao escolhido
  provider.setCustomParameters({ prompt: silent ? 'none' : 'select_account' });

  // iOS/iPadOS: usar redirect (popup quebra com "missing initial state").
  // A navegação acontece imediatamente — não mostra spinner, página troca.
  if (_isIosOrIpad()) {
    await signInWithRedirect(auth, provider);
    // Nunca chega aqui — página redireciona pro Google
    return null;
  }

  // Desktop e Android: popup
  const result = await signInWithPopup(auth, provider);
  _capturarIdToken(result);
  // checkAllowlist é chamado pelo onAuthStateChanged
  return result.user;
}

// Tratar retorno do redirect (executa quando volta da navegação OAuth no iOS).
// Em desktop / sem redirect pendente, getRedirectResult resolve com null silenciosamente.
async function _handleRedirectReturn() {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      _capturarIdToken(result);
      // onAuthStateChanged vai disparar checkAllowlist em seguida
    }
  } catch (err) {
    const code = err && err.code || '';
    // Cancelamentos / fechamentos não são erros pra mostrar
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ||
        code === 'auth/user-cancelled' || code === 'auth/web-storage-unsupported') {
      console.info('[UC_Auth] redirect cancelado/sem-storage:', code);
      return;
    }
    console.warn('[UC_Auth] getRedirectResult error:', code, err && err.message);
    setLoginError('Falha no retorno do login: ' + (err && err.message || err));
  }
}
// Dispara no carregamento — se houver retorno pendente, processa.
// Roda em paralelo ao onAuthStateChanged que também processa retornos válidos.
_handleRedirectReturn();

const BOOTSTRAP_ADMIN_EMAIL = 'eduardourany@uranydecastro.com.br';

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

  // Bootstrap: o admin do escritório se autocria no primeiro login.
  if (!snap.exists() && email === BOOTSTRAP_ADMIN_EMAIL) {
    try {
      await setDoc(doc(db, 'users', email), {
        email,
        nome: user.displayName || 'Owner',
        role: 'admin',
        ativo: true,
        escritorioId: 'UC',
        criadoEm: Date.now()
      });
      snap = await getDoc(doc(db, 'users', email));
    } catch (err) {
      setLoginError('Falha no bootstrap do admin: ' + err.message);
      return null;
    }
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
  // Multi-tenant: todo doc carrega escritorio_id (default 'UC' por enquanto).
  if (!record.escritorio_id) {
    record.escritorio_id = (currentUserDoc && currentUserDoc.escritorioId) || 'UC';
  }
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
  if (!cfg.WEB_APP_URL) {
    throw new Error('Apps Script não configurado neste ambiente (WEB_APP_URL vazia em config.js).');
  }
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
  if (data.error) {
    // Propaga mensagem detalhada (ex: erro da API Gemini/Claude com 429, 500, etc)
    // mantendo o código de erro como prefixo pra debug.
    const detail = data.message ? ': ' + data.message.slice(0, 300) : '';
    throw new Error(data.error + detail);
  }
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

/**
 * Normaliza p.partes e p.advogados pra formato objeto consistente.
 *
 * Contexto: o app tem 2 formatos historicamente em uso:
 *   - ARRAY (legacy / importação Astrea): [{polo:'AT', nome, advogados:[]}, ...]
 *   - OBJETO (MNI / UI nova):              {ativo:[{nome}], passivo:[{nome}]}
 *
 * O card detalhado de processo, render de polo ativo/passivo e várias
 * funções esperam formato OBJETO. Esta normalização garante consistência
 * na leitura — toda função de getProcess/getAllProcesses passa por aqui.
 *
 * Idempotente: se já estiver em formato objeto, retorna sem alterar.
 */
function _normalizarProcesso(p) {
  if (!p || typeof p !== 'object') return p;
  // partes array → objeto + extrai advogados aninhados pra p.advogados
  if (Array.isArray(p.partes) && p.partes.length > 0) {
    const ativo = [];
    const passivo = [];
    const advAtivo = [];
    const advPassivo = [];
    for (const item of p.partes) {
      if (!item || typeof item !== 'object') continue;
      const isAtivo = item.polo === 'AT';
      // Clona a parte sem o polo nem advogados aninhados
      const { polo: _polo, advogados: aninhados, ...resto } = item;
      (isAtivo ? ativo : passivo).push(resto);
      // Promove advogados aninhados pra estrutura paralela
      if (Array.isArray(aninhados)) {
        const target = isAtivo ? advAtivo : advPassivo;
        for (const adv of aninhados) target.push(adv);
      }
    }
    p.partes = { ativo, passivo };
    // Se p.advogados não existe ou também é array, usa os promovidos
    if (!p.advogados || Array.isArray(p.advogados)) {
      p.advogados = { ativo: advAtivo, passivo: advPassivo };
    }
  }
  // advogados array isolado (sem partes em array) → objeto (caso edge)
  if (Array.isArray(p.advogados)) {
    const ativo = [];
    const passivo = [];
    for (const adv of p.advogados) {
      if (!adv) continue;
      (adv.polo === 'AT' ? ativo : passivo).push(adv);
    }
    p.advogados = { ativo, passivo };
  }
  return p;
}

const RemoteDB = {
  // Processos
  async getAllProcesses()    {
    const list = await getAll_('processos');
    return list.map(_normalizarProcesso);
  },
  async getProcess(id)       {
    const p = await getById_('processos', id);
    return p ? _normalizarProcesso(p) : null;
  },
  async saveProcess(p)       { return await upsert_('processos', p); },
  async deleteProcess(id) {
    await softDelete_('processos', id);
    for (const col of ['eventos', 'prazos', 'notas', 'jurisprudencia']) {
      await cascadeSoftDelete_(col, 'processId', id);
    }
  },
  // Query restrita por clienteId — usada pelo bootApp do cliente.
  // Firestore não aceita OR — fazemos 2 queries (campo legado `clienteId`
  // e campo novo `clienteIds[]`) e mergemos por id. Security Rules
  // permitem cliente ler apenas docs onde o campo bate.
  async getProcessosByClienteId(clienteId) {
    if (!clienteId) return [];
    const cid = String(clienteId);
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db, 'processos'), where('clienteId', '==', cid))),
      getDocs(query(collection(db, 'processos'), where('clienteIds', 'array-contains', cid)))
    ]);
    const map = new Map();
    s1.forEach(d => { const p = d.data(); if (!p.deletedAt) map.set(p.id, p); });
    s2.forEach(d => { const p = d.data(); if (!p.deletedAt) map.set(p.id, p); });
    return Array.from(map.values()).map(_normalizarProcesso);
  },
  // Compromissos filtrados por clienteId (rule permite cliente ler só os dele)
  async getCompromissosByClienteIdRemote(clienteId) {
    if (!clienteId) return [];
    const snap = await getDocs(query(collection(db, 'compromissos'),
      where('clienteId', '==', String(clienteId))));
    const out = [];
    snap.forEach(d => { const v = d.data(); if (!v.deletedAt) out.push(v); });
    return out;
  },
  // Lista docs filtrados por processId — usado por cliente com Security
  // Rules estritas (rule só libera doc se processoIdDoCliente bate).
  // Como TODOS os docs retornados têm o mesmo processId, o lookup
  // `get(/processos/X)` em rules é cached (1 read total, não N).
  async getByProcessIdRemote(collectionName, processId, field) {
    if (!processId) return [];
    const f = field || 'processId';
    const snap = await getDocs(query(collection(db, collectionName),
      where(f, '==', String(processId))));
    const out = [];
    snap.forEach(d => { const v = d.data(); if (!v.deletedAt) out.push(v); });
    return out;
  },
  // Honorários filtrados por clienteId (rule permite cliente ler só os dele)
  async getHonorariosByClienteIdRemote(clienteId) {
    if (!clienteId) return [];
    const snap = await getDocs(query(collection(db, 'honorarios'),
      where('clienteId', '==', String(clienteId))));
    const out = [];
    snap.forEach(d => { const v = d.data(); if (!v.deletedAt) out.push(v); });
    return out;
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

  // ====== Clientes (v6.19+) ======
  async getAllClientes() { return await getAll_('clientes'); },
  async getCliente(id) { return await getById_('clientes', id); },
  async saveCliente(c) { return await upsert_('clientes', c); },

  // Cálculos monetários (atualização monetária, juros, multa, honorários)
  async getAllCalculos() { return await getAll_('calculos'); },
  async getCalculo(id) { return await getById_('calculos', id); },
  async getCalculosByProcess(pid) {
    return (await getAll_('calculos')).filter(c => c.processoId === pid);
  },
  async getCalculosByCliente(cid) {
    return (await getAll_('calculos')).filter(c => c.clienteId === cid);
  },
  async saveCalculo(c) { return await upsert_('calculos', c); },
  async deleteCalculo(id) { return await softDelete_('calculos', id); },
  async deleteCliente(id) { return await softDelete_('clientes', id); },

  // ====== Custas processuais (P5) ======
  // Salva cálculos de custas iniciais por processo. Uma coleção separada
  // dos cálculos monetários (que vão em /calculos) — schema diferente,
  // contexto diferente.
  async getCustasByProcess(pid) {
    return (await getAll_('custas')).filter(c => c.processoId === pid && !c.deletedAt);
  },
  async saveCusta(c) { return await upsert_('custas', c); },
  async deleteCusta(id) { return await softDelete_('custas', id); },

  // ====== Comunicações (v6.23 — Cli.4) ======
  async getAllComunicacoes() { return await getAll_('comunicacoes'); },
  async getComunicacoesByCliente(cid) {
    return (await getAll_('comunicacoes')).filter(c => c.clienteId === cid);
  },
  async saveComunicacao(c) { return await upsert_('comunicacoes', c); },
  async deleteComunicacao(id) { return await softDelete_('comunicacoes', id); },

  // ====== Compromissos / Agenda (v6.25) ======
  async getAllCompromissos() { return await getAll_('compromissos'); },
  async getCompromissosByProcess(pid) {
    return (await getAll_('compromissos')).filter(c => c.processoId === pid);
  },
  async getCompromissosByCliente(cid) {
    return (await getAll_('compromissos')).filter(c => c.clienteId === cid);
  },
  async saveCompromisso(c) { return await upsert_('compromissos', c); },
  async deleteCompromisso(id) { return await softDelete_('compromissos', id); },

  // ====== Módulo Petições — Modelos (v6.27) ======
  async getAllPeticaoModelos() { return await getAll_('peticao_modelos'); },
  async savePeticaoModelo(m) { return await upsert_('peticao_modelos', m); },
  async deletePeticaoModelo(id) { return await softDelete_('peticao_modelos', id); },

  // ====== Módulo Petições — Versões (v6.31, Sprint Pet.1) ======
  async getAllPeticoes() { return await getAll_('peticoes'); },
  async getPeticoesByProcess(pid) {
    return (await getAll_('peticoes')).filter(p => p.processoId === pid);
  },
  async savePeticao(p) { return await upsert_('peticoes', p); },
  async deletePeticao(id) { return await softDelete_('peticoes', id); },

  // ====== Geração IA (peças + relatórios) ======
  // Default: gemini-3-flash-preview (free tier reduzido do Google AI Studio).
  //
  // Migrado de 2.5-flash → 3-flash-preview em 18/05/2026 (v6.64.32). Qualidade
  // superior em raciocínio jurídico e multimodal, ainda dentro do free tier.
  // Custo paid tier: $0.50/M input + $3.00/M output (~$0.012/peça).
  //
  // Pra qualidade máxima (gemini-3-pro-preview, ~$0.046/peça), ativar billing
  // no Google Cloud (https://console.cloud.google.com/billing) e mudar aqui.
  //
  // briefing: string (requerimento do advogado)
  // contextoSnapshot: { processo, cliente, eventos[], prazos[], jurisprudencia[] }
  // opts: { modeloPromptSistema?, tipo?, modeloApi? }
  async gerarPeticaoIA(briefing, contextoSnapshot, opts = {}) {
    return await callAppsScript('gerarPeticaoIA', null, {
      briefing,
      contextoSnapshot,
      modeloPromptSistema: opts.modeloPromptSistema || '',
      tipo: opts.tipo || 'outro',
      modeloApi: opts.modeloApi || 'gemini-3-flash-preview'
    });
  },

  // Jurisprudência
  async getJurisprudenceByProcess(pid) {
    return (await getAll_('jurisprudencia')).filter(j => j.processId === pid);
  },
  async saveJurisprudence(j) { return await upsert_('jurisprudencia', j); },

  // ====== Módulo Financeiro (v6.16+) ======
  // Bancos
  async getAllBancos() { return await getAll_('bancos'); },
  async saveBanco(b) { return await upsert_('bancos', b); },
  async deleteBanco(id) { return await softDelete_('bancos', id); },

  // Cartões
  async getAllCartoes() { return await getAll_('cartoes'); },
  async saveCartao(c) { return await upsert_('cartoes', c); },
  async deleteCartao(id) { return await softDelete_('cartoes', id); },

  // Categorias financeiras
  async getAllCategoriasFin() { return await getAll_('categorias_fin'); },
  async saveCategoriaFin(c) { return await upsert_('categorias_fin', c); },
  async deleteCategoriaFin(id) { return await softDelete_('categorias_fin', id); },

  // Transações
  async getAllTransacoes() { return await getAll_('transacoes'); },
  async getTransacoesByProcess(pid) {
    return (await getAll_('transacoes')).filter(t => t.processoId === pid);
  },
  async saveTransacao(t) { return await upsert_('transacoes', t); },
  async deleteTransacao(id) { return await softDelete_('transacoes', id); },

  // Recorrências
  async getAllRecorrencias() { return await getAll_('recorrencias'); },
  async saveRecorrencia(r) { return await upsert_('recorrencias', r); },
  async deleteRecorrencia(id) { return await softDelete_('recorrencias', id); },

  // Honorários
  async getAllHonorarios() { return await getAll_('honorarios'); },
  async getHonorariosByProcess(pid) {
    return (await getAll_('honorarios')).filter(h =>
      h.processoId === pid ||  // legado (Cli.1 e anterior)
      (Array.isArray(h.processosCobertos) && h.processosCobertos.includes(pid))  // Cli.2+
    );
  },
  async getHonorariosByCliente(cid) {
    return (await getAll_('honorarios')).filter(h => h.clienteId === cid);
  },
  async saveHonorario(h) { return await upsert_('honorarios', h); },
  async deleteHonorario(id) { return await softDelete_('honorarios', id); },

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

// ============================================================
// UC_admin — utilitários de gestão de usuários (só para admins).
// Pensado para uso no console do browser. Mais tarde vira UI.
// ============================================================

function requireAdmin_() {
  if (!currentUserDoc || currentUserDoc.role !== 'admin') {
    throw new Error('admin_required: faça login como admin antes de chamar UC_admin.*');
  }
}

/**
 * Valida que o user atual pode gerenciar acessos de clientes
 * (admin ou role='user' do escritório). Funções restritas a esse
 * grupo gerenciam APENAS docs com role='cliente'.
 */
function requireCanWrite_() {
  if (!currentUserDoc || !['admin', 'user'].includes(currentUserDoc.role)) {
    throw new Error('insufficient_role: precisa ser admin ou user pra gerenciar acesso de clientes');
  }
}

/**
 * Sincroniza um usuário INTERNO (admin/user/viewer) na allowlist do
 * Apps Script (Sheets `Usuarios`) — necessária pra acessar a API IA
 * (gerarPeticaoIA + outras actions).
 *
 * Clientes (role='cliente') NÃO precisam — eles só acessam o app no
 * frontend (Firestore /users), nunca chamam o Apps Script.
 *
 * Não falha o fluxo principal — se a sync der erro (ex: Apps Script
 * fora do ar, ou user atual não é admin no Sheets), loga warn e retorna.
 * Frontend mostra toast amarelo opcional.
 */
async function syncUserAppsScript_(email, nome, role) {
  // Clientes não vão pra Sheets — só interno
  if (role === 'cliente') return { skipped: true, reason: 'role cliente não usa API IA' };
  try {
    const resp = await callAppsScript('addUsuario', null, {
      email, nome: nome || '', role: role || 'user'
    });
    return { ok: true, response: resp };
  } catch (err) {
    console.warn('[syncUserAppsScript_] falha:', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

window.UC_admin = {
  async addUser(email, nome, role = 'user', clienteId = null) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    if (!e) throw new Error('email_required');
    const payload = {
      email: e,
      nome: nome || '',
      role,
      ativo: true,
      escritorioId: (currentUserDoc && currentUserDoc.escritorioId) || 'UC',
      criadoEm: Date.now()
    };
    // Pra role 'cliente': linkar ao doc da coleção clientes via clienteId.
    // O filtro de processos em bootApp do app usa esse campo pra mostrar
    // só os processos que tem clienteIds incluindo esse clienteId.
    if (clienteId) payload.clienteId = String(clienteId);
    await setDoc(doc(db, 'users', e), payload, { merge: true });
    // Sync com Apps Script Sheets pra users INTERNOS (não clientes).
    // Garante que o user também consegue chamar a API IA, não só ler
    // dados no frontend. Não bloqueia se falhar.
    const syncResult = await syncUserAppsScript_(e, nome, role);
    if (!syncResult.ok && !syncResult.skipped) {
      console.warn('[UC_admin.addUser] Firestore OK, Sheets sync falhou:', syncResult.error);
    }
    return e;
  },
  async setClienteId(email, clienteId) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    await updateDoc(doc(db, 'users', e), { clienteId: clienteId ? String(clienteId) : null });
    return e;
  },

  /**
   * Força sync de um user existente no Firestore com a allowlist do
   * Apps Script (Sheets). Útil quando user já tá no Firestore mas
   * Apps Script reporta forbidden — ou quando se reverte uma
   * desativação manual da planilha.
   *
   * Uso típico no console:
   *   await UC_admin.syncToAppsScript('eduardourany@uranydecastro.com.br')
   */
  async syncToAppsScript(email) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    if (!e) throw new Error('email_required');
    // Lê os dados atuais do Firestore
    const snap = await getDoc(doc(db, 'users', e));
    if (!snap.exists()) throw new Error('user_not_in_firestore: ' + e);
    const u = snap.data();
    if (u.role === 'cliente') return { skipped: true, reason: 'clientes não usam Apps Script' };
    return await syncUserAppsScript_(e, u.nome, u.role);
  },

  /**
   * Cria/atualiza/desativa o acesso de um CLIENTE ao sistema.
   * Aceita non-admin (user role='user' pode chamar) — mais restrito que
   * addUser. Validações:
   *   - role hardcoded como 'cliente' (não dá pra promover)
   *   - email obrigatório
   *   - clienteId obrigatório quando ativando
   *
   * Uso típico: chamado pelo editClienteFlow quando flag `temAcessoSistema`
   * muda. Pode ativar (criar/reativar) ou desativar (preserva histórico).
   */
  async toggleClienteAccess(email, ativo, nome, clienteId) {
    requireCanWrite_();
    const e = String(email || '').toLowerCase().trim();
    if (!e) throw new Error('email_required');
    if (ativo) {
      if (!clienteId) throw new Error('clienteId_required');
      // setDoc com merge: cria se não existe, atualiza se já existe.
      // role='cliente' hardcoded — rules bloqueiam mudança.
      const payload = {
        email: e,
        nome: nome || '',
        role: 'cliente',
        ativo: true,
        escritorioId: (currentUserDoc && currentUserDoc.escritorioId) || 'UC',
        clienteId: String(clienteId),
        criadoEm: Date.now()
      };
      await setDoc(doc(db, 'users', e), payload, { merge: true });
    } else {
      // Desativar: apenas marca ativo=false. Preserva histórico.
      await updateDoc(doc(db, 'users', e), { ativo: false });
    }
    return e;
  },
  async backfillEscritorioId(escritorioId = 'UC') {
    requireAdmin_();
    const collectionsToBackfill = [
      'processos', 'prazos', 'eventos', 'notas', 'jurisprudencia', 'djen', 'settings', 'audit'
    ];
    const stats = {};
    for (const col of collectionsToBackfill) {
      const snap = await getDocs(collection(db, col));
      let touched = 0, alreadyOk = 0;
      for (const d of snap.docs) {
        if (d.data().escritorio_id) { alreadyOk++; continue; }
        await updateDoc(d.ref, { escritorio_id: escritorioId });
        touched++;
      }
      stats[col] = { touched, alreadyOk, total: snap.size };
    }
    // users também
    const usersSnap = await getDocs(collection(db, 'users'));
    let utouched = 0, ualreadyOk = 0;
    for (const d of usersSnap.docs) {
      if (d.data().escritorioId) { ualreadyOk++; continue; }
      await updateDoc(d.ref, { escritorioId });
      utouched++;
    }
    stats.users = { touched: utouched, alreadyOk: ualreadyOk, total: usersSnap.size };
    return stats;
  },
  async listUsers() {
    requireAdmin_();
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async setActive(email, ativo) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    await updateDoc(doc(db, 'users', e), { ativo: !!ativo });
    return e;
  },
  async setRole(email, role) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    await updateDoc(doc(db, 'users', e), { role: String(role) });
    return e;
  },
  // Exclusão definitiva — apaga o doc da coleção users. Diferente de setActive(false),
  // que só desativa. Use com cuidado: se o user logar de novo e o allowlist não tiver
  // o doc, ele é rejeitado pelo guard de auth (mesmo efeito de bloqueado), mas o
  // histórico (escritorioId, clienteId, etc.) é perdido.
  async deleteUser(email) {
    requireAdmin_();
    const e = String(email || '').toLowerCase().trim();
    if (!e) throw new Error('email_required');
    // Guard: não permite admin excluir a si mesmo (evita lockout do escritório).
    if (currentUserDoc && (currentUserDoc.email || '').toLowerCase() === e) {
      throw new Error('cannot_delete_self: você não pode excluir o próprio user');
    }
    await deleteDoc(doc(db, 'users', e));
    return e;
  }
};

// Sinaliza para index.html que o módulo está pronto (caso ele queira esperar)
window.dispatchEvent(new CustomEvent('uc:ready'));
