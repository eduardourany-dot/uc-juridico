// UC Jurídico — Cobrança insistente (F1a, portada da Agenda UC)
//
// Filosofia: "um compromisso não some da tela enquanto não for cumprido"
// (Agenda UC · HANDOFF 30/08/2026). Prazos, compromissos e tarefas
// vencidos e não terminais recebem push a cada N horas até serem
// resolvidos ou até o responsável adiar/passar pra amanhã.
//
// Escopo desta Fase A: BACKEND + MODELO. A tela travante da 3ª cobrança
// (overlay full-screen) fica pra Fase B — aqui só marcamos
// `insistenteAcionado=true` no doc pra o frontend saber quando abrir.
//
// Config vive em settings/cobrancaConfig.value (single source, editável
// pelo frontend em Ajustes). Defaults abaixo cobrem o caso sem config.
//
// Cron: a cada 30 min, região SP. Silêncio noturno 22h–06h (Brasília).

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

// =====================================================================
// CONSTANTES
// =====================================================================

const DEFAULT_CONFIG = {
  enabled: true,
  intervaloHoras: 4,           // 4h entre cobranças (Agenda UC usa 1h; UCJ escolheu 4h)
  silencioInicioHora: 22,      // silêncio começa 22h
  silencioFimHora: 6,          // silêncio termina 6h
  insistenteLimite: 3,         // 3+ cobranças → marca insistenteAcionado (Fase B trava tela)
  escopo: { prazos: true, compromissos: true, tarefas: true },
  optOutEmails: []             // e-mails que não recebem cobrança (nem token)
};

const STATUS_TERMINAIS = {
  prazos:       new Set(['cumprido', 'perdido', 'cancelado']),
  compromissos: new Set(['cancelado', 'realizado']),
  tarefas:      new Set(['concluida', 'cancelada'])
};

// Campo de data de vencimento por coleção.
const CAMPO_DATA = {
  prazos:       'deadlineDate',
  compromissos: 'dataHoraInicio',
  tarefas:      'prazoData'
};

// =====================================================================
// HELPERS
// =====================================================================

// Silêncio noturno: se inicio > fim, atravessa meia-noite (ex 22..06).
function _estaEmSilencio(inicioHora, fimHora, hora) {
  if (inicioHora === fimHora) return false;
  if (inicioHora > fimHora) return hora >= inicioHora || hora < fimHora;
  return hora >= inicioHora && hora < fimHora;
}

// Hora do dia em São Paulo (UTC-3, sem DST desde 2019).
function _horaBrasilia(agoraUtc) {
  const utcMs = agoraUtc.getTime() + agoraUtc.getTimezoneOffset() * 60000;
  const spMs = utcMs + (-3) * 60 * 60000;
  return new Date(spMs).getHours();
}

async function _loadConfig(db) {
  try {
    const snap = await db.doc('settings/cobrancaConfig').get();
    if (!snap.exists) return { ...DEFAULT_CONFIG };
    const v = snap.data().value || {};
    return {
      ...DEFAULT_CONFIG,
      ...v,
      escopo: { ...DEFAULT_CONFIG.escopo, ...(v.escopo || {}) }
    };
  } catch (e) {
    logger.warn('[cobranca] falha ao carregar config: ' + (e.message || e));
    return { ...DEFAULT_CONFIG };
  }
}

// Mapeia nome (upper case) → email do advogado, a partir de
// settings/quadroAdvogados.value ({email: nome}). Se doc não existir,
// retorna {} — cobrança rola sem push individualizado.
async function _loadQuadroAdvogados(db) {
  try {
    const snap = await db.doc('settings/quadroAdvogados').get();
    if (!snap.exists) return {};
    const v = snap.data().value || {};
    const byNome = {};
    for (const [email, nome] of Object.entries(v)) {
      if (!email || !nome) continue;
      byNome[String(nome).toUpperCase().trim()] = String(email).toLowerCase();
    }
    return byNome;
  } catch (e) {
    logger.warn('[cobranca] falha ao carregar quadro: ' + (e.message || e));
    return {};
  }
}

async function _loadFcmTokens(db) {
  try {
    const snap = await db.doc('settings/fcmTokens').get();
    if (!snap.exists) return {};
    return snap.data().value || {};
  } catch (e) {
    logger.warn('[cobranca] falha ao carregar fcmTokens: ' + (e.message || e));
    return {};
  }
}

// Nome → email via quadro; se falhar, tenta prefixo do primeiro nome.
function _emailPorNome(nome, byNome) {
  if (!nome) return null;
  const key = String(nome).toUpperCase().trim();
  if (!key) return null;
  if (byNome[key]) return byNome[key];
  const first = key.split(/\s+/)[0];
  for (const [k, v] of Object.entries(byNome)) {
    if (k.startsWith(first + ' ') || k === first) return v;
  }
  return null;
}

async function _enviarPush(messaging, token, dataPayload) {
  try {
    await messaging.send({ token, data: dataPayload });
    return true;
  } catch (e) {
    logger.warn('[cobranca push] ' + (e.code || '') + ' ' + (e.message || e));
    return false;
  }
}

// =====================================================================
// CORE
// =====================================================================

