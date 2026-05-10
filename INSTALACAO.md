# UC Jurídico — Instalação e operação

Versão atual: **v6.15.0**
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

Funções de teste manual em `Lembretes.gs`:
- `_testarFcmAccessToken()` — confirma JWT/OAuth2
- `_testarFirestoreList()` — confirma leitura Firestore via REST
- `_testarFcmEnvio()` — envia push de teste (cole token na constante)
- `_previewLembretesDePrazo()` — varre prazos sem enviar

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
| v6.15 | ✅ em produção | Sprint 3 C — email Gmail Workspace nos marcos críticos (T-1/T-0/T+1) |
| **v6.16** | **próxima** | Módulo Financeiro: receitas, despesas, bancos, cartões, parcelamento de honorários, balancete |
| v6.17+ | planejado | CRM de clientes (Cliente vira entidade), agenda unificada, tarefas/projetos, formulário de atendimento |
| v7.x | futuro | Módulo Petições com integração Claude API |

Pendências menores:
- Reescrita do `INSTALACAO.md` (este documento — feita em v6.14.2)
- Corpus de validação do parser (50 publicações com gabarito) — coleta incremental
- Tier 3 LLM no parser (após corpus mostrar acerto baixo) — não bloqueia
- Migração futura para AWS SES (se precisar enviar pra clientes externos com volume alto): trocar 1 chamada em `enviarEmail()` no `Lembretes.gs`

---

**Eduardo Urany de Castro · OAB/GO 16.539 · OAB/DF 87.243**
Goiânia · Av. Deputado Jamel Cecílio, 2690 · Ed. Metropolitan Mall · sala 2903 · Jardim Goiás · CEP 74.810-100
Anápolis · Rua Conde Afonso Celso, 557 · Centro · CEP 75.025-030
