# UC Jurídico — Instalação e operação

Versão atual: **v6.36.0**
URL pública: https://eduardourany-dot.github.io/uc-juridico/
Repositório: https://github.com/eduardourany-dot/uc-juridico

---

## O que é

Plataforma interna de gestão jurídica do escritório **Urany de Castro Advocacia** (Anápolis/GO + Goiânia/GO). PWA estático servido via GitHub Pages, com backend gerenciado em Firestore + Apps Script.

**Funcionalidades principais (v6.14.x):**

| Módulo | O que faz |
|---|---|
| **Processos** | Cadastro completo (CNJ, cliente, parte adversa, tribunal, advogado titular, suplente, risco, honorários, área tributária com CDAs) |
| **Prazos** | Captura via DJEN + cálculo de data fatal (art. 224 CPC, dias úteis, recesso forense, prazo em dobro) + cumprimento explícito (data + protocolo) + auto-perdido + push 24/7 |
| **Eventos** | Timeline de movimentações (DataJud / DJEN / manual) |
| **Notas** | Anotações livres por processo, vinculáveis a eventos |
| **Jurisprudência** | Catalogação por tipo (REsp, Tema, Súmula…) |
| **PDFs** | 12 ferramentas (extração, dividir, juntar, OCR via Tesseract, indexar autos…) |
| **Diligência rápida** | Modo otimizado mobile pra audiência/fórum |
| **DJEN** | Monitoramento automático via API CNJ pelas OABs do escritório |
| **DataJud** | Sincronização de movimentos por CNJ |
| **Configurações > Equipe** | Sócio padrão, status de ausência, sub-aba de notificações neste dispositivo |

---

## Stack técnica

| Camada | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS monolítico (`index.html`, ~330KB) + PWA service worker |
| Auth | Firebase Authentication (Google OAuth) |
| Banco | Firestore (collections: `processos`, `prazos`, `eventos`, `notas`, `jurisprudencia`, `djen`, `settings`, `users`, `audit`) |
| Push notifications | Firebase Cloud Messaging (FCM) |
| Backend (PDFs) | Google Apps Script (Drive API) + Sheets como fallback histórico |
| Backend (cron lembretes) | Apps Script com trigger time-driven 30min, FCM HTTP v1 + JWT manual |
| Email (lembretes críticos) | Gmail Workspace via `MailApp.sendEmail` (Apps Script) — 2K/dia |
| OCR | Tesseract.js |
| PDF | pdf.js + pdf-lib |
| Estilo | Tailwind CSS (CDN) + EB Garamond + Inter |

---

## Como atualizar

### Para usuários do escritório (10 advogados + staff)

Nada manual. O service worker (`uc-juridico-v6-X-Y`) detecta versão nova ao recarregar e força refresh em ~5s.

Se algo não atualizar:
1. `Ctrl+Shift+R` (hard refresh)
2. Se persistir: DevTools (`F12`) → Application → Storage → "Clear site data" → recarregar

### Para o admin (Eduardo)

```bash
# 1. Edita o código localmente
git pull
# ... faz alterações em index.html / api.js / etc ...

# 2. Bump de versão em três lugares:
#    - index.html linha do rodapé (v6.X.Y)
#    - service-worker.js linhas 1 e 2 (uc-juridico-v6-X-Y)
#    - INSTALACAO.md (este arquivo, no topo)

# 3. Commit + push
git add -A
git commit -m "vX.Y.Z: descrição"
git push origin main

# 4. GitHub Pages redeploya em 1–2 min
# 5. Service worker força refresh nos clientes ao recarregar
```

---

## Setup de novo dispositivo (advogado novo)

1. Receber convite da admin (Eduardo) — sua conta Google é adicionada à allowlist (`users/{email}` no Firestore)
2. Acessar https://eduardourany-dot.github.io/uc-juridico/
3. Login com Google da conta `@uranydecastro.com.br`
4. Para receber push de prazo: **Configurações → Equipe → Notificações → 🔔 Permitir**

### Adicionar advogado à allowlist (admin)

Tem três caminhos:

**A. Bootstrap (primeiro admin do escritório):** auto-cria-se no primeiríssimo login se o email for `eduardourany@uranydecastro.com.br` (regra hardcoded em `firestore.rules`).

**B. Console Firebase (recomendado):**
1. https://console.firebase.google.com/project/uc-juridico/firestore/data
2. Coleção `users` → "+ Adicionar documento"
3. ID do doc = email lowercase
4. Campos: `nome` (string), `role` (`'admin'` ou `'user'`), `ativo` (boolean true), `criadoEm` (timestamp)

