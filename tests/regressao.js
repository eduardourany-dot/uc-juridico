/**
 * Regressão dos achados da varredura de set/2026.
 *
 *   node tests/regressao.js
 *
 * Sem dependências: lê os fontes, extrai as funções por nome e roda contra
 * mocks. Como o app é um index.html único, o "import" é fatiamento de string —
 * feio, mas é o que permite testar sem modularizar (D2 do roadmap).
 *
 * O fuso importa: a contagem de prazos é ancorada em dia-calendário LOCAL, e
 * o CI/desenvolvedor pode estar em UTC. O bloco abaixo força America/Sao_Paulo
 * antes de qualquer Date ser criada.
 */
if (process.env.TZ !== 'America/Sao_Paulo') {
  process.env.TZ = 'America/Sao_Paulo';
  require('child_process').execFileSync(process.execPath, [__filename], { stdio: 'inherit' });
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const gsCod = fs.readFileSync(path.join(RAIZ, 'backend/Codigo.gs'), 'utf8');
const gsDrive = fs.readFileSync(path.join(RAIZ, 'backend/Drive.gs'), 'utf8');
const gsBackup = fs.readFileSync(path.join(RAIZ, 'backend/Backup.gs'), 'utf8');

let pass = 0, fail = 0;
const t = (nome, fn) => {
  try { fn(); console.log('  ✓ ' + nome); pass++; }
  catch (e) { console.log('  ✗ ' + nome + '\n      ' + e.message); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); };

// Extrai uma função por nome, fatiando até a chave que fecha.
function extrair(src, nome) {
  const i = src.indexOf('function ' + nome + '(');
  if (i < 0) throw new Error('função não encontrada: ' + nome);
  let d = 0, dentro = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { d++; dentro = true; }
    else if (src[k] === '}') { d--; if (dentro && d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('fim não encontrado: ' + nome);
}

const ctxFn = new Function(
  extrair(html, '_diaFatalLocal') + '\n' +
  extrair(html, '_diasAteDia') + '\n' +
  extrair(html, '_normTexto') + '\n' +
  extrair(html, '_tarefaAtrasada') + '\n' +
  extrair(html, '_tarefasProdutividade') + '\n' +
  extrair(gsCod, 'requireWrite_') + '\n' +
  extrair(gsCod, 'requireAdmin_') + '\n' +
  'return { _diaFatalLocal, _diasAteDia, _normTexto, _tarefaAtrasada, _tarefasProdutividade, requireWrite_, requireAdmin_ };'
);
const F = ctxFn();

console.log('TZ =', Intl.DateTimeFormat().resolvedOptions().timeZone, '(offset', new Date().getTimezoneOffset(), 'min)\n');

// ── Sintaxe: o app inteiro precisa ao menos parsear ───────────────────────
// Um backtick solto dentro de template literal já derrubou o app antes.
console.log('Sintaxe:');
t('script inline do index.html parseia', () => {
  const i = html.indexOf('<script>', 400), j = html.lastIndexOf('</script>');
  new Function(html.slice(i + 8, j));
});
for (const f of fs.readdirSync(path.join(RAIZ, 'backend')).filter(x => x.endsWith('.gs'))) {
  t('backend/' + f + ' parseia', () => { new Function(fs.readFileSync(path.join(RAIZ, 'backend', f), 'utf8')); });
}
for (const f of ['api.js', 'messaging.js', 'config.js', 'service-worker.js', 'firebase-messaging-sw.js']) {
  // api.js/messaging.js são módulos ES (import/export), que new Function não
  // aceita — `node --check` parseia os dois formatos.
  t(f + ' parseia', () => {
    try { require('child_process').execFileSync(process.execPath, ['--check', path.join(RAIZ, f)], { stdio: 'pipe' }); }
    catch (e) { throw new Error(String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')); }
  });
}
console.log('');

// ── Achados 3 e 5: contagem de dias pelo dia-calendário local ──────────────
console.log('Contagem de dias (achados 3 e 5):');
const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
const iso = d => { const x = new Date(hoje.getTime() + d * 86400000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const dias = s => Math.round((F._diaFatalLocal(s) - hoje) / 86400000);

t('prazo de hoje conta 0 dia (era 1)', () => eq(dias(iso(0)), 0));
t('prazo de amanhã conta 1 dia', () => eq(dias(iso(1)), 1));
t('prazo de ontem conta -1 dia', () => eq(dias(iso(-1)), -1));
t('prazo de hoje NÃO é vencido', () => eq(F._diaFatalLocal(iso(0)) < hoje, false));
t('prazo de ontem é vencido', () => eq(F._diaFatalLocal(iso(-1)) < hoje, true));
t('janela urgente (0..5) inclui hoje e o 5º dia', () => {
  const dentro = d => { const n = dias(iso(d)); return n <= 5 && n >= 0; };
  eq([dentro(0), dentro(5), dentro(6), dentro(-1)].join(','), 'true,true,false,false');
});
t('"Meu dia": hoje/amanhã não trocam de balde', () => {
  const amanhaMs = hoje.getTime() + 86400000;
  eq(F._diaFatalLocal(iso(0)).getTime() === hoje.getTime(), true, 'hoje:');
  eq(F._diaFatalLocal(iso(1)).getTime() === amanhaMs, true, 'amanhã:');
});
// Formato REAL gravado: `deadlineDate.toISOString()` de um Date ao meio-dia
// local (ver newDeadlineFlow / calc.deadline). É contra isso que a contagem roda.
const fatalReal = d => { const x = new Date(hoje.getTime() + d * 86400000); x.setHours(12, 0, 0, 0); return x.toISOString(); };

t('formato gravado é ISO com hora, não YYYY-MM-DD cru', () => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fatalReal(0))) throw new Error('premissa do teste errada');
});
t('no formato real, o Math.ceil antigo somava +1 dia', () => {
  const ceilAntigo = d => Math.ceil((new Date(fatalReal(d)) - hoje) / 86400000);
  eq(ceilAntigo(0), 1, 'fatal de hoje virava "1 dia":');
  eq(ceilAntigo(5), 6, 'fatal de 5 dias virava 6 e saía da janela urgente:');
});
t('com _diaFatalLocal + round a contagem fica exata', () => {
  const agora = d => Math.round((F._diaFatalLocal(fatalReal(d)) - hoje) / 86400000);
  eq([agora(0), agora(1), agora(5), agora(-1)].join(','), '0,1,5,-1');
});
t('janela urgente com o formato real passa a incluir o 5º dia', () => {
  const dentro = d => { const n = Math.round((F._diaFatalLocal(fatalReal(d)) - hoje) / 86400000); return n >= 0 && n <= 5; };
  eq([dentro(0), dentro(5), dentro(6)].join(','), 'true,true,false');
});
t('prazo que vence hoje nunca é "expirado" (nem antes nem depois da mudança)', () => {
  eq(F._diaFatalLocal(fatalReal(0)) < hoje, false);
  eq(new Date(fatalReal(0)) < hoje, false, 'comportamento preservado:');
});

// ── _diasAteDia: o helper único da contagem de dias-calendário ────────────
console.log('\nHelper _diasAteDia:');
const emNoon = d => { const x = new Date(hoje.getTime() + d * 86400000); x.setHours(12, 0, 0, 0); return x; };

t('conta 0 pra hoje, qualquer que seja a hora', () => {
  for (const h of [0, 9, 12, 14, 21, 23]) {
    const x = new Date(hoje); x.setHours(h, 30, 0, 0);
    eq(F._diasAteDia(x), 0, h + 'h:');
  }
});
t('reunião das 14h de hoje é HOJE, não "em 1d"', () => {
  const r = new Date(hoje); r.setHours(14, 30, 0, 0);
  eq(F._diasAteDia(r, hoje), 0);
  eq(Math.ceil((r - hoje) / 86400000), 1, 'a forma antiga dizia 1:');
});
t('aceita ISO com hora, ISO só-data, Date e timestamp', () => {
  const alvo = emNoon(3);
  const soData = iso(3);
  eq(F._diasAteDia(alvo.toISOString()), 3, 'ISO com hora:');
  eq(F._diasAteDia(soData), 3, 'ISO só-data:');
  eq(F._diasAteDia(alvo), 3, 'Date:');
  eq(F._diasAteDia(alvo.getTime()), 3, 'timestamp:');
});
t('base alternativa funciona com Date e com timestamp', () => {
  eq(F._diasAteDia(emNoon(5), emNoon(2)), 3, 'base Date:');
  eq(F._diasAteDia(emNoon(5), hoje.getTime()), 5, 'base timestamp:');
});
t('sem data devolve NaN — some das janelas em vez de entrar nelas', () => {
  for (const v of ['nao é data', null, undefined, '']) {
    if (!Number.isNaN(F._diasAteDia(v))) throw new Error(JSON.stringify(v) + ' devia dar NaN, deu ' + F._diasAteDia(v));
  }
  // O ponto do NaN: com null, `null <= 1` seria true e um prazo sem data fatal
  // apareceria como "iminente". Com NaN toda comparação é falsa.
  const n = F._diasAteDia(null);
  eq([n < 0, n === 0, n <= 1, n <= 5].join(','), 'false,false,false,false');
});
t('base inválida também devolve NaN', () => {
  if (!Number.isNaN(F._diasAteDia(emNoon(2), 'lixo'))) throw new Error('base inválida passou');
});
t('dias negativos contam pra trás corretamente', () => {
  eq([F._diasAteDia(emNoon(-1)), F._diasAteDia(emNoon(-7))].join(','), '-1,-7');
});
t('janela de parcela (-7 a +3) pega os dois extremos', () => {
  const dentro = d => { const n = F._diasAteDia(emNoon(d)); return n >= -7 && n <= 3; };
  eq([dentro(-7), dentro(3), dentro(-8), dentro(4)].join(','), 'true,true,false,false');
});
t('não sobrou contagem de dia feita na mão sobre compromisso/parcela', () => {
  const rx = /Math\.ceil\(\((?:dt|venc|dataPx|inicio|inicioDia|d)\s*-\s*(?:today|hoje|hoje0|ms)\)/g;
  const achados = html.match(rx) || [];
  if (achados.length) throw new Error(achados.length + ' resíduo(s): ' + achados.join(' | '));
});

// ── _normTexto: normalizador unificado ────────────────────────────────────
console.log('\nNormalizador de texto (_normTexto):');
t('tira acento e baixa a caixa', () => eq(F._normTexto('JOSÉ DA SILVA'), 'jose da silva'));
t('colapsa espaço e apara as pontas', () => eq(F._normTexto('  Ana   Maria  '), 'ana maria'));
t('cobre cedilha e til', () => eq(F._normTexto('Conceição Assunção'), 'conceicao assuncao'));
t('null e undefined viram string vazia', () => {
  eq(F._normTexto(null), ''); eq(F._normTexto(undefined), '');
});
t('preserva 0 e false como texto (não vira vazio)', () => {
  eq(F._normTexto(0), '0'); eq(F._normTexto(false), 'false');
});
t('as cópias duplicadas sumiram do fonte', () => {
  if (/function _bgNorm\b|function _mniNormNome\b/.test(html)) throw new Error('normalizador duplicado ainda existe');
  if (!/function _normTexto\b/.test(html)) throw new Error('_normTexto não encontrado');
});

// ── Log de diagnóstico atrás de interruptor ───────────────────────────────
console.log('\nLog de produção:');
t('console.log de rotina saiu do caminho padrão', () => {
  // Sobram só os que TÊM de imprimir sempre: o próprio UC_debug e o
  // relatório do __testarCalculo, que é chamado à mão no console.
  const linhas = html.split('\n').filter(l => /console\.log\(/.test(l));
  const inesperadas = linhas.filter(l => !/UC_debug|\[UC\] debug|veredito|function _log\(/.test(l));
  if (inesperadas.length) throw new Error(inesperadas.length + ' console.log fora do gate: ' + inesperadas.map(l => l.trim().slice(0, 60)).join(' | '));
});
t('_log existe, é silencioso por padrão e não recursa', () => {
  const def = extrair(html, '_log');
  if (!/console\.log\(/.test(def)) throw new Error('_log não chama console.log — recursão infinita?');
  if (!/_UC_DEBUG/.test(def)) throw new Error('_log não checa o interruptor');
});
t('UC_debug persiste a escolha e tolera storage bloqueado', () => {
  const def = extrair(html, 'UC_debug');
  if (!/localStorage\.setItem/.test(def)) throw new Error('não persiste');
  if (!/catch/.test(def)) throw new Error('sem catch — quebra em navegação privativa');
});
t('console.warn e console.error seguem diretos', () => {
  if (!/console\.warn\(/.test(html) || !/console\.error\(/.test(html)) throw new Error('erros deixaram de aparecer');
});

// ── Achado 6: produtividade das tarefas em horário local ───────────────────
console.log('\nProdutividade das tarefas (achado 6):');
const asMs = (isoDia, h, m) => { const [Y, M, D] = isoDia.split('-').map(Number); return new Date(Y, M - 1, D, h, m).getTime(); };

t('concluída às 22h do dia do prazo conta NO PRAZO', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Ana', status: 'concluida', prazoData: iso(-1), concluidoEm: asMs(iso(-1), 22, 30) }
  ], 30);
  eq(r['Ana'].noPrazo, 1);
  eq(r['Ana'].concluidas, 1);
});
t('concluída no dia seguinte ao prazo conta FORA do prazo', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Ana', status: 'concluida', prazoData: iso(-2), concluidoEm: asMs(iso(-1), 9, 0) }
  ], 30);
  eq(r['Ana'].noPrazo, 0);
});
t('concluída às 23h59 do dia do prazo ainda é no prazo', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Ana', status: 'concluida', prazoData: iso(0), concluidoEm: asMs(iso(0), 23, 59) }
  ], 30);
  eq(r['Ana'].noPrazo, 1);
});
t('tarefa sem prazo conta no prazo', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Bia', status: 'concluida', prazoData: '', concluidoEm: Date.now() }
  ], 30);
  eq(r['Bia'].noPrazo, 1);
});
t('aberta com prazo passado conta atrasada', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Bia', status: 'aberta', prazoData: iso(-3) }
  ], 30);
  eq(r['Bia'].atrasadas, 1); eq(r['Bia'].abertas, 1);
});
t('aberta com prazo HOJE não conta atrasada', () => {
  eq(F._tarefaAtrasada({ status: 'aberta', prazoData: iso(0) }, hoje), false);
});
t('concluída fora da janela de 30d não entra na contagem', () => {
  const r = F._tarefasProdutividade([
    { responsavel: 'Cid', status: 'concluida', prazoData: iso(-60), concluidoEm: Date.now() - 60 * 86400000 }
  ], 30);
  eq(r['Cid'].concluidas, 0);
});

