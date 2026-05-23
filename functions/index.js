// UC Jurídico — Cloud Functions (Firebase v2)
//
// Roda em southamerica-east1 (São Paulo) — IP brasileiro. Necessário pra
// acessar a API DJEN do CNJ, que tem geo-restriction via CloudFront e
// bloqueia requests fora do Brasil.
//
// Funções:
//   - djenAutoCheckCron: scheduled diário 08h (dias úteis). Varre DJEN
//     pra cada OAB cadastrada, salva publicações novas em djen/{hash}
//     com status='pending', dispara FCM push pros tokens registrados.
//   - djenAutoCheckHttp: HTTP trigger pra teste manual (executar via
//     curl ou navegador autenticado).
//
// Deploy:
//   cd functions && npm install
//   firebase deploy --only functions

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// =====================================================================
// CONFIG
// =====================================================================

const DJEN_API_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const DJEN_ESCRITORIO_ID = 'UC';

// OABs varridas — espelho da DJEN_DEFAULT_OABS no app (index.html).
// Pra editar sem redeploy, mover pra settings/djenCron.oabs no Firestore.
const DJEN_OABS = [
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

// Headers de browser real — alguns WAFs do CNJ rejeitam UAs de bot
const BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
};

// =====================================================================
// HELPERS
// =====================================================================

function _normalizeCnj(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/\D/g, '');
  if (d.length !== 20) return String(raw);
  return d.slice(0,7) + '-' + d.slice(7,9) + '.' + d.slice(9,13) + '.' + d.slice(13,14) + '.' + d.slice(14,16) + '.' + d.slice(16,20);
}

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