**C. Apps Script:**
- `addUsuario('email@x.com', 'Nome Completo', 'user')` no editor (`UC Jurídico Backend` → `Codigo.gs`)

---

## Setup de admin (do zero, em outro projeto Firebase)

> Caso precise replicar o app para outro escritório no futuro.

### 1. Firebase Project
1. Console Firebase → criar projeto novo
2. Habilitar **Authentication** (Google provider) + **Firestore Database** (modo produção, região `nam5` ou `southamerica-east1` se Blaze)
3. **Cloud Messaging** habilitado por default no Spark
4. Em **Project Settings → Geral**: registrar app Web
5. Em **Cloud Messaging**: gerar **VAPID Web Push Certificate**
6. Em **Service Accounts**: gerar nova chave privada (JSON)

### 2. `config.js`
- Atualizar `firebaseConfig` com as chaves do app Web
- Atualizar `FCM_VAPID_PUBLIC_KEY`
- `OAUTH_CLIENT_ID` deve bater com o do projeto Cloud (não Firebase)

### 3. Firestore Security Rules
- Subir `firestore.rules` via Firebase CLI: `firebase deploy --only firestore:rules`
- Ajustar email do bootstrap admin se for outro escritório

### 4. Apps Script Backend
- Criar projeto Apps Script "UC Jurídico Backend"
- Copiar `backend/Codigo.gs`, `backend/Bootstrap.gs`, `backend/Lembretes.gs`
- Em ⚙ Script Properties cadastrar:
  - `OAUTH_CLIENT_ID` (mesmo do Firebase Auth)
  - `DRIVE_FOLDER_ID` (pasta Drive pra PDFs)
  - `SPREADSHEET_ID` (planilha de auditoria/legado, opcional)
  - `FCM_SERVICE_ACCOUNT_JSON` (Service Account JSON inteiro, do passo 1.6)
- Rodar `_testarFCMConfig`, `_testarFcmAccessToken`, `_testarFirestoreList` pra validar
- **Acionadores**: criar trigger time-driven 30min em `cron_lembretesDePrazo`

### 5. GitHub Pages
- Push do repositório
- Settings → Pages → branch `main` → `/`
- Adicionar origem JS no OAuth Client (Cloud Console) com a URL

---

## Backend Apps Script

| Arquivo | Função |
|---|---|
| `backend/Codigo.gs` | doGet/doPost legacy — só PDFs via Drive (a maioria das collections migrou pra Firestore) |
| `backend/Bootstrap.gs` | Setup inicial da planilha de allowlist (legado) |
| `backend/Lembretes.gs` | Cron horário de envio FCM (Sprint 3 B.2) — JWT manual + Firestore REST API + FCM HTTP v1 |
| `backend/Backup.gs` | Cron semanal de backup Firestore → Drive (v6.28+) |
| `backend/Peticoes.gs` | Proxy Apps Script → Anthropic Claude API (v6.35+, Sprint Pet.3) |

Funções de teste manual em `Lembretes.gs`:
- `_testarFcmAccessToken()` — confirma JWT/OAuth2
- `_testarFirestoreList()` — confirma leitura Firestore via REST
- `_testarFcmEnvio()` — envia push de teste (cole token na constante)
- `_previewLembretesDePrazo()` — varre prazos sem enviar

Funções de teste manual em `Backup.gs`:
- `_testarBackupConfig()` — valida pasta Drive + access token + lista das coleções
- `executarBackupAgora()` — roda backup sem esperar trigger
- `_listarBackupsExistentes()` — mostra arquivos atuais na pasta Drive

---

## Setup do backup automático (v6.28+)

> Backup semanal automático de **todas as coleções Firestore** para uma pasta Drive privada do escritório. Mantém os 12 arquivos mais recentes (rotação automática). Roda em paralelo ao cron de lembretes — sem custo adicional no Spark.

### 1. Criar pasta Drive
1. Acesse https://drive.google.com com a conta `eduardourany@uranydecastro.com.br` (mesma do Apps Script)
2. Criar pasta `UC Juridico — Backups` em local privado (não compartilhar)
3. Abrir a pasta → copiar o ID da URL (parte após `folders/`)
   Ex.: `https://drive.google.com/drive/folders/1AbCdEfGhIj...` → ID = `1AbCdEfGhIj...`