async function _processarColecao(db, messaging, colecao, cfg, byNome, fcmTokens, agora) {
  const agoraMs = agora.getTime();
  const intervaloMs = cfg.intervaloHoras * 60 * 60 * 1000;
  const campoData = CAMPO_DATA[colecao];
  const terminais = STATUS_TERMINAIS[colecao];

  const snap = await db.collection(colecao).get();
  let cobrados = 0, semToken = 0, marcadosInsistente = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.deletedAt) continue;
    if (terminais.has(d.status)) continue;
    if (d.cobrar === false) continue;
    if (d.silencioAte && agoraMs < Number(d.silencioAte)) continue;

    const rawData = d[campoData];
    if (!rawData) continue;
    const dataVenc = new Date(rawData);
    if (isNaN(dataVenc)) continue;
    // Prazos e tarefas são data-only: considera vencido no fim do dia.
    if (colecao !== 'compromissos') dataVenc.setHours(23, 59, 59, 999);
    if (agora < dataVenc) continue;

    // Intervalo respeitado?
    const ultima = Number(d.ultimaCobrancaAt || 0);
    if (ultima && (agoraMs - ultima) < intervaloMs) continue;

    // Cobra!
    const cobrancasNova = (Number(d.cobrancas) || 0) + 1;
    const responsavelNome = d.responsavel || d.responsavelNome || null;
    const emailResp = _emailPorNome(responsavelNome, byNome);
    let pushEnviado = false;

    if (emailResp && !cfg.optOutEmails.includes(emailResp)) {
      const tokenInfo = fcmTokens[emailResp];
      const token = tokenInfo && tokenInfo.token;
      if (token) {
        const titulo = d.titulo || d.description || d.type || d.assunto || 'Pendência';
        const dataStr = colecao === 'compromissos'
          ? dataVenc.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
          : dataVenc.toLocaleDateString('pt-BR');
        pushEnviado = await _enviarPush(messaging, token, {
          type: 'cobranca_insistente',
          title: `${cobrancasNova}ª cobrança — ${titulo}`.slice(0, 240),
          body: `Vencido em ${dataStr} · segue pendente`,
          cobrancas: String(cobrancasNova),
          colecao,
          docId: doc.id,
          insistente: String(cobrancasNova >= cfg.insistenteLimite),
          timestamp: String(agoraMs),
          tag: `cobranca-${colecao}-${doc.id}`
        });
      } else {
        semToken++;
      }
    } else {
      semToken++;
    }

    const update = {
      cobrancas: cobrancasNova,
      ultimaCobrancaAt: agoraMs,
      updatedAt: agoraMs
    };
    if (cobrancasNova >= cfg.insistenteLimite && !d.insistenteAcionado) {
      update.insistenteAcionado = true;
      marcadosInsistente++;
    }
    try {
      await doc.ref.set(update, { merge: true });
      if (pushEnviado || cobrancasNova >= cfg.insistenteLimite) cobrados++;
    } catch (e) {
      logger.warn('[cobranca] update ' + colecao + '/' + doc.id + ' falhou: ' + e.message);
    }
  }

  return { cobrados, semToken, marcadosInsistente, total: snap.size };
}

async function runCobrancaInsistente(dryRun = false) {
  const db = getFirestore();
  const messaging = getMessaging();
  const agora = new Date();

  const cfg = await _loadConfig(db);
  if (cfg.enabled === false) {
    logger.info('[cobranca] desativada em settings/cobrancaConfig.value.enabled');
    return { skipped: 'disabled' };
  }

  const horaSP = _horaBrasilia(agora);
  if (_estaEmSilencio(cfg.silencioInicioHora, cfg.silencioFimHora, horaSP)) {
    logger.info(`[cobranca] silêncio noturno (SP ${horaSP}h · janela ${cfg.silencioInicioHora}-${cfg.silencioFimHora}) — pulando`);
    return { skipped: 'silencio_noturno', horaSP };
  }

  const [byNome, fcmTokens] = await Promise.all([
    _loadQuadroAdvogados(db),
    _loadFcmTokens(db)
  ]);

  logger.info(`[cobranca] iniciando · advogados no quadro: ${Object.keys(byNome).length} · tokens FCM: ${Object.keys(fcmTokens).length} · intervalo: ${cfg.intervaloHoras}h`);

  const resultado = { prazos: null, compromissos: null, tarefas: null, horaSP };
  if (cfg.escopo.prazos) {
    resultado.prazos = await _processarColecao(db, messaging, 'prazos', cfg, byNome, fcmTokens, agora);
  }
  if (cfg.escopo.compromissos) {
    resultado.compromissos = await _processarColecao(db, messaging, 'compromissos', cfg, byNome, fcmTokens, agora);
  }
  if (cfg.escopo.tarefas) {
    resultado.tarefas = await _processarColecao(db, messaging, 'tarefas', cfg, byNome, fcmTokens, agora);
  }

  logger.info('[cobranca] resultado: ' + JSON.stringify(resultado));
  return resultado;
}

// =====================================================================
// EXPORTS
// =====================================================================

// Cron a cada 30min. Filtro de silêncio 22-06 acontece dentro do run.
exports.cobrancaInsistenteCron = onSchedule({
  schedule: '*/30 * * * *',
  timeZone: 'America/Sao_Paulo',
  region: 'southamerica-east1',
  memory: '256MiB',
  timeoutSeconds: 300,
  retryCount: 0
}, async () => {
  try {
    const r = await runCobrancaInsistente(false);
    logger.info('[cobranca cron] ' + JSON.stringify(r));
  } catch (e) {
    logger.error('[cobranca cron] ERRO: ' + (e && e.message || String(e)), e);
  }
});

// Exports pra teste manual futuro (Fase B pode adicionar HTTP trigger).
exports.runCobrancaInsistente = runCobrancaInsistente;
