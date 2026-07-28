# UC Jurídico — Handoff de Sessão

> Documento vivo. Atualizado a cada virada de dia ou troca de dispositivo. **Última atualização:** 2026-07-05.

---

## 📍 Estado atual

| Item | Valor |
|---|---|
| **Versão no código (`main`/`sandbox`)** | `v6.89.0` (B1 DataJud + B2 digest + B3 painel de notificações) |
| **Versão em produção (LOCAWEB)** | `v6.89.0` ✅ **em dia com o código** (deploys concluídos em 05/07, incl. `Lembretes.gs`) |
| **Branches** | `main` = `sandbox` = `claude/continuidade-aaq0lh` (em sincronia, fast-forward) |
| **Working tree** | Limpo |
| **Repositório** | https://github.com/eduardourany-dot/uc-juridico |

### ▶️ Próxima sessão

**Estado ao encerrar 06/07:** código em **v6.93.0**; **blocos B e C (C1+C7+C8) concluídos** — só restam infra (D) e decisões (E). **Pendências manuais em UM combo** (na pasta do repo, máquina do Marco): ① `git pull origin main` · ② `firebase deploy --only hosting` (frontend v6.90→v6.93) · ③ `firebase deploy --only firestore:rules` (collection nova `tarefas` — sem isso a página Tarefas dá permission-denied) · ④ recolar no Apps Script: `Drive.gs` (arquivo NOVO) + `Codigo.gs` (ativa o Organizador do Drive). Próximo: fechar a migração Google (passos ② deploy automático e ③ domínio — runbook `docs/RUNBOOK_migracao_google.md`; ⚠️ zona DNS/MX antes de cancelar a LOCAWEB) ou bloco D.

### ✅ C1 — Tarefas com delegação (v6.93.0, sessão 06/07)

- Página **Tarefas** (nav desktop+mobile, badge de abertas): kanban leve **A fazer → Em andamento → Concluídas (14d)**, filtro por responsável, criação/edição/conclusão com `logs[]` auditável (quem/quando/o quê), soft-delete. Painel de **produtividade 30d** por advogado (abertas · atrasadas · concluídas · % no prazo).
- **Agenda integrada**: tarefa com prazo aparece na lista e no calendário (chip ✅ verde) com ações inline (iniciar/concluir/editar); toggle da Agenda virou "⏰ Prazos e tarefas". Botão "✅ Nova tarefa" nas Ações do processo (vincula automaticamente).
- Dados: collection Firestore `tarefas` via helpers genéricos do api.js (`getAll_`/`upsert_`/`softDelete_`), regra adicionada ao `firestore.rules` (padrão isInternal/canWrite), cache TTL no boot, stubs offline. **Zero backend Apps Script.**
- Testes: 10 casos (atraso por dia-calendário, produtividade — janela 30d, atrasadas, % no prazo, cancelada não conta) + parse global.

Decisões pendentes do titular: **E1 reativar e-mails — um clique no painel 🔔** · E2 piloto de descoberta por OAB ~R$ 50–250/mês.

### 🗂 C7 — Organizador do Drive (v6.92.0, sessão 06/07)

- Card destacado na página **Ferramentas**: cola o link/ID da pasta do Drive → `Drive.gs` lista (até 300 arquivos, não-recursivo) → seleção → **Gemini multimodal classifica um a um** (PDF/JPG/PNG vão inline ≤15MB; TXT/Google Docs como texto; DOCX não suportado) extraindo categoria (taxonomia C8), **CNJ, data e título** → modal de revisão (nome proposto `{CNJ}_{tipo}_{data}_{título}` e categoria editáveis; confiança <70% em âmbar; checkbox "agrupar em subpastas por categoria" 01-Petições…09-Outros) → `driveAplicarOrganizacao` renomeia/move em lotes de 25 com relatório item a item.
- Backend novo: `backend/Drive.gs` (3 actions) + 3 cases no router do `Codigo.gs` + wrappers no `api.js` + stubs offline. Reusa `GEMINI_API_KEY`/`GEMINI_API_BASE` das petições e `audit_` (trilha em toda ação). Falha em um arquivo não derruba o lote; erro de acesso à pasta orienta compartilhar com a conta do Web App.
- Testes: 16 casos (montador de nome, extração de folderId de URL, mimes, aplicar com mock DriveApp — rename/subpasta com cache/erro isolado/audit) + parse do index e do api.js.

