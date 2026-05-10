/**
 * Lembretes.gs — Sprint 3 Fase B.2 (Módulo Prazos)
 *
 * Cron horário de envio de push notifications via FCM HTTP v1.
 * Lê prazos e settings do Firestore via REST API, calcula marco
 * (T-7..T+1), resolve destinatários (titular/suplente/sócio padrão
 * + ausências) e dispara FCM para os tokens registrados.
 *
 * Pré-requisitos (configurados em Script Properties):
 *   FCM_SERVICE_ACCOUNT_JSON — Service Account JSON do Firebase Admin
 *
 * Trigger time-driven recomendado:
 *   - Função: cron_lembretesDePrazo
 *   - Frequência: a cada 30 minutos
 *
 * Funções de teste manual:
 *   _testarFcmAccessToken() — confirma que o JWT/OAuth2 está OK
 *   _testarFirestoreList() — confirma leitura do Firestore
 *   _testarFcmEnvio()      — envia push pra um token específico
 *   _previewLembretesDePrazo() — varre como o cron mas SEM enviar
 */

const FCM_PROJECT_ID = 'uc-juridico';
const FCM_ENDPOINT = 'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/messages:send';
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const COMBINED_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore';
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/databases/(default)/documents';

const NOME_EMAIL_MAP = {
  'EDUARDO URANY DE CASTRO':       'eduardourany@uranydecastro.com.br',
  'MARCELO MENDES FRANÇA':         'marcelofranca@uranydecastro.com.br',
  'JULIANO DA COSTA FERREIRA':     'juliano@uranydecastro.com.br',
  'CLEBER RIBEIRO':                'cleber@uranydecastro.com.br',
  'MARKO ANTONIO DUARTE':          'markoduarte@uranydecastro.com.br',
  'SARA CAROLINA URANY DE CASTRO': 'sara@uranydecastro.com.br',
  'MARCELO BITTAR':                'marcelobittar@uranydecastro.com.br',
  'BRUNO NACIFF DA ROCHA':         'bruno@uranydecastro.com.br',
  'MARCOS FERNANDO SILVA':         'marcos@uranydecastro.com.br'
};

const STATUS_TERMINAIS = ['cumprido', 'perdido', 'cancelado'];
const MARCO_LABELS = {
  'T-7': '⏰ Prazo em ≤7 dias',
  'T-3': '⏰ Prazo em 3 dias',
  'T-2': '⚠ Prazo em 2 dias',
  'T-1': '🚨 Prazo AMANHÃ',
  'T-0': '🚨🚨 Prazo HOJE',
  'T+1': '✗ Prazo VENCEU'
};

// =====================================================================
// OAuth2 — gera access token via JWT do Service Account
// =====================================================================

/**
 * Gera (ou retorna do cache) access token Google com scopes
 * firebase.messaging + datastore. Cacheado por 50 min.
 */
function _getGoogleAccessToken() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('google_access_token_combined');
  if (cached) return cached;

  const json = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_JSON');
  if (!json) throw new Error('FCM_SERVICE_ACCOUNT_JSON não está em Script Properties');
  const sa = JSON.parse(json);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: COMBINED_SCOPE,
    aud: OAUTH_TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600
  };
  const encHeader = _b64UrlEncode(JSON.stringify(header));
  const encClaims = _b64UrlEncode(JSON.stringify(claims));
  const toSign = encHeader + '.' + encClaims;
  const signature = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  const encSig = _b64UrlEncodeBytes(signature);
  const assertion = toSign + '.' + encSig;

  const resp = UrlFetchApp.fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('Token OAuth2 falhou (' + code + '): ' + resp.getContentText());
  }
  const data = JSON.parse(resp.getContentText());
  if (!data.access_token) throw new Error('Resposta OAuth2 sem access_token');

  cache.put('google_access_token_combined', data.access_token, 50 * 60);
  return data.access_token;
}

function _b64UrlEncode(s) {
  return Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
}

function _b64UrlEncodeBytes(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

// =====================================================================
// Firestore REST — encode/decode entre JS e formato Firestore
// =====================================================================

function _firestoreEncode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(_firestoreEncode) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = _firestoreEncode(v[k]);
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(v) };
}

function _firestoreDecode(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(_firestoreDecode);
  if ('mapValue' in v) {
    const out = {};
    const f = (v.mapValue && v.mapValue.fields) || {};
    for (const k of Object.keys(f)) out[k] = _firestoreDecode(f[k]);
    return out;
  }
  return null;
}

