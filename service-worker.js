// Service Worker — UC Jurídico v6.94.2 (chore: dívida técnica da varredura zerada — novo _diasAteDia(v, base) centraliza TODA contagem de dias-calendário do app (32 pontos), ancorando os dois lados à meia-noite local antes de subtrair; além dos 15 pontos da v6.94.1, pegou mais 9 da mesma classe em outros tipos de data: parcela de honorário vencendo hoje contava "1d" e a janela "vencidas até 7d" era 6, compromisso das 14h de HOJE aparecia como "em 1d" no painel inicial/relatório/badge da Agenda, follow-up de comunicação e o _diasAte da ficha idem; contrato deliberado: sem data devolve NaN e não null, porque `null <= 1` é true e faria prazo sem fatal virar "iminente". Novo _normTexto substitui as cópias idênticas _bgNorm (busca global) e _mniNormNome (MNI). Log de produção atrás de interruptor: os 18 console.log de rotina viraram _log(), silencioso por padrão — UC_debug(true) no console liga e persiste, UC_debug(false) desliga; console.warn/error seguem diretos. tests/regressao.js sobe pra 71 checagens. Anterior v6.94.1 (fix: varredura geral de código — [SEGURANÇA] novo requireWrite_ no Codigo.gs trava as 3 actions do organizador do Drive: viewer/cliente não renomeiam nem movem arquivo (era irreversível e alcançava qualquer pasta cujo ID chegasse no corpo) [REQUER recolar Codigo.gs + Drive.gs no Apps Script]; segmentador aceita PDF protegido do Projudi/PJe (ignoreEncryption, faltava só no último passo, depois de gastar a IA) e fecha o modal de progresso em caso de erro — igual no organizador, que ganhou try/finally; contagem de prazos migrada pra _diaFatalLocal + Math.round em 15 pontos que ainda usavam Math.ceil sobre a fatal ao meio-dia (somava +1 dia: janela "urgentes 0-5" era na prática 0-4, "Próximo prazo" do processo, Meu dia, mini-cards, chips do calendário, painel de marcos, exports CSV/XLSX, calculadora de prazo); produtividade das tarefas passa a usar o dia LOCAL da conclusão (com toISOString, tarefa fechada depois das 21h contava como atrasada); coleção tarefas entra no COLECOES_BACKUP (a caixa de exclusão prometia recuperação pelo suporte e o backup não a cobria); overlay de tarefas da Agenda respeita o filtro de status igual ao de prazos, com badge de concluída/cancelada; ORG_MAX_BYTES 15→10MiB (base64 infla 33% e estourava o teto do Gemini em arquivo marcado como "suportado"). Novo tests/regressao.js — 52 checagens sem dependência (node tests/regressao.js), incluindo guardas que varrem o fonte atrás dos padrões que causaram estes bugs. Anterior v6.94.0 (feat C9: 🔎 Busca global — Ctrl+K/⌘K em qualquer tela + botão no topo da barra lateral: uma caixa só que atravessa processos, clientes, prazos, tarefas, publicações, agenda e notas; casamento tolerante a acento/caixa e por dígitos [digitar 5142789 acha o CNJ formatado, 12345678 acha o CNPJ com pontuação], busca no TEOR da publicação e da nota, resultados agrupados por tipo com peso começa-com, Enter abre o primeiro, Esc fecha; resolve a dor 'informação difícil de achar'. Novo DB.getAllNotes. Anterior v6.93.0 (feat C1: ✅ Tarefas com delegação — nova página/rota Tarefas [nav desktop+mobile, badge de abertas]: kanban leve A fazer→Em andamento→Concluídas(14d), delegação por advogado, prazo opcional, vínculo a processo, filtro por responsável, logs auditáveis e painel de produtividade 30d [abertas/atrasadas/concluídas/% no prazo]; tarefas com prazo aparecem na AGENDA junto dos prazos [chip ✅ no calendário + card com ações inline, toggle vira 'Prazos e tarefas']; botão '✅ Nova tarefa' nas Ações do processo; collection Firestore tarefas [REQUER firebase deploy --only firestore:rules] + cache TTL + stubs offline. Anterior v6.92.0 (feat C7: 🗂 Organizador do Drive [IA] — card na página Ferramentas: cola o link da pasta → backend Drive.gs lista os arquivos → Gemini multimodal classifica um a um [PDF/JPG/PNG inline; TXT/GDoc como texto; taxonomia de 11 peças + CNJ/data/título detectados] → modal de REVISÃO [nome proposto {CNJ}_{tipo}_{data}_{título} e categoria editáveis, confiança <70% em âmbar, agrupar em subpastas por categoria opcional] → aplicar renomeia/move via Drive API com relatório item a item; falha em um arquivo não derruba o lote; requer recolar Drive.gs NOVO + Codigo.gs no Apps Script. Anterior v6.91.0 (feat C8: ✂️ Segmentador de autos — botão nas Ações do processo: PDF consolidado [Projudi/PJe] → pdf.js extrai texto por página → IA segmenta em blocos com marcadores [PÁGINA N] via action gerarPeticaoIA existente [prompt de sistema próprio, JSON validável, taxonomia de 11 peças] → reconciliação de blocos [dedupe/overlap/buracos=outros, cobertura total] → modal de REVISÃO editável [títulos/categorias/cortes] → pdf-lib recorta e baixa cada peça + índice auditável vira nota do processo; detecta PDF escaneado sem texto e orienta OCR; só o texto vai à IA. Anterior v6.90.0 (feat B4+B5: 💬 botão "WhatsApp pro cliente" no processo — modal com telefone do cliente vinculado + mensagem de atualização pré-preenchida e editável [último andamento], abre wa.me, nada é enviado sem revisão; B5.1 contagem de dias dos prazos alinhada ao dia-calendário [_diaFatalLocal] em lista/processo/agenda/status visual — fatal hoje ao meio-dia não aparece mais como "1d"; B5.3 toggle "lembretes do Google no evento do prazo" em Settings→Sincronização [desligar evita alerta em dobro; Calendar.gs aceita lembretes vazio = evento sem alarme]; B5.2 decisão: push permanece por prazo [deep-link individual]. Anterior v6.89.0 (feat B2+B3: 🔔 painel de notificações no app [Configurações→Sincronização] editando settings/notifConfig no Firestore — kill-switch de e-mail vira um clique, modo digest/porMarco, hora do digest, marcos com e-mail, opt-out push/e-mail por advogado; backend Lembretes.gs lê o config a cada ciclo [vale em ≤30min sem recolar código]; ☕ digest diário: um resumo por advogado após a hora configurada, agrupado por processo com Parte·Providência·Situação·Prazo + sem-ACK, anti-dup por dia em settings/digestStatus; no modo digest e-mails individuais só T-0/FATAL/escalonamento e o fallback sem-token não flooda. Anterior v6.88.0 — feat B1: 🛰 varredura DataJud da carteira — API pública do CNJ [91 tribunais, grátis] consultada pra cada processo ativo há >7 dias sem sync; movimentos dos últimos 90 dias viram eventos na linha do tempo [reusa merge+dedupe do mniAplicarMudancasFlow, idempotente]; lotes de 150 mais-antigos-primeiro, delay 700ms [~85 req/min, sob o limite do CNJ], falha/não-encontrado marca datajudTentativaEm e respeita o ciclo; roda no boot [silencioso, máx 1x/20h, toast se houver novidade] + botão "🛰 Varrer carteira agora" em Configurações→MNI com progresso/cancelamento e relatório clicável. DataJud tem defasagem — prazos continuam nascendo do DJEN)
const CACHE_NAME = 'uc-juridico-v6-94-2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './config.js',
  './api.js',
  './messaging.js',
  './logo.png',
  './logo.mp4',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './favicon-32.png'
];

// firebase-messaging-sw.js NÃO entra no APP_SHELL nem é interceptado por
// este SW — o Firebase SDK gerencia o registro/atualização separadamente.

const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Permite o app perguntar a versão do SW (rodapé exibe dinamicamente, sem
// precisar atualizar string hardcoded no index.html a cada bump).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ cacheName: CACHE_NAME });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  // firebase-messaging-sw.js é gerenciado pelo Firebase SDK — NÃO interceptar
  // (sempre buscar fresh, sem cachear) pra evitar versão antiga colada.
  if (url.pathname.endsWith('/firebase-messaging-sw.js')) return;

  // App shell — cache first
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return resp;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // CDNs — stale-while-revalidate
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(resp => {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
