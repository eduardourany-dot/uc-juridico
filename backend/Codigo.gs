/**
 * Codigo.gs — Backend Web App do UC Jurídico v2.
 *
 * Endpoints (via parâmetro action):
 *   whoami         GET    valida token e retorna email/role do usuário
 *   version        GET    retorna timestamps de última modificação por entidade (polling barato)
 *   getAll         GET    {entity}                       → todos os registros não-deletados
 *   getDelta       GET    {entity, since}                → registros com updatedAt >= since (inclui deletados)
 *   upsert         POST   {entity, record}               → cria/atualiza (last-write-wins por updatedAt)
 *   softDelete     POST   {entity, id}                   → marca deletedAt
 *   uploadPdf      POST   {pdfId, filename, base64, processId?}
 *   getPdfUrl      GET    {pdfId}                        → URL temporária de download
 *   listUsuarios   GET    (admin)                        → lista allowlist
 *   addUsuario     POST   (admin) {email, nome, role}
 *
 * Auth: cliente envia Google ID token (JWT) em header `X-Id-Token` via JSON body
 *       (Apps Script web app não permite headers customizados via fetch sem CORS preflight,
 *        então tokens vão em query string ?token=... no GET, ou no body em POST).
 */

const ENTITIES = {
  Processos:      { pk: 'id',   indexed: ['id', 'status', 'updatedAt', 'deletedAt'] },
  Prazos:         { pk: 'id',   indexed: ['id', 'processId', 'status', 'deadlineDate', 'updatedAt', 'deletedAt'] },
  Eventos:        { pk: 'id',   indexed: ['id', 'processId', 'updatedAt', 'deletedAt'] },
  Notas:          { pk: 'id',   indexed: ['id', 'processId', 'updatedAt', 'deletedAt'] },
  Jurisprudencia: { pk: 'id',   indexed: ['id', 'processId', 'updatedAt', 'deletedAt'] },
  DJEN:           { pk: 'hash', indexed: ['hash', 'cnj', 'processId', 'status', 'dataDisponibilizacao', 'importedAt', 'updatedAt', 'deletedAt'] },
  Settings:       { pk: 'chave', indexed: ['chave', 'updatedAt'] }
};

// ============================================================
// Entry points
// ============================================================

function doGet(e) {
  return handle_(e, 'GET');
}

function doPost(e) {
  return handle_(e, 'POST');
}

function handle_(e, method) {
  try {
    const params = e.parameter || {};
    const action = params.action;
    const token = params.token || (e.postData ? safeParse_(e.postData.contents).token : null);
    const body = e.postData ? safeParse_(e.postData.contents) : {};

    if (!action) return json_({ error: 'missing action' }, 400);

    // whoami é o único endpoint que valida sem exigir allowlist (retorna 'unauthorized' se não estiver)
    if (action === 'whoami') {
      const tokenInfo = validateToken_(token);
      if (!tokenInfo) return json_({ error: 'invalid_token' }, 401);
      const user = lookupUser_(tokenInfo.email);
      return json_({
        email: tokenInfo.email,
        name: tokenInfo.name,
        picture: tokenInfo.picture,
        authorized: !!(user && user.ativo),
        role: user ? user.role : null
      });
    }

    const tokenInfo = validateToken_(token);
    if (!tokenInfo) return json_({ error: 'invalid_token' }, 401);
    const user = lookupUser_(tokenInfo.email);
    if (!user || !user.ativo) return json_({ error: 'forbidden', email: tokenInfo.email }, 403);

    const ctx = { user: user, email: tokenInfo.email, params: params, body: body, method: method };

    // ATENÇÃO: debugToken não exige autorização (mas mascara o token na resposta).
    // Remover depois do diagnóstico.
    if (action === 'debugToken') {
      return json_(actionDebugToken_(params, body));
    }

    switch (action) {
      case 'version':       return json_(actionVersion_(ctx));
      case 'getAll':        return json_(actionGetAll_(ctx));
      case 'getDelta':      return json_(actionGetDelta_(ctx));
      case 'upsert':        return json_(actionUpsert_(ctx));
      case 'softDelete':    return json_(actionSoftDelete_(ctx));
      case 'uploadPdf':     return json_(actionUploadPdf_(ctx));
      case 'getPdfUrl':     return json_(actionGetPdfUrl_(ctx));
      case 'listUsuarios':  return json_(actionListUsuarios_(ctx));
      case 'addUsuario':    return json_(actionAddUsuario_(ctx));
      default: return json_({ error: 'unknown_action', action: action }, 400);
    }
  } catch (err) {
    return json_({ error: 'server_error', message: String(err && err.message || err), stack: String(err && err.stack || '') }, 500);
  }
}

