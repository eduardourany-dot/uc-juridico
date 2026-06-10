# UC Jurídico — Handoff de Sessão

> Documento vivo. Atualizado a cada virada de dia ou troca de dispositivo. **Última atualização:** 2026-06-10.

---

## 📍 Estado atual

| Item | Valor |
|---|---|
| **Versão em prod** | `v6.83.0` |
| **Último commit (main + sandbox)** | `2428ab5` — perf: cache em memória TTL 5min em DB.getAll_ |
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
- **Co-titularidade**: `eduardourany@uranydecastro.com.br` + `ucjuridico@uranydecastro.com.br` (segunda titular em Firebase IAM, Apps Script, allowlist e alertas)

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
| 22 | P3 | Meet Fase 3 — auto-convidados + RSVP | pendente |
| 34 | P3 | Petição IA: fila de revisão do advogado | pendente |
| 42 | Aux | `ucjuridico@` como membro em GitHub/CF/Vercel | ✅ concluído 10/06 — GitHub + Cloudflare ok; Vercel mantido solo (decisão B, ver `docs/RUNBOOK_42_cotitularidade.md`) |
| 44 | P3 | Kanban de prazos — quadro visual de estado | pendente |

**P0 e P1 zerados.** Tudo crítico está em produção.

> Backlog detalhado vive no sistema de tasks do Claude. Cada item tem descrição rica com escopo, esforço e ganchos com outras tarefas.

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
