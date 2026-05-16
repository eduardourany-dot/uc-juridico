/**
 * DjenCron.gs — MNI.4 fase 2 (Apps Script)
 *
 * Cron diário de varredura DJEN com app fechado.
 * Lê processos e settings do Firestore via REST, consulta DJEN
 * (API pública do CNJ) com cada OAB cadastrada, salva publicações
 * novas em `djen_publications/{hash}` e dispara push FCM pros
 * advogados via tokens de `settings/fcmTokens`.
 *
 * Reusa infra de Lembretes.gs:
 *   - _getGoogleAccessToken()      — OAuth2 via JWT do Service Account
 *   - _firestoreGet / List / Query — REST Firestore
 *   - _firestoreUpdate             — PATCH com mask (só atualiza existente)
 *   - enviarFcmPush                — FCM HTTP v1
 *
 * Pré-requisitos (já configurados):
 *   FCM_SERVICE_ACCOUNT_JSON em Script Properties
 *
 * Trigger time-driven recomendado:
 *   - Função: cron_djenAutoCheck
 *   - Frequência: dias úteis às 08h (Segunda a Sexta)
 *
 * Funções de teste manual:
 *   _previewDjenCron()  — varre como o cron mas SEM gravar nem enviar push
 *   _testarDjenCron()   — roda o cron de verdade (cuidado em produção)
 *   _resetDjenCron()    — limpa settings/djenCron.lastRun pra forçar re-run
 */

// =====================================================================
// CONFIG
// =====================================================================

const DJEN_API_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';

// OABs varridas — espelho da DJEN_DEFAULT_OABS no app.
// Mover pra settings/djenCron.oabs no futuro se precisar editar sem deploy.
const DJEN_CRON_OABS = [
  { numero: '16539', uf: 'GO', nome: 'Eduardo Urany de Castro' },
  { numero: '87243', uf: 'DF', nome: 'Eduardo Urany de Castro' },
  { numero: '2725',  uf: 'GO', nome: 'Terezinha Urany de Castro' },
  { numero: '51774', uf: 'GO', nome: 'Sara Carolina Urany de Castro Melhem' },
  { numero: '18809', uf: 'GO', nome: 'Juliano da Costa Ferreira' },
  { numero: '18601', uf: 'GO', nome: 'Marko Antônio Duarte' },
  { numero: '18222', uf: 'GO', nome: 'Cleber Ribeiro' },
  { numero: '14301', uf: 'GO', nome: 'Marcelo Mendes França' },
  { numero: '26648', uf: 'GO', nome: 'Bruno Naciff da Rocha' },
  { numero: '24030', uf: 'GO', nome: 'Marcelo Bittar' },
  { numero: '45212', uf: 'GO', nome: 'Marcos Fernando da Silva' }
];

const DJEN_CRON_ESCRITORIO_ID = 'UC';

// =====================================================================
// HELPERS
// =====================================================================

/**
 * PATCH sem updateMask — cria doc se não existir, ou substitui campos
 * listados (semantics de setDoc com merge: false). _firestoreUpdate
 * (do Lembretes.gs) usa mask e exige doc existente.
 */
function _firestoreSet(path, fieldsObj) {
  const accessToken = _getGoogleAccessToken();
  const fields = {};
  for (const k of Object.keys(fieldsObj)) fields[k] = _firestoreEncode(fieldsObj[k]);
  const url = FIRESTORE_BASE + '/' + path;
  const resp = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Firestore set ' + path + ' falhou (' + resp.getResponseCode() + '): ' + resp.getContentText());
  }
  return _firestoreDecodeDoc(JSON.parse(resp.getContentText()));
}

/**
 * Hash determinístico pra publicação. Usa pub.hash do CNJ se disponível,
 * senão djb2 sobre cnj + data + sample do texto. Idempotência depende
 * disso bater entre execuções.
 */