function _firestoreDecodeDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  for (const k of Object.keys(doc.fields)) out[k] = _firestoreDecode(doc.fields[k]);
  // doc.name = "projects/X/databases/Y/documents/collection/id"
  if (doc.name) {
    const parts = doc.name.split('/');
    out._docId = parts[parts.length - 1];
    out._docPath = doc.name.substring(doc.name.indexOf('/documents/') + '/documents/'.length);
  }
  return out;
}

/**
 * Lista todos os documentos de uma collection. Pagina automaticamente.
 * Path relativo: 'prazos', 'processos', etc.
 */
function _firestoreList(collectionPath) {
  const accessToken = _getGoogleAccessToken();
  const out = [];
  let pageToken = null;
  do {
    const url = FIRESTORE_BASE + '/' + collectionPath + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      throw new Error('Firestore list ' + collectionPath + ' falhou (' + resp.getResponseCode() + '): ' + resp.getContentText());
    }
    const data = JSON.parse(resp.getContentText());
    (data.documents || []).forEach(d => {
      const decoded = _firestoreDecodeDoc(d);
      if (decoded) out.push(decoded);
    });
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return out;
}

/**
 * Lê um único documento. path = "settings/fcmTokens" etc.
 * Retorna null se o doc não existir.
 */
function _firestoreGet(path) {
  const accessToken = _getGoogleAccessToken();
  const url = FIRESTORE_BASE + '/' + path;
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() === 404) return null;
  if (resp.getResponseCode() !== 200) {
    throw new Error('Firestore get ' + path + ' falhou (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  return _firestoreDecodeDoc(JSON.parse(resp.getContentText()));
}

/**
 * Roda uma query estruturada (Firestore :runQuery). Mais eficiente que list
 * quando só precisamos de docs filtrados por campo (cobra só os retornados).
 * filters = [{ field, op, value }, ...] — op: GREATER_THAN_OR_EQUAL, etc.
 * deadlineDate é ISO string — comparação lexicográfica = ordem cronológica.
 */
function _firestoreQuery(collectionId, filters, limit) {
  const accessToken = _getGoogleAccessToken();
  const filterObjs = filters.map(f => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op,
      value: _firestoreEncode(f.value)
    }
  }));
  const where = filterObjs.length === 1 ? filterObjs[0]
    : { compositeFilter: { op: 'AND', filters: filterObjs } };
  const query = {
    structuredQuery: {
      from: [{ collectionId: collectionId }],
      where: where,
      limit: limit || 1000
    }
  };
  const url = FIRESTORE_BASE + ':runQuery';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify(query),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Firestore runQuery ' + collectionId + ' falhou (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  const arr = JSON.parse(resp.getContentText());
  return arr.filter(r => r.document).map(r => _firestoreDecodeDoc(r.document));
}

/**
 * Atualiza campos específicos de um doc. fieldsObj é objeto JS plano.
 * Usa updateMask pra patch parcial — não toca campos não listados.
 */
