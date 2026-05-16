# UC Jurídico — Cloud Functions

Cron de varredura DJEN rodando em `southamerica-east1` (São Paulo).

## Por que aqui e não no Apps Script?

A API DJEN (`comunicaapi.pje.jus.br`) é geo-bloqueada pelo CloudFront: aceita só requests do Brasil. Apps Script roda em IPs Google Cloud nos EUA → HTTP 403. Cloudflare Workers free também roteiam pra POP americano quando chamados de IP americano. **Cloud Functions em `southamerica-east1` é a única solução free que garante IP brasileiro.**

## Setup (uma vez)

### 1. Habilitar Blaze plan no Firebase

Functions v2 exige plano **Blaze** (pay-as-you-go). Free tier cobre nosso uso:
- 2M invocations/mês (usamos ~22)
- 400k GB-segundos compute (usamos ~5)
- 5GB egress (usamos < 0.5GB)

Custo real estimado: **R$ 0** mesmo com cron ativo.

Como ativar:
1. https://console.firebase.google.com/project/uc-juridico/usage/details
2. **Modificar plano** → escolher **Blaze**
3. Adicionar cartão de crédito (Google só cobra se passar do free tier — pode setar **orçamento mensal R$5** pra alerta de segurança)

### 2. Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

Se já estava logado, confirma com `firebase projects:list`.

### 3. Dependências locais

```bash
cd functions
npm install
```

### 4. Deploy

```bash
firebase deploy --only functions
```

Output esperado (depois de uns 2-3min):
```
✔  functions[djenAutoCheckCron(southamerica-east1)] Successful create operation.
✔  functions[djenAutoCheckHttp(southamerica-east1)] Successful create operation.
✔  Deploy complete!
```

Cloud Scheduler é criado automaticamente — verifica em https://console.cloud.google.com/cloudscheduler.

### 5. Teste manual

#### Opção A — Via Firebase Console
1. https://console.firebase.google.com/project/uc-juridico/functions
2. Clica em `djenAutoCheckCron` → tab **"Acionadores"** → **"Forçar execução"**

#### Opção B — Via HTTP (com auth)

Set o secret uma vez (opcional, recomendado pra evitar invocação anônima):
```bash
firebase functions:secrets:set DJEN_HTTP_SECRET
# digita uma senha aleatória, ex: "alguma-string-longa-aqui-123"
firebase deploy --only functions:djenAutoCheckHttp
```

Roda dry-run (não grava nem manda push):
```bash
curl "https://southamerica-east1-uc-juridico.cloudfunctions.net/djenAutoCheckHttp?secret=alguma-string-longa-aqui-123&dry=1"
```

Roda real:
```bash
curl "https://southamerica-east1-uc-juridico.cloudfunctions.net/djenAutoCheckHttp?secret=...&dry=0"
```

### 6. Ver logs

```bash
firebase functions:log --only djenAutoCheckCron
```

Ou no console: https://console.firebase.google.com/project/uc-juridico/functions/logs

## Schedule

`0 8 * * 1-5` America/Sao_Paulo = **08h00 de segunda a sexta**.

Pra mudar, editar em `index.js` linha do `onSchedule({ schedule: ... })` e re-deploy.

## Schema novo no Firestore

`djen/{hash}` ganha campos do cron:
- `source: 'djen-cron'`
- `status: 'pending'` (cron) → `imported` ou `orphan` (após user triar) → `dismissed` (opcional)
- `matched: boolean` — classificação do cron
- `fetchedAt: timestamp`

`settings/djenCron`:
- `value.enabled: boolean` (default true; setar false desliga o cron sem precisar pausar trigger)
- `value.lastRun: timestamp`
- `value.lastDataFim: 'YYYY-MM-DD'`
- `value.lastNovas: number`
- `value.lastOrfas: number`

## Tirar do ar

Pausar trigger (mantém código deployed):
```bash
gcloud scheduler jobs pause djenAutoCheckCron --location=southamerica-east1
```

Desativar via Firestore (mais simples — só seta `enabled: false`):
```js
// No browser console, com user admin logado:
firebase.firestore().doc('settings/djenCron').set(
  { value: { enabled: false }, updatedAt: Date.now() },
  { merge: true }
);
```

Remover por completo:
```bash
firebase functions:delete djenAutoCheckCron --region southamerica-east1
firebase functions:delete djenAutoCheckHttp --region southamerica-east1
```