### 2. Apps Script
1. Abrir https://script.google.com → projeto **UC Jurídico Backend**
2. Criar novo arquivo `Backup.gs` → colar o conteúdo de `backend/Backup.gs`
3. Em **⚙ Configurações do projeto → Propriedades do script**, adicionar:
   - `BACKUP_DRIVE_FOLDER_ID` = ID copiado no passo 1
4. Validar: rodar função `_testarBackupConfig` → verificar logs em "Execuções":
   - ✓ Pasta Drive acessível
   - ✓ Access token Firestore OK
   - Lista das coleções com contagem de docs

### 3. Trigger semanal
1. Em **⏰ Acionadores → + Adicionar acionador**:
   - Função: `cron_backupSemanal`
   - Origem: `Acionado por tempo`
   - Tipo: `Acionador semanal`
   - Dia: `Todo domingo`
   - Hora: `Entre 03:00 e 04:00`
2. Salvar — primeiro run acontece no próximo domingo de manhã

### 4. Rodar primeiro backup imediatamente
- Editor Apps Script → função `executarBackupAgora` → ▶ Executar
- Logs em "Execuções" mostram tamanho, total de docs, ID do arquivo Drive
- A aba `Configurações → Backup` no app vai começar a mostrar o "Último backup automático"

### Restauração (caso precise)
> Não há automação — restauração é manual e raríssima.

1. Baixar o `.json` mais recente da pasta Drive
2. Abrir Firebase Console → Firestore Database → coleção a restaurar
3. Para coleção limpa: importar via script Node.js usando Admin SDK + JSON do backup
4. Para restauração de doc específico: copiar campo `collections.<colecao>.<docId>` e colar manualmente no console

---

## Setup da geração com IA — Claude API (v6.35+, Sprint Pet.3)

> Permite gerar petições com Claude diretamente do app. Briefing + contexto do processo (CNJ, partes, eventos, prazos, jurisprudência) viram input pra Claude, que devolve a peça em Markdown. Custos cobrados na conta Anthropic.

### 1. Conta Anthropic
1. Criar conta em https://console.anthropic.com
2. **Billing** → adicionar cartão de crédito · começar com US$ 20–50 de saldo
3. **API Keys** → **Create Key** → copiar a chave (`sk-ant-...`) e guardar em local seguro (Anthropic só mostra uma vez)

### 2. Apps Script
1. https://script.google.com → projeto **UC Jurídico Backend**
2. **+ Novo arquivo** → **Script** → nome `Peticoes`
3. Apagar conteúdo padrão e colar tudo de [backend/Peticoes.gs](uc-juridico/backend/Peticoes.gs)
4. Verificar que `Codigo.gs` foi atualizado (já tem `case 'gerarPeticaoIA'` no switch — se você copiou Codigo.gs antes da v6.35, atualize)
5. 💾 Salvar

### 3. Script Property
1. ⚙ **Configurações do projeto** → **Propriedades do script** → **+ Adicionar**
2. Nome: `CLAUDE_API_KEY`
   Valor: a chave `sk-ant-...` copiada no passo 1
3. **Salvar propriedades do script**

### 4. Validar
1. Editor → função `_testarClaudeKey` → ▶ Executar
2. Logs em **Execuções**:
   - `✓ CLAUDE_API_KEY configurada (length 108, prefix sk-ant-...)`
3. Função `_testarChamadaClaude` → ▶ Executar (faz uma chamada pequena pra validar)
4. Logs:
   - `✓ Resposta: ping`
   - `Input tokens: X · Output: Y`
   - `Custo estimado: $0.0000XX`

### 5. Re-implantar Web App (importante!)
> Apps Script só expõe novas actions após re-implantação.

1. Editor → **Implantar** → **Gerenciar implantações**
2. Editar a implantação atual → **Versão** = "Nova versão" → **Implantar**
3. URL fica a mesma — frontend não precisa mudar nada

### 6. Usar
- No app: abrir um processo → header → **🤖 Gerar com IA** (botão dourado ao lado de "📝 Gerar petição")
- Modal pede briefing (o que você quer argumentar). Opcionalmente escolha um template já cadastrado pra usar seu `promptSistema` (campo novo no editor de modelo, /modelos → editar → "System prompt da IA")
- Submit → Claude responde em ~30s a 2min → preview com texto editável + Save / .docx / Copy
- Petição salva fica vinculada ao processo com `geradoPor: claude-opus-4-7`, `briefing`, `contextoSnapshot`, `tokensInput/Output`, `custoEstimado` (rastreável depois)

