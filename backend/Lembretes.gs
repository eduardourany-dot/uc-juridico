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
  'CLEBER RIBEIRO':                'cleberribeiro@uranydecastro.com.br',
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
// Email — Sprint 3 Fase C (canal redundante via Gmail Workspace)
// =====================================================================
// Usa MailApp.sendEmail (Apps Script built-in) — sai como a conta logada
// (eduardourany@uranydecastro.com.br Workspace), 2000 emails/dia.
// DKIM/SPF/DMARC já configurados pelo Google Workspace pra uranydecastro.adv.br.
//
// Para migrar pra AWS SES no futuro: trocar a chamada em enviarEmail() por
// enviarEmailSES() (criar essa função com UrlFetchApp.fetch). Nada mais muda
// no resto do código.

// Marcos em que email é enviado (push é enviado em TODOS os marcos sempre).
// Email é redundância pros marcos críticos onde o push pode ser perdido.
const EMAIL_MARCOS = ['T-1', 'T-0', 'T+1'];

/**
 * Abstração de provider. Hoje: Gmail (MailApp). Amanhã: SES, se precisar.
 * Retorna { ok, error? }.
 */
function enviarEmail(destinatario, assunto, corpoHtml) {
  return enviarEmailGmail(destinatario, assunto, corpoHtml);
  // Pra migrar pra SES quando precisar:
  // return enviarEmailSES(destinatario, assunto, corpoHtml);
}