// ============================================================
// Auth
// ============================================================

function validateToken_(idToken) {
  if (!idToken) return null;
  // Hash do token (chave do CacheService tem limite de 250 chars; ID tokens passam de 1KB).
  const cacheKey = 'tok:' + tokenHash_(idToken);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) return null;
  const info = JSON.parse(resp.getContentText());

  const expectedAud = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (expectedAud && info.aud !== expectedAud) return null;
  if (info.email_verified !== 'true' && info.email_verified !== true) return null;
  if (Number(info.exp) * 1000 < Date.now()) return null;

  const result = { email: (info.email || '').toLowerCase(), name: info.name, picture: info.picture };
  // Cache até a expiração (máx 6h, o limite do CacheService).
  const ttl = Math.min(6 * 3600, Math.max(60, Math.floor(Number(info.exp) - Date.now() / 1000)));
  cache.put(cacheKey, JSON.stringify(result), ttl);
  return result;
}

function tokenHash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function lookupUser_(email) {
  if (!email) return null;
  email = email.toLowerCase();
  const sh = sheet_('Usuarios');
  const last = sh.getLastRow();
  if (last < 2) return null;
  const rows = sh.getRange(2, 1, last - 1, 5).getValues();
  for (const r of rows) {
    if (String(r[0]).toLowerCase() === email) {
      return { email: email, nome: r[1], role: r[2], ativo: r[3] === true || r[3] === 'TRUE', criadoEm: r[4] };
    }
  }
  return null;
}

function requireAdmin_(ctx) {
  if (!ctx.user || ctx.user.role !== 'admin') {
    throw new Error('admin_required');
  }
}

// ============================================================
// Action handlers
// ============================================================

// Debug helper — cole seu ID token na constante e rode no editor.
function debugMyToken() {
  const token = 'COLE_AQUI_O_ID_TOKEN';
  if (token === 'COLE_AQUI_O_ID_TOKEN' || !token) {
    Logger.log('Cole o token primeiro (linha "const token = ...")');
    return;
  }
  Logger.log('Token len: ' + token.length);
  Logger.log('Stored OAUTH_CLIENT_ID: [' + PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID') + ']');
  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  Logger.log('tokeninfo status: ' + resp.getResponseCode());
  Logger.log('tokeninfo body: ' + resp.getContentText());
  try {
    const info = JSON.parse(resp.getContentText());
    Logger.log('aud from token: [' + info.aud + ']');
    Logger.log('email from token: [' + info.email + ']');
    Logger.log('email_verified: [' + info.email_verified + '] (typeof=' + typeof info.email_verified + ')');
    Logger.log('exp: ' + info.exp + ' (now=' + Math.floor(Date.now()/1000) + ')');
    Logger.log('Aud matches stored CLIENT_ID? ' + (info.aud === PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID')));
  } catch (e) { Logger.log('Parse error: ' + e); }
}

function actionDebugToken_(params, body) {
  const token = params.token || (body && body.token);
  const out = { hasToken: !!token, tokenLen: token ? token.length : 0 };
  out.expectedAud = PropertiesService.getScriptProperties().getProperty('OAUTH_CLIENT_ID');
  if (!token) return out;
  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  out.tokeninfoStatus = resp.getResponseCode();
  let info = null;
  try { info = JSON.parse(resp.getContentText()); } catch (_) {}
  out.tokeninfoBody = info;
  if (info) {
    out.audMatches = info.aud === out.expectedAud;
    out.emailVerified = info.email_verified === 'true' || info.email_verified === true;
    out.notExpired = Number(info.exp) * 1000 >= Date.now();
    out.passesAllChecks = (resp.getResponseCode() === 200) && out.audMatches && out.emailVerified && out.notExpired;
  }
  return out;
}

function actionVersion_(ctx) {
  const out = {};
  for (const name of Object.keys(ENTITIES)) {
    out[name] = lastUpdatedAt_(name);
  }
  return { versions: out, serverTime: Date.now() };
}

function actionGetAll_(ctx) {
  const entity = ctx.params.entity;
  if (!ENTITIES[entity]) throw new Error('unknown_entity');
  const rows = readAll_(entity, /*includeDeleted*/ false);
  return { entity: entity, records: rows };
}

function actionGetDelta_(ctx) {
  const entity = ctx.params.entity;
  const since = Number(ctx.params.since || 0);
  if (!ENTITIES[entity]) throw new Error('unknown_entity');
  const rows = readAll_(entity, /*includeDeleted*/ true)
    .filter(function(r){ return Number(r.updatedAt || 0) >= since; });
  return { entity: entity, since: since, records: rows };
}

function actionUpsert_(ctx) {
  const entity = ctx.body.entity;
  const record = ctx.body.record;
  if (!ENTITIES[entity]) throw new Error('unknown_entity');
  if (!record) throw new Error('missing_record');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const result = upsertRow_(entity, record, ctx.email);
    audit_(ctx.email, 'upsert', entity, result.record[ENTITIES[entity].pk], { conflict: result.conflict });
    return result;
  } finally {
    lock.releaseLock();
  }
}

function actionSoftDelete_(ctx) {
  const entity = ctx.body.entity;
  const id = ctx.body.id;
  if (!ENTITIES[entity]) throw new Error('unknown_entity');
  if (!id) throw new Error('missing_id');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ok = softDeleteRow_(entity, id, ctx.email);
    audit_(ctx.email, 'softDelete', entity, id, {});
    return { ok: ok };
  } finally {
    lock.releaseLock();
  }
}