function _djenComputeHash(pub) {
  if (pub.hash) return String(pub.hash);
  const cnj = String(pub.numero_processo || pub.numeroProcesso || '').replace(/\D/g, '');
  const data = pub.data_disponibilizacao || pub.data_publicacao || '';
  const sample = String(pub.texto || '').slice(0, 200);
  const s = cnj + '|' + data + '|' + sample.length + '|' + sample;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'gen_' + (h >>> 0).toString(36);
}

/**
 * Normaliza CNJ de 20 dígitos pra formato com máscara (espelho de
 * normalizeCnj() no app). Retorna a string original se não bater o
 * tamanho — não inventa.
 */
function _normalizeCnj(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '');
  if (d.length !== 20) return String(raw);
  return d.slice(0,7) + '-' + d.slice(7,9) + '.' + d.slice(9,13) + '.' + d.slice(13,14) + '.' + d.slice(14,16) + '.' + d.slice(16,20);
}

/**
 * Fetch uma página da API DJEN. Retorna array de items (vazio em erro).
 * Loga falhas mas não interrompe o cron — uma OAB pode falhar sem afetar
 * o resto.
 *
 * Headers de browser real são necessários — sem User-Agent customizado,
 * Apps Script manda "Mozilla/5.0 (compatible; Google-Apps-Script)" que
 * a API do CNJ rejeita com HTTP 403 (provável discrim. de bots).
 */
function _djenFetchPage(oab, dataInicio, dataFim, pagina) {
  const params = {
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: 100,
    pagina: pagina
  };
  const qs = Object.keys(params)
    .map(function(k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');
  const url = DJEN_API_URL + '?' + qs;
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://comunicaapi.pje.jus.br/'
    },
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code !== 200) {
    Logger.log('[DJEN cron] API ' + oab.numero + '/' + oab.uf + ' pg' + pagina + ' HTTP ' + code);
    return [];
  }
  try {
    const data = JSON.parse(resp.getContentText());
    return data.items || [];
  } catch (e) {
    Logger.log('[DJEN cron] JSON parse falhou ' + oab.numero + '/' + oab.uf + ': ' + e.message);
    return [];
  }
}

// =====================================================================
// CORE — djenAutoCheckCron
// =====================================================================

/**
 * Função principal. Chamada pelo trigger time-driven.
 * Use o wrapper `cron_djenAutoCheck` no trigger.
 */