// ── Achado 7: trava de papel no organizador do Drive ──────────────────────
console.log('\nPermissão do organizador do Drive (achado 7):');
const tenta = (fn, ctx) => { try { fn(ctx); return 'ok'; } catch (e) { return e.message; } };

t('admin escreve', () => eq(tenta(F.requireWrite_, { user: { role: 'admin' } }), 'ok'));
t('user (advogado) escreve', () => eq(tenta(F.requireWrite_, { user: { role: 'user' } }), 'ok'));
t('viewer é BLOQUEADO', () => eq(tenta(F.requireWrite_, { user: { role: 'viewer' } }), 'write_required'));
t('cliente é BLOQUEADO', () => eq(tenta(F.requireWrite_, { user: { role: 'cliente' } }), 'write_required'));
t('sem usuário é BLOQUEADO', () => eq(tenta(F.requireWrite_, {}), 'write_required'));
t('papel desconhecido é BLOQUEADO', () => eq(tenta(F.requireWrite_, { user: { role: 'estagiario' } }), 'write_required'));
t('requireWrite_ é mais permissivo que requireAdmin_ só pro papel user', () => {
  eq(tenta(F.requireAdmin_, { user: { role: 'user' } }), 'admin_required');
  eq(tenta(F.requireWrite_, { user: { role: 'user' } }), 'ok');
});
t('as 3 actions do Drive.gs chamam requireWrite_', () => {
  for (const a of ['actionDriveListarPasta_', 'actionDriveClassificarArquivo_', 'actionDriveAplicarOrganizacao_']) {
    const corpo = extrair(gsDrive, a);
    if (!/requireWrite_\(ctx\)/.test(corpo)) throw new Error(a + ' sem requireWrite_');
  }
});

