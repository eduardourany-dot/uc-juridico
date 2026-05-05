// UC Jurídico — camada de auth (Google Identity Services) + cliente da Web App.
// Expõe window.UC_Auth e window.UC_RemoteDB.
// O RemoteDB tem a MESMA API do DB local; é aplicado via Object.assign(DB, UC_RemoteDB) após login.

(() => {
  const cfg = window.UC_CONFIG;
  if (!cfg) throw new Error('config.js not loaded');

  const TOKEN_KEY = 'uc_id_token';
  const TOKEN_EXP_KEY = 'uc_id_token_exp';
  const USER_KEY = 'uc_user';

  // ============================================================
  // Token storage
  // ============================================================

  function getStoredToken() {
    const tok = localStorage.getItem(TOKEN_KEY);
    const exp = Number(localStorage.getItem(TOKEN_EXP_KEY) || 0);
    if (!tok) return null;
    // 60s de margem
    if (Date.now() > exp - 60000) return null;
    return tok;
  }

  function storeToken(token, expSec) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TOKEN_EXP_KEY, String(expSec * 1000));
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXP_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function decodeJwt(t) {
    try {
      const payload = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch (_) { return null; }
  }

  // ============================================================
  // HTTP wrapper
  // ============================================================

  async function apiCall(action, params, body) {
    const token = getStoredToken();
    if (!token) {
      await UC_Auth.requireSignIn();
      return apiCall(action, params, body);
    }
    const url = new URL(cfg.WEB_APP_URL);
    url.searchParams.set('action', action);
    if (params) for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    url.searchParams.set('token', token);

    const opts = body
      // text/plain para evitar preflight CORS no Apps Script Web App
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, token }) }
      : { method: 'GET' };

    let resp;
    try {
      resp = await fetch(url.toString(), opts);
    } catch (err) {
      throw new Error('network_error: ' + err.message);
    }
    if (!resp.ok) throw new Error('http_' + resp.status);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new Error('bad_response: ' + text.slice(0, 200));
    }
    if (data.error === 'invalid_token' || data.error === 'forbidden') {
      clearToken();
      await UC_Auth.requireSignIn();
      return apiCall(action, params, body);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  // ============================================================
  // Login overlay UI
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
        <div id="uc-google-btn" style="display:flex;justify-content:center;min-height:44px;"></div>
        <p id="uc-login-error" style="color:#a33;margin:24px 0 0;font-size:13px;display:none;font-family:system-ui,sans-serif;"></p>
        <p id="uc-login-loading" style="color:#888;margin:24px 0 0;font-size:13px;display:none;font-family:system-ui,sans-serif;">Verificando…</p>
      </div>
    `;
    document.body.appendChild(overlay);
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
  // Google Identity Services (GIS) bootstrap
  // ============================================================

  let gsiInitialized = false;
  let signInResolver = null;

  function waitForGsi() {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (window.google && google.accounts && google.accounts.id) return resolve();
        if (Date.now() - start > 8000) return reject(new Error('gsi_load_timeout'));
        setTimeout(tick, 80);
      })();
    });
  }

  async function initGsi() {
    if (gsiInitialized) return;
    await waitForGsi();
    google.accounts.id.initialize({
      client_id: cfg.OAUTH_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      ux_mode: 'popup',
      itp_support: true,
      use_fedcm_for_prompt: false,
      use_fedcm_for_button: false
    });
    gsiInitialized = true;
  }

  async function handleCredentialResponse(resp) {
    const idToken = resp && resp.credential;
    if (!idToken) { setLoginError('Resposta inválida do Google.'); return; }
    const claims = decodeJwt(idToken);
    if (!claims || !claims.exp) { setLoginError('Token inválido.'); return; }

    storeToken(idToken, claims.exp);
    setLoginLoading(true);

    try {
      const url = new URL(cfg.WEB_APP_URL);
      url.searchParams.set('action', 'whoami');
      url.searchParams.set('token', idToken);
      const r = await fetch(url.toString());
      const data = await r.json();
      if (!data.authorized) {
        clearToken();
        const who = data.email || claims.email || '(desconhecido)';
        setLoginError(`${who} não tem acesso a este sistema. Peça ao administrador para liberar.`);
        return;
      }
      const user = {
        email: data.email,
        name: data.name || claims.name,
        picture: data.picture || claims.picture,
        role: data.role
      };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      hideLoginOverlay();
      if (signInResolver) {
        const r = signInResolver;
        signInResolver = null;
        r(user);
      }
    } catch (err) {
      setLoginError('Erro de comunicação: ' + err.message);
    }
  }

  async function requireSignIn() {
    const tok = getStoredToken();
    if (tok) {
      const stored = localStorage.getItem(USER_KEY);
      if (stored) return JSON.parse(stored);
    }
    showLoginOverlay();
    try {
      await initGsi();
      const btn = document.getElementById('uc-google-btn');
      if (btn) {
        btn.innerHTML = '';
        google.accounts.id.renderButton(btn, {
          theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular',
          locale: 'pt-BR'
        });
      }
    } catch (err) {
      setLoginError('Falha ao carregar login Google: ' + err.message);
    }
    return new Promise((resolve) => { signInResolver = resolve; });
  }

  function signOut() {
    clearToken();
    if (window.google && google.accounts && google.accounts.id) {
      try { google.accounts.id.disableAutoSelect(); } catch (_) {}
    }
    window.location.reload();
  }

  function getUser() {
    const s = localStorage.getItem(USER_KEY);
    return s ? JSON.parse(s) : null;
  }

  window.UC_Auth = { requireSignIn, signOut, getUser, getToken: getStoredToken };
  window.UC_API = { call: apiCall };

  // ============================================================
  // RemoteDB — espelha a API do DB local (IndexedDB) chamando o backend.
  // ============================================================

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

  // Cache leve em memória (somente durante a sessão da página) para evitar
  // refetch redundante no mesmo render. Invalidado em qualquer escrita.
  const cache = new Map();
  const CACHE_TTL = 5 * 1000; // 5s

  function cacheKey(entity) { return 'getAll:' + entity; }
  function cacheGet(k) {
    const v = cache.get(k);
    if (!v) return null;
    if (Date.now() - v.t > CACHE_TTL) { cache.delete(k); return null; }
    return v.r;
  }
  function cacheSet(k, r) { cache.set(k, { t: Date.now(), r }); }
  function invalidate(entity) { cache.delete(cacheKey(entity)); }

  async function getAll_(entity) {
    const k = cacheKey(entity);
    const c = cacheGet(k);
    if (c) return c;
    const r = await apiCall('getAll', { entity });
    const records = r.records || [];
    cacheSet(k, records);
    return records;
  }

  async function upsert_(entity, record) {
    const r = await apiCall('upsert', null, { entity, record });
    invalidate(entity);
    return r.record;
  }

  async function softDelete_(entity, id) {
    await apiCall('softDelete', null, { entity, id });
    invalidate(entity);
  }

  const RemoteDB = {
    // Processos
    async getAllProcesses()    { return await getAll_('Processos'); },
    async getProcess(id)       { return (await getAll_('Processos')).find(p => p.id === id) || null; },
    async saveProcess(p)       {
      p.updatedAt = Date.now();
      if (!p.createdAt) p.createdAt = p.updatedAt;
      return await upsert_('Processos', p);
    },
    async deleteProcess(id) {
      await softDelete_('Processos', id);
      // cascade: marca relacionados como deletados
      for (const ent of ['Eventos', 'Prazos', 'Notas', 'Jurisprudencia']) {
        const items = (await getAll_(ent)).filter(x => x.processId === id);
        for (const it of items) await softDelete_(ent, it.id);
      }
    },

    // Eventos
    async getEventsByProcess(pid) { return (await getAll_('Eventos')).filter(e => e.processId === pid); },
    async saveEvent(e)            { return await upsert_('Eventos', e); },
    async deleteEvent(id)         { return await softDelete_('Eventos', id); },

    // Prazos (deadlines)
    async getAllDeadlines()       { return await getAll_('Prazos'); },
    async getDeadlinesByProcess(pid) { return (await getAll_('Prazos')).filter(d => d.processId === pid); },
    async saveDeadline(d)         { return await upsert_('Prazos', d); },
    async deleteDeadline(id)      { return await softDelete_('Prazos', id); },

    // Notas
    async getNotesByProcess(pid)  { return (await getAll_('Notas')).filter(n => n.processId === pid); },
    async saveNote(n)             { return await upsert_('Notas', n); },
    async deleteNote(id)          { return await softDelete_('Notas', id); },

    // Jurisprudência
    async getJurisprudenceByProcess(pid) { return (await getAll_('Jurisprudencia')).filter(j => j.processId === pid); },
    async saveJurisprudence(j)    { return await upsert_('Jurisprudencia', j); },

    // PDFs (Drive folder)
    async getPdf(id) {
      try {
        const r = await apiCall('getPdfUrl', { pdfId: id });
        if (!r || !r.downloadUrl) return null;
        // Drive download URLs requerem auth do dono; melhor expor via fileId pelo Drive viewer.
        return { id, name: r.name, fileId: r.fileId, downloadUrl: r.downloadUrl };
      } catch (_) { return null; }
    },
    async savePdf(pdf) {
      const base64 = await blobToBase64(pdf.blob);
      const r = await apiCall('uploadPdf', null, {
        pdfId: pdf.id,
        filename: pdf.name || (pdf.id + '.pdf'),
        base64,
        processId: pdf.processId || null
      });
      return { ...pdf, fileId: r.fileId };
    },
    async deletePdf(_id) { /* sem endpoint dedicado por enquanto */ },

    // Prompts — mantidos LOCAIS (templates de IA, per-browser).
    // Dependem de openDB() / dbPromise estarem inicializados (estão, no bootApp).
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

    // Settings (compartilhados)
    async getSetting(key, defaultVal = null) {
      const all = await getAll_('Settings');
      const found = all.find(s => s.chave === key);
      if (!found) return defaultVal;
      return found.value !== undefined ? found.value : defaultVal;
    },
    async setSetting(key, value) {
      await upsert_('Settings', { chave: key, value });
    },

    // History (cliente vira no-op; servidor já audita escritas em Auditoria)
    async getHistory(_limit) { return []; },
    async addHistoryEntry(_action, _data) { /* server-side */ },

    // DJEN
    async getAllDjenPublications() { return await getAll_('DJEN'); },
    async getDjenPublication(hash) {
      return (await getAll_('DJEN')).find(p => p.hash === hash) || null;
    },
    async saveDjenPublication(pub) { return await upsert_('DJEN', pub); },
    async getDjenPublicationsByProcess(processId) {
      return (await getAll_('DJEN')).filter(p => p.processId === processId);
    },
    async hasDjenPublication(hash) {
      return !!(await this.getDjenPublication(hash));
    }
  };

  window.UC_RemoteDB = RemoteDB;
})();