### ✂️ C8 — Segmentador de autos (v6.91.0, sessão 06/07)

- Botão "✂️ Segmentar autos (PDF)" nas Ações do processo. Pipeline: pdf.js extrai texto por página → IA segmenta em blocos de ~100k chars com `[PÁGINA N]` absolutos e sobreposição de 2 págs (via **action `gerarPeticaoIA` existente** com `modeloPromptSistema` próprio — zero backend novo) → `_segReconciliarPecas` funde os blocos (dedupe, corte de overlap, buracos viram "outros", cobertura total garantida) → **modal de revisão editável** (título/categoria/cortes; sobreposição bloqueada) → pdf-lib recorta e baixa `NN - Título (pX-Y).pdf` → índice auditável salvo como nota do processo.
- Guardas: PDF escaneado sem camada de texto (<40% das págs com texto) aborta com orientação de OCR; só o TEXTO vai à IA; bloco com JSON inválido é pulado sem derrubar o lote; confiança <70% destacada em âmbar na revisão.
- Testes: 18 casos (parser JSON com fences, reconciliação — buracos/duplicatas/overlap/clamp, blocos com sobreposição e marcadores absolutos, sanitização de nome) + parse global.

### 💬 B4+B5 — WhatsApp + afinamentos (v6.90.0, sessão 06/07)

- **B4**: botão "💬 WhatsApp pro cliente" nas Ações do processo — resolve o cliente vinculado (`clienteId`/`clienteIds`/nome legado), monta mensagem com o último andamento, modal com telefone e texto **editáveis**, abre `wa.me` (nada é enviado sem revisão). `_telefoneParaWa` normaliza DDD→55.
- **B5.1**: contagem de dias dos prazos alinhada ao dia-calendário (`_diaFatalLocal`) em 5 pontos: linha de prazo do processo, lista de publicações, `recomputarStatusVisual`, agenda e pacote-Claude. Fatal hoje ao meio-dia não aparece mais como "1d".
- **B5.3**: toggle "lembretes do próprio Google no evento do prazo" (Settings→Sincronização, default ligado). Desligado → evento criado SEM alarme do Google (evita dobro com a régua). `Calendar.gs` atualizado pra aceitar `lembretes: []` = silêncio — **recolagem do `Calendar.gs` só é necessária se alguém desligar o toggle** (default mantém comportamento atual).
- **B5.2 (decisão)**: push permanece 1-por-prazo — o deep-link individual pro processo vale mais que a consolidação; FCM agrupa por tag e o e-mail já é consolidado/digest.
- Testes: 12 casos (telefone→wa, gating de lembretes client, Calendar.gs [] vs null, 4 casos da contagem de dias) + parse global. O parse pegou um bug real de crase aninhada em template literal no help-text — corrigido.

### 🔔 B2+B3 — Digest diário + painel de notificações (v6.89.0, sessão 30/06)

- **B3 painel**: Configurações → Sincronização → card 🔔. Edita `settings/notifConfig` no Firestore: kill-switch de e-mail, kill-switch de push, modo `digest`/`porMarco`, hora do digest, marcos com e-mail individual, opt-out push/e-mail por advogado. O backend (`_notifConfig()` no Lembretes.gs) lê a cada ciclo do cron — **mudança vale em ≤30 min sem recolar código**. Defaults = estado atual (e-mails suspensos + modo digest): colar o Lembretes.gs não muda comportamento até alguém mexer no painel.
- **B2 digest**: `_talvezEnviarDigest` roda dentro do cron de 30 min; após `digestHora` local, monta UM e-mail por advogado (roteamento igual ao da régua: titular/suplente/sócio por marco) agrupado por processo — Parte · Providência · Situação · Prazo — incluindo prazos sem-ACK (>24h sem ciência). Anti-dup diário em `settings/digestStatus`. No modo digest: e-mails individuais imediatos só em **T-0, FATAL e escalonamento sem-ACK ao sócio**; o fallback "sem token de push → e-mail em todo marco" fica desativado (senão quem não tem push voltaria a ser inundado — bug pego por teste).
- Kill-switch antigo hardcoded (`EMAILS_SUSPENSOS`) substituído pelo config — a "segunda ordem" do titular agora é autosserviço.
- Testes: 19 casos GAS (defaults/merge, kill-switch, opt-outs, marcos por modo, digest end-to-end com anti-dup, sem-ACK gating, regressão do modo porMarco) + parse client + merge client=backend.