async function _djenFetchPage(oab, dataInicio, dataFim, pagina) {
  const params = new URLSearchParams({
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: dataInicio,
    dataDisponibilizacaoFim: dataFim,
    itensPorPagina: '100',
    pagina: String(pagina)
  });
  const url = `${DJEN_API_URL}?${params}`;
  try {
    const resp = await fetch(url, { method: 'GET', headers: BROWSER_HEADERS });
    if (!resp.ok) {
      logger.warn(`[DJEN] OAB ${oab.numero}/${oab.uf} pg${pagina} HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return data.items || [];
  } catch (e) {
    logger.warn(`[DJEN] OAB ${oab.numero}/${oab.uf} fetch error: ${e.message}`);
    return [];
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =====================================================================
// CORE
// =====================================================================

/**
 * Função principal. Idempotente — pode rodar duas vezes no mesmo dia
 * sem criar duplicatas (skipa hash já existente).
 *
 * @param {boolean} dryRun - se true, não grava nem manda push
 */
async function runDjenAutoCheck(dryRun = false) {
  const tNow = Date.now();
  const logPrefix = dryRun ? '[DJEN · DRY]' : '[DJEN]';
  logger.info(`${logPrefix} === iniciando ${new Date(tNow).toISOString()} ===`);

  // ---- 1. Config -----------------------------------------------------
  const cfgSnap = await db.doc('settings/djenCron').get();
  const cfg = cfgSnap.exists ? (cfgSnap.data().value || {}) : {};
  if (cfg.enabled === false) {
    logger.info(`${logPrefix} cron desativado em settings/djenCron.value.enabled`);
    return { skipped: 'disabled' };
  }
  const lastRun = cfg.lastRun || 0;

  // ---- 2. Janela: ontem (ou desde lastRun, cap 7d) -------------------
  const ontem = new Date(tNow);
  ontem.setDate(ontem.getDate() - 1);
  const fim = ontem.toISOString().slice(0, 10);
  let inicio = fim;
  if (lastRun) {
    const cap7d = tNow - 7 * 24 * 60 * 60 * 1000;
    const inicioMs = Math.max(lastRun - 24 * 60 * 60 * 1000, cap7d);
    inicio = new Date(inicioMs).toISOString().slice(0, 10);
  }
  logger.info(`${logPrefix} janela ${inicio} → ${fim}`);

  // ---- 3. Fetch DJEN pra todas as OABs -------------------------------
  const allPubs = [];
  for (let i = 0; i < DJEN_OABS.length; i++) {
    if (i > 0) await _sleep(250);
    const oab = DJEN_OABS[i];
    let pagina = 1;
    while (pagina <= 20) {
      const items = await _djenFetchPage(oab, inicio, fim, pagina);
      if (!items.length) break;
      items.forEach(it => { it._oab = oab; allPubs.push(it); });
      if (items.length < 100) break;
      pagina++;
      await _sleep(150);
    }
  }
  logger.info(`${logPrefix} total pubs fetched: ${allPubs.length}`);

  if (allPubs.length === 0) {
    if (!dryRun) {
      await db.doc('settings/djenCron').set({
        value: { ...cfg, lastRun: tNow, lastDataFim: fim, lastNovas: 0, lastOrfas: 0 },
        updatedAt: tNow
      }, { merge: true });
    }
    return { fetched: 0, novas: 0, orfas: 0 };
  }

  // ---- 4. Indexa processos do escritório por CNJ ---------------------
  const procsSnap = await db.collection('processos').get();
  const cnjIndex = {};
  procsSnap.forEach(d => {
    const p = d.data();
    if (p.deletedAt || p.escritorio_id !== DJEN_ESCRITORIO_ID) return;
    if (p.cnj) {
      const k = String(p.cnj).replace(/\D/g, '');
      if (k) cnjIndex[k] = p;
    }
  });
  logger.info(`${logPrefix} processos indexados: ${Object.keys(cnjIndex).length}`);

  // ---- 5. Salva pubs novas em djen/{hash} ----------------------------
  let novasVinculadas = 0;
  let novasOrfas = 0;
  let skipExistente = 0;

  for (const pub of allPubs) {
    const hash = _djenComputeHash(pub);
    const ref = db.doc(`djen/${hash}`);
    const existing = await ref.get();
    if (existing.exists && existing.data().hash) {
      skipExistente++;
      continue;
    }

    const cnjRaw = pub.numero_processo || pub.numeroProcesso || '';
    const cnjDigits = String(cnjRaw).replace(/\D/g, '');
    const cnjFormatted = _normalizeCnj(cnjRaw);
    const proc = cnjIndex[cnjDigits];
    const matched = !!proc;

    const rawClean = { ...pub };
    delete rawClean._oab;

    const docPayload = {
      hash,
      escritorio_id: DJEN_ESCRITORIO_ID,
      cnj: cnjFormatted,
      processId: proc ? (proc.id || null) : null,
      tribunal: pub.siglaTribunal || pub.tribunal || '',
      orgao: pub.nomeOrgao || pub.orgao || '',
      tipo: pub.tipoComunicacao || pub.tipo_comunicacao || 'Intimação',
      dataDisponibilizacao: pub.data_disponibilizacao || pub.data_publicacao || '',
      texto: pub.texto || '',
      link: pub.link || '',
      oab: { numero: String(pub._oab.numero), uf: String(pub._oab.uf), nome: String(pub._oab.nome || '') },
      raw: rawClean,
      status: 'pending',
      source: 'djen-cron',
      matched,
      fetchedAt: tNow,
      importedAt: null,
      createdAt: tNow,
      updatedAt: tNow,
      updatedBy: 'djen-cron',
      deletedAt: null
    };

    if (!dryRun) {
      try {
        await ref.set(docPayload);
      } catch (e) {
        logger.warn(`${logPrefix} falhou salvar ${hash}: ${e.message}`);
        continue;
      }
    }
    if (matched) novasVinculadas++; else novasOrfas++;
  }
  logger.info(`${logPrefix} novas: ${novasVinculadas} vinculadas + ${novasOrfas} órfãs · skip ${skipExistente} já existentes`);

  // ---- 6. Push FCM ---------------------------------------------------
  if ((novasVinculadas + novasOrfas) > 0 && !dryRun) {
    await _enviarPushDjen(novasVinculadas, novasOrfas);
  }

  // ---- 7. Atualiza state ---------------------------------------------
  if (!dryRun) {
    await db.doc('settings/djenCron').set({
      value: { ...cfg, lastRun: tNow, lastDataFim: fim, lastNovas: novasVinculadas, lastOrfas: novasOrfas },
      updatedAt: tNow
    }, { merge: true });
  }

  return {
    fetched: allPubs.length,
    novas: novasVinculadas,
    orfas: novasOrfas,
    skipExistente
  };
}

async function _enviarPushDjen(novas, orfas) {
  const fcmSnap = await db.doc('settings/fcmTokens').get();
  if (!fcmSnap.exists) {
    logger.info('[DJEN push] settings/fcmTokens não existe — pulando');
    return;
  }
  const tokens = (fcmSnap.data().value) || {};
  const emails = Object.keys(tokens);
  if (emails.length === 0) {
    logger.info('[DJEN push] sem tokens cadastrados — pulando');
    return;
  }

  let body;
  if (novas > 0 && orfas > 0) body = `${novas} vinculada(s) + ${orfas} órfã(s)`;
  else if (novas > 0) body = `${novas} ${novas > 1 ? 'novas publicações vinculadas' : 'nova publicação vinculada'} a processo(s)`;
  else body = `${orfas} ${orfas > 1 ? 'novas publicações' : 'nova publicação'} de processo(s) não cadastrado(s)`;

  const dataPayload = {
    type: 'djen_cron',
    title: '🔔 UC Jurídico — DJEN',
    body,
    novas: String(novas),
    orfas: String(orfas),
    timestamp: String(Date.now()),
    tag: 'djen-cron'
  };

  let pushed = 0;
  const invalidos = [];
  for (const email of emails) {
    const tokenInfo = tokens[email];
    if (!tokenInfo || !tokenInfo.token) continue;
    try {
      await messaging.send({
        token: tokenInfo.token,
        data: dataPayload
      });
      pushed++;
    } catch (e) {
      logger.warn(`[DJEN push] ${email}: ${e.code || ''} ${e.message || ''}`);
      const code = e.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        invalidos.push(email);
      }
    }
  }
  logger.info(`[DJEN push] enviado pra ${pushed}/${emails.length} device(s)`);

  if (invalidos.length > 0) {
    const cleanTokens = { ...tokens };
    invalidos.forEach(e => { delete cleanTokens[e]; });
    try {
      await db.doc('settings/fcmTokens').set({
        value: cleanTokens,
        updatedAt: Date.now()
      }, { merge: true });
      logger.info(`[DJEN push] cleanup: removidos ${invalidos.length} tokens inválidos`);
    } catch (e) {
      logger.warn(`[DJEN push] cleanup falhou: ${e.message}`);
    }
  }
}

// =====================================================================
// EXPORTS — Scheduled + HTTP (teste)
// =====================================================================

// Cron diário 08h Brasília, dias úteis (Seg-Sex).
// Cron syntax: minuto hora diaMes mes diaSemana
//   "0 8 * * 1-5" = todo dia de semana às 08h00
exports.djenAutoCheckCron = onSchedule({
  schedule: '0 8 * * 1-5',
  timeZone: 'America/Sao_Paulo',
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 540,  // 9min — fetch de 11 OABs pode demorar
  retryCount: 1
}, async (event) => {
  try {
    const r = await runDjenAutoCheck(false);
    logger.info('[DJEN cron] resultado: ' + JSON.stringify(r));
  } catch (e) {
    logger.error('[DJEN cron] ERRO: ' + (e && e.message || String(e)), e);
    throw e;
  }
});

// HTTP trigger pra teste manual. Acessar via:
//   curl "https://southamerica-east1-uc-juridico.cloudfunctions.net/djenAutoCheckHttp?dry=1"
// dry=1 → não grava nem manda push
exports.djenAutoCheckHttp = onRequest({
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 540,
  cors: false
}, async (req, res) => {
  // Auth: query param ?secret=... compara com env var.
  // Pra setar: firebase functions:secrets:set DJEN_HTTP_SECRET
  //
  // FAIL-CLOSED: se o secret não estiver configurado no ambiente, NEGA o
  // acesso (em vez de liberar geral). Antes era fail-open — sem env var, a
  // checagem era pulada e qualquer um podia disparar a função (que escreve
  // no Firestore via Admin SDK e dispara push). O cron interno
  // (djenAutoCheckCron via onSchedule) não passa por aqui, então fechar
  // este endpoint não afeta o agendamento automático.
  const secret = String(req.query.secret || '');
  const expected = process.env.DJEN_HTTP_SECRET || '';
  if (!expected || secret !== expected) {
    res.status(403).json({ erro: 'secret_inválido' });
    return;
  }

  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const r = await runDjenAutoCheck(dryRun);
    res.json({ ok: true, dryRun, ...r });
  } catch (e) {
    logger.error('[DJEN http] ERRO', e);
    res.status(500).json({ erro: e.message || String(e) });
  }
});