function actionUploadPdf_(ctx) {
  const pdfId = ctx.body.pdfId;
  const filename = ctx.body.filename || (pdfId + '.pdf');
  const base64 = ctx.body.base64;
  const processId = ctx.body.processId || null;
  if (!pdfId || !base64) throw new Error('missing_fields');

  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID'));
  // Substitui se já existir um arquivo com o mesmo pdfId
  const existing = folder.getFilesByName(pdfId + '.pdf');
  while (existing.hasNext()) existing.next().setTrashed(true);

  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/pdf', pdfId + '.pdf');
  const file = folder.createFile(blob);
  // Marca processId nos metadados (descrição do arquivo)
  if (processId) file.setDescription(JSON.stringify({ processId: processId, pdfId: pdfId, filename: filename }));

  audit_(ctx.email, 'uploadPdf', 'PDF', pdfId, { filename: filename, fileId: file.getId(), bytes: blob.getBytes().length });
  return { pdfId: pdfId, fileId: file.getId(), filename: filename };
}

function actionGetPdfUrl_(ctx) {
  const pdfId = ctx.params.pdfId;
  if (!pdfId) throw new Error('missing_pdfId');
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID'));
  const it = folder.getFilesByName(pdfId + '.pdf');
  if (!it.hasNext()) return { error: 'not_found' };
  const file = it.next();
  return { pdfId: pdfId, fileId: file.getId(), downloadUrl: file.getDownloadUrl(), name: file.getName() };
}

function actionListUsuarios_(ctx) {
  requireAdmin_(ctx);
  const sh = sheet_('Usuarios');
  const last = sh.getLastRow();
  if (last < 2) return { usuarios: [] };
  const rows = sh.getRange(2, 1, last - 1, 5).getValues().map(function(r){
    return { email: r[0], nome: r[1], role: r[2], ativo: r[3] === true || r[3] === 'TRUE', criadoEm: r[4] };
  });
  return { usuarios: rows };
}

function actionAddUsuario_(ctx) {
  requireAdmin_(ctx);
  const email = String(ctx.body.email || '').toLowerCase();
  const nome = ctx.body.nome || '';
  const role = ctx.body.role || 'user';
  if (!email) throw new Error('missing_email');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_('Usuarios');
    const last = sh.getLastRow();
    const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];
    const idx = rows.findIndex(function(r){ return String(r[0]).toLowerCase() === email; });
    if (idx >= 0) {
      sh.getRange(idx + 2, 2, 1, 3).setValues([[nome || rows[idx][1], role, true]]);
    } else {
      sh.appendRow([email, nome, role, true, new Date().toISOString()]);
    }
    audit_(ctx.email, 'addUsuario', 'Usuarios', email, { nome: nome, role: role });
    return { email: email, nome: nome, role: role, ativo: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Sheet helpers
// ============================================================

function sheet_(name) {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID not configured. Run bootstrap()');
  const ss = SpreadsheetApp.openById(id);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('sheet_not_found:' + name);
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function readAll_(entity, includeDeleted) {
  const sh = sheet_(entity);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = headers_(sh);
  const rows = sh.getRange(2, 1, last - 1, cols.length).getValues();
  const out = [];
  for (const r of rows) {
    const rec = rowToRecord_(cols, r);
    if (!includeDeleted && rec.deletedAt) continue;
    out.push(rec);
  }
  return out;
}

function lastUpdatedAt_(entity) {
  const sh = sheet_(entity);
  const cols = headers_(sh);
  const ix = cols.indexOf('updatedAt');
  if (ix < 0) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, ix + 1, last - 1, 1).getValues();
  let max = 0;
  for (const v of vals) {
    const n = Number(v[0] || 0);
    if (n > max) max = n;
  }
  return max;
}

function rowToRecord_(cols, row) {
  const rec = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    let v = row[i];
    if (c === 'data') {
      try { v = v ? JSON.parse(v) : {}; } catch (_) { v = {}; }
      Object.assign(rec, v);
    } else if (c === 'updatedAt' || c === 'createdAt' || c === 'deletedAt' || c === 'importedAt') {
      rec[c] = v === '' ? null : Number(v);
    } else {
      rec[c] = v === '' ? null : v;
    }
  }
  return rec;
}