function djenAutoCheckCron(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const tNow = Date.now();
  const logPrefix = dryRun ? '[DJEN cron · DRY]' : '[DJEN cron]';

  Logger.log(logPrefix + ' === iniciando ' + new Date(tNow).toISOString() + ' ===');

  // ---- 1. Carrega config (settings/djenCron) -----------------------
  const cfgDoc = _firestoreGet('settings/djenCron');
  const cfg = (cfgDoc && cfgDoc.value) || {};
  if (cfg.enabled === false) {
    Logger.log(logPrefix + ' cron desativado em settings/djenCron.value.enabled');
    return { skipped: 'disabled' };
  }
  const lastRun = cfg.lastRun || 0;

  // ---- 2. Janela: ontem (ou desde lastRun, cap 7d) → ontem ---------
  const ontemDate = new Date(tNow);
  ontemDate.setDate(ontemDate.getDate() - 1);
  const fim = ontemDate.toISOString().slice(0, 10);

  let inicio = fim;
  if (lastRun) {
    const cap7d = tNow - 7 * 24 * 60 * 60 * 1000;
    const inicioMs = Math.max(lastRun - 24 * 60 * 60 * 1000, cap7d);
    inicio = new Date(inicioMs).toISOString().slice(0, 10);
  }
  Logger.log(logPrefix + ' janela: ' + inicio + ' → ' + fim);

  // ---- 3. Fetch DJEN pra todas as OABs -----------------------------
  // Sleep 250ms entre OABs pra não bater rate limit do CNJ (já vimos
  // HTTP 403 vindo de Apps Script sem espaçamento + headers de bot).
  const allPubs = [];
  for (var i = 0; i < DJEN_CRON_OABS.length; i++) {
    if (i > 0) Utilities.sleep(250);
    const oab = DJEN_CRON_OABS[i];
    var pagina = 1;
    var loops = 0;
    while (loops < 20) {
      const items = _djenFetchPage(oab, inicio, fim, pagina);
      if (!items.length) break;
      for (var j = 0; j < items.length; j++) {
        items[j]._oab = oab;
        allPubs.push(items[j]);
      }
      if (items.length < 100) break;
      pagina++;
      loops++;
      Utilities.sleep(150); // entre páginas
    }
  }
  Logger.log(logPrefix + ' total pubs fetched: ' + allPubs.length);

  if (allPubs.length === 0) {
    if (!dryRun) {
      _firestoreSet('settings/djenCron', {
        value: Object.assign({}, cfg, {
          lastRun: tNow,
          lastDataFim: fim,
          lastNovas: 0,
          lastOrfas: 0
        }),
        updatedAt: tNow
      });
    }
    Logger.log(logPrefix + ' sem publicações no período');
    return { fetched: 0, novas: 0, orfas: 0 };
  }

  // ---- 4. Indexa processos do escritório por CNJ -------------------
  const processos = _firestoreList('processos').filter(function(p) {
    return !p.deletedAt && p.escritorio_id === DJEN_CRON_ESCRITORIO_ID;
  });
  const cnjIndex = {};
  processos.forEach(function(p) {
    if (p.cnj) {
      const k = String(p.cnj).replace(/\D/g, '');
      if (k) cnjIndex[k] = p;
    }
  });
  Logger.log(logPrefix + ' processos indexados por CNJ: ' + Object.keys(cnjIndex).length);

  // ---- 5. Salva publicações novas em djen/{hash} -------------------
  // Schema alinhado com DB.saveDjenPublication no app (api.js linha ~605).
  // status='pending' indica que ainda não foi triado pelo user — diferente
  // dos status 'imported' (vinculou a processo) e 'orphan' (não tinha CNJ
  // cadastrado, foi pra revisão manual).
  var novasVinculadas = 0;
  var novasOrfas = 0;
  var skipExistente = 0;
  for (var k = 0; k < allPubs.length; k++) {
    const pub = allPubs[k];
    const hash = _djenComputeHash(pub);
    const path = 'djen/' + hash;

    // Já existe? Skip (idempotência — DJEN repete pubs entre OABs).
    const existing = _firestoreGet(path);
    if (existing && existing.hash) {
      skipExistente++;
      continue;
    }

    const cnjRaw = pub.numero_processo || pub.numeroProcesso || '';
    const cnjDigits = String(cnjRaw).replace(/\D/g, '');
    const cnjFormatted = _normalizeCnj(cnjRaw);
    const proc = cnjIndex[cnjDigits];
    const matched = !!proc;

    // Limpa raw pra não duplicar _oab dentro (já está em oab/).
    const rawClean = {};
    for (var rk in pub) {
      if (Object.prototype.hasOwnProperty.call(pub, rk) && rk !== '_oab') rawClean[rk] = pub[rk];
    }

    const docPayload = {
      hash: hash,
      escritorio_id: DJEN_CRON_ESCRITORIO_ID,
      cnj: cnjFormatted,
      processId: proc ? (proc.id || proc._docId || null) : null,
      tribunal: pub.siglaTribunal || pub.tribunal || '',
      orgao: pub.nomeOrgao || pub.orgao || '',
      tipo: pub.tipoComunicacao || pub.tipo_comunicacao || 'Intimação',
      dataDisponibilizacao: pub.data_disponibilizacao || pub.data_publicacao || '',
      texto: pub.texto || '',
      link: pub.link || '',
      oab: { numero: String(pub._oab.numero), uf: String(pub._oab.uf), nome: String(pub._oab.nome || '') },
      raw: rawClean,
      // Status: 'pending' = cron pre-fetch, ainda não triado. App move pra
      // 'imported' (vinculou) ou 'orphan' (sem processo cadastrado) ao
      // user importar/dispensar.
      status: 'pending',
      source: 'djen-cron',
      matched: matched,
      fetchedAt: tNow,
      importedAt: null,
      createdAt: tNow,
      updatedAt: tNow,
      updatedBy: 'djen-cron',
      deletedAt: null
    };

    if (!dryRun) {
      try {
        _firestoreSet(path, docPayload);
      } catch (e) {
        Logger.log(logPrefix + ' falhou salvar ' + hash + ': ' + e.message);
        continue;
      }
    }
    if (matched) novasVinculadas++;
    else novasOrfas++;
  }
  Logger.log(logPrefix + ' novas: ' + novasVinculadas + ' vinculadas + ' + novasOrfas + ' órfãs · skip ' + skipExistente + ' já existentes');

  // ---- 6. Dispara push FCM se houver novas -------------------------
  if ((novasVinculadas + novasOrfas) > 0 && !dryRun) {
    _djenEnviarPush(novasVinculadas, novasOrfas);
  }

  // ---- 7. Atualiza state -------------------------------------------
  if (!dryRun) {
    _firestoreSet('settings/djenCron', {
      value: Object.assign({}, cfg, {
        lastRun: tNow,
        lastDataFim: fim,
        lastNovas: novasVinculadas,
        lastOrfas: novasOrfas
      }),
      updatedAt: tNow
    });
  }

  Logger.log(logPrefix + ' === done ===');
  return {
    fetched: allPubs.length,
    novas: novasVinculadas,
    orfas: novasOrfas,
    skipExistente: skipExistente
  };
}