// ── Achados 1, 2, 6(Drive), 8 e 9: checagens estáticas ───────────────────
console.log('\nChecagens estáticas (achados 1, 2, 6, 8, 9):');

t('segmentador carrega PDF com ignoreEncryption', () => {
  const corpo = extrair(html, 'segmentarAutosFlow');
  if (!/PDFLib\.PDFDocument\.load\(.*ignoreEncryption:\s*true/.test(corpo)) throw new Error('sem ignoreEncryption');
});
t('todo PDFDocument.load do app aceita PDF protegido', () => {
  const cargas = html.match(/PDFDocument\.load\([^\n]*/g) || [];
  const sem = cargas.filter(c => !/ignoreEncryption:\s*true/.test(c));
  if (sem.length) throw new Error(sem.length + ' sem ignoreEncryption: ' + sem.join(' | '));
});
t('segmentador fecha o 2º modal no catch', () => {
  const corpo = extrair(html, 'segmentarAutosFlow');
  if (!/let prog2 = null/.test(corpo)) throw new Error('prog2 não declarado fora do try');
  if (!/if \(prog2\) prog2\.close\(\)/.test(corpo)) throw new Error('catch não fecha prog2');
});
t('organizador do Drive tem finally que fecha os modais', () => {
  const corpo = extrair(html, 'organizadorDriveFlow');
  if (!/\} finally \{[\s\S]*prog2\.close\(\)[\s\S]*prog3\.close\(\)/.test(corpo)) throw new Error('sem finally fechando prog2/prog3');
});
t('ORG_MAX_BYTES cabe no teto do Gemini depois do base64', () => {
  const m = gsDrive.match(/ORG_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
  if (!m) throw new Error('ORG_MAX_BYTES não encontrado');
  const mib = Number(m[1]);
  const base64MiB = mib * 4 / 3;
  if (base64MiB >= 19) throw new Error(mib + 'MiB viram ' + base64MiB.toFixed(1) + 'MiB em base64 — estoura o teto de ~20MB');
});
t('texto de ajuda do organizador bate com o limite real', () => {
  const m = gsDrive.match(/ORG_MAX_BYTES\s*=\s*(\d+)\s*\*/);
  if (!html.includes('Google Docs ≤' + m[1] + 'MB')) throw new Error('help-text fora de sincronia com ORG_MAX_BYTES');
});
t('coleção tarefas entra no backup diário', () => {
  const lista = gsBackup.slice(gsBackup.indexOf('COLECOES_BACKUP'), gsBackup.indexOf('BACKUP_KEEP'));
  if (!/'tarefas'/.test(lista)) throw new Error('tarefas fora de COLECOES_BACKUP');
});
t('overlay de tarefas da Agenda respeita o filtro de status', () => {
  const i = html.indexOf('tarefasOverlay = (tarefasAg || []).filter');
  const trecho = html.slice(i, i + 700);
  if (!/f\.status === 'ativos'/.test(trecho) || !/else if \(f\.status !== 'todos'\) return false/.test(trecho)) {
    throw new Error('filtro de status não espelha o dos prazos');
  }
});
t('card de tarefa não oferece "concluir" em tarefa já concluída', () => {
  const corpo = extrair(html, '_renderTarefaNaAgenda');
  if (!/\(t\.status === 'aberta' \|\| t\.status === 'andamento'\)[\s\S]{0,120}'concluida'\)" title="Concluir"/.test(corpo)) {
    throw new Error('botão Concluir sem gate de status');
  }
});
t('nenhum resíduo de contagem antiga sobre deadlineDate', () => {
  const residuos = [
    // parse cru de 'YYYY-MM-DD' (= meia-noite UTC) reancorado no fuso local
    [/new Date\(\w*\.?deadlineDate[^)]*\);\s*\w+\.setHours\(0/g, 'setHours sobre data crua'],
    // comparação direta com o dia de hoje (prazo de hoje virava vencido)
    [/new Date\(\w*\.?deadlineDate\)\s*<=?\s*(?:today|hoje\b|hoje0)/g, 'comparação crua com hoje'],
    // ceil sobre timestamp ao meio-dia/UTC somava um dia
    [/Math\.ceil\(\((?:new Date\([^)]*deadlineDate[^)]*\)|dl|deadlineDate)\s*-\s*(?:today|hoje)/g, 'Math.ceil na diferença'],
  ];
  const achados = [];
  for (const [rx, rot] of residuos) for (const m of (html.match(rx) || [])) achados.push(rot + ' → ' + m.trim());
  if (achados.length) throw new Error(achados.length + ' resíduo(s):\n      ' + achados.join('\n      '));
});
t('autoMarcarPerdidos não marca o prazo que vence hoje', () => {
  const corpo = extrair(html, 'autoMarcarPerdidos');
  if (!/_diaFatalLocal\(d\.deadlineDate\) < today/.test(corpo)) throw new Error('ainda usa data crua — marcaria como perdido o prazo de hoje');
});

console.log('\n' + '='.repeat(52));
console.log(pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