### 🛰 B1 — Varredura DataJud (v6.88.0, sessão 30/06)

- `datajudVarrerCarteira()`: pra cada processo ativo com CNJ há >7 dias sem sync (MNI ou DataJud), consulta a API pública do CNJ via worker MNI (`consultarProcessoDataJud`, key embarcada) e importa os movimentos dos últimos 90 dias como eventos `movimento_mni` — reusa `mniAplicarMudancasFlow` (dedupe por identificador estável do worker → idempotente).
- Lotes de 150 (mais antigos primeiro), delay 700ms (~85 req/min, sob o limite ~120/min do CNJ). Falha/não-encontrado marca `p.datajudTentativaEm` (volta pra fila só após o ciclo de 7d). Tribunal detectado pelo CNJ é salvo em `p.tribunal` (amortiza).
- Gatilhos: boot silencioso (máx 1x/20h, throttle em `datajudVarreduraEm`; toast só se houver novidade) + botão "🛰 Varrer carteira agora" em Configurações → MNI (modal de progresso com cancelamento + relatório final com processos clicáveis).
- Testes: 13 casos (filtro de elegíveis, ordenação, janela de 90d, não-encontrado, detecção de tribunal, throttle, idempotência) + parse global OK.

### ⛔ E-mails de lembrete SUSPENSOS (até segunda ordem)

Por decisão do titular (jun/2026), os e-mails do backend estão **desligados** enquanto o sistema de prazos não está 100% operante. **O push continua normal.** Desde a v6.89.0 o interruptor vive no painel: **Configurações → Sincronização → 🔔 Notificações → marcar "E-mails ativos"** (vale em ≤30 min; já reativa no modo digest). Não precisa mais mexer em código nem recolar arquivo.

### ✅ Deploys em dia (bloco A concluído em 05/07)

LOCAWEB na **v6.89.0** + `Lembretes.gs` recolado + Calendar API verificada. **Nenhuma pendência de deploy.** Todo o épico Prazos (v6.85→v6.89) está em produção: Kanban, fatal interna, auto-agendamento 🤖, Agenda como centro de controle, sync Google, varredura DataJud, digest e painel 🔔.

### 🚚 Migração pro ecossistema Google (decisão do titular, 05/07)

**LOCAWEB descontinuada — sem mais uploads manuais.** Produção migrou pro **Firebase Hosting** (projeto `uc-juridico`). ① **✅ Primeiro deploy concluído e VALIDADO em 05/07** (máquina do Marco, login `eduardourany@`): **https://uc-juridico.web.app no ar** (v6.89.0) — login OK após liberar os referrers `uc-juridico.web.app/*` e `uc-juridico.firebaseapp.com/*` na API key restrita (Console GCP → Credentials). **Passos restantes** (runbook em `docs/RUNBOOK_migracao_google.md`): ② `firebase init hosting:github` (liga o deploy automático no push — até lá, publicar = `git pull` + `firebase deploy --only hosting` na pasta do projeto); ③ domínio `uc.uranydecastro.adv.br` no console + DNS. ⚠️ **Antes de cancelar a LOCAWEB**: conferir se a ZONA DNS do domínio está lá — se estiver, migrar a zona (Cloudflare/registro.br) preservando os **MX do Workspace**, senão derruba site E e-mails.

### Onde está rodando

- 🌐 **Firebase Hosting** (produção nova): `https://uc-juridico.web.app` — deploy automático no push em `main` (após passos ①/②) · domínio `uc.uranydecastro.adv.br` em migração
- 🌐 **LOCAWEB** (descontinuada): https://uc.uranydecastro.adv.br/ — congelada na v6.89.0 até o DNS migrar
- 🌐 **GitHub Pages** (espelho): https://eduardourany-dot.github.io/uc-juridico/ — auto-build de `main`, sempre atualizado
- 🌐 **Staging** (Cloudflare Pages): `*.pages.dev` — ambiente de testes

### Stack & infra