### Funções de teste manual em `Peticoes.gs`
- `_testarClaudeKey()` — valida que a chave está em Script Properties
- `_testarChamadaClaude()` — faz uma chamada real pequena pra confirmar conexão
- Audit log: cada geração registra `audit_(email, 'gerarPeticaoIA', 'peticoes', ...)`

### Modelos suportados
Trocar a constante `CLAUDE_MODELO_DEFAULT` em `Peticoes.gs`:
- `claude-opus-4-7` — mais capaz, $15/$75 por 1M tokens (default)
- `claude-sonnet-4-6` — equilíbrio, $3/$15 por 1M tokens
- `claude-haiku-4-5` — rápido/barato, $0.80/$4 por 1M tokens

Estimativa de custo por petição: ~$0.10–$0.50 com Opus, ~$0.02–$0.10 com Sonnet, ~$0.005 com Haiku (depende do tamanho do contexto + output).

---

## Operação rotineira

### Monitorar consumo Firestore (Spark plan)

https://console.firebase.google.com/project/uc-juridico/usage

Limites diários:
- **Reads**: 50K/dia
- **Writes**: 20K/dia

Otimizações em vigor (v6.14.1+):
- Cache em memória de 5min nos métodos `DB.getAll*` / `DB.getSetting`
- `cron_lembretesDePrazo` usa `:runQuery` filtrado por janela [hoje-2, hoje+8]

Se passar de 30K reads em poucas horas, investigar antes de estourar.

### Monitorar cron de lembretes

https://script.google.com → projeto **UC Jurídico Backend** → ⏰ Acionadores

Verificar:
- Última execução recente (a cada 30 min)
- Taxa de erros próxima de zero
- Logs em "Execuções" (menu lateral)

---

## Bugs históricos pra não repetir

1. **Apps Script `CacheService.put`** quebra com key > 250 chars → sempre hashear (`tokenHash_()` em `Codigo.gs`)
2. **Firebase Auth allowlist** vive em **dois lugares**: Firebase Console (Auth → Settings → Authorized domains) **e** Cloud Console (OAuth Client → Origens JS). Adicionar nos dois ao adicionar domínio novo
3. **Firestore region `nam5`** é definida no primeiro deploy e não muda. Spark fica preso em US. Pra mudar pra `southamerica-east1` precisa Blaze + recriar projeto
4. **Service Worker não atualiza** se o cache name não mudar entre versões. Sempre bumpar `CACHE_NAME` no `service-worker.js` ao publicar
5. **`firebase-messaging-sw.js`** precisa de `skipWaiting()` + `clients.claim()` ou fica preso em "installed" e não recebe pushes em background

---

## Roadmap

