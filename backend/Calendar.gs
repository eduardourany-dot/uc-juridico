/**
 * Calendar.gs — Integração Google Calendar + Meet pro módulo Agenda.
 *
 * Cria/atualiza/cancela eventos na agenda da conta que roda este Web App
 * (uranydecastro@uranydecastro.com.br · Workspace), gerando link Google
 * Meet automaticamente e enviando convite por e-mail aos participantes.
 *
 * PRÉ-REQUISITOS (configurar 1x no editor Apps Script):
 *   1. Serviços → adicionar "Google Calendar API" (Advanced Service).
 *      Sem isso, `Calendar.Events.insert` lança ReferenceError.
 *   2. Web App publicado com "Executar como: Eu (uranydecastro@)" —
 *      os eventos caem na agenda 'primary' dessa conta.
 *   3. Primeira execução pede autorização do scope calendar.
 *
 * Actions expostas (registradas no switch do Codigo.gs handle_):
 *   criarEventoCalendar     POST  → cria evento+Meet+convite, retorna {eventId, meetLink, htmlLink}
 *   atualizarEventoCalendar POST  → patch (re-notifica convidados)
 *   cancelarEventoCalendar  POST  → remove (notifica cancelamento)
 *   rsvpEventoCalendar      POST  → lê respostas dos convidados (Fase 3),
 *                                   retorna {convidados:[{email, nome, organizador, resposta, comentario}]}
 *
 * Body esperado (criar/atualizar):
 *   {
 *     eventId?:    string         // só em atualizar
 *     titulo:      string
 *     descricao?:  string
 *     local?:      string
 *     inicioISO:   string         // ISO 8601 com timezone
 *     fimISO?:     string         // se ausente, +1h do início
 *     convidados?: [{ email, nome? }]
 *     lembretes?:  [{ method:'email'|'popup', minutes:int }]  // default: email 1 dia + popup 30min
 *     gerarMeet?:  boolean        // default true
 *   }
 */