- **Frontend**: PWA estático (`index.html` ~24,8k linhas, `api.js`, `messaging.js`, `service-worker.js`)
- **Banco**: Firestore (`uc-juridico` em prod, `uc-juridico-staging` em staging)
- **Backend**: Apps Script "UC Juridico Backend" (Codigo.gs, Lembretes.gs, DjenCron.gs, Backup.gs, Calendar.gs, Peticoes.gs, Bootstrap.gs)
- **Cloud Functions**: `djenAutoCheckCron` + `djenAutoCheckHttp`
- **Workers**: 3 Cloudflare (uc-djen-proxy, uc-mni-tjgo, uc-datajud) + 1 Vercel (uc-mni-vercel)
- **Hospedagem**: GitHub Pages (legado) + LOCAWEB (`uc.uranydecastro.adv.br`)
- **Co-titularidade**: `eduardourany@uranydecastro.com.br` + `ucjuridico@uranydecastro.com.br` (segunda titular em Firebase IAM, Apps Script, allowlist, alertas, GitHub e Cloudflare — Vercel solo por decisão, ver `docs/RUNBOOK_42_cotitularidade.md`)

---

## 🎯 Onde paramos (sessão 29/06/2026) — Épico Prazos

Sessão dedicada a transformar o módulo de Prazos no centro operacional do escritório. Tudo commitado em `main`/`sandbox`; deploy manual pendente (ver topo).

### 1. 🤖 Auto-agendamento de prazos (**v6.86.0**)
- Intimação não tratada → **vínculo automático ao processo por CNJ idêntico** → parser lê o teor → se extrai prazo numérico (confiança ≥50%: regex 75–92% / keywords 70%) **cria o prazo automaticamente** (fatal interna, etapa `atribuido`, cobrança imediata) e dá ciência do sistema na intimação.
- **Guardas**: backlog com fatal já vencida é tratado SEM criar prazo (`autoTriagem: prazo_expirado`); órfãs sem CNJ na carteira e teores sem prazo extraível ficam na caixa pra triagem manual; dedup por (djenHash, tipo); idempotente.
- Roda no boot (silencioso) + botão "🤖 Auto-agendar" na caixa. Decisões do titular: confiança ≥50% · cobrança imediata · backlog inteiro (com a guarda de expirados).

### 2. 📅 Agenda como centro de controle dos prazos (**v6.87.0**)
- **Overlay**: prazos do Kanban aparecem na Agenda (lista **e** calendário) na data fatal, com ações inline (cumprir/suspender/cancelar/ajustar fatal/📅 Google/abrir processo). Toggle "⏰ Mostrar prazos" (default on). Religou a infra que já existia e estava desativada (`prazosOverlay = []`).
- **Unificação do fluxo DJEN**: "📅 Salvar e agendar prazos" da busca DJEN agora cria **prazo (deadline)**, não mais compromisso `prazo_judicial`. Helper único `montarPrazoDjen()` compartilhado com o auto-agendamento. Compromissos antigos seguem intactos.
- **Sync Google Calendar**: cada prazo pode espelhar um evento simples (sem Meet) na fatal, com lembrete e-mail 3d + popup 1d. Botão 📅 por prazo (avulso, inclui backlog) + toggle de auto-sync em Settings → Sincronização (default OFF). Reconciliação no ciclo de vida (cumprido/cancelado/removido → apaga; recalcular fatal → atualiza). Falha de API nunca quebra o fluxo local. Auto-Google **não** roda no boot silencioso.

### 3. 🤖 Auto-agendados sem banner em Publicações (**v6.87.1**)
- Removido o banner/fila "🤖 aguardando revisão" do topo de Publicações (era redundante). `_secaoRevisaoAutoHtml` deletada.
- Revisão acontece no lugar: **dar ciência no Kanban** marca `autoAgendado.revisado` (log `revisao_confirmada`) **ou** **"🤖 revisar" na Agenda**. Badge "🤖 revisar" no Kanban e na Agenda.

