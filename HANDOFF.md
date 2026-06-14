# UC Jurídico — Handoff de Sessão

> Documento vivo. Atualizado a cada virada de dia ou troca de dispositivo. **Última atualização:** 2026-06-10.

---

## 📍 Estado atual

| Item | Valor |
|---|---|
| **Versão em prod** | `v6.84.0` (LOCAWEB + GitHub Pages + Apps Script atualizados) |
| **Último commit (main + sandbox)** | `343e698` — feat(#22): Meet Fase 3 — auto-convidados + RSVP |
| **Branch ativo de trabalho** | `sandbox` |
| **Working tree** | Limpo (sem mudanças não-commitadas) |
| **Repositório** | https://github.com/eduardourany-dot/uc-juridico |

### Onde está rodando

- 🌐 **Produção LOCAWEB** (profissional): https://uc.uranydecastro.adv.br/ — *requer upload manual via FileZilla pra refletir cada nova versão*
- 🌐 **Produção GitHub Pages** (legado, paralelo): https://eduardourany-dot.github.io/uc-juridico/ — auto-build do branch `main`
- 🌐 **Staging** (Cloudflare Pages): `*.pages.dev` — ambiente de testes

### Stack & infra

- **Frontend**: PWA estático (`index.html` ~22.7k linhas, `api.js`, `messaging.js`, `service-worker.js`)
- **Banco**: Firestore (projeto `uc-juridico` em prod, `uc-juridico-staging` em staging)
- **Backend**: Apps Script "UC Juridico Backend" (Codigo.gs, Lembretes.gs, DjenCron.gs, Backup.gs, Calendar.gs, Peticoes.gs)
- **Cloud Functions**: `djenAutoCheckCron` + `djenAutoCheckHttp`
- **Workers**: 3 Cloudflare (uc-djen-proxy, uc-mni-tjgo, uc-datajud) + 1 Vercel (uc-mni-vercel)
- **Hospedagem**: GitHub Pages (legado) + LOCAWEB (`uc.uranydecastro.adv.br`)
- **Co-titularidade**: `eduardourany@uranydecastro.com.br` + `ucjuridico@uranydecastro.com.br` (segunda titular em Firebase IAM, Apps Script, allowlist, alertas, GitHub e Cloudflare — Vercel solo por decisão, ver `docs/RUNBOOK_42_cotitularidade.md`)

---

## 🔄 Trabalhando em múltiplos dispositivos

A partir de agora o sandbox/main fluem **só pelo GitHub**. Não tem nada local fora do git que precise mover entre máquinas.

### Configurar pela primeira vez no NOVO dispositivo

```bash
# 1. Instalar pré-requisitos
#    - Git: https://git-scm.com/
#    - Node.js LTS: https://nodejs.org/
#    - Firebase CLI: npm install -g firebase-tools
#    - GitHub CLI (opcional): https://cli.github.com/
#    - FileZilla (pra upload na LOCAWEB): https://filezilla-project.org/

# 2. Clonar o repositório
cd "C:/Users/<seu-usuario>/Documents"   # ou outra pasta de trabalho
git clone https://github.com/eduardourany-dot/uc-juridico.git
cd uc-juridico

# 3. Configurar identidade do git (uma vez por máquina)
git config user.name "Eduardo Urany"
git config user.email "eduardourany@uranydecastro.com.br"

# 4. (Opcional) Autenticar Firebase pra poder deployar rules
firebase login --reauth

# 5. (Opcional) Autenticar GitHub CLI
gh auth login

# 6. Mudar pro branch de trabalho
git checkout sandbox
git pull origin sandbox
```

### Workflow diário (em qualquer dispositivo)

**Ao COMEÇAR a sessão:**

```bash
cd uc-juridico
git checkout sandbox
git pull origin sandbox     # puxa o que rolou no outro dispositivo
git status                  # confirma working tree limpo
```

**Durante o trabalho:**
- Trabalho normal via Claude — ele commita o que for relevante.
- O `.gitignore` já protege segredos (service-account, .env, etc.). Não tem nada local "perdido" entre sessões — tudo importante vai pro git.

**Antes de PARAR (especialmente antes de trocar pra outro dispositivo):**

```bash
git status                  # vê o que mudou
git add .                   # se houver coisa não-commitada
git commit -m "wip: ..."    # commit do que estiver no meio
git push origin sandbox     # publica
```

Se o Claude commitou tudo durante a sessão, geralmente só precisa de `git push origin sandbox` final.

### ⚠️ Cuidado: NÃO trabalhar simultaneamente nos dois dispositivos

Se trabalhar em `sandbox` na máquina A e na máquina B ao mesmo tempo, o segundo `git push` vai dar conflito. Solução: **sempre dar `git pull` antes de começar e `git push` antes de parar**.

Se der conflito mesmo assim:
```bash
git pull --rebase origin sandbox   # reaplica seus commits em cima do remoto
# resolver conflitos se houver
git push origin sandbox
```

---

## 📋 Backlog ativo

| # | Prio | Tarefa | Estado |
|---|---|---|---|
| 22 | P3 | Meet Fase 3 — auto-convidados + RSVP | ✅ concluído 10/06 — v6.84.0 em produção (Apps Script + LOCAWEB atualizados) |
| 34 | P3 | Petição IA: fila de revisão do advogado | pendente |
| 42 | Aux | `ucjuridico@` como membro em GitHub/CF/Vercel | ✅ concluído 10/06 — GitHub + Cloudflare ok; Vercel mantido solo (decisão B, ver `docs/RUNBOOK_42_cotitularidade.md`) |
| 44 | P3 | Kanban de prazos + máquina de estados do prazo | ✅ implementado 10/06 (**v6.85.0**) — pendente recolar Lembretes.gs no Apps Script e subir LOCAWEB |

**P0 e P1 zerados.** Tudo crítico está em produção.

> Backlog detalhado vive no sistema de tasks do Claude. Cada item tem descrição rica com escopo, esforço e ganchos com outras tarefas.

---

## 🎯 Onde paramos (sessão 10/06/2026)

**Trabalhos da sessão:**

1. **#42** — Co-titularidade `ucjuridico@` concluída: GitHub (collaborator `ucjuridico`, write — verificado via API) + Cloudflare (Administrator). Vercel ficou solo por decisão (opção B). Runbook: `docs/RUNBOOK_42_cotitularidade.md`.
2. **#22** — Meet Fase 3 implementado (**v6.84.0**):
   - **Auto-convidados**: ao criar/editar compromisso com Meet, convida automaticamente criador + responsável (e-mail canônico via `advogadoEmailPorNome`) + cliente vinculado, mesclando com os digitados. Checkbox de opt-out nos dois modais.
   - **RSVP**: nova action `rsvpEventoCalendar` (Calendar.gs + switch do Codigo.gs + wrapper em api.js) lê `responseStatus` dos convidados. Card do compromisso ganhou linha "🙋 RSVP" com contadores ✅/❌/❔/⏳, lista expandível por convidado e botão "🔄 atualizar respostas" (cache em `compromisso.rsvp`). Vínculo é desfeito se o evento sumiu/foi cancelado no Google.

**Ações manuais da sessão: ✅ todas concluídas** — Apps Script recolado (Calendar.gs + Codigo.gs) e v6.84.0 no ar na LOCAWEB.

3. **#44** — Kanban de prazos + máquina de estados implementado (**v6.85.0**):
   - **Kanban**: toggle Lista⇄Kanban na tela Publicações. Colunas 📌 Atribuído → ✋ Ciente → ✍️ Em elaboração → 🔍 Em revisão → ✅ Protocolado (últimos 14 dias). Cards ordenados pela fatal interna, com ações contextuais por etapa (dar ciência / iniciar / enviar revisão / devolver com motivo / protocolar) e "📅 ajustar fatal".
   - **Máquina de estados**: campo `etapa` no doc do prazo; transições validadas (`_transicaoEtapaValida` — avanço pode pular, retrocesso só revisão→elaboração); todos os movimentos geram evento no `logs[]` com ator. Protocolar continua exigindo nº de protocolo. Backfill idempotente no boot (`garantirCamposKanban`).
   - **Fatal interna** (= fatal real − 2 dias úteis, `computarFatalInterna`): persistida em `deadlineInternaDate`; régua de cobrança T-7…T+1 roda sobre ela (client + Lembretes.gs); no dia da fatal real dispara o marco **⛔FATAL** pra responsável+suplente+sócio (push requireInteraction + e-mail). Janela da query do cron ampliada pra +12 dias.
   - **Escalonamento sem-ACK**: `_escalonarSemAck` no Lembretes.gs — prazo atribuído há >24h sem ciência cobra responsável + sócio (push + e-mail), re-cobra a cada 24h até o ACK. Legados sem `atribuidoEm` não disparam (sem cobrança retroativa).
   - **Ajustar data fatal**: modal com motivo obrigatório → evento `recalculado {antes, depois, motivo}`, recomputa fatal interna e limpa marcos notificados (re-agenda lembretes).
   - **🐛 Fix de off-by-one nos marcos** (pré-existente): datas fatais gravadas ao meio-dia + `Math.ceil` faziam T-0 disparar um dia DEPOIS do vencimento. Corrigido com normalização pro dia-calendário (`_diaFatalLocal`) no client e no GAS. 24 casos de teste passando (interna, FATAL, legado, date-only, feriados).
   - Obs.: os badges de dias da LISTA de publicações (Vencidos/Urgentes/etc.) ainda usam a contagem antiga (visual, conservador +1d) — candidato a ajuste fino futuro.

5. **📅 Agenda como centro de controle dos prazos** (**v6.87.0**) — a pedido ("será pela agenda a organização e controle dos prazos"), três camadas:
   - **Overlay (base):** os prazos do Kanban aparecem na Agenda (lista **e** calendário) na data fatal, com ações inline (cumprir/suspender/cancelar/abrir processo/📅 Google). Gated pelo toggle **"⏰ Mostrar prazos"** (ligado por padrão). A infra (`_renderPrazoNaAgenda`, chips no calendário, modal de dia) já existia e estava desativada (`prazosOverlay = []`); foi religada filtrando por data/responsável/status.
   - **Unificação do fluxo DJEN:** o botão "📅 Salvar e agendar prazos" da busca DJEN agora cria **prazo (deadline)** no Kanban — não mais um compromisso `prazo_judicial`. Acaba a duplicidade de dois mundos. Helper único `montarPrazoDjen()` compartilhado entre `autoAgendarIntimacoes` e `djenAgendarPrazos` (dedup consistente por djenHash+tipo). Compromissos `prazo_judicial` antigos seguem na Agenda como estavam (sem perda).
   - **Google Calendar:** cada prazo pode espelhar um evento simples (sem Meet) na data fatal, com lembrete e-mail 3 dias antes + popup 1 dia antes. Botão **📅** por prazo na Agenda (liga/desliga avulso, inclui backlog); toggle de **auto-sync de novos prazos DJEN** em Settings → Sincronização (default OFF). Reconciliação no ciclo de vida: cumprido/cancelado/removido → apaga o evento; recalcular fatal → atualiza. Usa o backend `Calendar.gs` (`criarEventoCalendar`/`atualizar`/`cancelar`) via `UC_RemoteDB`; falha de API nunca quebra o fluxo local.
   - Testes: 22 casos (auto-agendamento + helper unificado, regressão verde) + 24 casos (sync Google: payload sem-Meet, criar/atualizar/cancelar, reconciliação, toggle, fallback sem-API) + parse global OK.
   - Decisão do titular: as três camadas (overlay + unificação + Google). Auto-Google **não** roda no boot silencioso (não inunda o Calendar com o backlog) — só em ação manual com o toggle ligado.

4. **🤖 Auto-agendamento de prazos** (**v6.86.0**) — a pedido, sobre toda a caixa:
   - Intimações não tratadas são **vinculadas automaticamente** ao processo da carteira (CNJ idêntico) e, quando o parser extrai prazo numérico do teor (confiança ≥50% — na prática regex 75–92% e keywords 70%), o **prazo é criado automaticamente** (fatal interna, etapa atribuido, cobrança imediata) e a intimação recebe ciência do sistema.
   - **Fila de revisão 🤖** no topo de Publicações: Confirmar / Ajustar fatal (auditado) / Cancelar. Card no Kanban ganha badge 🤖 até revisar.
   - **Guardas**: backlog com fatal já vencida é tratado SEM criar prazo (marca `prazo_expirado`, listado no relatório); órfãs sem CNJ na carteira e teores sem prazo extraível ficam na caixa pra triagem manual; dedup por (djenHash, tipo); idempotente.
   - Roda no boot (silencioso) + botão "🤖 Auto-agendar" na caixa (com relatório modal). 8 casos de teste integrados (mock DB) + parse OK.
   - Decisões do titular: confiança ≥50% · cobrança imediata sem esperar revisão · incluir todo o backlog (com a guarda de expiradas acima).

**Pendente de ação manual (#44):**

- **Apps Script**: recolar do raw em `main` → `backend/Lembretes.gs` (fatal interna + marco FATAL + sem-ACK).
- **LOCAWEB**: subir `v6.85.0` via FileZilla (`index.html`, `service-worker.js` — `api.js` não mudou nesta versão).

**Parecer sobre spec externa (Prazos em PostgreSQL):** avaliada uma spec de redesign do módulo Prazos (event sourcing + outbox em PostgreSQL, vinda de conversa antiga que assumia v4.2.2). **Decisão: descartada a adoção literal** — arquitetura incompatível com o stack (Firestore/Apps Script, sem banco relacional nem servidor pra triggers/workers) e ~70% do conteúdo funcional já existe na v6.84.0 (cálculo CPC 219/224 com diário auditável, feriados por comarca, marcos T-7…T+1 idempotentes, escalonamento com ausência, Torre de Prazos). **4 conceitos aproveitados → incorporados ao escopo do #44:**

1. **Data fatal interna** = fatal − 2 dias úteis: cobrança passa a usar a interna; a fatal real é limite absoluto, nunca meta.
2. **ACK de ciência + escalonamento por inatividade**: prazo atribuído sem ciência do responsável em 24h → escala pro sócio (hoje só escala por proximidade da fatal).
3. **Máquina de estados** `ATRIBUIDO → CIENTE → EM_ELABORACAO → EM_REVISAO → PROTOCOLADO` = as colunas do Kanban.
4. **Trilha de eventos** `eventos[]` no doc do prazo (recálculo registra `{antes, depois, motivo}`; marcar PROTOCOLADO exige comprovante).

---

## 🎯 Onde paramos (sessão 04–05/06/2026)

**Trabalhos da sessão** (todos em produção):

1. **#39** — Vincular publicação órfã a processo existente
2. **#28** — Feriados municipais por comarca (Goiânia/Anápolis) + suspensões manuais
3. **#40** — Co-titularidade `ucjuridico@` (Firebase + Apps Script + rules + alertas)
4. **#41** — Hospedagem profissional LOCAWEB (`uc.uranydecastro.adv.br` + SSL)
5. **#27** — Rede de segurança DJEN: entrada manual + alerta de silêncio
6. **#32 / #33** — Decisões de produto (manter registry MNI + manter Financeiro)
7. **#43** — Auditoria de segurança 2026-06 — concluída (2 fixes deployados)
8. **#29** — Backup diário pro Drive + watchdog
9. **#30** — Torre de Prazos como tela inicial
10. **#31** — Protocolo eletrônico religado com gating (TJGO + 9 outros tribunais validados)
11. **#23** — Export Excel completo com 4 abas (Processos · Prazos · Financeiro · Clientes)
12. **#44** — Kanban de prazos: análise + escopo registrado pra implementar depois
13. **perf** — Cache em memória TTL 5min em DB.getAll_ (lentidão geral)

**Pendente de ação manual no servidor LOCAWEB:**

Subir a versão **`v6.83.0`** via FileZilla:
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/index.html
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/api.js
- https://raw.githubusercontent.com/eduardourany-dot/uc-juridico/main/service-worker.js

(O GitHub Pages auto-builda sozinho — só LOCAWEB exige upload.)

**Pendente de ação manual no Apps Script:**

Recolar (do raw em `main`) caso ainda não tenha feito:
- `backend/Lembretes.gs` — vigia DJEN-captura + backup (#27 parte 2 + #29)
- `backend/Backup.gs` — backup diário (#29)
- `backend/DjenCron.gs` — grava `lastPubAt` (#27 parte 2)

Trigger de backup configurado? Confirmar no painel Apps Script → Acionadores: deve haver **`cron_backupDiario`** time-driven 03h–04h.

---

## 🔐 Credenciais & acessos

Sem segredos neste arquivo. Tudo crítico vive em:
- **Firebase Console** (`uc-juridico` e `uc-juridico-staging`): acesso por Owner via `eduardourany@` ou `ucjuridico@`
- **Apps Script Properties**: `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `BACKUP_DRIVE_FOLDER_ID`, `DJEN_PROXY_URL`, `FCM_SERVICE_ACCOUNT_JSON`
- **Cloudflare / Vercel**: env vars dos workers (`ALLOWED_ORIGINS` etc.)
- **Service accounts (.json)**: ficam apenas em `tools/migration/` local, protegidos por `.gitignore`

> Se for trabalhar em outro dispositivo e precisar deployar rules: rode `firebase login --reauth` na primeira vez.

---

## 📞 Como o Claude continua

Se for usar o Claude (Code, Anthropic, ou outra interface) no novo dispositivo:

1. Abra o repositório local (`uc-juridico`) na ferramenta que esteja usando.
2. Mostre este `HANDOFF.md` (ou só diga "leia o HANDOFF.md").
3. Continue de onde parou — todas as tasks estão no histórico do git e na descrição commit-a-commit.

Em particular, ao iniciar com Claude no outro dispositivo, peça:
> "Leia o HANDOFF.md, confirme o estado atual e me ajude a continuar com **<tarefa>**."

---

## 🧹 Arquivos gerados localmente (não commitados)

Ficam só no dispositivo onde foram gerados, não vão pro git:

- `_docs_gerados/ROADMAP_UC_Juridico_Junho_2026.docx` — documento de divulgação pra equipe (gerado em 04/06/2026)
- `_docs_gerados/gerar_roadmap.js` — script que gera o doc acima
- `tools/migration/service-account*.json` — credenciais Firebase Admin

Se precisar gerar no outro dispositivo, é só rodar o `gerar_roadmap.js` de novo após `npm install -g docx`.

---

**Bom trabalho — e até a próxima sessão.**