// =====================================================================
// FCM — dispara pros tokens em settings/fcmTokens
// =====================================================================

function _djenEnviarPush(novas, orfas) {
  const fcmDoc = _firestoreGet('settings/fcmTokens');
  const tokens = (fcmDoc && fcmDoc.value) || {};
  const emails = Object.keys(tokens);
  if (emails.length === 0) {
    Logger.log('[DJEN cron] sem tokens FCM cadastrados — push pulado');
    return;
  }

  const title = '🔔 UC Jurídico — DJEN';
  var body;
  if (novas > 0 && orfas > 0) {
    body = novas + (novas > 1 ? ' publicações' : ' publicação') + ' vinculada(s) + ' + orfas + ' órfã(s)';
  } else if (novas > 0) {
    body = novas + (novas > 1 ? ' novas publicações vinculadas' : ' nova publicação vinculada') + ' a processo(s)';
  } else {
    body = orfas + (orfas > 1 ? ' novas publicações' : ' nova publicação') + ' de processo(s) não cadastrado(s)';
  }

  const data = {
    type: 'djen_cron',
    novas: String(novas),
    orfas: String(orfas),
    timestamp: String(Date.now())
  };

  var pushed = 0;
  const invalidos = [];
  for (var i = 0; i < emails.length; i++) {
    const email = emails[i];
    const tokenInfo = tokens[email];
    if (!tokenInfo || !tokenInfo.token) continue;
    const r = enviarFcmPush(tokenInfo.token, title, body, data);
    if (r.ok) {
      pushed++;
    } else {
      Logger.log('[DJEN cron] FCM ' + email + ' falhou code=' + r.code);
      // Token expirado/inválido — marca pra remover
      if (r.code === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(r.response || '')) {
        invalidos.push(email);
      }
    }
  }
  Logger.log('[DJEN cron] push enviado pra ' + pushed + '/' + emails.length + ' device(s)');

  // Cleanup tokens inválidos
  if (invalidos.length > 0) {
    const cleanTokens = {};
    for (var j = 0; j < emails.length; j++) {
      if (invalidos.indexOf(emails[j]) < 0) {
        cleanTokens[emails[j]] = tokens[emails[j]];
      }
    }
    try {
      _firestoreUpdate('settings/fcmTokens', {
        value: cleanTokens,
        updatedAt: Date.now()
      });
      Logger.log('[DJEN cron] cleanup tokens: removidos ' + invalidos.length);
    } catch (e) {
      Logger.log('[DJEN cron] cleanup tokens falhou: ' + e.message);
    }
  }
}