var UC_CAL_TZ = 'America/Sao_Paulo';
var UC_CAL_ID = 'primary';
var UC_CAL_MAX_CONVIDADOS = 50;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function _calValidarEmail_(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

// Monta o objeto de attendees a partir da lista de convidados,
// deduplicando por e-mail (lowercase) e ignorando inválidos.
function _calMontarAttendees_(convidados) {
  if (!Array.isArray(convidados)) return [];
  var vistos = {};
  var out = [];
  for (var i = 0; i < convidados.length; i++) {
    var c = convidados[i] || {};
    var email = String(c.email || '').trim().toLowerCase();
    if (!_calValidarEmail_(email)) continue;
    if (vistos[email]) continue;
    vistos[email] = true;
    var att = { email: email };
    if (c.nome) att.displayName = String(c.nome).slice(0, 200);
    out.push(att);
    if (out.length >= UC_CAL_MAX_CONVIDADOS) break;
  }
  return out;
}

// Lembretes padrão se o cliente não passar nada.
function _calMontarReminders_(lembretes) {
  var overrides = [];
  if (Array.isArray(lembretes) && lembretes.length > 0) {
    for (var i = 0; i < lembretes.length; i++) {
      var l = lembretes[i] || {};
      var method = (l.method === 'email' || l.method === 'popup') ? l.method : 'popup';
      var minutes = Math.max(0, Math.min(40320, parseInt(l.minutes, 10) || 0)); // até 4 semanas
      overrides.push({ method: method, minutes: minutes });
    }
  } else {
    overrides = [
      { method: 'email', minutes: 24 * 60 },  // 1 dia antes (e-mail)
      { method: 'popup', minutes: 30 }         // 30 min antes (popup)
    ];
  }
  return { useDefault: false, overrides: overrides };
}

// Monta o corpo do evento (compartilhado entre criar e atualizar).
function _calMontarEvento_(body) {
  var titulo = String(body.titulo || '').trim();
  if (!titulo) throw new Error('titulo_obrigatorio');
  var inicioISO = String(body.inicioISO || '').trim();
  if (!inicioISO) throw new Error('inicio_obrigatorio');

  var inicio = new Date(inicioISO);
  if (isNaN(inicio.getTime())) throw new Error('inicio_invalido');

  var fim;
  if (body.fimISO) {
    fim = new Date(body.fimISO);
    if (isNaN(fim.getTime())) throw new Error('fim_invalido');
  } else {
    fim = new Date(inicio.getTime() + 60 * 60 * 1000); // +1h default
  }
  if (fim.getTime() <= inicio.getTime()) {
    fim = new Date(inicio.getTime() + 60 * 60 * 1000);
  }

  var event = {
    summary: titulo,
    start: { dateTime: inicio.toISOString(), timeZone: UC_CAL_TZ },
    end:   { dateTime: fim.toISOString(),    timeZone: UC_CAL_TZ },
    reminders: _calMontarReminders_(body.lembretes)
  };
  if (body.descricao) event.description = String(body.descricao).slice(0, 8000);
  if (body.local) event.location = String(body.local).slice(0, 1000);

  var attendees = _calMontarAttendees_(body.convidados);
  if (attendees.length > 0) event.attendees = attendees;

  return event;
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

function actionCriarEventoCalendar_(ctx) {
  if (typeof Calendar === 'undefined') {
    throw new Error('calendar_api_nao_habilitada'); // Serviço não adicionado no editor
  }
  var body = ctx.body || {};
  var event = _calMontarEvento_(body);

  var options = { sendUpdates: 'all' };
  var gerarMeet = body.gerarMeet !== false; // default true
  if (gerarMeet) {
    event.conferenceData = {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    };
    options.conferenceDataVersion = 1;
  }

  var created = Calendar.Events.insert(event, UC_CAL_ID, options);

  return {
    ok: true,
    eventId: created.id,
    meetLink: created.hangoutLink || _calExtrairMeetUri_(created),
    htmlLink: created.htmlLink,
    status: created.status
  };
}

function actionAtualizarEventoCalendar_(ctx) {
  if (typeof Calendar === 'undefined') {
    throw new Error('calendar_api_nao_habilitada');
  }
  var body = ctx.body || {};
  var eventId = String(body.eventId || '').trim();
  if (!eventId) throw new Error('eventId_obrigatorio');

  // Busca o evento atual: (1) confirma que existe; (2) preserva campos que
  // não reenviamos (conferenceData/Meet, organizador, etc); (3) o update
  // completo (PUT) dispara a notificação de alteração de forma mais
  // confiável que o patch — que no Apps Script às vezes não reenvia e-mail.
  var existing;
  try {
    existing = Calendar.Events.get(UC_CAL_ID, eventId);
  } catch (err) {
    if (_calIsNotFound_(err)) {
      return { ok: false, erro: 'evento_nao_encontrado', limparVinculo: true };
    }
    throw err;
  }

  // Aplica as mudanças sobre o evento existente (mantém conferenceData/Meet).
  var novo = _calMontarEvento_(body);
  existing.summary = novo.summary;
  existing.start = novo.start;
  existing.end = novo.end;
  existing.reminders = novo.reminders;
  existing.description = novo.description || '';
  existing.location = novo.location || '';
  existing.attendees = novo.attendees || [];

  var options = { sendUpdates: 'all', conferenceDataVersion: 1 };

  var updated;
  try {
    updated = Calendar.Events.update(existing, UC_CAL_ID, eventId, options);
  } catch (err) {
    if (_calIsNotFound_(err)) {
      return { ok: false, erro: 'evento_nao_encontrado', limparVinculo: true };
    }
    throw err;
  }

  return {
    ok: true,
    eventId: updated.id,
    meetLink: updated.hangoutLink || _calExtrairMeetUri_(updated),
    htmlLink: updated.htmlLink,
    status: updated.status,
    notificados: (updated.attendees || []).length
  };
}

function actionCancelarEventoCalendar_(ctx) {
  if (typeof Calendar === 'undefined') {
    throw new Error('calendar_api_nao_habilitada');
  }
  var body = ctx.body || {};
  var eventId = String(body.eventId || '').trim();
  if (!eventId) throw new Error('eventId_obrigatorio');

  try {
    Calendar.Events.remove(UC_CAL_ID, eventId, { sendUpdates: 'all' });
  } catch (err) {
    if (_calIsNotFound_(err)) {
      // Já não existe — idempotente, sucesso do ponto de vista do cliente
      return { ok: true, jaRemovido: true };
    }
    throw err;
  }
  return { ok: true };
}

// Fase 3 — RSVP: lê o evento e devolve a resposta de cada convidado.
// resposta ∈ 'needsAction' | 'declined' | 'tentative' | 'accepted'.
function actionRsvpEventoCalendar_(ctx) {
  if (typeof Calendar === 'undefined') {
    throw new Error('calendar_api_nao_habilitada');
  }
  var body = ctx.body || {};
  var eventId = String(body.eventId || '').trim();
  if (!eventId) throw new Error('eventId_obrigatorio');

  var ev;
  try {
    ev = Calendar.Events.get(UC_CAL_ID, eventId);
  } catch (err) {
    if (_calIsNotFound_(err)) {
      return { ok: false, erro: 'evento_nao_encontrado', limparVinculo: true };
    }
    throw err;
  }
  if (ev.status === 'cancelled') {
    return { ok: false, erro: 'evento_cancelado', limparVinculo: true };
  }

  var lista = ev.attendees || [];
  var convidados = [];
  for (var i = 0; i < lista.length; i++) {
    var a = lista[i] || {};
    if (a.resource) continue; // salas/equipamentos não são convidados
    convidados.push({
      email: String(a.email || '').toLowerCase(),
      nome: a.displayName || null,
      organizador: !!a.organizer,
      resposta: a.responseStatus || 'needsAction',
      comentario: a.comment || null
    });
  }

  return { ok: true, eventId: ev.id, status: ev.status, convidados: convidados };
}

// ------------------------------------------------------------
// Helpers de resposta da API
// ------------------------------------------------------------

function _calExtrairMeetUri_(ev) {
  try {
    var eps = ev.conferenceData && ev.conferenceData.entryPoints;
    if (Array.isArray(eps)) {
      for (var i = 0; i < eps.length; i++) {
        if (eps[i].entryPointType === 'video' && eps[i].uri) return eps[i].uri;
      }
    }
  } catch (e) {}
  return null;
}

function _calIsNotFound_(err) {
  var msg = String(err && err.message || err);
  return /not found|404|deleted|resource has been deleted/i.test(msg);
}

// ------------------------------------------------------------
// Teste manual (rode no editor depois de habilitar a Calendar API)
// ------------------------------------------------------------
function _calTesteManual() {
  var ctx = {
    body: {
      titulo: 'TESTE UC Jurídico — pode apagar',
      descricao: 'Evento de teste gerado pelo Apps Script.',
      local: 'Online',
      inicioISO: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      convidados: [],   // coloque seu e-mail aqui pra testar o convite
      gerarMeet: true
    }
  };
  var r = actionCriarEventoCalendar_(ctx);
  Logger.log(JSON.stringify(r, null, 2));
}