function _firestoreUpdate(path, fieldsObj) {
  const accessToken = _getGoogleAccessToken();
  const fields = {};
  for (const k of Object.keys(fieldsObj)) fields[k] = _firestoreEncode(fieldsObj[k]);
  const mask = Object.keys(fieldsObj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const url = FIRESTORE_BASE + '/' + path + '?' + mask;
  const resp = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Firestore update ' + path + ' falhou (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  return _firestoreDecodeDoc(JSON.parse(resp.getContentText()));
}

// =====================================================================
// FCM HTTP v1 — envio
// =====================================================================

/**
 * Envia push FCM. Retorna { ok, response } ou { ok: false, code, response }.
 * Payload data-only — o firebase-messaging-sw.js renderiza a Notification.
 */
function enviarFcmPush(token, title, body, data) {
  const accessToken = _getGoogleAccessToken();
  data = data || {};
  // FCM exige todos os valores em data como string
  const dataPayload = { title: String(title || ''), body: String(body || '') };
  for (const k of Object.keys(data)) dataPayload[k] = String(data[k]);

  const payload = {
    message: {
      token: token,
      data: dataPayload
    }
  };
  const resp = UrlFetchApp.fetch(FCM_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  const respText = resp.getContentText();
  if (code === 200) return { ok: true, response: JSON.parse(respText) };
  return { ok: false, code: code, response: respText };
}

// =====================================================================
// Cron — varre prazos e envia lembretes
// =====================================================================

/**
 * Replica a lógica de marcoDoPrazo do client. Faixas exclusivas.
 */
function _marcoDoPrazo(d, todayMs) {
  if (!d || !d.deadlineDate) return null;
  if (STATUS_TERMINAIS.indexOf(d.status) >= 0) return null;
  if (d.status === 'suspenso') return null;
  const dl = typeof d.deadlineDate === 'number' ? d.deadlineDate : new Date(d.deadlineDate).getTime();
  const days = Math.ceil((dl - todayMs) / 86400000);
  if (days >= 4 && days <= 7) return 'T-7';
  if (days === 3) return 'T-3';
  if (days === 2) return 'T-2';
  if (days === 1) return 'T-1';
  if (days === 0) return 'T-0';
  if (days === -1) return 'T+1';
  return null;
}

/**
 * Replica rotearDestinatarios do client.
 */
function _rotearDestinatarios(titular, suplente, socio, marco, titularAusente) {
  const principal = (titularAusente && suplente) ? suplente : titular;
  const cobertura = (titularAusente && suplente) ? titular : suplente;
  let lista = [];
  if (['T-7','T-3','T-2'].indexOf(marco) >= 0) lista = [principal];
  else if (marco === 'T-1') lista = [principal, cobertura];
  else if (marco === 'T-0' || marco === 'T+1') lista = [principal, cobertura, socio];
  else lista = [principal];
  // dedup + remove vazios
  const seen = {};
  const out = [];
  lista.forEach(x => { if (x && !seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

/**
 * Trigger time-driven principal. Idempotente (anti-spam por marco/email).
 *
 * Otimizado v6.14.1: usa runQuery filtrando deadlineDate em janela
 * [hoje-2, hoje+8] dias. Reduz de ~2342 reads/exec (list completo)
 * pra ~85 reads/exec. A janela cobre todos os marcos T-7..T+1 com folga.
 */
function cron_lembretesDePrazo() {
  const startTime = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();

  // Janela: 2 dias atrás (cobre T+1) até 8 dias à frente (cobre T-7).
  // deadlineDate é ISO string — comparação lexicográfica = ordem cronológica.
  const janelaInicio = new Date(todayMs - 2 * 86400000).toISOString();
  const janelaFim = new Date(todayMs + 8 * 86400000).toISOString();

  const prazos = _firestoreQuery('prazos', [
    { field: 'deadlineDate', op: 'GREATER_THAN_OR_EQUAL', value: janelaInicio },
    { field: 'deadlineDate', op: 'LESS_THAN_OR_EQUAL', value: janelaFim }
  ], 500);

  // Buscar processos só dos prazos retornados (1 fetch por id único)
  const processIdsUnicos = [];
  const seenPid = {};
  prazos.forEach(d => { if (d.processId && !seenPid[d.processId]) { seenPid[d.processId] = true; processIdsUnicos.push(d.processId); } });
  const processos = {};
  for (const pid of processIdsUnicos) {
    try {
      const proc = _firestoreGet('processos/' + pid);
      if (proc) processos[pid] = proc;
    } catch (e) {
      Logger.log('Falha ao buscar processo ' + pid + ': ' + e.message);
    }
  }

  const fcmTokensDoc = _firestoreGet('settings/fcmTokens') || {};
  const fcmTokens = (fcmTokensDoc && fcmTokensDoc.value) || {};
  const ausenciasDoc = _firestoreGet('settings/advogadosAusencias') || {};
  const ausencias = (ausenciasDoc && ausenciasDoc.value) || {};
  const socioDoc = _firestoreGet('settings/socioPadraoNome') || {};
  const socio = (socioDoc && socioDoc.value) || null;

  let processados = 0, enviados = 0, erros = 0, ignorados = 0;
  let tokensRemovidos = false;

  for (const d of prazos) {
    const marco = _marcoDoPrazo(d, todayMs);
    if (!marco) { ignorados++; continue; }

    const proc = processos[d.processId];
    if (!proc) { ignorados++; continue; }

    const titular = proc.advogadoResponsavel || null;
    const suplente = proc.advogadoSuplente || null;

    const titAus = titular ? ausencias[titular] : null;
    const titularAusente = !!titAus &&
      (!titAus.ate || new Date(titAus.ate + 'T23:59:59').getTime() >= todayMs);

    const destinatariosNomes = _rotearDestinatarios(titular, suplente, socio, marco, titularAusente);
    if (!destinatariosNomes.length) { ignorados++; continue; }

    let alterado = false;
    const notificado = d.notificado || {};
    notificado[marco] = notificado[marco] || {};

    for (const nome of destinatariosNomes) {
      const email = NOME_EMAIL_MAP[nome];
      if (!email) continue;
      if (notificado[marco][email]) continue;  // anti-spam

      const tokenInfo = fcmTokens[email];
      if (!tokenInfo || !tokenInfo.token) continue;

      const title = MARCO_LABELS[marco] || ('Prazo ' + marco);
      const body = (d.description || d.type || 'Prazo') + ' · vence ' +
        (typeof d.deadlineDate === 'string' ? d.deadlineDate.slice(0,10) : new Date(d.deadlineDate).toISOString().slice(0,10));
      const url = 'https://eduardourany-dot.github.io/uc-juridico/#process/' + proc._docId;
      const requireInteraction = ['T-1','T-0','T+1'].indexOf(marco) >= 0 ? 'true' : 'false';

      processados++;
      try {
        const r = enviarFcmPush(tokenInfo.token, title, body, {
          tag: 'prazo-' + d._docId + '-' + marco,
          url: url,
          requireInteraction: requireInteraction,
          processId: proc._docId,
          prazoId: d._docId,
          marco: marco
        });
        if (r.ok) {
          enviados++;
          notificado[marco][email] = Date.now();
          alterado = true;
        } else {
          erros++;
          Logger.log('FCM falha pra ' + email + ' marco ' + marco + ': ' + r.code + ' ' + r.response);
          // Token inválido → remove pra próxima rodada e re-registro do client
          if (r.code === 404 || (r.code === 400 && /UNREGISTERED|INVALID_ARGUMENT|registration/i.test(r.response))) {
            delete fcmTokens[email];
            tokensRemovidos = true;
          }
        }
      } catch (e) {
        erros++;
        Logger.log('FCM exceção para ' + email + ' marco ' + marco + ': ' + e.message);
      }
    }

    if (alterado) {
      try {
        _firestoreUpdate('prazos/' + d._docId, { notificado: notificado, updatedAt: Date.now() });
      } catch (e) {
        Logger.log('update prazo ' + d._docId + ' falhou: ' + e.message);
      }
    }
  }

  // Persiste fcmTokens limpo se tirou algum
  if (tokensRemovidos) {
    try {
      _firestoreUpdate('settings/fcmTokens', { value: fcmTokens, updatedAt: Date.now() });
    } catch (e) {
      Logger.log('cleanup fcmTokens falhou: ' + e.message);
    }
  }

  const elapsed = Date.now() - startTime;
  const summary = 'cron_lembretesDePrazo: prazos_query=' + prazos.length +
    ' processos_fetch=' + processIdsUnicos.length +
    ' processados=' + processados +
    ' enviados=' + enviados +
    ' erros=' + erros +
    ' ignorados=' + ignorados +
    ' elapsed=' + elapsed + 'ms';
  Logger.log(summary);
  return { prazos: prazos.length, processos_fetch: processIdsUnicos.length, processados, enviados, erros, ignorados, elapsed };
}

// =====================================================================
// Funções de teste manual
// =====================================================================

function _testarFcmAccessToken() {
  try {
    const t = _getGoogleAccessToken();
    Logger.log('✓ Access token OK');
    Logger.log('  length: ' + t.length);
    Logger.log('  prefix: ' + t.slice(0, 30) + '…');
  } catch (e) {
    Logger.log('❌ Falhou: ' + e.message);
    Logger.log(e.stack);
  }
}

function _testarFirestoreList() {
  try {
    const prazos = _firestoreList('prazos');
    Logger.log('✓ Firestore list OK');
    Logger.log('  prazos: ' + prazos.length);
    if (prazos.length > 0) {
      const sample = prazos[0];
      Logger.log('  exemplo: ' + JSON.stringify({
        id: sample._docId,
        description: sample.description,
        status: sample.status,
        deadlineDate: sample.deadlineDate
      }));
    }
    const procs = _firestoreList('processos');
    Logger.log('  processos: ' + procs.length);
  } catch (e) {
    Logger.log('❌ Falhou: ' + e.message);
    Logger.log(e.stack);
  }
}

function _testarFcmEnvio() {
  // Cole um token FCM aqui (capturado via DevTools no client após permitir notificações)
  const token = 'COLE_TOKEN_FCM_AQUI';
  if (token === 'COLE_TOKEN_FCM_AQUI') {
    Logger.log('Cole o token primeiro. Pra capturar:');
    Logger.log('1. No app, abra DevTools (F12) → Console');
    Logger.log('2. Cole: window.UC_Messaging.getFcmToken().then(console.log)');
    Logger.log('3. Copie o token longo que aparecer');
    return;
  }
  const r = enviarFcmPush(token, '🧪 Teste UC Jurídico', 'Push de teste do backend', {
    url: 'https://eduardourany-dot.github.io/uc-juridico/'
  });
  Logger.log(JSON.stringify(r, null, 2));
}

function _previewLembretesDePrazo() {
  // Igual cron mas SEM enviar — útil pra ver o que seria disparado
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();

  const janelaInicio = new Date(todayMs - 2 * 86400000).toISOString();
  const janelaFim = new Date(todayMs + 8 * 86400000).toISOString();

  const prazos = _firestoreQuery('prazos', [
    { field: 'deadlineDate', op: 'GREATER_THAN_OR_EQUAL', value: janelaInicio },
    { field: 'deadlineDate', op: 'LESS_THAN_OR_EQUAL', value: janelaFim }
  ], 500);

  const processIdsUnicos = [];
  const seenPid = {};
  prazos.forEach(d => { if (d.processId && !seenPid[d.processId]) { seenPid[d.processId] = true; processIdsUnicos.push(d.processId); } });
  const processos = {};
  for (const pid of processIdsUnicos) {
    try { const proc = _firestoreGet('processos/' + pid); if (proc) processos[pid] = proc; } catch(_) {}
  }

  const ausenciasDoc = _firestoreGet('settings/advogadosAusencias') || {};
  const ausencias = (ausenciasDoc && ausenciasDoc.value) || {};
  const socioDoc = _firestoreGet('settings/socioPadraoNome') || {};
  const socio = (socioDoc && socioDoc.value) || null;
  const tokensDoc = _firestoreGet('settings/fcmTokens') || {};
  const fcmTokens = (tokensDoc && tokensDoc.value) || {};

  Logger.log('Janela: ' + janelaInicio.slice(0,10) + ' a ' + janelaFim.slice(0,10) + ' · ' + prazos.length + ' prazos · ' + processIdsUnicos.length + ' processos');

  const linhas = [];
  for (const d of prazos) {
    const marco = _marcoDoPrazo(d, todayMs);
    if (!marco) continue;
    const proc = processos[d.processId];
    if (!proc) continue;
    const titAus = proc.advogadoResponsavel ? ausencias[proc.advogadoResponsavel] : null;
    const titularAusente = !!titAus && (!titAus.ate || new Date(titAus.ate + 'T23:59:59').getTime() >= todayMs);
    const destinatariosNomes = _rotearDestinatarios(proc.advogadoResponsavel, proc.advogadoSuplente, socio, marco, titularAusente);
    const destEmails = destinatariosNomes.map(n => NOME_EMAIL_MAP[n]).filter(Boolean);
    const notificado = d.notificado || {};
    const pendentes = destEmails.filter(e => !(notificado[marco] && notificado[marco][e]));
    const semToken = pendentes.filter(e => !(fcmTokens[e] && fcmTokens[e].token));
    const enviarParaEmails = pendentes.filter(e => fcmTokens[e] && fcmTokens[e].token);
    if (pendentes.length === 0) continue;
    linhas.push({
      desc: (d.description || d.type || '').slice(0, 50),
      marco: marco,
      processo: (proc.name || '').slice(0, 40),
      destinatarios: destEmails.join(', '),
      enviar_para: enviarParaEmails.join(', ') || '—',
      sem_token: semToken.join(', ') || '—'
    });
  }
  Logger.log('Preview (sem enviar):');
  Logger.log(JSON.stringify(linhas, null, 2));
  Logger.log('Total que seria enviado: ' + linhas.reduce((s, l) => s + (l.enviar_para === '—' ? 0 : l.enviar_para.split(', ').length), 0));
}
