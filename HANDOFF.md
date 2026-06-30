# UC Jurídico — Handoff de Sessão

> Documento vivo. Atualizado a cada virada de dia ou troca de dispositivo. **Última atualização:** 2026-06-29.

---

## 📍 Estado atual

| Item | Valor |
|---|---|
| **Versão no código (`main`/`sandbox`)** | `v6.87.1` + `Lembretes.gs` consolidado |
| **Versão em produção (LOCAWEB)** | `v6.86.0` — ⏳ **v6.87.1 pendente de upload** |
| **Último commit** | `993a1d7` — docs: regenera ROADMAP (jun/2026) |
| **Branches** | `main` = `sandbox` = `claude/continuidade-aaq0lh` (em sincronia, fast-forward) |
| **Working tree** | Limpo |
| **Repositório** | https://github.com/eduardourany-dot/uc-juridico |

### ⛔ E-mails de lembrete SUSPENSOS (até segunda ordem)

Por decisão do titular (jun/2026), os e-mails do backend estão **desligados** enquanto o sistema de prazos não está 100% operante (estavam só lotando as caixas). Interruptor: `const EMAILS_SUSPENSOS = true;` no topo da seção de e-mail do `backend/Lembretes.gs`. **O push continua normal.** Pra **reativar**: trocar para `false` e recolar o `Lembretes.gs` no Apps Script (ou pedir ao Claude).

### ⏳ Pendências de ação manual (fazer pra colocar o épico Prazos no ar)

1. **LOCAWEB (FileZilla)** — subir `index.html` + `service-worker.js` (v6.87.1). Conferir rodapé `v6-87-1`. *(`api.js` não mudou desde o último upload.)*
2. **Apps Script ("UC Juridico Backend")** — colar `backend/Lembretes.gs` (e-mail consolidado por processo + fatal interna/FATAL/sem-ACK).
3. **Apps Script (só verificar)** — Google Calendar API habilitada em Serviços (já usada pelo Meet; provável que sim) — necessária pro sync de prazos → Google Calendar.

As três são independentes. Sem (1) a Agenda/Kanban novos não aparecem; sem (2) os e-mails continuam saindo um por parte.

### Onde está rodando

- 🌐 **Produção LOCAWEB** (profissional): https://uc.uranydecastro.adv.br/ — *requer upload manual via FileZilla pra refletir cada nova versão*
- 🌐 **Produção GitHub Pages** (legado, paralelo): https://eduardourany-dot.github.io/uc-juridico/ — auto-build do branch `main`
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
| 44 | P3 | Kanban de prazos + máquina de estados + épico Prazos | ✅ implementado (v6.85→v6.87.1) — ⏳ deploy manual pendente |
| 34 | P3 | Petição IA: fila de revisão do advogado | pendente |
| — | ⭐ | Calculadora Fase 2 (tab Fiscal, histórico, export) | pendente |
| — | ⭐ | Relatórios automáticos pro cliente | pendente |

**P0/P1 críticos zerados.** Backlog completo e priorizado em `docs/ROADMAP.md`.

---

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
| **GitHub Pages** | Automático no push pra `main` |
| **LOCAWEB** | Manual via FileZilla — subir os arquivos alterados (`index.html`, `service-worker.js`, `api.js`) do raw de `main` |
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