function enviarEmailGmail(destinatario, assunto, corpoHtml) {
  try {
    MailApp.sendEmail({
      to: destinatario,
      subject: assunto,
      htmlBody: corpoHtml,
      name: 'UC Jurídico — Prazos',
      replyTo: 'eduardourany@uranydecastro.com.br',
      noReply: false
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Monta { assunto, html } pro email de lembrete. HTML inline-styled
 * (clientes de email não respeitam CSS externo).
 */
function _montarEmailLembrete(marco, prazo, processo) {
  const labels = {
    'T-7': 'Prazo em até 7 dias',
    'T-3': 'Prazo em 3 dias',
    'T-2': 'Prazo em 2 dias',
    'T-1': '🚨 PRAZO AMANHÃ',
    'T-0': '🚨🚨 PRAZO HOJE',
    'T+1': '✗ PRAZO VENCIDO ONTEM'
  };
  const cores = {
    'T-7': '#4a7c4a', 'T-3': '#b87f1c', 'T-2': '#b87f1c',
    'T-1': '#a8472d', 'T-0': '#a8472d', 'T+1': '#a8472d'
  };
  const dl = (typeof prazo.deadlineDate === 'string')
    ? prazo.deadlineDate.slice(0,10)
    : new Date(prazo.deadlineDate).toISOString().slice(0,10);
  const url = 'https://uc.uranydecastro.adv.br/#process/' + processo._docId;

  const titulo = labels[marco] || marco;
  const cor = cores[marco] || '#6b6b68';
  const assunto = '[' + titulo.replace(/[🚨✗]/g, '').trim() + '] ' + (prazo.description || prazo.type || 'Prazo');

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf7; padding: 24px; border-radius: 8px; border: 1px solid #e8e3d4;">
      <div style="border-left: 4px solid ${cor}; padding-left: 16px; margin-bottom: 20px;">
        <h1 style="margin: 0 0 6px; font-size: 22px; color: ${cor}; font-weight: 600;">${_escapeEmail(titulo)}</h1>
        <p style="margin: 0; color: #1f1f1f; font-size: 15px; font-weight: 500;">${_escapeEmail(prazo.description || prazo.type || 'Prazo')}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #6b6b68; width: 130px;">Vencimento:</td><td style="padding: 6px 0; font-weight: 600; color: #1f1f1f;">${_escapeEmail(dl)}</td></tr>
        ${processo.client ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Cliente:</td><td style="padding: 6px 0;">${_escapeEmail(processo.client)}</td></tr>` : ''}
        ${(processo.cnj || processo.name) ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Processo:</td><td style="padding: 6px 0;">${_escapeEmail(processo.cnj || processo.name)}</td></tr>` : ''}
        ${prazo.tribunal && prazo.tribunal !== 'NACIONAL' ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Tribunal:</td><td style="padding: 6px 0;">${_escapeEmail(prazo.tribunal)}</td></tr>` : ''}
        ${prazo.daysAllowed ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Prazo:</td><td style="padding: 6px 0;">${prazo.daysAllowed} dias ${prazo.unidade === 'CORRIDOS' ? 'corridos' : 'úteis'}${prazo.emDobro ? ' (em dobro)' : ''}</td></tr>` : ''}
        ${prazo.diarioCalculo ? `<tr><td style="padding: 6px 0; color: #6b6b68; vertical-align: top;">Cálculo:</td><td style="padding: 6px 0; color: #6b6b68; font-size: 12px;">${_escapeEmail(prazo.diarioCalculo)}</td></tr>` : ''}
      </table>

      <a href="${url}" style="display: inline-block; background: #8a6f3d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">Abrir prazo no UC Jurídico →</a>

      <p style="color: #6b6b68; font-size: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e8e3d4;">
        Você está recebendo este email porque é destinatário deste prazo no UC Jurídico (titular, suplente ou sócio padrão).
        Para parar de receber sobre este prazo, marque-o como cumprido no app com o número de protocolo.
      </p>

      <p style="color: #9b9b96; font-size: 11px; margin-top: 12px; text-align: center;">
        UC Jurídico · Urany de Castro Advocacia · 30 anos
      </p>
    </div>
  `;

  return { assunto, html };
}

function _escapeEmail(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Teste manual — envia email de exemplo. Cole o destinatário na constante.
 */
function _testarEmailEnvio() {
  const destinatario = 'eduardourany@uranydecastro.com.br';
  const prazoFake = {
    description: '[TESTE] Contestação · Vara cível',
    deadlineDate: new Date(Date.now() + 24*3600*1000).toISOString(),
    daysAllowed: 15, unidade: 'UTEIS', emDobro: false, tribunal: 'TJGO',
    diarioCalculo: 'Publicado 09/05/2026 (sex). Marco inicial 12/05/2026 (seg). Prazo: 15 dias úteis. Data fatal: 02/06/2026.'
  };
  const procFake = {
    client: 'Cliente Teste',
    cnj: '0000000-00.0000.0.00.0000',
    name: 'Processo Teste',
    _docId: 'teste123'
  };
  const conteudo = _montarEmailLembrete('T-1', prazoFake, procFake);
  Logger.log('Assunto: ' + conteudo.assunto);
  Logger.log('Enviando para: ' + destinatario);
  const r = enviarEmail(destinatario, conteudo.assunto, conteudo.html);
  Logger.log(JSON.stringify(r));
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
      if (notificado[marco][email]) continue;  // anti-spam (por marco/email)

      let pushOk = false, emailOk = false;
      const tokenInfo = fcmTokens[email];
      const enviarEmailNesteMarco = EMAIL_MARCOS.indexOf(marco) >= 0;

      // ---------- Canal 1: Push FCM (todos os marcos, se tem token) ----------
      if (tokenInfo && tokenInfo.token) {
        processados++;
        try {
          const title = MARCO_LABELS[marco] || ('Prazo ' + marco);
          const body = (d.description || d.type || 'Prazo') + ' · vence ' +
            (typeof d.deadlineDate === 'string' ? d.deadlineDate.slice(0,10) : new Date(d.deadlineDate).toISOString().slice(0,10));
          const url = 'https://uc.uranydecastro.adv.br/#process/' + proc._docId;
          const requireInteraction = ['T-1','T-0','T+1'].indexOf(marco) >= 0 ? 'true' : 'false';
          const r = enviarFcmPush(tokenInfo.token, title, body, {
            tag: 'prazo-' + d._docId + '-' + marco,
            url: url,
            requireInteraction: requireInteraction,
            processId: proc._docId,
            prazoId: d._docId,
            marco: marco
          });
          if (r.ok) {
            pushOk = true;
          } else {
            erros++;
            Logger.log('FCM falha pra ' + email + ' marco ' + marco + ': ' + r.code + ' ' + r.response);
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

      // ---------- Canal 2: Email Gmail ----------
      // Envia email se: marco crítico (T-1/T-0/T+1) OU push falhou/sem token (fallback).
      const precisaEmail = enviarEmailNesteMarco || (!pushOk && !tokenInfo);
      if (precisaEmail) {
        try {
          const conteudo = _montarEmailLembrete(marco, d, proc);
          const r = enviarEmail(email, conteudo.assunto, conteudo.html);
          if (r.ok) {
            emailOk = true;
          } else {
            erros++;
            Logger.log('Email falha pra ' + email + ' marco ' + marco + ': ' + r.error);
          }
        } catch (e) {
          erros++;
          Logger.log('Email exceção para ' + email + ' marco ' + marco + ': ' + e.message);
        }
      }

      // Anti-spam: marca notificado se ALGUM canal funcionou
      if (pushOk || emailOk) {
        notificado[marco][email] = { at: Date.now(), push: pushOk, email: emailOk };
        alterado = true;
        enviados++;
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
// Cron — varre parcelas de honorários e envia lembretes (Sprint A.5)
// =====================================================================

const PARCELA_MARCO_LABELS = {
  'T-7': '💰 Parcela em ≤7 dias',
  'T-3': '💰 Parcela em 3 dias',
  'T-2': '⚠ Parcela em 2 dias',
  'T-1': '🔔 Parcela vence AMANHÃ',
  'T-0': '🔔🔔 Parcela vence HOJE',
  'T+1': '⚠ Parcela vencida ontem'
};

const PARCELA_EMAIL_MARCOS = ['T-1', 'T-0', 'T+1'];

// Calcula marco de uma parcela. Faixas exclusivas (mesmas regras dos prazos).
function _marcoDeParcela(parcela, todayMs) {
  if (!parcela || parcela.status === 'pago') return null;
  if (!parcela.vencimento) return null;
  const dl = typeof parcela.vencimento === 'number'
    ? parcela.vencimento
    : new Date(parcela.vencimento + 'T12:00:00').getTime();
  const days = Math.ceil((dl - todayMs) / 86400000);
  if (days >= 4 && days <= 7) return 'T-7';
  if (days === 3) return 'T-3';
  if (days === 2) return 'T-2';
  if (days === 1) return 'T-1';
  if (days === 0) return 'T-0';
  if (days === -1) return 'T+1';
  return null;
}

// Resolve destinatários para parcela:
// - Advogado titular do primeiro processo coberto (se houver)
// - Suplente desse processo (se houver)
// - Sócio padrão (sempre, em marcos T-1/T-0/T+1)
// Se honorário não tem processosCobertos: cai apenas no sócio padrão.
function _rotearDestinatariosParcela(honorario, processos, ausencias, socio, marco, todayMs) {
  let titular = null, suplente = null;
  const procsCobertos = (honorario.processosCobertos || []).map(pid => processos[pid]).filter(Boolean);
  // Se há processo legado processoId (compat) e não está em processosCobertos
  if (!procsCobertos.length && honorario.processoId && processos[honorario.processoId]) {
    procsCobertos.push(processos[honorario.processoId]);
  }
  if (procsCobertos.length) {
    titular = procsCobertos[0].advogadoResponsavel || null;
    suplente = procsCobertos[0].advogadoSuplente || null;
  }

  const titAus = titular ? ausencias[titular] : null;
  const titularAusente = !!titAus &&
    (!titAus.ate || new Date(titAus.ate + 'T23:59:59').getTime() >= todayMs);

  // Reaproveita _rotearDestinatarios mas adapta lista por marco específico
  // de parcela (mesmos marcos T-7..T+1 dos prazos).
  return _rotearDestinatarios(titular, suplente, socio, marco, titularAusente);
}

/**
 * Monta corpo HTML do email de parcela (similar ao de prazo).
 */
function _montarEmailParcela(marco, honorario, parcela, processosCobertos) {
  const labels = {
    'T-7': 'Parcela em até 7 dias',
    'T-3': 'Parcela em 3 dias',
    'T-2': 'Parcela em 2 dias',
    'T-1': '🔔 PARCELA VENCE AMANHÃ',
    'T-0': '🔔🔔 PARCELA VENCE HOJE',
    'T+1': '⚠ PARCELA VENCIDA ONTEM'
  };
  const cores = {
    'T-7': '#4a7c4a', 'T-3': '#b87f1c', 'T-2': '#b87f1c',
    'T-1': '#a8472d', 'T-0': '#a8472d', 'T+1': '#a8472d'
  };
  const titulo = labels[marco] || marco;
  const cor = cores[marco] || '#6b6b68';
  const cliente = honorario.clienteNome || '—';
  const valor = Number(parcela.valor || 0).toFixed(2).replace('.', ',');
  const procsLabel = processosCobertos.map(p => p.cnj || p.name || '—').join(', ') || 'sem processo específico';
  const assunto = '[' + titulo.replace(/[🔔⚠]/g, '').trim() + '] ' + cliente + ' · parcela ' +
    parcela.numero + '/' + (honorario.parcelas?.length || 1);

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf7; padding: 24px; border-radius: 8px; border: 1px solid #e8e3d4;">
      <div style="border-left: 4px solid ${cor}; padding-left: 16px; margin-bottom: 20px;">
        <h1 style="margin: 0 0 6px; font-size: 22px; color: ${cor}; font-weight: 600;">${_escapeEmail(titulo)}</h1>
        <p style="margin: 0; color: #1f1f1f; font-size: 15px; font-weight: 500;">${_escapeEmail(cliente)} — parcela ${parcela.numero}/${honorario.parcelas?.length || 1}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #6b6b68; width: 130px;">Vencimento:</td><td style="padding: 6px 0; font-weight: 600; color: #1f1f1f;">${_escapeEmail(parcela.vencimento || '')}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b6b68;">Valor:</td><td style="padding: 6px 0; font-weight: 600; color: ${cor};">R$ ${valor}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b6b68;">Cliente:</td><td style="padding: 6px 0;">${_escapeEmail(cliente)}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b6b68;">Tipo:</td><td style="padding: 6px 0;">${_escapeEmail(honorario.tipoHonorario || 'fixo')}</td></tr>
        <tr><td style="padding: 6px 0; color: #6b6b68;">Processo(s):</td><td style="padding: 6px 0; font-size: 12px;">${_escapeEmail(procsLabel)}</td></tr>
        ${honorario.observacoes ? `<tr><td style="padding: 6px 0; color: #6b6b68; vertical-align: top;">Obs:</td><td style="padding: 6px 0; color: #6b6b68; font-size: 12px;">${_escapeEmail(honorario.observacoes)}</td></tr>` : ''}
      </table>
      <a href="https://uc.uranydecastro.adv.br/#cliente/${_escapeEmail(honorario.clienteId || '')}" style="display: inline-block; background: #8a6f3d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">Abrir cliente no UC Jurídico →</a>
      <p style="color: #6b6b68; font-size: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e8e3d4;">
        Lembrete automático sobre parcela de honorário. Confirme o pagamento ou marque a parcela como paga no app pra parar de receber este lembrete.
      </p>
      <p style="color: #9b9b96; font-size: 11px; margin-top: 12px; text-align: center;">
        UC Jurídico · Urany de Castro Advocacia · 30 anos
      </p>
    </div>
  `;
  return { assunto, html };
}

/**
 * Trigger principal de parcelas. Chame paralelo ao cron_lembretesDePrazo
 * (ou crie segundo trigger time-driven). Idempotente via parcela.notificado.
 */
function cron_lembretesDeParcelas() {
  const startTime = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();

  // Lista todos os honorários (escritório tem dezenas, não centenas — list é OK)
  const honorarios = _firestoreList('honorarios');
  if (honorarios.length === 0) {
    Logger.log('cron_lembretesDeParcelas: nenhum honorário cadastrado');
    return { honorarios: 0, processados: 0, enviados: 0, erros: 0, elapsed: Date.now() - startTime };
  }

  // Coleta processoIds únicos (legado + processosCobertos)
  const procIds = {};
  honorarios.forEach(h => {
    if (h.processoId) procIds[h.processoId] = true;
    (h.processosCobertos || []).forEach(pid => { if (pid) procIds[pid] = true; });
  });
  const processos = {};
  for (const pid of Object.keys(procIds)) {
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

  let processados = 0, enviados = 0, erros = 0, ignorados = 0, semCobertura = 0;
  let tokensRemovidos = false;

  for (const h of honorarios) {
    let alterouHonorario = false;
    const parcelas = h.parcelas || [];
    if (!parcelas.length) { ignorados++; continue; }

    const procsCobertos = (h.processosCobertos || []).map(pid => processos[pid]).filter(Boolean);
    if (!procsCobertos.length && h.processoId && processos[h.processoId]) {
      procsCobertos.push(processos[h.processoId]);
    }

    for (const parc of parcelas) {
      const marco = _marcoDeParcela(parc, todayMs);
      if (!marco) continue;

      const destinatariosNomes = _rotearDestinatariosParcela(h, processos, ausencias, socio, marco, todayMs);
      if (!destinatariosNomes.length) { semCobertura++; continue; }

      const notificado = parc.notificado || {};
      notificado[marco] = notificado[marco] || {};

      let alterouParcela = false;
      const enviarEmailNesteMarco = PARCELA_EMAIL_MARCOS.indexOf(marco) >= 0;

      for (const nome of destinatariosNomes) {
        const email = NOME_EMAIL_MAP[nome];
        if (!email) continue;
        if (notificado[marco][email]) continue;  // anti-spam

        let pushOk = false, emailOk = false;
        const tokenInfo = fcmTokens[email];
        const procPrincipal = procsCobertos[0];

        // Push FCM
        if (tokenInfo && tokenInfo.token) {
          processados++;
          try {
            const title = PARCELA_MARCO_LABELS[marco] || ('Parcela ' + marco);
            const body = (h.clienteNome || '—') + ' · parcela ' + parc.numero + '/' + parcelas.length +
              ' · R$ ' + Number(parc.valor || 0).toFixed(2).replace('.', ',');
            const url = 'https://uc.uranydecastro.adv.br/#cliente/' + (h.clienteId || '');
            const requireInteraction = ['T-1','T-0','T+1'].indexOf(marco) >= 0 ? 'true' : 'false';
            const r = enviarFcmPush(tokenInfo.token, title, body, {
              tag: 'parcela-' + h.id + '-' + parc.numero + '-' + marco,
              url: url,
              requireInteraction: requireInteraction,
              clienteId: h.clienteId || '',
              honorarioId: h.id,
              parcelaNumero: String(parc.numero),
              marco: marco
            });
            if (r.ok) {
              pushOk = true;
            } else {
              erros++;
              Logger.log('FCM parcela falha pra ' + email + ' marco ' + marco + ': ' + r.code + ' ' + r.response);
              if (r.code === 404 || (r.code === 400 && /UNREGISTERED|INVALID_ARGUMENT|registration/i.test(r.response))) {
                delete fcmTokens[email];
                tokensRemovidos = true;
              }
            }
          } catch (e) {
            erros++;
            Logger.log('FCM parcela exceção ' + email + ' ' + marco + ': ' + e.message);
          }
        }

        // Email (marcos críticos OU fallback se push não rolou)
        if (enviarEmailNesteMarco || (!pushOk && !tokenInfo)) {
          try {
            const conteudo = _montarEmailParcela(marco, h, parc, procsCobertos);
            const r = enviarEmail(email, conteudo.assunto, conteudo.html);
            if (r.ok) {
              emailOk = true;
            } else {
              erros++;
              Logger.log('Email parcela falha pra ' + email + ' ' + marco + ': ' + r.error);
            }
          } catch (e) {
            erros++;
            Logger.log('Email parcela exceção ' + email + ' ' + marco + ': ' + e.message);
          }
        }

        if (pushOk || emailOk) {
          notificado[marco][email] = { at: Date.now(), push: pushOk, email: emailOk };
          alterouParcela = true;
          enviados++;
        }
      }

      if (alterouParcela) {
        parc.notificado = notificado;
        alterouHonorario = true;
      }
    }

    if (alterouHonorario) {
      try {
        _firestoreUpdate('honorarios/' + h._docId, { parcelas: parcelas, updatedAt: Date.now() });
      } catch (e) {
        Logger.log('update honorário ' + h._docId + ' falhou: ' + e.message);
      }
    }
  }

  if (tokensRemovidos) {
    try {
      _firestoreUpdate('settings/fcmTokens', { value: fcmTokens, updatedAt: Date.now() });
    } catch (e) {
      Logger.log('cleanup fcmTokens (parcelas) falhou: ' + e.message);
    }
  }

  const elapsed = Date.now() - startTime;
  const summary = 'cron_lembretesDeParcelas: honorarios=' + honorarios.length +
    ' processados=' + processados +
    ' enviados=' + enviados +
    ' erros=' + erros +
    ' ignorados=' + ignorados +
    ' semCobertura=' + semCobertura +
    ' elapsed=' + elapsed + 'ms';
  Logger.log(summary);
  return { honorarios: honorarios.length, processados, enviados, erros, ignorados, semCobertura, elapsed };
}

// =====================================================================
// MÓDULO COMPROMISSOS (Sprint Agenda v6.25+) ===========================
// =====================================================================

const COMPROMISSO_MARCO_LABELS = {
  'T-1': '📅 Compromisso AMANHÃ',
  'T-0': '📅 Compromisso HOJE',
  'T+1': '✗ Compromisso de ontem (não marcado)'
};

const COMPROMISSO_EMAIL_MARCOS = ['T-1', 'T-0'];

const COMPROMISSO_TIPO_LABELS = {
  'audiencia': '⚖ Audiência',
  'reuniao_cliente': '👥 Reunião com cliente',
  'reuniao_interna': '👥 Reunião interna',
  'diligencia': '🚗 Diligência',
  'prazo_admin': '📋 Prazo administrativo',
  'outro': '📌 Compromisso'
};

const COMPROMISSO_STATUS_TERMINAIS = ['cancelado', 'realizado'];

// Marco do compromisso: T-1 (véspera), T-0 (dia), T+1 (atrasado pra
// marcar como realizado/cancelado).
function _marcoDoCompromisso(c, todayMs) {
  if (!c || !c.dataHoraInicio) return null;
  if (COMPROMISSO_STATUS_TERMINAIS.indexOf(c.status) >= 0) return null;
  const inicio = new Date(c.dataHoraInicio);
  inicio.setHours(0, 0, 0, 0);
  const days = Math.ceil((inicio.getTime() - todayMs) / 86400000);
  if (days === 1) return 'T-1';
  if (days === 0) return 'T-0';
  if (days === -1) return 'T+1';
  return null;
}

// Roteia destinatários do compromisso.
// - Responsável (sempre)
// - Participantes (todos)
// - Sócio padrão SÓ em T-0 quando status ainda 'agendado' (escalonamento
//   pra confirmar presença)
function _rotearDestinatariosCompromisso(c, socio, marco) {
  const lista = [];
  if (c.responsavel) lista.push(c.responsavel);
  (c.participantes || []).forEach(p => { if (p) lista.push(p); });
  if (marco === 'T-0' && c.status === 'agendado' && socio) lista.push(socio);
  // dedup
  const seen = {}, out = [];
  lista.forEach(x => { if (x && !seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

function _montarEmailCompromisso(marco, c, proc, cli) {
  const labels = {
    'T-1': '📅 COMPROMISSO AMANHÃ',
    'T-0': '📅 COMPROMISSO HOJE',
    'T+1': '⚠ COMPROMISSO DE ONTEM (não marcado)'
  };
  const cores = {
    'T-1': '#b87f1c',
    'T-0': '#a8472d',
    'T+1': '#a8472d'
  };
  const titulo = labels[marco] || marco;
  const cor = cores[marco] || '#6b6b68';
  const tipoLabel = COMPROMISSO_TIPO_LABELS[c.tipo] || c.tipo || 'Compromisso';
  const dt = new Date(c.dataHoraInicio);
  const dataFmt = dt.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const horaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dataHoraFim = c.dataHoraFim ? (' até ' + new Date(c.dataHoraFim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })) : '';
  const participantesLabel = (c.participantes || []).join(', ');
  const titReal = c.titulo || tipoLabel;
  const assunto = '[' + titulo.replace(/[📅⚠]/g, '').trim() + '] ' + titReal +
    ' · ' + dt.toLocaleDateString('pt-BR') + ' ' + horaFmt;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #fafaf7; padding: 24px; border-radius: 8px; border: 1px solid #e8e3d4;">
      <div style="border-left: 4px solid ${cor}; padding-left: 16px; margin-bottom: 20px;">
        <h1 style="margin: 0 0 6px; font-size: 22px; color: ${cor}; font-weight: 600;">${_escapeEmail(titulo)}</h1>
        <p style="margin: 0; color: #1f1f1f; font-size: 15px; font-weight: 500;">${_escapeEmail(titReal)}</p>
        <p style="margin: 4px 0 0; color: #6b6b68; font-size: 13px;">${_escapeEmail(tipoLabel)}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #6b6b68; width: 130px;">Quando:</td><td style="padding: 6px 0; font-weight: 600; color: #1f1f1f;">${_escapeEmail(dataFmt)} · ${_escapeEmail(horaFmt)}${_escapeEmail(dataHoraFim)}</td></tr>
        ${c.local ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Local:</td><td style="padding: 6px 0;">${_escapeEmail(c.local)}</td></tr>` : ''}
        ${c.responsavel ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Responsável:</td><td style="padding: 6px 0; font-weight: 600;">${_escapeEmail(c.responsavel)}</td></tr>` : ''}
        ${participantesLabel ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Participantes:</td><td style="padding: 6px 0; font-size: 12px;">${_escapeEmail(participantesLabel)}</td></tr>` : ''}
        ${cli ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Cliente:</td><td style="padding: 6px 0;">${_escapeEmail(cli.nome || '')}</td></tr>` : ''}
        ${proc ? `<tr><td style="padding: 6px 0; color: #6b6b68;">Processo:</td><td style="padding: 6px 0; font-size: 12px;">${_escapeEmail((proc.cnj || proc.name || '—'))}</td></tr>` : ''}
        ${c.observacoes ? `<tr><td style="padding: 6px 0; color: #6b6b68; vertical-align: top;">Obs:</td><td style="padding: 6px 0; color: #6b6b68; font-size: 12px; white-space: pre-wrap;">${_escapeEmail(c.observacoes)}</td></tr>` : ''}
      </table>
      <a href="https://uc.uranydecastro.adv.br/#agenda" style="display: inline-block; background: #8a6f3d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 600; font-size: 14px;">Abrir Agenda no UC Jurídico →</a>
      <p style="color: #6b6b68; font-size: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e8e3d4;">
        Lembrete automático de compromisso. Marque como realizado, cancelado ou adiado no app pra parar de receber este lembrete.
      </p>
      <p style="color: #9b9b96; font-size: 11px; margin-top: 12px; text-align: center;">
        UC Jurídico · Urany de Castro Advocacia · 30 anos
      </p>
    </div>
  `;
  return { assunto, html };
}

/**
 * Trigger principal de compromissos. Idempotente via c.notificado.
 * Janela [hoje-2, hoje+3] cobre T-1, T-0 e T+1 com folga.
 */
function cron_lembretesDeCompromissos() {
  const startTime = Date.now();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();

  const janelaInicio = new Date(todayMs - 2 * 86400000).toISOString();
  const janelaFim = new Date(todayMs + 3 * 86400000).toISOString();

  let compromissos = [];
  try {
    compromissos = _firestoreQuery('compromissos', [
      { field: 'dataHoraInicio', op: 'GREATER_THAN_OR_EQUAL', value: janelaInicio },
      { field: 'dataHoraInicio', op: 'LESS_THAN_OR_EQUAL', value: janelaFim }
    ], 500);
  } catch (e) {
    Logger.log('cron_lembretesDeCompromissos: query falhou: ' + e.message);
    return { compromissos: 0, processados: 0, enviados: 0, erros: 1, elapsed: Date.now() - startTime };
  }

  if (compromissos.length === 0) {
    Logger.log('cron_lembretesDeCompromissos: nenhum compromisso na janela');
    return { compromissos: 0, processados: 0, enviados: 0, erros: 0, elapsed: Date.now() - startTime };
  }

  // Buscar processos e clientes referenciados (1 fetch por id único)
  const procIds = {}, cliIds = {};
  compromissos.forEach(c => {
    if (c.processoId) procIds[c.processoId] = true;
    if (c.clienteId) cliIds[c.clienteId] = true;
  });
  const processos = {};
  for (const pid of Object.keys(procIds)) {
    try { const p = _firestoreGet('processos/' + pid); if (p) processos[pid] = p; } catch (_) {}
  }
  const clientes = {};
  for (const cid of Object.keys(cliIds)) {
    try { const cl = _firestoreGet('clientes/' + cid); if (cl) clientes[cid] = cl; } catch (_) {}
  }

  const fcmTokensDoc = _firestoreGet('settings/fcmTokens') || {};
  const fcmTokens = (fcmTokensDoc && fcmTokensDoc.value) || {};
  const socioDoc = _firestoreGet('settings/socioPadraoNome') || {};
  const socio = (socioDoc && socioDoc.value) || null;

  let processados = 0, enviados = 0, erros = 0, ignorados = 0;
  let tokensRemovidos = false;

  for (const c of compromissos) {
    // Espelho de prazo (criado ao agendar publicação): NÃO dispara lembrete
    // próprio — o deadline correspondente já cobre os marcos T-7..T-0.
    // Evita push/e-mail duplicado pro advogado.
    if (c.espelhoPrazo === true) { ignorados++; continue; }
    const marco = _marcoDoCompromisso(c, todayMs);
    if (!marco) { ignorados++; continue; }

    const destinatariosNomes = _rotearDestinatariosCompromisso(c, socio, marco);
    if (!destinatariosNomes.length) { ignorados++; continue; }

    const proc = c.processoId ? processos[c.processoId] : null;
    const cli = c.clienteId ? clientes[c.clienteId] : null;

    let alterado = false;
    const notificado = c.notificado || {};
    notificado[marco] = notificado[marco] || {};

    for (const nome of destinatariosNomes) {
      const email = NOME_EMAIL_MAP[nome];
      if (!email) continue;
      if (notificado[marco][email]) continue;  // anti-spam

      let pushOk = false, emailOk = false;
      const tokenInfo = fcmTokens[email];
      const enviarEmailNesteMarco = COMPROMISSO_EMAIL_MARCOS.indexOf(marco) >= 0;

      // Push FCM
      if (tokenInfo && tokenInfo.token) {
        processados++;
        try {
          const title = COMPROMISSO_MARCO_LABELS[marco] || ('Compromisso ' + marco);
          const dt = new Date(c.dataHoraInicio);
          const horaFmt = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const tipoLabel = COMPROMISSO_TIPO_LABELS[c.tipo] || 'Compromisso';
          const titReal = c.titulo || tipoLabel;
          const body = titReal + ' · ' + horaFmt + (c.local ? ' · ' + c.local : '');
          const url = 'https://uc.uranydecastro.adv.br/#agenda';
          const r = enviarFcmPush(tokenInfo.token, title, body, {
            tag: 'compromisso-' + c._docId + '-' + marco,
            url: url,
            requireInteraction: 'true',
            compromissoId: c._docId,
            marco: marco
          });
          if (r.ok) {
            pushOk = true;
          } else {
            erros++;
            Logger.log('FCM compromisso falha pra ' + email + ' marco ' + marco + ': ' + r.code + ' ' + r.response);
            if (r.code === 404 || (r.code === 400 && /UNREGISTERED|INVALID_ARGUMENT|registration/i.test(r.response))) {
              delete fcmTokens[email];
              tokensRemovidos = true;
            }
          }
        } catch (e) {
          erros++;
          Logger.log('FCM compromisso exceção ' + email + ' ' + marco + ': ' + e.message);
        }
      }

      // Email (T-1, T-0 ou fallback se não tem token)
      if (enviarEmailNesteMarco || (!pushOk && !tokenInfo)) {
        try {
          const conteudo = _montarEmailCompromisso(marco, c, proc, cli);
          const r = enviarEmail(email, conteudo.assunto, conteudo.html);
          if (r.ok) {
            emailOk = true;
          } else {
            erros++;
            Logger.log('Email compromisso falha pra ' + email + ' ' + marco + ': ' + r.error);
          }
        } catch (e) {
          erros++;
          Logger.log('Email compromisso exceção ' + email + ' ' + marco + ': ' + e.message);
        }
      }

      if (pushOk || emailOk) {
        notificado[marco][email] = { at: Date.now(), push: pushOk, email: emailOk };
        alterado = true;
        enviados++;
      }
    }

    if (alterado) {
      try {
        _firestoreUpdate('compromissos/' + c._docId, { notificado: notificado, updatedAt: Date.now() });
      } catch (e) {
        Logger.log('update compromisso ' + c._docId + ' falhou: ' + e.message);
      }
    }
  }

  if (tokensRemovidos) {
    try {
      _firestoreUpdate('settings/fcmTokens', { value: fcmTokens, updatedAt: Date.now() });
    } catch (e) {
      Logger.log('cleanup fcmTokens (compromissos) falhou: ' + e.message);
    }
  }

  const elapsed = Date.now() - startTime;
  const summary = 'cron_lembretesDeCompromissos: total=' + compromissos.length +
    ' processados=' + processados +
    ' enviados=' + enviados +
    ' erros=' + erros +
    ' ignorados=' + ignorados +
    ' elapsed=' + elapsed + 'ms';
  Logger.log(summary);
  return { compromissos: compromissos.length, processados, enviados, erros, ignorados, elapsed };
}

// =====================================================================
// DEAD-MAN'S SWITCH — monitoramento cruzado de crons (P0.1)
// =====================================================================
// Este cron (Apps Script) vigia o cron do DJEN (Cloud Function). Se o
// DJEN parar de rodar, novas intimações deixam de ser capturadas — risco
// de prazo perdido. Como rodam em infra independente, este detecta a
// morte do outro e alerta por e-mail. (O caminho reverso — Cloud Function
// vigiando este cron via push — está em functions/index.js.)

// Co-titularidade (#40): alertas vão pros DOIS — se uma conta falhar, a outra
// recebe. MailApp.sendEmail aceita lista separada por vírgula em "to".
const CRON_ALERT_EMAIL = 'eduardourany@uranydecastro.com.br,ucjuridico@uranydecastro.com.br';
const CRON_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // re-alerta no máx 1x/dia

// Início (00:00) do último dia útil ANTERIOR a hoje (pula sáb/dom).
function _inicioUltimoDiaUtilAnterior(agoraMs) {
  const d = new Date(agoraMs);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Cron está "morto" se não roda desde o último dia útil anterior.
// Tolera fim de semana (não alerta por gap normal sex→seg).
function _cronEstaStale(lastRunMs, agoraMs) {
  if (!lastRunMs) return true;
  return lastRunMs < _inicioUltimoDiaUtilAnterior(agoraMs);
}

// Grava o heartbeat deste cron (lido pelo watcher do Cloud Function).
function _gravarHeartbeatLembretes(resumo) {
  try {
    _firestoreUpdate('settings/lembretesCron', {
      value: { lastRun: Date.now(), resumo: String(resumo || '').slice(0, 500) },
      updatedAt: Date.now()
    });
  } catch (e) {
    Logger.log('[deadman] heartbeat lembretes falhou: ' + e.message);
  }
}

// Vigia o cron de backup diário (Backup.gs). Detecta se settings/lastBackup
// está sem update há mais de BACKUP_STALE_HORAS — significa que ou (a) o
// cron não rodou, ou (b) rodou e falhou silenciosamente. Em (b) o próprio
// Backup.gs já envia alerta; isto aqui pega o caso (a). Cooldown 24h.
const BACKUP_STALE_HORAS = 36;  // tolera 1 dia + 12h de folga (cobre fim de semana etc)
function _vigiarCronBackup() {
  try {
    const agora = Date.now();
    const doc = _firestoreGet('settings/lastBackup');
    // Grace period: nunca rodou antes — não alerta (sistema novo)
    if (!doc || !doc.value || !doc.value.timestamp) {
      Logger.log('[deadman] backup ainda não inicializado (settings/lastBackup vazio) — pulando');
      return;
    }
    const lastBackup = doc.value.timestamp;
    const horasSemBackup = (agora - lastBackup) / 3600000;
    if (horasSemBackup < BACKUP_STALE_HORAS) return;

    // Anti-spam: chave separada
    const alertDoc = _firestoreGet('settings/cronAlertas');
    const alertVal = (alertDoc && alertDoc.value) || {};
    if (agora - (alertVal.backupLastAlert || 0) < CRON_ALERT_COOLDOWN_MS) return;

    const ultima = new Date(lastBackup).toLocaleString('pt-BR');
    const html = '<div style="font-family:Arial,sans-serif;max-width:520px">' +
      '<h2 style="color:#a8472d;margin:0 0 8px">&#9888; UC Jur&iacute;dico — backup di&aacute;rio parado</h2>' +
      '<p>O cron <b>cron_backupDiario</b> n&atilde;o registra execu&ccedil;&atilde;o ' +
      'bem-sucedida h&aacute; <b>' + horasSemBackup.toFixed(1) + 'h</b> ' +
      '(&uacute;ltimo backup: ' + ultima + ').</p>' +
      '<p><b>Dados podem estar sem prote&ccedil;&atilde;o de recupera&ccedil;&atilde;o.</b></p>' +
      '<p><b>O que fazer:</b></p>' +
      '<ul style="margin:6px 0 12px 18px;padding:0">' +
      '<li>Verificar trigger time-driven de <code>cron_backupDiario</code> no Apps Script.</li>' +
      '<li>Rodar <code>executarBackupAgora()</code> manualmente no editor pra ver se h&aacute; erro.</li>' +
      '<li>Conferir cota do Drive / Apps Script.</li>' +
      '</ul>' +
      '<p style="color:#888;font-size:12px;margin-top:16px">Alerta autom&aacute;tico do dead-man\'s switch &middot; UC Jur&iacute;dico</p></div>';
    enviarEmail(CRON_ALERT_EMAIL, "⚠ UC Jurídico — backup diário parado há " + Math.round(horasSemBackup) + "h", html);

    alertVal.backupLastAlert = agora;
    _firestoreUpdate('settings/cronAlertas', { value: alertVal, updatedAt: agora });
    Logger.log('[deadman] ALERTA backup parado enviado (último=' + ultima + ')');
  } catch (e) {
    Logger.log('[deadman] vigiar backup falhou: ' + e.message);
  }
}

// Vigia se a captura DJEN está PRODUTIVA — não basta o cron estar vivo, ele
// precisa estar trazendo pubs (#27 parte 2: alerta de silêncio). Se a última
// pub capturada (settings/djenCron.lastPubAt) for mais antiga que ALERT_SILENCIO_DIAS
// E o cron está rodando normal (heartbeat OK) → alerta. Detecta:
//   - DJEN API caiu silenciosamente (sem erro, mas vazio)
//   - Bug no proxy Cloudflare retornando vazio
//   - Geo-bloqueio CloudFront sem erro visível
//   - Cron rodando mas filtros errados (todas as OABs desativadas, etc.)
// Falso positivo aceitável: férias forenses longas. Tunar threshold se incomodar.
const ALERT_SILENCIO_DIAS = 7;
function _vigiarCapturaDjen() {
  try {
    const agora = Date.now();
    const doc = _firestoreGet('settings/djenCron');
    if (!doc || !doc.value) return;
    const v = doc.value;
    const lastRun = v.lastRun || 0;
    const lastPubAt = v.lastPubAt || 0;
    // Grace period: se cron não rodou ainda, ou rodou há pouco (sistema novo)
    // → _vigiarCronDjen cuida da parte "cron parado". Aqui não alerta.
    if (!lastRun) return;
    const limiteMs = ALERT_SILENCIO_DIAS * 24 * 60 * 60 * 1000;
    // Se nunca capturou pub MAS o cron está vivo há mais do que o threshold,
    // alerta. (lastPubAt==0 = nunca capturou no histórico desta versão.)
    if (lastPubAt && (agora - lastPubAt) < limiteMs) return;
    // Se o cron está parado, deixa o _vigiarCronDjen alertar (alerta dele é
    // mais específico — "cron parado" é causa raiz, "captura zero" é sintoma).
    if (_cronEstaStale(lastRun, agora)) return;
    // Anti-spam (chave separada do alerta do cron parado)
    const alertDoc = _firestoreGet('settings/cronAlertas');
    const alertVal = (alertDoc && alertDoc.value) || {};
    if (agora - (alertVal.capturaLastAlert || 0) < CRON_ALERT_COOLDOWN_MS) return;

    const diasSemPub = lastPubAt ? Math.round((agora - lastPubAt) / (24 * 60 * 60 * 1000)) : null;
    const ultimaPub = lastPubAt ? new Date(lastPubAt).toLocaleString('pt-BR') : 'nunca registrada';
    const ultimoRun = new Date(lastRun).toLocaleString('pt-BR');
    const html = '<div style="font-family:Arial,sans-serif;max-width:560px">' +
      '<h2 style="color:#b87f1c;margin:0 0 8px">&#9888; UC Jur&iacute;dico — DJEN sem captura</h2>' +
      '<p>O cron DJEN <b>est&aacute; rodando normalmente</b> ' +
      '(&uacute;ltima execu&ccedil;&atilde;o: ' + ultimoRun + '), ' +
      'mas <b>n&atilde;o trouxe nenhuma publica&ccedil;&atilde;o nova</b> ' +
      (diasSemPub != null ? ('h&aacute; ' + diasSemPub + ' dias (&uacute;ltima pub capturada: ' + ultimaPub + ').') : 'desde a instala&ccedil;&atilde;o do monitor.') + '</p>' +
      '<p><b>Causas poss&iacute;veis:</b></p>' +
      '<ul style="margin:6px 0 12px 18px;padding:0">' +
      '<li>API do CNJ (comunicaapi) com problema silencioso ou geo-bloqueio</li>' +
      '<li>Proxy Cloudflare retornando vazio</li>' +
      '<li>Todas as OABs desativadas em Configura&ccedil;&otilde;es &rarr; DJEN</li>' +
      '<li>F&eacute;rias forenses prolongadas (falso positivo)</li>' +
      '</ul>' +
      '<p><b>O que fazer:</b> abrir o UC Jur&iacute;dico &rarr; Publica&ccedil;&otilde;es &rarr; bot&atilde;o "&#128276; Pesquisar agora" pra confirmar manualmente se h&aacute; pubs vindo. ' +
      'Se nada vier, contatar o admin pra investigar o proxy/API.</p>' +
      '<p style="color:#888;font-size:12px;margin-top:16px">Alerta autom&aacute;tico do dead-man\'s switch &middot; UC Jur&iacute;dico</p></div>';
    enviarEmail(CRON_ALERT_EMAIL, "⚠ UC Jurídico — DJEN sem captura há " + (diasSemPub || '?') + " dias", html);

    alertVal.capturaLastAlert = agora;
    _firestoreUpdate('settings/cronAlertas', { value: alertVal, updatedAt: agora });
    Logger.log('[deadman] ALERTA captura DJEN parada enviado (lastPubAt=' + ultimaPub + ')');
  } catch (e) {
    Logger.log('[deadman] vigiar captura DJEN falhou: ' + e.message);
  }
}

// Vigia o cron do DJEN. Se stale, manda e-mail de alerta (com cooldown).
function _vigiarCronDjen() {
  try {
    const agora = Date.now();
    const doc = _firestoreGet('settings/djenCron');
    // Grace period: se o heartbeat do DJEN nunca existiu, não alerta
    // (evita falso positivo antes do cron rodar pela primeira vez).
    if (!doc || !doc.value || !doc.value.lastRun) {
      Logger.log('[deadman] djenCron ainda não inicializado — pulando');
      return;
    }
    const lastRun = doc.value.lastRun;
    if (!_cronEstaStale(lastRun, agora)) return;

    // Anti-spam: não repete o alerta dentro do cooldown
    const alertDoc = _firestoreGet('settings/cronAlertas');
    const alertVal = (alertDoc && alertDoc.value) || {};
    if (agora - (alertVal.djenLastAlert || 0) < CRON_ALERT_COOLDOWN_MS) return;

    const horas = lastRun ? Math.round((agora - lastRun) / 3600000) : null;
    const ultima = lastRun ? new Date(lastRun).toLocaleString('pt-BR') : 'nunca registrada';
    const html = '<div style="font-family:Arial,sans-serif;max-width:520px">' +
      '<h2 style="color:#a8472d;margin:0 0 8px">&#9888; Monitor de intima&ccedil;&otilde;es (DJEN) parado</h2>' +
      '<p>O cron <b>djenAutoCheckCron</b> n&atilde;o roda h&aacute; ' +
      (horas != null ? ('aproximadamente <b>' + horas + 'h</b>') : '<b>tempo indeterminado</b>') +
      ' (&uacute;ltima execu&ccedil;&atilde;o: ' + ultima + ').</p>' +
      '<p><b>Novas intima&ccedil;&otilde;es podem n&atilde;o estar sendo capturadas.</b> ' +
      'Verifique o Cloud Scheduler / Cloud Functions do projeto <code>uc-juridico</code> ' +
      '(fun&ccedil;&atilde;o djenAutoCheckCron, regi&atilde;o southamerica-east1).</p>' +
      '<p style="color:#888;font-size:12px;margin-top:16px">Alerta autom&aacute;tico do dead-man\'s switch &middot; UC Jur&iacute;dico</p></div>';
    enviarEmail(CRON_ALERT_EMAIL, "⚠ UC Jurídico — monitor DJEN parado", html);

    alertVal.djenLastAlert = agora;
    _firestoreUpdate('settings/cronAlertas', { value: alertVal, updatedAt: agora });
    Logger.log('[deadman] ALERTA DJEN enviado (lastRun=' + ultima + ')');
  } catch (e) {
    Logger.log('[deadman] vigiar DJEN falhou: ' + e.message);
  }
}

/**
 * Cron unificado — chama prazos + parcelas + compromissos em sequência.
 * Use ESTE como trigger time-driven (substituindo o cron_lembretesDePrazo
 * antigo, que continua existindo pra debug isolado).
 */
function cron_lembretesUnificado() {
  Logger.log('=== cron_lembretesUnificado iniciando ===');
  let resPrazos = null, resParcelas = null, resCompromissos = null;
  try { resPrazos = cron_lembretesDePrazo(); }
  catch (e) { Logger.log('cron_lembretesDePrazo erro: ' + e.message); }
  try { resParcelas = cron_lembretesDeParcelas(); }
  catch (e) { Logger.log('cron_lembretesDeParcelas erro: ' + e.message); }
  try { resCompromissos = cron_lembretesDeCompromissos(); }
  catch (e) { Logger.log('cron_lembretesDeCompromissos erro: ' + e.message); }

  // Dead-man's switch: registra que ESTE cron rodou + vigia outros crons.
  // - _vigiarCronDjen     : DJEN parou de rodar
  // - _vigiarCapturaDjen  : DJEN rodando mas sem trazer pub (#27 parte 2)
  // - _vigiarCronBackup   : backup diário parado (#29)
  _gravarHeartbeatLembretes(JSON.stringify({
    prazos: resPrazos, parcelas: resParcelas, compromissos: resCompromissos
  }));
  _vigiarCronDjen();
  _vigiarCapturaDjen();
  _vigiarCronBackup();

  Logger.log('=== cron_lembretesUnificado concluído ===');
  return { prazos: resPrazos, parcelas: resParcelas, compromissos: resCompromissos };
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
    url: 'https://uc.uranydecastro.adv.br/'
  });
  Logger.log(JSON.stringify(r, null, 2));
}

// Preview de parcelas que entrariam no próximo cron (sem enviar nada).
function _previewLembretesDeParcelas() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  const honorarios = _firestoreList('honorarios');
  const procIds = {};
  honorarios.forEach(h => {
    if (h.processoId) procIds[h.processoId] = true;
    (h.processosCobertos || []).forEach(pid => { if (pid) procIds[pid] = true; });
  });
  const processos = {};
  for (const pid of Object.keys(procIds)) {
    try { const proc = _firestoreGet('processos/' + pid); if (proc) processos[pid] = proc; } catch(_) {}
  }
  const ausenciasDoc = _firestoreGet('settings/advogadosAusencias') || {};
  const ausencias = (ausenciasDoc && ausenciasDoc.value) || {};
  const socioDoc = _firestoreGet('settings/socioPadraoNome') || {};
  const socio = (socioDoc && socioDoc.value) || null;
  const tokensDoc = _firestoreGet('settings/fcmTokens') || {};
  const fcmTokens = (tokensDoc && tokensDoc.value) || {};

  const linhas = [];
  let totalPush = 0, totalEmail = 0;
  for (const h of honorarios) {
    for (const parc of (h.parcelas || [])) {
      const marco = _marcoDeParcela(parc, todayMs);
      if (!marco) continue;
      const dest = _rotearDestinatariosParcela(h, processos, ausencias, socio, marco, todayMs);
      const destEmails = dest.map(n => NOME_EMAIL_MAP[n]).filter(Boolean);
      const notificado = parc.notificado || {};
      const pendentes = destEmails.filter(e => !(notificado[marco] && notificado[marco][e]));
      if (pendentes.length === 0) continue;
      const enviarEmailNesteMarco = PARCELA_EMAIL_MARCOS.indexOf(marco) >= 0;
      const enviarPush = pendentes.filter(e => fcmTokens[e] && fcmTokens[e].token);
      const enviarEmailLista = pendentes.filter(e => enviarEmailNesteMarco || !(fcmTokens[e] && fcmTokens[e].token));
      totalPush += enviarPush.length;
      totalEmail += enviarEmailLista.length;
      linhas.push({
        cliente: (h.clienteNome || '').slice(0, 30),
        parcela: parc.numero + '/' + (h.parcelas?.length || 1),
        marco: marco,
        vence: parc.vencimento,
        valor: parc.valor,
        push: enviarPush.join(', ') || '—',
        email: enviarEmailLista.join(', ') || '—'
      });
    }
  }
  Logger.log('Preview parcelas (sem enviar):');
  Logger.log(JSON.stringify(linhas, null, 2));
  Logger.log('Total push: ' + totalPush + ' · Total email: ' + totalEmail);
}

function _previewLembretesDeCompromissos() {
  const today = new Date(); today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  const janelaInicio = new Date(todayMs - 2 * 86400000).toISOString();
  const janelaFim = new Date(todayMs + 3 * 86400000).toISOString();
  let compromissos = [];
  try {
    compromissos = _firestoreQuery('compromissos', [
      { field: 'dataHoraInicio', op: 'GREATER_THAN_OR_EQUAL', value: janelaInicio },
      { field: 'dataHoraInicio', op: 'LESS_THAN_OR_EQUAL', value: janelaFim }
    ], 500);
  } catch (e) {
    Logger.log('Preview falhou: ' + e.message);
    return;
  }
  const socioDoc = _firestoreGet('settings/socioPadraoNome') || {};
  const socio = (socioDoc && socioDoc.value) || null;
  const tokensDoc = _firestoreGet('settings/fcmTokens') || {};
  const fcmTokens = (tokensDoc && tokensDoc.value) || {};

  Logger.log('Janela: ' + janelaInicio.slice(0,10) + ' a ' + janelaFim.slice(0,10) + ' · ' + compromissos.length + ' compromissos');
  const linhas = [];
  let totalPush = 0, totalEmail = 0;
  for (const c of compromissos) {
    const marco = _marcoDoCompromisso(c, todayMs);
    if (!marco) continue;
    const dest = _rotearDestinatariosCompromisso(c, socio, marco);
    const destEmails = dest.map(n => NOME_EMAIL_MAP[n]).filter(Boolean);
    const notificado = c.notificado || {};
    const pendentes = destEmails.filter(e => !(notificado[marco] && notificado[marco][e]));
    if (pendentes.length === 0) continue;
    const enviarEmailNesteMarco = COMPROMISSO_EMAIL_MARCOS.indexOf(marco) >= 0;
    const enviarPush = pendentes.filter(e => fcmTokens[e] && fcmTokens[e].token);
    const enviarEmailLista = pendentes.filter(e => enviarEmailNesteMarco || !(fcmTokens[e] && fcmTokens[e].token));
    totalPush += enviarPush.length;
    totalEmail += enviarEmailLista.length;
    linhas.push({
      titulo: (c.titulo || c.tipo || '').slice(0, 40),
      tipo: c.tipo,
      marco: marco,
      quando: (c.dataHoraInicio || '').slice(0, 16),
      status: c.status,
      push: enviarPush.join(', ') || '—',
      email: enviarEmailLista.join(', ') || '—'
    });
  }
  Logger.log('Preview compromissos (sem enviar):');
  Logger.log(JSON.stringify(linhas, null, 2));
  Logger.log('Total push: ' + totalPush + ' · Total email: ' + totalEmail);
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
  let totalPush = 0, totalEmail = 0;
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
    if (pendentes.length === 0) continue;

    const enviarEmailNesteMarco = EMAIL_MARCOS.indexOf(marco) >= 0;
    const enviarPush = pendentes.filter(e => fcmTokens[e] && fcmTokens[e].token);
    const enviarEmail = pendentes.filter(e => enviarEmailNesteMarco || !(fcmTokens[e] && fcmTokens[e].token));

    totalPush += enviarPush.length;
    totalEmail += enviarEmail.length;

    linhas.push({
      desc: (d.description || d.type || '').slice(0, 50),
      marco: marco,
      processo: (proc.name || '').slice(0, 40),
      push: enviarPush.join(', ') || '—',
      email: enviarEmail.join(', ') || '—'
    });
  }
  Logger.log('Preview (sem enviar):');
  Logger.log(JSON.stringify(linhas, null, 2));
  Logger.log('Total push: ' + totalPush + ' · Total email: ' + totalEmail);
}