| Versão | Estado | Conteúdo |
|---|---|---|
| v6.7–v6.10 | ✅ entregue | Módulo Prazos: state machine completo + cumprimento explícito + auto-perdido + UI de Equipe |
| v6.11–v6.13 | ✅ entregue | Lembretes via Web Notifications in-app (B.1) |
| v6.14 | ✅ entregue | FCM real (B.2) — push 24/7 com app fechado + cache em memória |
| v6.15 | ✅ entregue | Sprint 3 C — email Gmail Workspace nos marcos críticos (T-1/T-0/T+1) |
| v6.16 | ✅ entregue | Módulo Financeiro A.1 — Bancos + Transações + Visão Geral |
| v6.17 | ✅ entregue | Módulo Financeiro A.2 — Cartões + Categorias com orçamento + filtros avançados |
| v6.18 | ✅ entregue | Módulo Financeiro A.3 — Honorários parcelados + integração com Processos |
| v6.19 | ✅ entregue | Sprint Cli.1 — Cliente vira entidade dedicada (rota /clientes + CRUD + migração lazy de processos) |
| v6.20 | ✅ entregue | Sprint Cli.2 — Honorário vinculado a Cliente + `processosCobertos[]` (multi-vinculação) |
| v6.21 | ✅ entregue | Sprint Cli.3 — aba "Cliente" no processo + dashboard `/clientes/{id}` + dropdown de cliente nos forms de processo |
| v6.22 | ✅ entregue | Financeiro A.4 — Recorrências mensais + Balancete por mês/ano + exportações CSV |
| v6.23 | ✅ entregue | Sprint Cli.4 — Comunicações com cliente + follow-ups |
| v6.24 | ✅ entregue | Financeiro A.5 — push/email de parcela vencendo via cron Apps Script (reusa Sprint 3) |
| v6.25.0 | ✅ entregue | Sprint Agenda Unificada — compromissos (audiência/reunião/diligência/prazo admin) com push+email T-1/T-0, aba no processo, seção no cliente, bloco no dashboard inicial |
| v6.25.1 | ✅ entregue | Agenda consolidada — prazos processuais ativos aparecem como cards read-only na rota `/agenda` (toggle "Incluir prazos do processo"). Cumprimento/edição segue em /prazos. |
| v6.26.0 | ✅ entregue | Relatório executivo mensal — rota `/relatorio` consolida pulso financeiro, processual, clientes e compromissos. Seletor de mês + export CSV. |
| v6.27.0 | ✅ entregue | Modelos de petição (Pet.0) — rota `/modelos` com CRUD de templates Markdown + placeholders. Botão "📝 Gerar petição" no header do processo. Substituição literal (sem Claude API ainda). |
| v6.28.0 | ✅ entregue | Backup automático Drive — cron semanal Apps Script faz dump JSON de todas as 19 coleções para pasta privada do Drive. Rotação automática (12 mais recentes). |
| v6.29.0 | ✅ entregue | Ações inline de prazo na agenda — botões ✓ cumprir · ⏸ suspender · ⊘ cancelar · ▶ reabrir direto no card. Funções de ação agnósticas ao contexto. |
| v6.30.0 | ✅ entregue | Calendário visual mensal — toggle 📋 Lista / 📅 Calendário no header de `/agenda`. Grid 7×N + chips por dia. |
| v6.31.0 | ✅ entregue | Petições Pet.1 — versionamento + aba "Petições" no processo + editor com "+ Nova versão" / status / arquivar. |
| v6.32.0 | ✅ entregue | Indicadores por advogado — rota `/equipe` com picker + 8 cards + listas (próximos prazos, vencidos não-cumpridos, próximos compromissos, processos por papel). |
| v6.33.0 | ✅ entregue | Modo escuro completo — 3 opções (☀/🌙/🖥 Auto via matchMedia) + toggle rápido na sidebar. |
| v6.34.0 | ✅ entregue | Petições Pet.2 — export .docx (Garamond + cabeçalho/rodapé) + 5 templates seed instaláveis com 1 clique. |
| v6.35.0 | ✅ entregue | Petições Pet.3 — proxy Apps Script → Claude API + botão "🤖 Gerar com IA" no processo + audit log de tokens/custo. |
| **v6.36.0** | ✅ em produção | **Dashboard "Minhas tarefas hoje"** — card no topo do `/` personalizado pelo advogado logado (via `defaultAdvogado(email)`). Agrupa em sub-blocos coloridos: ⚠ prazos vencidos não-cumpridos, 🚨 prazos HOJE, ⏰ prazos amanhã, 📅 compromissos HOJE/amanhã, 🔔 follow-ups vencidos (próximaAcao com data ≤ hoje), 💰 parcelas de honorário vencendo nos próximos 3 dias (filtradas pelos processos onde sou titular). Empty state quando nada urgente. Botão ✓ inline pra cumprir prazo vencido sem sair da home. Badge vermelho com contador total no header do card. |
| v6.22+ | planejado | Retomada Financeiro A.4 (Recorrências + Balancete) → A.5 → Agenda unificada |
| v7.x | planejado | Módulo Petições com Claude API (briefing em [docs/BRIEFING_Peticoes.md](docs/BRIEFING_Peticoes.md)) |

Pendências menores:
- Reescrita do `INSTALACAO.md` (este documento — feita em v6.14.2)
- Corpus de validação do parser (50 publicações com gabarito) — coleta incremental
- Tier 3 LLM no parser (após corpus mostrar acerto baixo) — não bloqueia
- Migração futura para AWS SES (se precisar enviar pra clientes externos com volume alto): trocar 1 chamada em `enviarEmail()` no `Lembretes.gs`

---

**Eduardo Urany de Castro · OAB/GO 16.539 · OAB/DF 87.243**
Goiânia · Av. Deputado Jamel Cecílio, 2690 · Ed. Metropolitan Mall · sala 2903 · Jardim Goiás · CEP 74.810-100
Anápolis · Rua Conde Afonso Celso, 557 · Centro · CEP 75.025-030