### 4. 📧 E-mails de lembrete consolidados por processo (`Lembretes.gs`)
- `cron_lembretesDePrazo` e `_escalonarSemAck` reescritos em 3 fases: push por prazo + coleta de grupos → **1 e-mail consolidado por (destinatário · CNJ · marco)** → persiste `notificado`. Vários prazos/partes do mesmo processo viram **um único e-mail** (agrupa por CNJ normalizado, `_cnjKeyProc`).
- Conteúdo novo: tabela **Parte · Providência · Prazo** com o número do processo no topo. Providência em poucas palavras = `_providenciaCurta` (tipo de ato do parser). Push passou a citar providência + parte.
- Anti-spam refinado: `notificado[marco][email]` separa `.push` e `.email`. Honorários/parcelas intactos.

### 5. 📋 Docs
- `docs/ROADMAP.md` regenerado (jun/2026): status, pendências de deploy, épico Prazos entregue, backlog repriorizado (P1-P12 + outros).

### ✅ Cobertura de testes desta sessão (Node, sem deploy)
- Auto-agendamento + helper unificado: **22 casos** (vínculo, criação, expirado, órfã, sem-prazo, dedup, idempotência, djen-busca).
- Sync Google Calendar: **24 casos** (payload sem-Meet, criar/atualizar/cancelar, reconciliação, toggle, fallback sem-API).
- Revisão no Kanban: **7 casos** (parse, banner removido, ciência-limpa-🤖).
- E-mail consolidado: **20 casos** end-to-end (stub Firestore/FCM/Mail — 3 prazos mesmo CNJ → 1 e-mail; anti-spam; sem-ACK).
- Parse global do `index.html` OK após cada bloco.

### 🔧 Afinamentos do épico ainda em aberto (baixa urgência)
- Badges de dias da LISTA de publicações ainda usam contagem antiga (+1d conservador) — alinhar com `_diaFatalLocal`.
- Avaliar consolidar também o **push** por processo (e-mail já consolidado).
- Opção de silenciar o lembrete do Google Calendar quando o prazo já cobra pela régua do app (evitar alerta em dobro).

---

## 📋 Backlog ativo

| # | Prio | Tarefa | Estado |
|---|---|---|---|
| 44 | P3 | Kanban de prazos + máquina de estados + épico Prazos | ✅ **em produção** (v6.85→v6.89.0, deploy 05/07) |
| 34 | P3 | Petição IA: fila de revisão do advogado | pendente |
| — | ⭐ | Calculadora Fase 2 (tab Fiscal, histórico, export) | pendente |
| — | ⭐ | Relatórios automáticos pro cliente | pendente |

**P0/P1 críticos zerados.** Backlog completo e priorizado em `docs/ROADMAP.md`.

---

## 🗂 Contexto: spec "Organizador de Documentos Jurídicos" (parecer arquivado, jun-jul/2026)

O titular trouxe de outra conversa (Claude in Chrome) uma spec de organizador de documentos com IA, derivada da **análise funcional limpa de um produto de terceiros** ("Organizador Jurídico", i.am v0.15.0 — sem código proprietário, só comportamento observável). **Decisão: descartar a arquitetura** (Next.js/PostgreSQL/Redis/multi-tenant/medição por páginas/BYOK — características herdadas do produto espiado, não requisitos do escritório) **e incorporar a funcionalidade** como módulos do UC:

- **C7 Organizador do Drive** e **C8 Segmentador de autos** registrados no ROADMAP (bloco C) com escopo completo.
- **Material aproveitado da spec**: fluxo em 4 etapas (envio→IA→revisão humana obrigatória→aplicar); taxonomia de 11 tipos de peça; prompts de classificação e de segmentação por `[PÁGINA N]` com intervalos de páginas; threshold de confiança 0,7 pra destaque na revisão; JSON validável + temperatura baixa; falha de um item não derruba o lote; relatório de processamento; minimização do que vai pra IA de terceiros.
- Encaixe no stack real: Drive (arquivos) + Gemini/Claude via Apps Script (classificação) + tela de revisão no app (padrão 🤖 já consagrado). Custo de infra: zero.

## 🧱 Contexto: redesign do módulo Prazos (parecer arquivado)

Foi avaliada uma spec externa de redesign do módulo Prazos (event sourcing + outbox em PostgreSQL, de conversa antiga que assumia v4.2.2). **Decisão: descartada a adoção literal** — incompatível com o stack (Firestore/Apps Script, sem banco relacional nem servidor pra triggers/workers) e ~70% já existia. **4 conceitos aproveitados e hoje implementados** no épico Prazos:

1. **Fatal interna** (= fatal − 2 úteis): cobrança usa a interna; a fatal real é limite absoluto. ✅
2. **ACK de ciência + escalonamento por inatividade** (atribuído >24h sem ciência → escala pro sócio). ✅
3. **Máquina de estados** `ATRIBUIDO → CIENTE → EM_ELABORACAO → EM_REVISAO → PROTOCOLADO` = colunas do Kanban. ✅
4. **Trilha de eventos** `logs[]` no doc do prazo (recálculo registra `{antes, depois, motivo}`; protocolar exige comprovante). ✅

---

## 🔄 Trabalhando em múltiplos dispositivos

Sandbox/main fluem **só pelo GitHub**. Nada local fora do git precisa ser movido entre máquinas.

### Configurar pela primeira vez no NOVO dispositivo

```bash
# 1. Pré-requisitos: Git, Node.js LTS, Firebase CLI (npm i -g firebase-tools),
#    GitHub CLI (opcional), FileZilla (upload LOCAWEB)
# 2. Clonar
git clone https://github.com/eduardourany-dot/uc-juridico.git
cd uc-juridico
# 3. Identidade do git (uma vez por máquina)
git config user.name "Eduardo Urany"
git config user.email "eduardourany@uranydecastro.com.br"
# 4. (Opcional) firebase login --reauth   |   gh auth login
# 5. Branch de trabalho
git checkout sandbox && git pull origin sandbox
```

### Workflow diário

**Começar:** `git checkout sandbox && git pull origin sandbox && git status`
**Durante:** Claude commita o que for relevante (`.gitignore` protege segredos).
**Parar (antes de trocar de máquina):** `git add . && git commit -m "wip: ..." && git push origin sandbox`

### ⚠️ Não trabalhar nos dois dispositivos ao mesmo tempo
Sempre `git pull` antes de começar e `git push` antes de parar. Se der conflito: `git pull --rebase origin sandbox` → resolver → `git push`.

---

## 🚀 Como deployar cada camada

| Camada | Como |
|---|---|
| **Firebase Hosting** (produção) | Automático no push pra `main` (workflow `firebase-hosting.yml`; requer secret — ver runbook) · manual: `firebase deploy --only hosting` |
| **GitHub Pages** (espelho) | Automático no push pra `main` |
| **LOCAWEB** | ⛔ descontinuada (05/07) — não subir mais nada |
| **Apps Script** | Manual — colar o conteúdo de `backend/*.gs` no editor "UC Juridico Backend" e salvar |
| **Firestore Rules** | `firebase deploy --only firestore:rules` (precisa `firebase login`) |
| **Cloud Functions / Workers** | Deploy próprio (gcloud / wrangler / vercel) quando mudarem |

Raw de `main` pra copiar:
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/index.html
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/service-worker.js
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/backend/Lembretes.gs

---

## 🔐 Credenciais & acessos

Sem segredos neste arquivo. Tudo crítico vive em:
- **Firebase Console** (`uc-juridico` e `uc-juridico-staging`): Owner via `eduardourany@` ou `ucjuridico@`
- **Apps Script Properties**: `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `BACKUP_DRIVE_FOLDER_ID`, `DJEN_PROXY_URL`, `FCM_SERVICE_ACCOUNT_JSON`
- **Cloudflare / Vercel**: env vars dos workers (`ALLOWED_ORIGINS` etc.)
- **Service accounts (.json)**: apenas em `tools/migration/` local, protegidos por `.gitignore`

> Pra deployar rules em outro dispositivo: `firebase login --reauth` na primeira vez.

---

## 📞 Como o Claude continua

1. Abra o repositório local (`uc-juridico`) na ferramenta em uso.
2. Diga "leia o HANDOFF.md".
3. Continue de onde parou — tudo está no histórico git, commit a commit.

> "Leia o HANDOFF.md, confirme o estado atual e me ajude a continuar com **<tarefa>**."

---

## 🧹 Arquivos gerados localmente (não commitados)

- `_docs_gerados/` — documentos de divulgação pra equipe (gerados sob demanda)
- `tools/migration/service-account*.json` — credenciais Firebase Admin (`.gitignore`)

---

**Bom trabalho — e até a próxima sessão.**