// =====================================================================
// TRIGGER WRAPPER + TESTES MANUAIS
// =====================================================================

/**
 * Trigger entry point. Configurar em Triggers (time-driven, diário 08h).
 * Engloba try/catch pra não quebrar agendamento.
 */
function cron_djenAutoCheck() {
  try {
    const r = djenAutoCheckCron();
    Logger.log('[DJEN cron] resultado: ' + JSON.stringify(r));
  } catch (e) {
    Logger.log('[DJEN cron] ERRO: ' + e.message + '\n' + (e.stack || ''));
    // Email alerta pro admin
    try {
      MailApp.sendEmail({
        to: 'eduardourany@uranydecastro.com.br',
        subject: '[UC Jurídico] Cron DJEN falhou',
        body: 'O cron djenAutoCheckCron falhou:\n\n' + e.message + '\n\n' + (e.stack || '')
      });
    } catch (_) {}
  }
}

/**
 * Roda como cron mas sem gravar nem enviar push. Use pra testar a query.
 */
function _previewDjenCron() {
  const r = djenAutoCheckCron({ dryRun: true });
  Logger.log('Preview result: ' + JSON.stringify(r));
  return r;
}

/**
 * Roda o cron de verdade. CUIDADO em produção (vai mandar push).
 */
function _testarDjenCron() {
  cron_djenAutoCheck();
}

/**
 * Reset do lastRun pra forçar próxima execução varrer mais dias atrás.
 */
function _resetDjenCron() {
  _firestoreSet('settings/djenCron', {
    value: { enabled: true, lastRun: 0 },
    updatedAt: Date.now()
  });
  Logger.log('settings/djenCron resetado');
}

/**
 * Diagnóstico: 1 fetch isolado à API DJEN com log de tudo.
 * Use pra investigar HTTP 403 / bloqueio / parsing.
 * NÃO grava nada nem manda push.
 */
function _diagDjenApi() {
  // OAB de teste — Eduardo Urany GO (com publicações esperadas)
  const oab = { numero: '16539', uf: 'GO', nome: 'Eduardo' };
  // Janela: últimos 7 dias úteis pra garantir que tem dados
  const fim = new Date();
  fim.setDate(fim.getDate() - 1);
  const inicio = new Date(fim);
  inicio.setDate(fim.getDate() - 7);
  const fmt = d => d.toISOString().slice(0,10);

  const params = {
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: fmt(inicio),
    dataDisponibilizacaoFim: fmt(fim),
    itensPorPagina: 5,
    pagina: 1
  };
  const qs = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const url = DJEN_API_URL + '?' + qs;

  Logger.log('=== DIAG DJEN API ===');
  Logger.log('URL: ' + url);
  Logger.log('Janela: ' + fmt(inicio) + ' → ' + fmt(fim));

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': 'https://comunicaapi.pje.jus.br/'
    },
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const respHeaders = resp.getAllHeaders();
  const body = resp.getContentText();
  Logger.log('HTTP ' + code);
  Logger.log('Response headers: ' + JSON.stringify(respHeaders));
  Logger.log('Body (primeiros 1500 chars): ' + body.slice(0, 1500));

  if (code === 200) {
    try {
      const data = JSON.parse(body);
      Logger.log('Items: ' + (data.items ? data.items.length : 'N/A'));
      Logger.log('TotalRegistros: ' + (data.count || data.totalRegistros || 'N/A'));
    } catch (e) {
      Logger.log('JSON parse falhou: ' + e.message);
    }
  } else {
    Logger.log('FAIL — ver headers/body acima pra diagnóstico');
    if (code === 403) Logger.log('Dica: WAF bloqueia IP Google Cloud ou User-Agent. Tentar via Cloudflare Worker proxy.');
  }
}