function recordToRow_(cols, rec) {
  const indexedFields = new Set(cols.filter(function(c){ return c !== 'data'; }));
  const dataObj = {};
  for (const k of Object.keys(rec)) {
    if (!indexedFields.has(k)) dataObj[k] = rec[k];
  }
  return cols.map(function(c){
    if (c === 'data') return JSON.stringify(dataObj);
    const v = rec[c];
    return v === undefined || v === null ? '' : v;
  });
}

function findRowIndex_(sh, pkCol, pkValue) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ix = headers_(sh).indexOf(pkCol);
  if (ix < 0) return -1;
  const vals = sh.getRange(2, ix + 1, last - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(pkValue)) return i + 2;
  }
  return -1;
}

function upsertRow_(entity, record, email) {
  const sh = sheet_(entity);
  const cols = headers_(sh);
  const pk = ENTITIES[entity].pk;
  const id = record[pk];
  if (id === undefined || id === null || id === '') throw new Error('missing_pk:' + pk);

  const now = Date.now();
  const existingRowNum = findRowIndex_(sh, pk, id);

  let conflict = false;
  if (existingRowNum > 0) {
    const existing = rowToRecord_(cols, sh.getRange(existingRowNum, 1, 1, cols.length).getValues()[0]);
    // Last-write-wins: se o cliente está enviando algo "antigo", marcamos conflict mas SOBRESCREVEMOS mesmo assim
    // (porque o cliente perguntou antes via version e decidiu prosseguir).
    if (existing.updatedAt && record.clientUpdatedAt && existing.updatedAt > record.clientUpdatedAt) {
      conflict = true;
    }
    record.createdAt = existing.createdAt || now;
  } else {
    record.createdAt = record.createdAt || now;
  }
  record.updatedAt = now;
  record.updatedBy = email;
  delete record.clientUpdatedAt;

  const row = recordToRow_(cols, record);
  if (existingRowNum > 0) {
    sh.getRange(existingRowNum, 1, 1, cols.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return { ok: true, conflict: conflict, record: record };
}

function softDeleteRow_(entity, id, email) {
  const sh = sheet_(entity);
  const cols = headers_(sh);
  const pk = ENTITIES[entity].pk;
  const rowNum = findRowIndex_(sh, pk, id);
  if (rowNum < 0) return false;
  const now = Date.now();
  const ixDel = cols.indexOf('deletedAt') + 1;
  const ixUpd = cols.indexOf('updatedAt') + 1;
  const ixBy  = cols.indexOf('updatedBy') + 1;
  if (ixDel) sh.getRange(rowNum, ixDel).setValue(now);
  if (ixUpd) sh.getRange(rowNum, ixUpd).setValue(now);
  if (ixBy)  sh.getRange(rowNum, ixBy).setValue(email);
  return true;
}

function audit_(email, action, entity, entityId, payload) {
  try {
    const sh = sheet_('Auditoria');
    sh.appendRow([
      Utilities.getUuid(),
      Date.now(),
      email,
      action,
      entity,
      entityId === undefined ? '' : String(entityId),
      payload ? JSON.stringify(payload) : ''
    ]);
  } catch (_) { /* swallow audit errors */ }
}

// ============================================================
// Utils
// ============================================================

function json_(obj, status) {
  // Apps Script Web Apps não permitem setar status code arbitrário diretamente,
  // então retornamos sempre 200 e o cliente lê obj.error/obj.status no JSON.
  if (status) obj.__status = status;
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

function safeParse_(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch (_) { return {}; }
}
